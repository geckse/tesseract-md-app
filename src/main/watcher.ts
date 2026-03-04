/**
 * WatcherManager — spawns and manages the `mdvdb watch` child process.
 *
 * Handles lifecycle (start/stop/destroy), NDJSON event parsing from stdout,
 * and exponential backoff auto-restart on unexpected crashes.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { createInterface } from 'node:readline'

import { findCli } from './cli'

/** Watcher lifecycle states */
export type WatcherState = 'stopped' | 'starting' | 'running' | 'stopping' | 'error'

/** A parsed NDJSON event emitted by `mdvdb watch --json` */
export interface WatcherEvent {
  type: string
  [key: string]: unknown
}

/** Callback for watcher events */
export type WatcherEventCallback = (event: WatcherEvent) => void

/** Callback for watcher errors */
export type WatcherErrorCallback = (error: Error) => void

/** Callback for state changes */
export type WatcherStateCallback = (state: WatcherState) => void

/** Max auto-restart retries before entering error state */
const MAX_RETRIES = 5

/** Initial backoff delay in ms */
const INITIAL_BACKOFF_MS = 1_000

/** Maximum backoff delay in ms */
const MAX_BACKOFF_MS = 30_000

/** Grace period before SIGKILL after SIGTERM */
const KILL_TIMEOUT_MS = 5_000

export class WatcherManager {
  private child: ChildProcess | null = null
  private state: WatcherState = 'stopped'
  private root: string | null = null
  private retryCount = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private destroying = false

  private eventCallbacks: WatcherEventCallback[] = []
  private errorCallbacks: WatcherErrorCallback[] = []
  private stateCallbacks: WatcherStateCallback[] = []

  /** Start the watcher for the given project root. */
  async start(root: string): Promise<void> {
    if (this.state === 'running' || this.state === 'starting') {
      return
    }

    this.root = root
    this.retryCount = 0
    this.destroying = false
    await this.spawn()
  }

  /** Gracefully stop the watcher. */
  async stop(): Promise<void> {
    this.clearRetryTimer()
    this.destroying = false

    if (!this.child || this.state === 'stopped' || this.state === 'stopping') {
      this.setState('stopped')
      return
    }

    await this.killChild()
  }

  /**
   * Force-destroy the watcher — used during app quit.
   * Sends SIGTERM, waits up to 5s, then SIGKILL.
   */
  async destroy(): Promise<void> {
    this.destroying = true
    this.clearRetryTimer()

    if (!this.child) {
      this.setState('stopped')
      return
    }

    await this.killChild()
  }

  /** Whether the watcher process is currently running. */
  isRunning(): boolean {
    return this.state === 'running'
  }

  /** Current watcher state. */
  getState(): WatcherState {
    return this.state
  }

  /** Register callback for NDJSON events from the watcher. */
  onEvent(cb: WatcherEventCallback): void {
    this.eventCallbacks.push(cb)
  }

  /** Register callback for watcher errors. */
  onError(cb: WatcherErrorCallback): void {
    this.errorCallbacks.push(cb)
  }

  /** Register callback for state changes. */
  onStateChange(cb: WatcherStateCallback): void {
    this.stateCallbacks.push(cb)
  }

  /** Remove all registered callbacks. */
  removeAllListeners(): void {
    this.eventCallbacks = []
    this.errorCallbacks = []
    this.stateCallbacks = []
  }

  // --- Private ---

  private async spawn(): Promise<void> {
    if (!this.root) return

    this.setState('starting')

    let cliPath: string
    try {
      cliPath = await findCli()
    } catch (error) {
      this.emitError(error instanceof Error ? error : new Error(String(error)))
      this.setState('error')
      return
    }

    const child = spawn(cliPath, ['watch', '--json', '--root', this.root], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env }
    })

    this.child = child

    // Parse NDJSON from stdout line by line
    if (child.stdout) {
      const rl = createInterface({ input: child.stdout })
      rl.on('line', (line) => {
        const trimmed = line.trim()
        if (!trimmed) return
        try {
          const event = JSON.parse(trimmed) as WatcherEvent
          // Treat first event as confirmation watcher is running
          if (this.state === 'starting') {
            this.setState('running')
          }
          this.emitEvent(event)
        } catch {
          // Ignore non-JSON lines (e.g. log output)
        }
      })
    }

    // Collect stderr for error reporting
    let stderrBuf = ''
    if (child.stderr) {
      child.stderr.on('data', (chunk: Buffer) => {
        stderrBuf += chunk.toString()
        // Cap buffer to prevent memory leak
        if (stderrBuf.length > 10_000) {
          stderrBuf = stderrBuf.slice(-5_000)
        }
      })
    }

    child.on('error', (err) => {
      this.child = null
      this.emitError(err)
      this.handleUnexpectedExit()
    })

    child.on('close', (code) => {
      this.child = null

      if (this.state === 'stopping' || this.destroying) {
        this.setState('stopped')
        return
      }

      // Unexpected exit
      if (code !== 0) {
        this.emitError(
          new Error(`Watcher exited with code ${code}: ${stderrBuf.trim().slice(0, 500)}`)
        )
      }
      this.handleUnexpectedExit()
    })

    // If no events arrive within 2s, assume it's running anyway
    setTimeout(() => {
      if (this.state === 'starting' && this.child === child) {
        this.setState('running')
      }
    }, 2_000)
  }

  private async killChild(): Promise<void> {
    const child = this.child
    if (!child) {
      this.setState('stopped')
      return
    }

    this.setState('stopping')

    return new Promise<void>((resolve) => {
      let resolved = false
      const done = () => {
        if (resolved) return
        resolved = true
        this.child = null
        this.setState('stopped')
        resolve()
      }

      child.on('close', done)

      // Send SIGTERM
      child.kill('SIGTERM')

      // Force SIGKILL after timeout
      setTimeout(() => {
        if (!resolved) {
          try {
            child.kill('SIGKILL')
          } catch {
            // Process may have already exited
          }
          done()
        }
      }, KILL_TIMEOUT_MS)
    })
  }

  private handleUnexpectedExit(): void {
    if (this.destroying || this.state === 'stopping') return

    if (this.retryCount >= MAX_RETRIES) {
      this.setState('error')
      this.emitError(new Error(`Watcher crashed ${MAX_RETRIES} times, giving up`))
      return
    }

    const delay = Math.min(
      INITIAL_BACKOFF_MS * Math.pow(2, this.retryCount),
      MAX_BACKOFF_MS
    )
    this.retryCount++

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      if (!this.destroying) {
        this.spawn()
      }
    }, delay)
  }

  private clearRetryTimer(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
  }

  private setState(newState: WatcherState): void {
    if (this.state === newState) return
    this.state = newState
    for (const cb of this.stateCallbacks) {
      cb(newState)
    }
  }

  private emitEvent(event: WatcherEvent): void {
    for (const cb of this.eventCallbacks) {
      cb(event)
    }
  }

  private emitError(error: Error): void {
    for (const cb of this.errorCallbacks) {
      cb(error)
    }
  }
}
