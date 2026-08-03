import { app } from 'electron'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, join, resolve, sep } from 'node:path'

import type {
  IngestActivityEvent,
  IngestProgress,
  ModuleReport,
  WatchEventReport
} from '../renderer/types/cli'
import type { Collection } from './store'
import { atomicWriteFile } from './atomic-write'

const DEFAULT_RETENTION_DAYS = 7
const DEFAULT_COLLECTION_CAP_BYTES = 10 * 1024 * 1024
const SUMMARY_START = '<!-- tesseract-activity-summary:start -->'
const SUMMARY_END = '<!-- tesseract-activity-summary:end -->'

export interface ActivityLogDescriptor {
  collection_id: string
  date: string
  title: string
  content: string
  revision: number
  read_only: true
  summary: DailyActivitySummary
  latest_event: string
}

export interface ActivityLogChanged {
  collection_id: string
  date: string
  revision: number
}

export interface DailyActivitySummary {
  events: number
  watcher_events: number
  reindex_runs: number
  estimated_input_tokens: number
  api_calls: number
  errors: number
  watcher_state: string
}

interface ProgressCheckpoint {
  phase: string
  bucket: number
}

export interface ActivityLogLimits {
  retentionDays: number
  collectionCapBytes: number
}

const DEFAULT_LIMITS: ActivityLogLimits = {
  retentionDays: DEFAULT_RETENTION_DAYS,
  collectionCapBytes: DEFAULT_COLLECTION_CAP_BYTES
}

const EMPTY_SUMMARY: DailyActivitySummary = {
  events: 0,
  watcher_events: 0,
  reindex_runs: 0,
  estimated_input_tokens: 0,
  api_calls: 0,
  errors: 0,
  watcher_state: 'stopped'
}

