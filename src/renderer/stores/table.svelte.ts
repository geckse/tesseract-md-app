/**
 * Per-tab table data store for the folder-as-table view (phase-39).
 *
 * Responsibilities:
 *  - Load `mdvdb collection` output per table tab (debounced + deduped).
 *  - Compose the effective `TableViewConfig` (active saved view, degraded against
 *    the live columns, overlaid with the tab's ephemeral edits).
 *  - Derive the visible/ordered columns and the client-filtered, grouped rows.
 *
 * Ordering is server-authoritative for frontmatter columns (passed to the CLI so
 * the Rust type-aware, nulls-last comparator is the single source of truth).
 * The synthetic Title column is sorted client-side because it is not a
 * frontmatter field. Filters and group-by are client-side over the fully-loaded
 * set (no server paging in v1), which also keeps `new`/`{}` rows visible under
 * filters.
 *
 * Svelte 5 runes singleton (MUST remain a .svelte.ts file).
 */

import { stringify as stringifyYaml } from 'yaml'
import type { CollectionOutput, CollectionColumn, CollectionRow, JsonValue } from '../types/cli'
import type { TableViewConfig, TableColumnFilter, TableColumnLayout } from '../../preload/api'
import { cliFeatures } from '../lib/cli-features.svelte'
import { relationKey, coerceRelationFilterValue } from '../lib/relation-format'
import { workspace, type TableTab } from './workspace.svelte'
import { tableViewsStore, degradeViewConfig, TITLE_COLUMN } from './table-views.svelte'
import { tableHistory, snapshotOf, snapshotsEqual } from './table-history.svelte'
import { compareDecimalText, exactNumberText, stringifyExactJson } from '../../shared/exact-number'
import { parseFrontmatterData, splitFrontmatter } from '../lib/tiptap/markdown-bridge'
import { isComputedFieldType } from '../lib/computed-fields'

/** Parse the YAML frontmatter object from a markdown file's full content. */
function parseFrontmatterObject(content: string): Record<string, JsonValue> {
  const { frontmatter } = splitFrontmatter(content.replace(/\r\n/g, '\n'))
  return frontmatter === null ? {} : parseFrontmatterData(frontmatter)
}

/** A sensible empty default value for a freshly-added row, by column type. */
function defaultForType(fieldType: CollectionColumn['field_type']): JsonValue {
  switch (fieldType) {
    case 'Number':
      return 0
    case 'Boolean':
      return false
    case 'List':
    case 'File':
      return []
    case 'Relation':
      return ''
    default:
      return ''
  }
}

/** Loaded data + status for a single table tab. */
export interface TableTabData {
  loading: boolean
  error: string | null
  data: CollectionOutput | null
  lastLoadedAt: number | null
}

/** A client-side group of rows for group-by rendering. */
export interface TableRowGroup {
  value: string
  rows: CollectionRow[]
  /** Display label when it differs from `value` (relation groups: resolved title). */
  label?: string
}

function emptyConfig(): TableViewConfig {
  return { sort: [], filters: [], columns: [], groupBy: null, collapsedGroups: [] }
}

function emptyData(): TableTabData {
  return { loading: false, error: null, data: null, lastLoadedAt: null }
}

/** Stringify a JSON value for display / grouping / comparison. */
export function valueToString(v: JsonValue | undefined): string {
  if (v === undefined || v === null) return ''
  const exact = exactNumberText(v)
  if (exact !== null) return exact
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return stringifyExactJson(v)
}

/** Resolve the on-disk frontmatter value. Markdown is the sole value authority. */
export function effectiveFieldValue(row: CollectionRow, name: string): JsonValue | undefined {
  return row.frontmatter?.[name]
}

function asDecimalText(v: JsonValue | undefined): string | null {
  const exact = exactNumberText(v)
  if (exact !== null) return exact
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  if (typeof v === 'string' && v.trim() !== '') {
    const text = v.trim()
    if (compareDecimalText(text, text) === 0) return text
  }
  return null
}

/** Human-friendly text ordering: embedded digit runs compare numerically. */
const naturalTextCollator = new Intl.Collator(undefined, { numeric: true })

/**
 * Relation-aware equality (phase 42): exact `==` first (zero regression),
 * then — when the frontmatter value is link-shaped — the CLI's `relation_key`
 * normalization on both sides, so `[[clients/acme]]`, `clients/acme.md`, and
 * `clients/acme` match interchangeably (parity with `mdvdb --filter`).
 * Purely syntactic; saved views keep storing the RAW filter value.
 */
function filterValuesEqual(
  fieldValue: JsonValue | undefined,
  filterValue: JsonValue,
  numeric: boolean
): boolean {
  if (fieldValue === filterValue) return true
  if (numeric) {
    const left = asDecimalText(fieldValue)
    const right = asDecimalText(filterValue)
    if (left !== null && right !== null) return compareDecimalText(left, right) === 0
  }
  if (typeof fieldValue === 'string' && typeof filterValue === 'string') {
    const key = relationKey(fieldValue)
    if (key !== null) return key === coerceRelationFilterValue(filterValue)
  }
  return false
}

