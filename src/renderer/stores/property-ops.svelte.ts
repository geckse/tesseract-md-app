/**
 * Property type conversion / rename modal state + orchestration (phase 41).
 *
 * Svelte 5 runes singleton (MUST remain a .svelte.ts file). Owns the
 * ConvertTypeModal's lifecycle: preview → apply → follow-up refresh.
 *
 * Follow-up sequence after a successful apply (order matters, per the PRD):
 *  1. one incremental `mdvdb ingest` — recomputes schemas (incl. the overlay pin)
 *  2. refetch the schema store for the op's scope
 *  3. reload table tabs whose subtree intersects the scope
 *  4. route changed paths through the file-sync router so SAME-window editors
 *     reload (clean tabs silently, dirty tabs get the conflict banner) —
 *     required because registerOwnWrite suppresses our own watcher events and
 *     the per-file broadcast only reaches other windows.
 */

import { get } from 'svelte/store'
import type {
  PropertyOpRequest,
  PropertyOpPlan,
  PropertyOpResult,
  PropertyOpProgress,
  PropertyTargetType,
  OverlayFieldPatch
} from '../../preload/api'
import { activeCollection } from './collections'
import { workspace } from './workspace.svelte'
import { tableStore } from './table.svelte'
import { fetchSchema } from './schema'
import { handleVaultFileEvent } from './file-sync'
import { requestSave } from './editor'

/** Where the op was triggered from. */
export type PropertyOpOrigin =
  | { kind: 'panel'; filePath: string }
  | { kind: 'table'; tabId: string; folderPath: string }

export type PropertyOpModalPhase = 'loading' | 'preview' | 'running' | 'report' | 'error'

export interface PropertyOpModalState {
  phase: PropertyOpModalPhase
  origin: PropertyOpOrigin
  req: PropertyOpRequest
  /** UI type of the property before the change (for the modal title). */
  currentType: PropertyTargetType | null
  plan: PropertyOpPlan | null
  progress: PropertyOpProgress | null
  result: PropertyOpResult | null
  error: string | null
  /** Open + dirty document tabs among the affected files (conflict warning). */
  dirtyAffected: string[]
}

/**
 * Scope for a property-panel trigger: the file's parent directory subtree —
 * exactly the scope the panel's schema uses. Vault-root files → null
 * (single-file conversion, no overlay pin).
 */
export function scopeForPanelFile(filePath: string): string | null {
  const lastSlash = filePath.lastIndexOf('/')
  return lastSlash > 0 ? filePath.substring(0, lastSlash) : null
}

/** Scope for a table trigger: the tab's folder ('.'/'' = whole vault). */
export function scopeForTableTab(folderPath: string): string {
  return folderPath === '' ? '.' : folderPath
}

/** Whether the scope means "entire vault". */
export function isVaultWideScope(scope: string | null): boolean {
  return scope !== null && (scope === '' || scope === '.')
}

/** Whether two folder subtrees intersect (either is ancestor-or-equal of the other). */
function subtreesIntersect(a: string, b: string): boolean {
  if (a === '' || b === '' || a === b) return true
  return a.startsWith(`${b}/`) || b.startsWith(`${a}/`)
}