function localDate(timestamp = Date.now()): string {
  const date = new Date(timestamp)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function localTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

function latestEvent(content: string): string {
  const headings = [...content.matchAll(/^##\s+(.+)$/gm)]
  return headings.at(-1)?.[1] ?? 'No activity yet'
}

function markdownCode(value: string): string {
  return value.replace(/`/g, 'ˋ').replace(/[\r\n]+/g, ' ')
}

export function redactActivityText(value: string): string {
  let redacted = value
    .replace(/(authorization\s*[:=]\s*(?:bearer|basic)\s+)[^\s,;]+/gi, '$1<redacted>')
    .replace(
      /([?&](?:key|api_key|token|access_token|x-amz-credential|x-amz-signature|x-amz-security-token)=)[^&\s]+/gi,
      '$1<redacted>'
    )
    .replace(/((?:api[_-]?key|token|secret)\s*[:=]\s*)[^\s,;]+/gi, '$1<redacted>')
    .replace(
      /(["']?(?:embedding|embeddings|vector|vectors|document|content|inputs?)["']?\s*[:=]\s*)(?:\[[^\]]*\]|"[^"]*"|'[^']*')/gi,
      '$1<redacted>'
    )

  for (const [name, secret] of Object.entries(process.env)) {
    if (!/(?:KEY|TOKEN|SECRET|PASSWORD)$/i.test(name) || !secret || secret.length < 8) continue
    redacted = redacted.split(secret).join('<redacted>')
  }
  return redacted
}

function summaryMarkdown(summary: DailyActivitySummary): string {
  return `${SUMMARY_START}
> Watcher: **${summary.watcher_state}** · Events: **${summary.events.toLocaleString()}** · Watch events: **${summary.watcher_events.toLocaleString()}** · Reindex runs: **${summary.reindex_runs.toLocaleString()}**  
> Estimated input tokens: **${summary.estimated_input_tokens.toLocaleString()}** · API calls: **${summary.api_calls.toLocaleString()}** · Errors: **${summary.errors.toLocaleString()}**
${SUMMARY_END}`
}

function initialMarkdown(collection: Collection, date: string): string {
  return `---
generated_by: Tesseract
collection: ${JSON.stringify(collection.name)}
date: ${date}
read_only: true
---

# Activity — ${collection.name} — ${date}

${summaryMarkdown({ ...EMPTY_SUMMARY })}

`
}

function readSummary(content: string): DailyActivitySummary {
  const watcherState = content.match(/> Watcher: \*\*([^*]+)\*\*/)?.[1] ?? 'stopped'
  const number = (label: string): number => {
    const match = content.match(new RegExp(`${label}: \\*\\*([\\d,.]+)\\*\\*`))
    return match ? Number(match[1].replace(/[,.]/g, '')) || 0 : 0
  }
  return {
    events: number('Events'),
    watcher_events: number('Watch events'),
    reindex_runs: number('Reindex runs'),
    estimated_input_tokens: number('Estimated input tokens'),
    api_calls: number('API calls'),
    errors: number('Errors'),
    watcher_state: watcherState
  }
}

function replaceSummary(content: string, summary: DailyActivitySummary): string {
  const start = content.indexOf(SUMMARY_START)
  const end = content.indexOf(SUMMARY_END)
  if (start < 0 || end < start) return `${content.trimEnd()}\n\n${summaryMarkdown(summary)}\n`
  return `${content.slice(0, start)}${summaryMarkdown(summary)}${content.slice(end + SUMMARY_END.length)}`
}

function progressPercent(progress: IngestProgress): number {
  if (
    progress.phase === 'parsing' ||
    progress.phase === 'skipped' ||
    progress.phase === 'file_error'
  ) {
    return progress.total > 0 ? (progress.current / progress.total) * 100 : 0
  }
  if (progress.phase === 'embedding') {
    return progress.total_chunks > 0
      ? (progress.completed_chunks / progress.total_chunks) * 100
      : progress.total_batches > 0
        ? (progress.completed_batches / progress.total_batches) * 100
        : 100
  }
  return 0
}

function progressDetail(progress: IngestProgress): string {
  switch (progress.phase) {
    case 'parsing':
    case 'skipped':
      return `${progress.current}/${progress.total} files · \`${markdownCode(progress.path)}\``
    case 'file_error':
      return `${progress.current}/${progress.total} files · ${progress.error_count} error(s) · \`${markdownCode(progress.path)}\``
    case 'embedding':
      return `${progress.completed_batches}/${progress.total_batches} batches · ${progress.completed_chunks}/${progress.total_chunks} chunks · ${progress.estimated_input_tokens.toLocaleString()}/${progress.total_estimated_input_tokens.toLocaleString()} estimated input tokens`
    default:
      return progress.phase
  }
}

function moduleReportsMarkdown(reports: ModuleReport[]): string {
  if (reports.length === 0) return ''
  const items = reports
    .map((report) => {
      const diagnostics = report.diagnostics
        .map((diagnostic) => {
          const location = diagnostic.path ? `\`${markdownCode(diagnostic.path)}\` · ` : ''
          return `    - ${location}\`${markdownCode(diagnostic.field)}\` (${markdownCode(diagnostic.code)}): ${redactActivityText(diagnostic.message)}`
        })
        .join('\n')
      return `  - **${markdownCode(report.module)}**: ${report.fields_updated} fields updated across ${report.files_evaluated} files in ${report.duration_ms.toLocaleString()}ms${diagnostics ? `\n${diagnostics}` : ''}`
    })
    .join('\n')
  return `\n### Modules\n${items}\n`
}

function moduleDiagnosticCount(reports: ModuleReport[]): number {
  return reports.reduce((total, report) => total + report.diagnostics.length, 0)
}

export class ActivityLogStore {
  private readonly queues = new Map<string, Promise<void>>()
  private readonly revisions = new Map<string, number>()
  private readonly progressCheckpoints = new Map<string, ProgressCheckpoint>()
  private readonly ingestErrorCounts = new Map<string, number>()

  constructor(
    private readonly collections: () => Collection[],
    private readonly changed: (event: ActivityLogChanged) => void,
    private readonly limits: ActivityLogLimits = DEFAULT_LIMITS
  ) {}

  async recordIngest(event: IngestActivityEvent): Promise<void> {
    const collection = this.collectionForRoot(event.root)
    if (!collection) return
    const date = localDate(event.timestamp)

    if (event.type === 'progress') {
      const percent = progressPercent(event.progress)
      const checkpoint = {
        phase: event.progress.phase,
        bucket: Math.floor(percent / 10)
      }
      const previous = this.progressCheckpoints.get(event.run_id)
      if (
        event.progress.phase !== 'file_error' &&
        previous?.phase === checkpoint.phase &&
        previous.bucket === checkpoint.bucket
      ) {
        return
      }
      this.progressCheckpoints.set(event.run_id, checkpoint)
      const priorErrorCount = this.ingestErrorCounts.get(event.run_id) ?? 0
      const newlyObservedErrors =
        event.progress.phase === 'file_error'
          ? Math.max(0, event.progress.error_count - priorErrorCount)
          : 0
      if (event.progress.phase === 'file_error') {
        this.ingestErrorCounts.set(event.run_id, event.progress.error_count)
      }
      await this.append(collection, date, (summary) => {
        summary.errors += newlyObservedErrors
        return `## ${localTime(event.timestamp)} — ${event.reindex ? 'Reindex' : 'Index'} progress

- Phase: **${event.progress.phase.replace(/_/g, ' ')}**
- Progress: ${progressDetail(event.progress)}
- Elapsed: ${(event.progress.elapsed_ms / 1000).toFixed(1)}s
${event.progress.phase === 'file_error' ? `<!-- activity-error -->\n- Error: ${redactActivityText(event.progress.message)}\n` : ''}`
      })
      return
    }

    if (event.type === 'started') {
      this.progressCheckpoints.delete(event.run_id)
      this.ingestErrorCounts.delete(event.run_id)
      await this.append(collection, date, (summary) => {
        if (event.reindex) summary.reindex_runs++
        return `## ${localTime(event.timestamp)} — ${event.reindex ? 'Reindex' : 'Index'} started

- Run: \`${event.run_id}\`
- Mode: ${event.reindex ? 'Full atomic reindex' : 'Incremental ingest'}
`
      })
      return
    }

    this.progressCheckpoints.delete(event.run_id)
    if (event.type === 'failed') {
      this.ingestErrorCounts.delete(event.run_id)
      await this.append(collection, date, (summary) => {
        summary.errors++
        return `## ${localTime(event.timestamp)} — ${event.reindex ? 'Reindex' : 'Index'} failed

<!-- activity-error -->
- Run: \`${event.run_id}\`
- Error: ${redactActivityText(event.message)}
`
      })
      return
    }

    await this.append(collection, date, (summary) => {
      const errorsAlreadyRecorded = this.ingestErrorCounts.get(event.run_id) ?? 0
      this.ingestErrorCounts.delete(event.run_id)
      summary.estimated_input_tokens += event.result.estimated_input_tokens
      summary.api_calls += event.result.api_calls
      const moduleErrors = moduleDiagnosticCount(event.result.module_reports)
      summary.errors +=
        Math.max(0, event.result.errors.length - errorsAlreadyRecorded) + moduleErrors
      const title = event.type === 'cancelled' ? 'cancelled' : 'completed'
      const errors = event.result.errors
        .map((error) => `  - \`${markdownCode(error.path)}\`: ${redactActivityText(error.message)}`)
        .join('\n')
      const modules = moduleReportsMarkdown(event.result.module_reports)
      const errorMarker =
        event.result.errors.length > 0 || moduleErrors > 0 ? '<!-- activity-error -->\n' : ''
      return `## ${localTime(event.timestamp)} — ${event.reindex ? 'Reindex' : 'Index'} ${title}

${errorMarker}- Files indexed: ${event.result.files_indexed.toLocaleString()}
- Files skipped: ${event.result.files_skipped.toLocaleString()}
- Files removed: ${event.result.files_removed.toLocaleString()}
- Chunks created: ${event.result.chunks_created.toLocaleString()}
- Estimated input tokens: ${event.result.estimated_input_tokens.toLocaleString()}
- API calls: ${event.result.api_calls.toLocaleString()}
- Duration: ${event.result.duration_secs.toFixed(1)}s
- Errors: ${event.result.errors.length.toLocaleString()}
- Module diagnostics: ${moduleErrors.toLocaleString()}
${errors ? `\n### Errors\n${errors}\n` : ''}${modules}`
    })
  }

  async recordWatcherState(root: string, state: string, detail?: string): Promise<void> {
    const collection = this.collectionForRoot(root)
    if (!collection) return
    const timestamp = Date.now()
    await this.append(collection, localDate(timestamp), (summary) => {
      summary.watcher_state = state
      if (state === 'error') summary.errors++
      return `## ${localTime(timestamp)} — Watcher ${state}

${state === 'error' ? '<!-- activity-error -->\n' : ''}${detail ? `- ${redactActivityText(detail)}\n` : ''}`
    })
  }

  async recordWatchEvent(root: string, report: WatchEventReport): Promise<void> {
    const collection = this.collectionForRoot(root)
    if (!collection) return
    const timestamp = Date.now()
    await this.append(collection, localDate(timestamp), (summary) => {
      summary.watcher_events++
      summary.estimated_input_tokens += report.estimated_input_tokens
      summary.api_calls += report.api_calls
      const moduleErrors = moduleDiagnosticCount(report.module_reports)
      if (!report.success || report.error) summary.errors++
      summary.errors += moduleErrors
      const modules = moduleReportsMarkdown(report.module_reports)
      const reportedPath = report.previous_path
        ? `\`${markdownCode(report.previous_path)}\` → \`${markdownCode(report.path)}\``
        : `\`${markdownCode(report.path)}\``
      return `## ${localTime(timestamp)} — ${report.event_type} ${reportedPath} ${report.success ? '✓' : '✗'}

${report.error || moduleErrors > 0 ? '<!-- activity-error -->\n' : ''}- Chunks processed: ${report.chunks_processed.toLocaleString()}
- Estimated input tokens: ${report.estimated_input_tokens.toLocaleString()}
- API calls: ${report.api_calls.toLocaleString()}
- Duration: ${report.duration_ms.toLocaleString()}ms
${report.error ? `- Error: ${redactActivityText(report.error)}\n` : ''}${modules}`
    })
  }

  async openToday(collectionId: string): Promise<ActivityLogDescriptor> {
    return this.open(collectionId, localDate())
  }

  async open(collectionId: string, date: string): Promise<ActivityLogDescriptor> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid activity-log date')
    const collection = (this.collections() ?? []).find((item) => item.id === collectionId)
    if (!collection) throw new Error(`Collection not found: ${collectionId}`)
    const path = this.pathFor(collectionId, date)
    await fs.mkdir(this.directoryFor(collectionId), { recursive: true })
    let content: string
    try {
      content = await fs.readFile(path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      content = initialMarkdown(collection, date)
      await atomicWriteFile(path, content)
    }
    return {
      collection_id: collectionId,
      date,
      title: `Activity ${date}.md`,
      content,
      revision: this.revisions.get(path) ?? 0,
      read_only: true,
      summary: readSummary(content),
      latest_event: latestEvent(content)
    }
  }

  async read(collectionId: string, date: string): Promise<ActivityLogDescriptor> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid activity-log date')
    if (!(this.collections() ?? []).some((item) => item.id === collectionId)) {
      throw new Error(`Collection not found: ${collectionId}`)
    }
    const path = this.pathFor(collectionId, date)
    const content = await fs.readFile(path, 'utf8')
    return {
      collection_id: collectionId,
      date,
      title: `Activity ${date}.md`,
      content,
      revision: this.revisions.get(path) ?? 0,
      read_only: true,
      summary: readSummary(content),
      latest_event: latestEvent(content)
    }
  }

  private async append(
    collection: Collection,
    date: string,
    entry: (summary: DailyActivitySummary) => string
  ): Promise<void> {
    const path = this.pathFor(collection.id, date)
    await this.enqueue(path, async () => {
      await fs.mkdir(this.directoryFor(collection.id), { recursive: true })
      let content: string
      try {
        content = await fs.readFile(path, 'utf8')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        content = initialMarkdown(collection, date)
      }
      const summary = readSummary(content)
      summary.events++
      const markdown = entry(summary).trim()
      content = replaceSummary(content, summary)
      content = `${content.trimEnd()}\n\n${markdown}\n`
      content = this.compactCurrentFile(content)
      await atomicWriteFile(path, content)
      const revision = (this.revisions.get(path) ?? 0) + 1
      this.revisions.set(path, revision)
      try {
        this.changed({ collection_id: collection.id, date, revision })
      } catch {
        // Renderer notification is observational; the durable log is authoritative.
      }
      await this.prune(collection.id, date)
    })
  }

  private enqueue(path: string, task: () => Promise<void>): Promise<void> {
    const previous = this.queues.get(path) ?? Promise.resolve()
    const next = previous.catch(() => {}).then(task)
    this.queues.set(path, next)
    return next.finally(() => {
      if (this.queues.get(path) === next) this.queues.delete(path)
    })
  }

  private collectionForRoot(root: string): Collection | null {
    const normalized = resolve(root)
    return (
      (this.collections() ?? []).find((collection) => resolve(collection.path) === normalized) ??
      null
    )
  }

  private rootDirectory(): string {
    return join(app.getPath('userData'), 'activity-logs')
  }

  private directoryFor(collectionId: string): string {
    const safeId = createHash('sha256').update(collectionId).digest('hex').slice(0, 24)
    return join(this.rootDirectory(), safeId)
  }

  private pathFor(collectionId: string, date: string): string {
    const directory = this.directoryFor(collectionId)
    const path = resolve(directory, `${date}.md`)
    if (!path.startsWith(`${resolve(directory)}${sep}`) || basename(path) !== `${date}.md`) {
      throw new Error('Activity-log path escaped its managed directory')
    }
    return path
  }

  private async prune(collectionId: string, currentDate: string): Promise<void> {
    const directory = this.directoryFor(collectionId)
    const entries = (await fs.readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && /^\d{4}-\d{2}-\d{2}\.md$/.test(entry.name))
      .sort((left, right) => left.name.localeCompare(right.name))
    const cutoff = new Date()
    cutoff.setHours(0, 0, 0, 0)
    cutoff.setDate(cutoff.getDate() - (this.limits.retentionDays - 1))

    for (const entry of entries) {
      const date = new Date(`${entry.name.slice(0, 10)}T00:00:00`)
      if (date < cutoff) await fs.unlink(join(directory, entry.name)).catch(() => {})
    }

    const remaining = (await fs.readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && /^\d{4}-\d{2}-\d{2}\.md$/.test(entry.name))
      .sort((left, right) => left.name.localeCompare(right.name))
    const sized = await Promise.all(
      remaining.map(async (entry) => ({
        entry,
        size: (await fs.stat(join(directory, entry.name))).size
      }))
    )
    let total = sized.reduce((sum, item) => sum + item.size, 0)
    for (const item of sized) {
      if (total <= this.limits.collectionCapBytes) break
      if (item.entry.name === `${currentDate}.md`) continue
      await fs.unlink(join(directory, item.entry.name)).catch(() => {})
      total -= item.size
    }
  }

  private compactCurrentFile(content: string): string {
    if (Buffer.byteLength(content) <= this.limits.collectionCapBytes) return content
    const headerEnd = content.indexOf(SUMMARY_END)
    const header = headerEnd >= 0 ? content.slice(0, headerEnd + SUMMARY_END.length) : ''
    const entries = content
      .slice(headerEnd >= 0 ? headerEnd + SUMMARY_END.length : 0)
      .split(/\n(?=## \d{1,2}:)/)
    const keep = entries.map((entry) => entry.includes('<!-- activity-error -->'))
    let bytes = Buffer.byteLength(`${header}\n\n> Older successful entries were compacted.\n`)
    bytes += entries.reduce(
      (total, entry, index) => total + (keep[index] ? Buffer.byteLength(entry) : 0),
      0
    )
    for (let index = entries.length - 1; index >= 0; index--) {
      if (keep[index]) continue
      const entry = entries[index]
      const entryBytes = Buffer.byteLength(entry)
      if (bytes + entryBytes > this.limits.collectionCapBytes * 0.9) continue
      keep[index] = true
      bytes += entryBytes
    }
    const kept = entries.filter((_entry, index) => keep[index])
    return `${header}\n\n> Older successful entries were compacted to respect the temporary-log size limit.\n\n${kept.join('\n')}`
  }
}