/** Evaluate a single client-side filter against a row's frontmatter. */
function matchesFilter(
  row: CollectionRow,
  f: TableColumnFilter,
  column: CollectionColumn | undefined
): boolean {
  const raw = effectiveFieldValue(row, f.columnName)
  const numeric =
    column?.field_type === 'Number' ||
    ((column?.field_type === 'Formula' || column?.field_type === 'Rollup') &&
      column.result_type === 'Number')
  switch (f.op) {
    case 'exists':
      return raw !== undefined && raw !== null
    case 'equals': {
      if (f.value === undefined) return true
      if (Array.isArray(raw))
        return raw.some((x) => filterValuesEqual(x, f.value as JsonValue, numeric))
      return filterValuesEqual(raw, f.value, numeric)
    }
    case 'in': {
      const set = f.values ?? []
      if (set.length === 0) return false
      if (Array.isArray(raw)) {
        return raw.some((x) => set.some((v) => filterValuesEqual(x, v, numeric)))
      }
      return set.some((v) => filterValuesEqual(raw, v, numeric))
    }
    case 'contains': {
      const needle = valueToString(f.value).toLowerCase()
      if (needle === '') return true
      // Relation cells: also match the server-resolved titles (users think in
      // titles). Raw values keep matching so non-link items are never dropped.
      const titles = (row.relations?.[f.columnName] ?? [])
        .map((r) => r.title?.toLowerCase() ?? '')
        .filter((t) => t !== '')
      if (titles.some((t) => t.includes(needle))) return true
      if (Array.isArray(raw))
        return raw.some((x) => valueToString(x).toLowerCase().includes(needle))
      return valueToString(raw).toLowerCase().includes(needle)
    }
    case 'range': {
      const min = f.min
      const max = f.max
      const decimal = numeric ? asDecimalText(raw) : null
      if (decimal !== null && (asDecimalText(min) !== null || asDecimalText(max) !== null)) {
        const minimum = asDecimalText(min)
        const maximum = asDecimalText(max)
        if (minimum !== null) {
          const order = compareDecimalText(decimal, minimum)
          if (order !== null && order < 0) return false
        }
        if (maximum !== null) {
          const order = compareDecimalText(decimal, maximum)
          if (order !== null && order > 0) return false
        }
        return true
      }
      // Lexicographic fallback
      const s = valueToString(raw)
      if (min !== undefined && min !== null && s < valueToString(min)) return false
      if (max !== undefined && max !== null && s > valueToString(max)) return false
      return true
    }
    default:
      return true
  }
}

class TableStore {
  private byTab = $state<Record<string, TableTabData>>({})

  /** Cached (collectionId, root) per tab so render methods don't need them. */
  private ctx: Record<string, { collectionId: string; root: string }> = {}

  /** In-flight request signatures per tab (for dedupe). */
  private inflight: Record<string, string> = {}

  /** Last successfully-loaded request signature per tab: `load` skips a refetch
   *  when it matches (client-only config changes re-run callers' effects, and a
   *  refetch would clobber in-progress cell edits). `reload` forces past it. */
  private lastLoaded: Record<string, string> = {}

  /** Per-cell saving/error state, keyed by `${tabId} ${path} ${col}`. */
  private editState = $state<
    Record<string, { saving: boolean; error: string | null; flash?: number }>
  >({})

  /** Debounced single-file re-index queue per tab. */
  private pendingReindex: Record<string, Set<string>> = {}
  private reindexTimers: Record<string, ReturnType<typeof setTimeout>> = {}

  /** Dedupe guard for lazy `new`-row live-from-disk frontmatter augmentation. */
  private augmenting = new Set<string>()

  /** Last column-layout save failure per tab, surfaced in the table toolbar. */
  private layoutErrors = $state<Record<string, string | null>>({})

  /** Latest layout per tab, retained so a failed save can be retried explicitly. */
  private pendingLayouts: Record<string, TableColumnLayout[]> = {}

  /** Width drags write locally on every pointer move but persist only after settling. */
  private layoutSaveTimers: Record<string, ReturnType<typeof setTimeout>> = {}

  constructor() {
    // Single store-level subscription for cross-window edits (multi-window sync).
    // The main process only broadcasts to OTHER windows, so this never echoes
    // our own writes. One listener total — coexists with App's editor sync.
    if (typeof window !== 'undefined' && window.api?.onFileSavedExternally) {
      window.api.onFileSavedExternally(({ path, content }) => {
        for (const tabId of Object.keys(this.byTab)) {
          this.applyExternalContent(tabId, path, content)
        }
      })
    }
  }

  /** Get the loaded data + status for a tab (never undefined). */
  state(tabId: string): TableTabData {
    return this.byTab[tabId] ?? emptyData()
  }

  private cellKey(tabId: string, path: string, col: string): string {
    return `${tabId} ${path} ${col}`
  }

  /** Saving/error/flash state for a single cell. */
  cellState(
    tabId: string,
    path: string,
    col: string
  ): { saving: boolean; error: string | null; flash?: number } {
    return this.editState[this.cellKey(tabId, path, col)] ?? { saving: false, error: null }
  }

  private setCellState(key: string, value: { saving: boolean; error: string | null }): void {
    // Preserve a running flash counter across saving/error transitions — the
    // overlay clears itself via onanimationend, never via these writes.
    const flash = this.editState[key]?.flash
    this.editState = { ...this.editState, [key]: flash === undefined ? value : { ...value, flash } }
  }

  /** Bump a cell's flash counter (undo/redo highlight; one-shot overlay). */
  private flashCell(tabId: string, path: string, col: string): void {
    const key = this.cellKey(tabId, path, col)
    const cur = this.editState[key] ?? { saving: false, error: null }
    this.editState = { ...this.editState, [key]: { ...cur, flash: (cur.flash ?? 0) + 1 } }
  }