/** JSON round-trip so $state proxies never cross the IPC boundary. */
function snapshot<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** Poll until `cond` is true or the timeout elapses. */
async function waitFor(cond: () => boolean, timeoutMs: number): Promise<void> {
  const start = Date.now()
  while (!cond() && Date.now() - start < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

class PropertyOpsStore {
  /** Modal state; null = closed. Entry points disable while non-null. */
  modal = $state<PropertyOpModalState | null>(null)

  private unsubscribeProgress: (() => void) | null = null

  /** Open the convert flow (from the panel type picker or a table column menu). */
  openConvert(
    origin: PropertyOpOrigin,
    key: string,
    target: PropertyTargetType,
    currentType: PropertyTargetType | null
  ): void {
    if (this.modal) return
    const collectionId = get(activeCollection)?.id
    if (!collectionId) return
    const scope =
      origin.kind === 'panel'
        ? scopeForPanelFile(origin.filePath)
        : scopeForTableTab(origin.folderPath)
    this.modal = {
      phase: 'loading',
      origin,
      req: {
        collectionId,
        scope,
        filePath: origin.kind === 'panel' && scope === null ? origin.filePath : null,
        key,
        op: { kind: 'convert', target }
      },
      currentType,
      plan: null,
      progress: null,
      result: null,
      error: null,
      dirtyAffected: []
    }
    void this.preview()
  }

  /** Open the rename flow — the modal collects the new key, then previews. */
  openRename(origin: PropertyOpOrigin, key: string): void {
    if (this.modal) return
    const collectionId = get(activeCollection)?.id
    if (!collectionId) return
    const scope =
      origin.kind === 'panel'
        ? scopeForPanelFile(origin.filePath)
        : scopeForTableTab(origin.folderPath)
    this.modal = {
      phase: 'preview',
      origin,
      req: {
        collectionId,
        scope,
        filePath: origin.kind === 'panel' && scope === null ? origin.filePath : null,
        key,
        op: { kind: 'rename', newKey: '' }
      },
      currentType: null,
      plan: null,
      progress: null,
      result: null,
      error: null,
      dirtyAffected: []
    }
  }

  /** Set the rename target key (clears any stale plan until re-previewed). */
  setRenameKey(newKey: string): void {
    const m = this.modal
    if (!m || m.req.op.kind !== 'rename') return
    m.req.op.newKey = newKey
    m.plan = null
    m.error = null
  }

  /** Update the select target's allowed values from the modal chip editor. */
  setAllowedValues(values: string[]): void {
    const m = this.modal
    if (!m || m.req.op.kind !== 'convert') return
    m.req.op.allowedValues = values
  }

  /** Compute (or recompute) the plan. Auto-saves the triggering dirty tab first. */
  async preview(): Promise<void> {
    const m = this.modal
    if (!m || m.phase === 'running') return
    if (m.origin.kind === 'panel') {
      await this.saveTriggeringTabIfDirty(m.origin.filePath)
    }
    m.phase = 'loading'
    m.error = null
    try {
      const plan = await window.api.previewPropertyOp(snapshot(m.req))
      m.plan = plan
      m.dirtyAffected = this.findDirtyAffected(plan, m.origin)
      if (
        m.req.op.kind === 'convert' &&
        m.req.op.target === 'select' &&
        m.req.op.allowedValues === undefined
      ) {
        m.req.op.allowedValues = this.distinctValues(plan)
      }
      m.phase = 'preview'
    } catch (err) {
      m.error = err instanceof Error ? err.message : String(err)
      m.phase = 'error'
    }
  }

  /** Run the batch, stream progress, then refresh everything and report. */
  async apply(): Promise<void> {
    const m = this.modal
    if (!m || !m.plan || m.phase === 'running') return
    const opId = crypto.randomUUID()
    m.phase = 'running'
    m.progress = { opId, done: 0, total: m.plan.files.length, path: '' }
    this.unsubscribeProgress = window.api.onPropertyOpProgress((p) => {
      if (p.opId === opId && this.modal) this.modal.progress = p
    })
    try {
      const result = await window.api.applyPropertyOp(opId, snapshot(m.req))
      m.result = result
      await this.refreshAfterApply(m.req, result)
      m.phase = 'report'
    } catch (err) {
      m.error = err instanceof Error ? err.message : String(err)
      m.phase = 'error'
    } finally {
      this.unsubscribeProgress?.()
      this.unsubscribeProgress = null
    }
  }

  /** Close the modal (no-op while the batch is running — no cancel in V1). */
  close(): void {
    if (this.modal?.phase === 'running') return
    this.unsubscribeProgress?.()
    this.unsubscribeProgress = null
    this.modal = null
  }

  /**
   * Overlay-only annotation edit (Property settings popover): write the
   * overlay, then the same refresh sequence minus file routing (no file
   * contents changed).
   */
  async applyOverlayFieldPatch(
    scope: string | null,
    key: string,
    patch: OverlayFieldPatch
  ): Promise<void> {
    const collection = get(activeCollection)
    if (!collection) throw new Error('No active collection')
    await window.api.updateOverlayField(collection.id, scope, key, snapshot(patch))
    try {
      await window.api.ingest(collection.path)
    } catch {
      // Non-fatal: the overlay is written; the next ingest will pick it up.
    }
    await this.refreshStores(collection.path, scope)
  }

  // ─── Internals ────────────────────────────────────────────────────────

  private async refreshAfterApply(req: PropertyOpRequest, result: PropertyOpResult): Promise<void> {
    const collection = get(activeCollection)
    if (!collection) return
    try {
      await window.api.ingest(collection.path)
    } catch {
      // Non-fatal: files are converted on disk; schema refresh happens next ingest.
    }
    await this.refreshStores(collection.path, req.scope)

    // Same-window editor reconciliation (required — see module docblock).
    for (const entry of result.entries) {
      if (entry.status !== 'ok') continue
      handleVaultFileEvent({
        kind: 'modified',
        path: entry.path,
        isDirectory: false,
        fileKind: 'markdown',
        mimeCategory: null,
        mtimeMs: null,
        size: null,
        origin: 'app',
        ts: Date.now()
      })
    }
  }

  private async refreshStores(root: string, scope: string | null): Promise<void> {
    const prefix = scope !== null && !isVaultWideScope(scope) ? scope : undefined
    await fetchSchema(root, prefix)

    const scopeFolder = prefix ?? ''
    for (const tab of Object.values(workspace.tabs)) {
      if (tab.kind !== 'table') continue
      const affected =
        scope === null
          ? this.modal?.origin.kind === 'panel' &&
            subtreesIntersect(tab.folderPath, scopeForPanelFile(this.modal.origin.filePath) ?? '')
          : subtreesIntersect(tab.folderPath, scopeFolder)
      if (affected) await tableStore.reload(tab.id)
    }
  }

  private async saveTriggeringTabIfDirty(filePath: string): Promise<void> {
    const tab = workspace.focusedDocumentTab
    if (!tab || tab.filePath !== filePath || !tab.isDirty) return
    requestSave()
    await waitFor(() => !tab.isDirty, 3_000)
  }

  private findDirtyAffected(plan: PropertyOpPlan, origin: PropertyOpOrigin): string[] {
    const affected = new Set(
      plan.files.filter((f) => f.action === 'convert' || f.action === 'rename').map((f) => f.path)
    )
    const triggering = origin.kind === 'panel' ? origin.filePath : null
    const dirty: string[] = []
    for (const tab of Object.values(workspace.tabs)) {
      if (tab.kind !== 'document' || tab.isUntitled || !tab.isDirty) continue
      if (tab.filePath === triggering) continue
      if (affected.has(tab.filePath)) dirty.push(tab.filePath)
    }
    return dirty
  }

  /** Distinct current values across the scope (prefill for select allowed values). */
  private distinctValues(plan: PropertyOpPlan): string[] {
    const values = new Set<string>()
    for (const f of plan.files) {
      if ((f.action === 'convert' || f.action === 'unchanged') && f.before) values.add(f.before)
    }
    return [...values].sort((a, b) => a.localeCompare(b))
  }
}

export const propertyOps = new PropertyOpsStore()
