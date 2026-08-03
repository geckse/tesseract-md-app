import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline'

import type { IngestActivityEvent, IngestProgress, IngestResult } from '../renderer/types/cli'
import { redactActivityText } from './activity-log'
import { findCli } from './cli'

interface ActiveIngest {
  key: string
  runId: string
  root: string
  reindex: boolean
  child: ChildProcess
  promise: Promise<IngestResult>
  cancelling: boolean
  forceKillTimer: ReturnType<typeof setTimeout> | null
}

interface StreamLine {
  type?: unknown
  data?: unknown
}

export type IngestEventSink = (event: IngestActivityEvent) => void | Promise<void>

const CANCEL_GRACE_MS = 15_000

function messageFromStderr(stderr: string, fallback: string): string {
  const detail = stderr.trim()
  return redactActivityText(detail || fallback)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isProgress(value: unknown): value is IngestProgress {
  return isRecord(value) && typeof value.phase === 'string' && typeof value.elapsed_ms === 'number'
}

function isIngestResult(value: unknown): value is IngestResult {
  return (
    isRecord(value) &&
    typeof value.files_indexed === 'number' &&
    typeof value.cancelled === 'boolean' &&
    Array.isArray(value.errors)
  )
}

export class IngestProcessManager {
  private readonly active = new Map<string, ActiveIngest>()
  private readonly launching = new Map<string, Promise<IngestResult>>()
  private destroyed = false

  constructor(private readonly emit: IngestEventSink) {}

  getActive(root: string): ActiveIngest | null {
    return this.active.get(resolve(root)) ?? null
  }

  async run(root: string, reindex: boolean): Promise<IngestResult> {
    if (this.destroyed) throw new Error('Ingest process manager is shutting down')
    const key = resolve(root)
    const existing = this.active.get(key)
    if (existing) return existing.promise
    const launching = this.launching.get(key)
    if (launching) return launching

    const launch = this.start(key, root, reindex)
    this.launching.set(key, launch)
    try {
      return await launch
    } finally {
      if (this.launching.get(key) === launch) this.launching.delete(key)
    }
  }

  private async start(key: string, root: string, reindex: boolean): Promise<IngestResult> {
    const cliPath = await findCli()
    if (this.destroyed) throw new Error('Ingest process manager is shutting down')
    const runId = randomUUID()
    const args = ['ingest', '--json', '--json-lines', '--root', root]
    if (reindex) args.push('--reindex')

    const child = spawn(cliPath, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env }
    })

    let resolveRun!: (result: IngestResult) => void
    let rejectRun!: (error: Error) => void
    const promise = new Promise<IngestResult>((resolve, reject) => {
      resolveRun = resolve
      rejectRun = reject
    })

    const operation: ActiveIngest = {
      key,
      runId,
      root,
      reindex,
      child,
      promise,
      cancelling: false,
      forceKillTimer: null
    }
    this.active.set(key, operation)
    this.publish({ type: 'started', run_id: runId, root, reindex, timestamp: Date.now() })

    let stderr = ''
    let finalResult: IngestResult | null = null
    let settled = false

    if (child.stderr) {
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
        if (stderr.length > 20_000) stderr = stderr.slice(-10_000)
      })
    }

    if (child.stdout) {
      const lines = createInterface({ input: child.stdout })
      lines.on('line', (line) => {
        const trimmed = line.trim()
        if (!trimmed) return
        let parsed: StreamLine
        try {
          parsed = JSON.parse(trimmed) as StreamLine
        } catch {
          return
        }
        if (parsed.type === 'progress' && isProgress(parsed.data)) {
          this.publish({
            type: 'progress',
            run_id: runId,
            root,
            reindex,
            timestamp: Date.now(),
            progress: parsed.data
          })
        } else if (parsed.type === 'result' && isIngestResult(parsed.data)) {
          finalResult = parsed.data
        }
      })
    }

    const finish = (): void => {
      if (settled) return
      settled = true
      if (operation.forceKillTimer) clearTimeout(operation.forceKillTimer)
      if (this.active.get(key) === operation) this.active.delete(key)
    }

    child.once('error', (error) => {
      finish()
      const message = redactActivityText(error.message)
      this.publish({
        type: 'failed',
        run_id: runId,
        root,
        reindex,
        timestamp: Date.now(),
        message
      })
      rejectRun(error)
    })

    child.once('close', (code) => {
      if (settled) return
      finish()
      if (finalResult) {
        const type = finalResult.cancelled ? 'cancelled' : 'completed'
        this.publish({
          type,
          run_id: runId,
          root,
          reindex,
          timestamp: Date.now(),
          result: finalResult
        })
        resolveRun(finalResult)
        return
      }

      const message = operation.cancelling
        ? 'Indexing was cancelled before a final result was produced.'
        : messageFromStderr(stderr, `Indexing exited with code ${code ?? 'unknown'}.`)
      this.publish({
        type: operation.cancelling ? 'cancelled' : 'failed',
        run_id: runId,
        root,
        reindex,
        timestamp: Date.now(),
        ...(operation.cancelling
          ? {
              result: {
                files_indexed: 0,
                files_skipped: 0,
                files_removed: 0,
                chunks_created: 0,
                api_calls: 0,
                estimated_input_tokens: 0,
                files_failed: 0,
                errors: [],
                duration_secs: 0,
                cancelled: true,
                module_reports: []
              }
            }
          : { message })
      } as IngestActivityEvent)
      rejectRun(new Error(message))
    })

    return promise
  }

  async cancel(root: string): Promise<boolean> {
    const operation = this.active.get(resolve(root))
    if (!operation || operation.cancelling) return Boolean(operation)

    operation.cancelling = true
    operation.child.kill('SIGINT')
    operation.forceKillTimer = setTimeout(() => {
      if (this.active.get(operation.key) === operation) operation.child.kill('SIGKILL')
    }, CANCEL_GRACE_MS)
    operation.forceKillTimer.unref?.()
    return true
  }

  async destroy(): Promise<void> {
    this.destroyed = true
    for (const operation of this.active.values()) {
      operation.cancelling = true
      operation.child.kill('SIGTERM')
    }
    this.active.clear()
  }

  private publish(event: IngestActivityEvent): void {
    try {
      void Promise.resolve(this.emit(event)).catch(() => {})
    } catch {
      // UI/log consumers are observational and must not break indexing.
    }
  }
}