  /** Remove a cell's flash flag (called from onanimationend). */
  clearFlash(tabId: string, path: string, col: string): void {
    const key = this.cellKey(tabId, path, col)
    const cur = this.editState[key]
    if (!cur || cur.flash === undefined) return
    const { flash: _flash, ...rest } = cur
    this.editState = { ...this.editState, [key]: rest }
  }

  /** Immutably replace a row in a tab's loaded data. */
  private setRow(tabId: string, index: number, row: CollectionRow): void {
    const cur = this.byTab[tabId]?.data
    if (!cur) return
    const rows = cur.rows.slice()
    rows[index] = row
    this.byTab = { ...this.byTab, [tabId]: { ...this.byTab[tabId], data: { ...cur, rows } } }
  }

  private tableTab(tabId: string): TableTab | null {
    const tab = workspace.tabs[tabId]
    return tab && tab.kind === 'table' ? tab : null
  }

  /** Compute the server-affecting request signature for a tab. */
  private requestSignature(tab: TableTab, config: TableViewConfig): string {
    const primarySort = config.sort[0]
    const serverSort = primarySort?.columnName === TITLE_COLUMN ? undefined : primarySort
    return JSON.stringify({
      folderPath: tab.folderPath,
      recursive: tab.recursive,
      sort: serverSort?.columnName ?? null,
      order: serverSort?.direction ?? null,
      // Constant per session (load() awaits detection); kept in the signature
      // as a safety net so a flip can never be deduped into a stale result.
      populate: cliFeatures.supportsRelations
    })
  }

  /** Collection root for a tab (cells that spawn CLI-backed pickers need it). */
  rootFor(tabId: string): string | undefined {
    return this.ctx[tabId]?.root
  }

  /** Collection id for a tab (recents lookup in pickers). */
  collectionIdFor(tabId: string): string | undefined {
    return this.ctx[tabId]?.collectionId
  }

  /**
   * Effective view config: active saved view (degraded against the live columns)
   * overlaid with the tab's ephemeral edits.
   */
  mergedConfig(tabId: string): TableViewConfig {
    const tab = this.tableTab(tabId)
    if (!tab) return emptyConfig()
    const collectionId = this.ctx[tabId]?.collectionId
    const data = this.byTab[tabId]?.data
    const validCols = new Set((data?.columns ?? []).map((c) => c.name))

    let base = emptyConfig()
    if (collectionId) {
      const view = tab.activeViewId
        ? tableViewsStore.getById(collectionId, tab.folderPath, tab.activeViewId)
        : tableViewsStore.getDefault(collectionId, tab.folderPath)
      if (view) base = degradeViewConfig(view.config, validCols)
      if (!tab.activeViewId) {
        const defaultColumns = tableViewsStore.getDefaultColumns(collectionId, tab.folderPath)
        if (defaultColumns !== null) base = { ...base, columns: defaultColumns }
      }
    }
    if (tab.ephemeral) base = { ...base, ...tab.ephemeral }
    // Before the first collection response there is no authoritative schema
    // to degrade against. Treating that state as an empty schema would erase
    // valid ephemeral config when saving a view during initial load.
    if (!data) return base
    // Ephemeral state is allowed to outlive a schema refresh. Degrade the
    // final merged shape too, otherwise an old renamed sort/filter can be
    // reintroduced after the saved-view base was already sanitized.
    return degradeViewConfig(base, validCols)
  }

  /**
   * Load (or reload) the collection data for a tab. Deduped by the server-affecting
   * request signature so identical concurrent loads collapse into one CLI call.
   */
  async load(
    tabId: string,
    collectionId: string,
    root: string,
    options: { suppressServerSort?: boolean } = {}
  ): Promise<void> {
    const api = window.api
    const tab = this.tableTab(tabId)
    if (!api || !tab) return

    this.ctx[tabId] = { collectionId, root }
    // Version detection is async — a first load racing ahead of it would fetch
    // WITHOUT --populate and render every relation chip neutral/unlinked until
    // some other server input changes. Settled detection resolves instantly;
    // a manually-set version (tests) skips the await entirely.
    if (cliFeatures.version === null) await cliFeatures.init()
    const mergedConfig = this.mergedConfig(tabId)
    const config = options.suppressServerSort ? { ...mergedConfig, sort: [] } : mergedConfig
    const sig = this.requestSignature(tab, config)
    if (this.inflight[tabId] === sig) return
    const existing = this.byTab[tabId]
    if (existing?.data && !existing.error && this.lastLoaded[tabId] === sig) return
    this.inflight[tabId] = sig

    const prev = this.byTab[tabId] ?? emptyData()
    this.byTab = { ...this.byTab, [tabId]: { ...prev, loading: true, error: null } }

    const primarySort = config.sort[0]
    try {
      const result = await api.collection(root, tab.folderPath || '.', {
        recursive: tab.recursive,
        sort:
          primarySort?.columnName && primarySort.columnName !== TITLE_COLUMN
            ? primarySort.columnName
            : undefined,
        order: primarySort?.direction,
        // Always populate when the CLI supports it (one flag on one existing
        // call — a per-cell fetch would be the N+1 phase 31 eliminates).
        // NEVER pass the flag on older CLIs: unknown flags error the spawn.
        populate: cliFeatures.supportsRelations || undefined
      })
      // Ignore stale responses if a newer request superseded this one.
      if (this.inflight[tabId] !== sig) return
      this.lastLoaded[tabId] = sig
      const data = {
        ...result,
        rows: this.reconcileRows(this.byTab[tabId]?.data?.rows, result.rows)
      }
      this.byTab = {
        ...this.byTab,
        [tabId]: { loading: false, error: null, data, lastLoadedAt: Date.now() }
      }
    } catch (err) {
      if (this.inflight[tabId] !== sig) return
      const message = err instanceof Error ? err.message : String(err)
      this.byTab = {
        ...this.byTab,
        [tabId]: { ...this.byTab[tabId], loading: false, error: message }
      }
    } finally {
      if (this.inflight[tabId] === sig) delete this.inflight[tabId]
    }
  }

  /**
   * Reuse previous row objects when a refetch delivers equivalent data, so
   * reloads don't churn the UI (a post-edit refetch replaces every row; keeping
   * identities makes unchanged rows a render no-op). Also carries over the
   * lazily-augmented frontmatter of still-`new` rows — the CLI returns `{}` for
   * unindexed rows, and blanking them out on every refetch causes a visible
   * per-row re-augment flicker.
   */
  private reconcileRows(prev: CollectionRow[] | undefined, next: CollectionRow[]): CollectionRow[] {
    if (!prev || prev.length === 0) return next
    const prevByPath = new Map(prev.map((r) => [r.path, r]))
    return next.map((row) => {
      const old = prevByPath.get(row.path)
      if (!old) return row
      const keepAugmented =
        row.state === 'new' &&
        Object.keys(row.frontmatter ?? {}).length === 0 &&
        Object.keys(old.frontmatter ?? {}).length > 0
      const merged = keepAugmented ? { ...row, frontmatter: old.frontmatter } : row
      return JSON.stringify(old) === JSON.stringify(merged) ? old : merged
    })
  }

  /** Force a reload regardless of signature (e.g. the refresh button). */
  async reload(tabId: string, options: { suppressServerSort?: boolean } = {}): Promise<void> {
    const c = this.ctx[tabId]
    if (!c) return
    delete this.inflight[tabId]
    delete this.lastLoaded[tabId]
    await this.load(tabId, c.collectionId, c.root, options)
  }

  /** Reload every table currently owned by this renderer window. */
  async reloadAll(options: { suppressServerSort?: boolean } = {}): Promise<void> {
    await Promise.all(Object.keys(this.ctx).map((tabId) => this.reload(tabId, options)))
  }

  /** Drop cached state for a closed tab. */
  dispose(tabId: string): void {
    if (this.byTab[tabId]) {
      const next = { ...this.byTab }
      delete next[tabId]
      this.byTab = next
    }
    delete this.ctx[tabId]
    delete this.inflight[tabId]
    delete this.lastLoaded[tabId]
    if (this.layoutSaveTimers[tabId]) clearTimeout(this.layoutSaveTimers[tabId])
    delete this.layoutSaveTimers[tabId]
    delete this.pendingLayouts[tabId]
    if (tabId in this.layoutErrors) {
      const next = { ...this.layoutErrors }
      delete next[tabId]
      this.layoutErrors = next
    }
  }

  /** Data columns in display order, honoring layout (hidden/order); Title excluded. */
  visibleColumns(tabId: string): CollectionColumn[] {
    const data = this.byTab[tabId]?.data
    if (!data) return []
    const layout = this.mergedConfig(tabId).columns
    const layoutByName = new Map(layout.map((l) => [l.name, l]))
    return data.columns
      .filter((c) => !layoutByName.get(c.name)?.hidden)
      .slice()
      .sort((a, b) => {
        const oa = layoutByName.get(a.name)?.order ?? Number.MAX_SAFE_INTEGER
        const ob = layoutByName.get(b.name)?.order ?? Number.MAX_SAFE_INTEGER
        if (oa !== ob) return oa - ob
        return a.name.localeCompare(b.name)
      })
  }

  /** Layout width for a column (px), or a default. */
  columnWidth(tabId: string, name: string): number {
    const layout = this.mergedConfig(tabId).columns.find((l) => l.name === name)
    return layout?.width ?? 180
  }

  /**
   * Rows after applying client-side filters. Frontmatter sorts are already
   * applied by the server; the synthetic Title sort is applied here with
   * natural numeric ordering (`ltwf-99` before `ltwf-101`).
   */
  filteredRows(tabId: string): CollectionRow[] {
    const data = this.byTab[tabId]?.data
    if (!data) return []
    const config = this.mergedConfig(tabId)
    const columns = new Map(data.columns.map((column) => [column.name, column]))
    const rows =
      config.filters.length === 0
        ? data.rows
        : data.rows.filter((row) =>
            config.filters.every((filter) =>
              matchesFilter(row, filter, columns.get(filter.columnName))
            )
          )
    const primarySort = config.sort[0]
    if (primarySort?.columnName !== TITLE_COLUMN) return rows

    const direction = primarySort.direction === 'desc' ? -1 : 1
    return rows.slice().sort((a, b) => {
      const byTitle = naturalTextCollator.compare(a.title, b.title) * direction
      return byTitle || naturalTextCollator.compare(a.path, b.path)
    })
  }

  /** Client-filtered row count (what the toolbar shows when client filters are active). */
  rowCount(tabId: string): number {
    return this.filteredRows(tabId).length
  }

  /**
   * Group the filtered rows by the configured field. Returns null when no
   * grouping is active. List-valued fields place a row under each item.
   *
   * Relation values (phase 42) group by the server-resolved `path` — so
   * `[[clients/acme]]` and `clients/acme.md` land in ONE group — labeled by
   * the resolved title. Unresolved / old-CLI values keep the raw key.
   */
  groups(tabId: string): TableRowGroup[] | null {
    const groupBy = this.mergedConfig(tabId).groupBy
    if (!groupBy) return null
    const rows = this.filteredRows(tabId)
    const order: string[] = []
    const map = new Map<string, CollectionRow[]>()
    const labels = new Map<string, string>()
    const push = (value: string, row: CollectionRow, label?: string): void => {
      if (!map.has(value)) {
        map.set(value, [])
        order.push(value)
      }
      if (label && !labels.has(value)) labels.set(value, label)
      map.get(value)!.push(row)
    }
    const pushItem = (item: JsonValue | undefined, row: CollectionRow): void => {
      if (typeof item === 'string') {
        const resolved = row.relations?.[groupBy]?.find((r) => r.raw === item)
        if (resolved?.path) {
          push(resolved.path, row, resolved.title ?? item)
          return
        }
      }
      push(valueToString(item) || '(empty)', row)
    }
    for (const row of rows) {
      const raw = effectiveFieldValue(row, groupBy)
      if (Array.isArray(raw) && raw.length > 0) {
        for (const item of raw) pushItem(item, row)
      } else {
        pushItem(raw as JsonValue | undefined, row)
      }
    }
    order.sort((a, b) => a.localeCompare(b))
    return order.map((value) => ({ value, rows: map.get(value)!, label: labels.get(value) }))
  }

  // ─── Editing (39b) ────────────────────────────────────────────────────

  /**
   * Edit a single cell. Optimistically updates the row, calls the main-process
   * frontmatter writer, reconciles with the authoritative result (or reverts on
   * failure), then schedules a debounced single-file re-index + refetch.
   * Clearing a value (undefined/null/'') unsets the key.
   */
  async editCell(
    tabId: string,
    path: string,
    columnName: string,
    value: JsonValue | null | undefined,
    opts: { record?: boolean } = {}
  ): Promise<boolean> {
    const ctx = this.ctx[tabId]
    const data = this.byTab[tabId]?.data
    if (!ctx || !data) return false
    const rowIdx = data.rows.findIndex((r) => r.path === path)
    if (rowIdx < 0) return false
    const row = data.rows[rowIdx]
    if (row.state === 'deleted') return false // deleted rows are read-only
    if (
      isComputedFieldType(data.columns.find((column) => column.name === columnName)?.field_type)
    ) {
      return false
    }

    const key = this.cellKey(tabId, path, columnName)
    const prevFm = row.frontmatter
    const before = snapshotOf(prevFm?.[columnName])
    const clearing = value === undefined || value === null || value === ''
    // Cells may commit reactive $state proxies (e.g. ListCell's tag array), which
    // Electron IPC structured clone rejects. JsonValue is JSON-safe by definition,
    // so a round-trip losslessly strips any proxy.
    if (!clearing && typeof value === 'object') {
      value = JSON.parse(JSON.stringify(value)) as JsonValue
    }
    const patch = clearing ? { unset: [columnName] } : { set: { [columnName]: value as JsonValue } }

    // Optimistic update.
    const optimisticFm = { ...prevFm }
    if (clearing) delete optimisticFm[columnName]
    else optimisticFm[columnName] = value as JsonValue
    this.setRow(tabId, rowIdx, { ...row, frontmatter: optimisticFm })
    this.setCellState(key, { saving: true, error: null })

    try {
      const updated = await window.api.updateFrontmatter(ctx.collectionId, path, patch)
      const cur = this.byTab[tabId]?.data
      const i = cur ? cur.rows.findIndex((r) => r.path === path) : -1
      if (cur && i >= 0) this.setRow(tabId, i, { ...cur.rows[i], frontmatter: updated })
      this.setCellState(key, { saving: false, error: null })
      this.scheduleReindex(tabId, path)
      // Record AFTER the authoritative write succeeds (failed edits revert and
      // must never enter history); `after` comes from main's result so redo
      // replays any main-process coercions. No-op edits produce no entry.
      if (opts.record !== false) {
        const after = snapshotOf(updated[columnName])
        if (!snapshotsEqual(before, after)) {
          tableHistory.record(tabId, {
            kind: 'cell-edit',
            path,
            column: columnName,
            before,
            after,
            at: Date.now()
          })
        }
      }
      return true
    } catch (err) {
      const cur = this.byTab[tabId]?.data
      const i = cur ? cur.rows.findIndex((r) => r.path === path) : -1
      if (cur && i >= 0) this.setRow(tabId, i, { ...cur.rows[i], frontmatter: prevFm })
      this.setCellState(key, {
        saving: false,
        error: err instanceof Error ? err.message : String(err)
      })
      return false
    }
  }

  /** Queue a path for single-file re-index; flushes (then refetches) after idle. */
  private scheduleReindex(tabId: string, path: string): void {
    ;(this.pendingReindex[tabId] ??= new Set()).add(path)
    if (this.reindexTimers[tabId]) clearTimeout(this.reindexTimers[tabId])
    this.reindexTimers[tabId] = setTimeout(() => {
      void this.flushReindex(tabId)
    }, 600)
  }

  private async flushReindex(tabId: string): Promise<void> {
    const ctx = this.ctx[tabId]
    const paths = this.pendingReindex[tabId]
    delete this.pendingReindex[tabId]
    delete this.reindexTimers[tabId]
    if (!ctx || !paths || paths.size === 0) return
    for (const p of paths) {
      try {
        await window.api.ingestFile(ctx.root, p, { reindex: true })
      } catch {
        // Re-index failures are non-fatal; the on-disk value is already saved.
      }
    }
    await this.reload(tabId)
  }

  /**
   * Reconcile an external `file:saved-externally` broadcast (multi-window sync).
   * The broadcast path is absolute; rows are relative — match by `${root}/${path}`.
   */
  applyExternalContent(tabId: string, absolutePath: string, content: string): void {
    const ctx = this.ctx[tabId]
    const data = this.byTab[tabId]?.data
    if (!ctx || !data) return
    const idx = data.rows.findIndex((r) => `${ctx.root}/${r.path}` === absolutePath)
    if (idx < 0) return
    this.setRow(tabId, idx, { ...data.rows[idx], frontmatter: parseFrontmatterObject(content) })
  }

  /**
   * Lazily augment a `new` (on-disk-but-unindexed) row's empty frontmatter by
   * reading the file from disk, so it is still editable. Deduped per path.
   */
  async augmentNewRow(tabId: string, path: string): Promise<void> {
    const ctx = this.ctx[tabId]
    const data = this.byTab[tabId]?.data
    if (!ctx || !data) return
    const guard = `${tabId} ${path}`
    if (this.augmenting.has(guard)) return
    const idx = data.rows.findIndex((r) => r.path === path)
    if (idx < 0 || data.rows[idx].state !== 'new') return
    if (Object.keys(data.rows[idx].frontmatter ?? {}).length > 0) return
    this.augmenting.add(guard)
    try {
      const content = await window.api.readFile(`${ctx.root}/${path}`)
      const fm = parseFrontmatterObject(content)
      if (Object.keys(fm).length === 0) return
      const cur = this.byTab[tabId]?.data
      const i = cur ? cur.rows.findIndex((r) => r.path === path) : -1
      if (cur && i >= 0) this.setRow(tabId, i, { ...cur.rows[i], frontmatter: fm })
    } catch {
      // Leave the row with empty frontmatter on read failure.
    } finally {
      this.augmenting.delete(guard)
    }
  }

  /**
   * Create a new `.md` row in the folder, seeded with the scoped-schema columns
   * (typed empty defaults) plus a title. Re-indexes + refetches on success.
   */
  async addRow(
    tabId: string,
    fileName: string,
    opts: { record?: boolean } = {}
  ): Promise<{ ok: boolean; error?: string }> {
    const ctx = this.ctx[tabId]
    const tab = this.tableTab(tabId)
    const data = this.byTab[tabId]?.data
    if (!ctx || !tab || !data) return { ok: false, error: 'Table not ready' }

    const trimmed = fileName.trim()
    if (trimmed === '') return { ok: false, error: 'Enter a file name' }
    const name = /\.(md|markdown)$/i.test(trimmed) ? trimmed : `${trimmed}.md`
    const stem = name.replace(/\.(md|markdown)$/i, '')
    const folder = tab.folderPath && tab.folderPath !== '.' ? tab.folderPath : ''
    const relPath = folder ? `${folder}/${name}` : name

    const seed: Record<string, JsonValue> = { title: stem }
    for (const col of data.columns) {
      if (col.in_schema && col.name !== 'title' && !isComputedFieldType(col.field_type)) {
        seed[col.name] = defaultForType(col.field_type)
      }
    }
    const fmText = stringifyYaml(seed).replace(/\n$/, '')
    const content = `---\n${fmText}\n---\n\n# ${stem}\n`

    try {
      await window.api.createFile(`${ctx.root}/${relPath}`, content)
      await window.api.ingestFile(ctx.root, relPath, { reindex: true })
      await this.reload(tabId)
      if (opts.record !== false) {
        tableHistory.record(tabId, { kind: 'add-row', path: relPath, content, at: Date.now() })
      }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  /** Trash a row's `.md` file, close any open editor tabs for it, and refetch. */
  async deleteRow(
    tabId: string,
    path: string,
    opts: { record?: boolean } = {}
  ): Promise<{ ok: boolean; error?: string }> {
    const ctx = this.ctx[tabId]
    if (!ctx) return { ok: false, error: 'Table not ready' }
    // Snapshot the file BEFORE the trash so undo can recreate it. A failed
    // read never blocks the delete — it only forfeits the history entry.
    let snapshot: string | null = null
    if (opts.record !== false) {
      try {
        snapshot = await window.api.readFile(`${ctx.root}/${path}`)
      } catch {
        snapshot = null
      }
    }
    try {
      await window.api.deleteFile(`${ctx.root}/${path}`)
      // Close any open document tabs for the deleted file.
      for (const id of Object.keys(workspace.tabs)) {
        const t = workspace.tabs[id]
        if (t.kind === 'document' && t.filePath === path) workspace.closeTab(id)
      }
      await this.reload(tabId)
      if (opts.record !== false) {
        if (snapshot !== null) {
          tableHistory.record(tabId, {
            kind: 'delete-row',
            path,
            content: snapshot,
            at: Date.now()
          })
        } else {
          // A mutation happened but is unrecordable — stale redo must not
          // replay on top of it.
          tableHistory.clearRedo(tabId)
        }
      }
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  // ─── Undo / redo (history) ────────────────────────────────────────────

  private rowByPath(tabId: string, path: string): CollectionRow | null {
    return this.byTab[tabId]?.data?.rows.find((r) => r.path === path) ?? null
  }

  /** Current on-disk bytes of a row's file, or null when unreadable. */
  private async readRowFile(tabId: string, path: string): Promise<string | null> {
    const ctx = this.ctx[tabId]
    if (!ctx) return null
    try {
      return await window.api.readFile(`${ctx.root}/${path}`)
    } catch {
      return null
    }
  }

  /**
   * Recreate a row's file from a history snapshot (undo-of-delete /
   * redo-of-add). Deliberately NOT addRow — no seed rebuild, exact bytes.
   * createFile's exclusive flag makes "path reappeared" fail loudly.
   */
  private async restoreRowFile(tabId: string, path: string, content: string): Promise<boolean> {
    const ctx = this.ctx[tabId]
    if (!ctx) return false
    try {
      await window.api.createFile(`${ctx.root}/${path}`, content)
      await window.api.ingestFile(ctx.root, path, { reindex: true })
      await this.reload(tabId)
      return true
    } catch {
      return false
    }
  }

  /**
   * Undo the most recent recorded table mutation (one entry per call).
   * Stale entries — the cell changed outside this table since the edit —
   * are skipped with a notice, never force-applied.
   */
  async undo(tabId: string): Promise<void> {
    const entry = tableHistory.popUndo(tabId)
    if (!entry) return
    switch (entry.kind) {
      case 'cell-edit': {
        const row = this.rowByPath(tabId, entry.path)
        if (!row || !snapshotsEqual(snapshotOf(row.frontmatter?.[entry.column]), entry.after)) {
          tableHistory.setNotice(
            tabId,
            `Undo skipped — "${entry.column}" changed outside this table`
          )
          return
        }
        const ok = await this.editCell(
          tabId,
          entry.path,
          entry.column,
          entry.before.present ? entry.before.value : null,
          { record: false }
        )
        if (ok) {
          tableHistory.pushRedoRaw(tabId, entry)
          tableHistory.requestReveal(tabId, entry.path, entry.column)
          this.flashCell(tabId, entry.path, entry.column)
        }
        return
      }
      case 'add-row': {
        // Trash the added file. Capture current bytes first so redo restores
        // exactly what was trashed (body edits after the add survive the trip).
        const captured = (await this.readRowFile(tabId, entry.path)) ?? entry.content
        const res = await this.deleteRow(tabId, entry.path, { record: false })
        if (res.ok) {
          tableHistory.pushRedoRaw(tabId, { ...entry, content: captured })
        } else {
          tableHistory.setNotice(tabId, `Undo failed — could not remove "${entry.path}"`)
        }
        return
      }
      case 'delete-row': {
        const ok = await this.restoreRowFile(tabId, entry.path, entry.content)
        if (ok) {
          tableHistory.pushRedoRaw(tabId, entry)
          tableHistory.requestReveal(tabId, entry.path, null)
        } else {
          tableHistory.setNotice(
            tabId,
            `Undo failed — could not restore "${entry.path}" (a file may already exist there)`
          )
        }
        return
      }
    }
  }

  /** Redo the most recently undone table mutation (one entry per call). */
  async redo(tabId: string): Promise<void> {
    const entry = tableHistory.popRedo(tabId)
    if (!entry) return
    switch (entry.kind) {
      case 'cell-edit': {
        const row = this.rowByPath(tabId, entry.path)
        if (!row || !snapshotsEqual(snapshotOf(row.frontmatter?.[entry.column]), entry.before)) {
          tableHistory.setNotice(
            tabId,
            `Redo skipped — "${entry.column}" changed outside this table`
          )
          return
        }
        const ok = await this.editCell(
          tabId,
          entry.path,
          entry.column,
          entry.after.present ? entry.after.value : null,
          { record: false }
        )
        if (ok) {
          tableHistory.pushUndoRaw(tabId, entry)
          tableHistory.requestReveal(tabId, entry.path, entry.column)
          this.flashCell(tabId, entry.path, entry.column)
        }
        return
      }
      case 'add-row': {
        const ok = await this.restoreRowFile(tabId, entry.path, entry.content)
        if (ok) {
          tableHistory.pushUndoRaw(tabId, entry)
          tableHistory.requestReveal(tabId, entry.path, null)
        } else {
          tableHistory.setNotice(
            tabId,
            `Redo failed — could not recreate "${entry.path}" (a file may already exist there)`
          )
        }
        return
      }
      case 'delete-row': {
        const captured = (await this.readRowFile(tabId, entry.path)) ?? entry.content
        const res = await this.deleteRow(tabId, entry.path, { record: false })
        if (res.ok) {
          tableHistory.pushUndoRaw(tabId, { ...entry, content: captured })
        } else {
          tableHistory.setNotice(tabId, `Redo failed — could not remove "${entry.path}"`)
        }
        return
      }
    }
  }

  /**
   * A layout with an entry for EVERY column, orders frozen to the current
   * display order. A lone new entry (order 0 vs. absent = MAX) would win the
   * order sort and jump its column to the front — seeding prevents that.
   */
  private seededLayout(tabId: string): TableColumnLayout[] {
    const existing = this.mergedConfig(tabId).columns
    const byName = new Map(existing.map((l) => [l.name, l]))
    const seeded: TableColumnLayout[] = this.visibleColumns(tabId).map((c, i) => {
      const entry = byName.get(c.name)
      return entry
        ? { ...entry, order: i }
        : { name: c.name, hidden: false, width: this.columnWidth(tabId, c.name), order: i }
    })
    // Preserve entries for currently-hidden columns after the visible ones.
    for (const l of existing) {
      if (!seeded.some((s) => s.name === l.name)) seeded.push({ ...l, order: seeded.length })
    }
    return seeded
  }

  /** Last persistence error for column layout changes in this tab. */
  columnLayoutError(tabId: string): string | null {
    return this.layoutErrors[tabId] ?? null
  }

  private persistColumnLayout(tabId: string, layout: TableColumnLayout[]): void {
    const context = this.ctx[tabId]
    const tab = this.tableTab(tabId)
    if (!context || !tab) return
    const plain = layout.map((column) => ({ ...column }))
    this.pendingLayouts[tabId] = plain
    this.layoutErrors = { ...this.layoutErrors, [tabId]: null }
    void tableViewsStore
      .saveColumnLayout(context.collectionId, tab.folderPath, tab.activeViewId, plain)
      .then(() => {
        if (this.pendingLayouts[tabId] === plain) {
          this.layoutErrors = { ...this.layoutErrors, [tabId]: null }
        }
      })
      .catch((error) => {
        if (this.pendingLayouts[tabId] !== plain) return
        this.layoutErrors = {
          ...this.layoutErrors,
          [tabId]: error instanceof Error ? error.message : String(error)
        }
      })
  }

  /** Retry the newest failed column-layout save for this tab. */
  retryColumnLayoutSave(tabId: string): void {
    const layout = this.pendingLayouts[tabId]
    if (layout) this.persistColumnLayout(tabId, layout)
  }

  /** Persist the current layout immediately (used when a width drag ends). */
  commitColumnLayout(tabId: string): void {
    if (this.layoutSaveTimers[tabId]) clearTimeout(this.layoutSaveTimers[tabId])
    delete this.layoutSaveTimers[tabId]
    this.persistColumnLayout(tabId, this.seededLayout(tabId))
  }

  private applyColumnLayout(tabId: string, layout: TableColumnLayout[]): void {
    workspace.setTableEphemeral(tabId, { columns: layout })
    if (this.layoutSaveTimers[tabId]) clearTimeout(this.layoutSaveTimers[tabId])
    delete this.layoutSaveTimers[tabId]
    this.persistColumnLayout(tabId, layout)
  }

  /** Persist a column width into the tab's ephemeral layout (39a polish: resize). */
  setColumnWidth(tabId: string, name: string, width: number): void {
    const clamped = Math.max(80, Math.round(width))
    const layout = this.seededLayout(tabId)
    const idx = layout.findIndex((c) => c.name === name)
    if (idx >= 0) {
      layout[idx] = { ...layout[idx], width: clamped }
    } else {
      layout.push({ name, hidden: false, width: clamped, order: layout.length })
    }
    workspace.setTableEphemeral(tabId, { columns: layout })
    if (this.layoutSaveTimers[tabId]) clearTimeout(this.layoutSaveTimers[tabId])
    this.layoutSaveTimers[tabId] = setTimeout(() => {
      delete this.layoutSaveTimers[tabId]
      this.persistColumnLayout(tabId, this.seededLayout(tabId))
    }, 300)
  }

  /** Toggle a column's visibility without disturbing the display order. */
  toggleColumnHidden(tabId: string, name: string): void {
    const layout = this.seededLayout(tabId)
    const idx = layout.findIndex((c) => c.name === name)
    if (idx >= 0) {
      layout[idx] = { ...layout[idx], hidden: !layout[idx].hidden }
    } else {
      layout.push({ name, hidden: true, width: 180, order: layout.length })
    }
    this.applyColumnLayout(tabId, layout)
  }

  /** Reveal every data column while preserving the current order and widths. */
  showAllColumns(tabId: string): void {
    const layout = this.seededLayout(tabId).map((column) => ({ ...column, hidden: false }))
    this.applyColumnLayout(tabId, layout)
  }

  /** Move one visible column before/after another and persist the resulting order. */
  reorderColumn(
    tabId: string,
    sourceName: string,
    targetName: string,
    position: 'before' | 'after'
  ): void {
    if (sourceName === targetName) return
    const layout = this.seededLayout(tabId)
    const sourceIndex = layout.findIndex((column) => column.name === sourceName)
    if (sourceIndex < 0) return
    const [source] = layout.splice(sourceIndex, 1)
    const targetIndex = layout.findIndex((column) => column.name === targetName)
    if (targetIndex < 0) return
    layout.splice(position === 'after' ? targetIndex + 1 : targetIndex, 0, source)
    const ordered = layout.map((column, order) => ({ ...column, order }))
    this.applyColumnLayout(tabId, ordered)
  }

  /** Keyboard-accessible one-step column move. */
  moveColumn(tabId: string, name: string, direction: -1 | 1): void {
    const visible = this.visibleColumns(tabId)
    const index = visible.findIndex((column) => column.name === name)
    const target = visible[index + direction]
    if (index < 0 || !target) return
    this.reorderColumn(tabId, name, target.name, direction < 0 ? 'before' : 'after')
  }
}

/** Singleton table data store. */
export const tableStore = new TableStore()
