/**
 * Saved table views (per collection + folder), backed by the `tableviews:*` IPC.
 *
 * The main process performs structural migration (version bump + config
 * defaulting); this store additionally performs **column-aware degradation** —
 * dropping a view's references to columns that no longer exist in the live
 * `collection` output — so a stale saved view loads gracefully instead of
 * erroring. Degradation is a pure function so it is easy to unit-test.
 *
 * Svelte 5 runes singleton (MUST remain a .svelte.ts file).
 */

import type { SavedTableView, TableColumnLayout, TableViewConfig } from '../../preload/api'

/** The Title column is synthetic and always valid. */
export const TITLE_COLUMN = '__title__'

/** Cache key for a (collection, folder) pair. */
function key(collectionId: string, folderPath: string): string {
  return `${collectionId}\u0000${folderPath}`
}

/**
 * Drop references to columns that are not present in `validColumnNames`.
 * The synthetic Title column is always retained. Never throws.
 */
export function degradeViewConfig(
  config: TableViewConfig,
  validColumnNames: Set<string>
): TableViewConfig {
  const isValid = (name: string): boolean => name === TITLE_COLUMN || validColumnNames.has(name)
  return {
    sort: (config.sort ?? []).filter((s) => isValid(s.columnName)),
    filters: (config.filters ?? []).filter((f) => isValid(f.columnName)),
    columns: (config.columns ?? []).filter((c) => isValid(c.name)),
    groupBy: config.groupBy && isValid(config.groupBy) ? config.groupBy : null,
    collapsedGroups: config.collapsedGroups ?? []
  }
}

class TableViewsStore {
  /** Saved views keyed by `${collectionId}\0${folderPath}`. */
  private views = $state<Record<string, SavedTableView[]>>({})

  /** Durable layouts for the built-in "All fields" view. Null means no saved layout. */
  private defaultColumns = $state<Record<string, TableColumnLayout[] | null>>({})

  /** Serialize rapid layout writes per view so the newest drag/hide action wins. */
  private columnSaveQueues = new Map<string, Promise<void>>()

  /** Per-key generation of the newest requested disk read. Forced reloads
   * supersede an older in-flight response so a pre-rename view cannot win. */
  private generations = new Map<string, number>()
  private loading = new Map<string, number>()

  /** Return the cached views for a folder (empty array if not loaded). */
  getViews(collectionId: string, folderPath: string): SavedTableView[] {
    return this.views[key(collectionId, folderPath)] ?? []
  }

  /** Return the default view for a folder, if any. */
  getDefault(collectionId: string, folderPath: string): SavedTableView | null {
    return this.getViews(collectionId, folderPath).find((v) => v.isDefault) ?? null
  }

  /** Look up a view by id. */
  getById(collectionId: string, folderPath: string, viewId: string): SavedTableView | null {
    return this.getViews(collectionId, folderPath).find((v) => v.id === viewId) ?? null
  }

  /** Column layout for the built-in "All fields" view, if the user has customized it. */
  getDefaultColumns(collectionId: string, folderPath: string): TableColumnLayout[] | null {
    return this.defaultColumns[key(collectionId, folderPath)] ?? null
  }

  /** Load (or reload) the saved views for a folder from disk. */
  async load(collectionId: string, folderPath: string): Promise<void> {
    await this.loadFromDisk(collectionId, folderPath, false)
  }

  /** Force a fresh read even when an older request is still in flight. */
  async reload(collectionId: string, folderPath: string): Promise<void> {
    await this.loadFromDisk(collectionId, folderPath, true)
  }

  private async loadFromDisk(
    collectionId: string,
    folderPath: string,
    force: boolean
  ): Promise<void> {
    const api = window.api
    if (!api) return
    const k = key(collectionId, folderPath)
    if (!force && this.loading.has(k)) return
    const generation = (this.generations.get(k) ?? 0) + 1
    this.generations.set(k, generation)
    this.loading.set(k, generation)
    try {
      const [list, defaultColumns] = await Promise.all([
        api.listTableViews(collectionId, folderPath),
        typeof api.getDefaultTableColumns === 'function'
          ? api.getDefaultTableColumns(collectionId, folderPath)
          : Promise.resolve(null)
      ])
      if (this.generations.get(k) !== generation) return
      // Unchanged content → keep the cached array identity so downstream
      // deriveds (mergedConfig et al.) don't recompute for a no-op refetch.
      const prevViews = this.views[k]
      if (!prevViews || JSON.stringify(prevViews) !== JSON.stringify(list)) {
        this.views = { ...this.views, [k]: list }
      }
      const prevColumns = this.defaultColumns[k]
      if (JSON.stringify(prevColumns) !== JSON.stringify(defaultColumns)) {
        this.defaultColumns = { ...this.defaultColumns, [k]: defaultColumns }
      }
    } catch {
      if (this.generations.get(k) !== generation) return
      // Degrade silently — a missing/locked store yields no saved views.
      if (!this.views[k]) this.views = { ...this.views, [k]: [] }
      if (!(k in this.defaultColumns)) {
        this.defaultColumns = { ...this.defaultColumns, [k]: null }
      }
    } finally {
      if (this.loading.get(k) === generation) this.loading.delete(k)
    }
  }

  async save(
    collectionId: string,
    folderPath: string,
    view: SavedTableView
  ): Promise<SavedTableView[]> {
    const api = window.api
    if (!api) return this.getViews(collectionId, folderPath)
    // The view's config often embeds reactive $state proxies (tab ephemeral) —
    // Electron IPC structured clone rejects proxies ("An object could not be cloned").
    const plain = $state.snapshot(view) as SavedTableView
    const list = await api.saveTableView(collectionId, folderPath, plain)
    this.views = { ...this.views, [key(collectionId, folderPath)]: list }
    return list
  }

  /**
   * Persist column order/visibility/width into either the built-in All fields
   * layout (`viewId === null`) or the active named view. Writes are serialized
   * per target so a quick sequence of drops cannot publish out of order.
   */
  async saveColumnLayout(
    collectionId: string,
    folderPath: string,
    viewId: string | null,
    columns: TableColumnLayout[]
  ): Promise<void> {
    const api = window.api
    if (!api) return
    const targetKey = `${key(collectionId, folderPath)}\u0000${viewId ?? '__all_fields__'}`
    const plain = $state.snapshot(columns) as TableColumnLayout[]
    const previous = this.columnSaveQueues.get(targetKey) ?? Promise.resolve()
    const operation = previous
      .catch(() => undefined)
      .then(async () => {
        if (viewId === null) {
          if (typeof api.saveDefaultTableColumns !== 'function') {
            throw new Error('This app build cannot save the All fields layout.')
          }
          const saved = await api.saveDefaultTableColumns(collectionId, folderPath, plain)
          this.defaultColumns = {
            ...this.defaultColumns,
            [key(collectionId, folderPath)]: saved
          }
          return
        }

        const view = this.getById(collectionId, folderPath, viewId)
        if (!view) throw new Error('The selected saved view no longer exists.')
        // Views in the $state cache are deep reactive proxies. Spreading the
        // top level is insufficient: sort/filter/collapsedGroups remain proxies
        // and Electron IPC rejects the payload as non-cloneable.
        const updated = $state.snapshot({
          ...view,
          config: { ...view.config, columns: plain }
        }) as SavedTableView
        const saved = await api.updateTableView(collectionId, folderPath, updated)
        this.views = { ...this.views, [key(collectionId, folderPath)]: saved }
      })
    this.columnSaveQueues.set(targetKey, operation)
    try {
      await operation
    } finally {
      if (this.columnSaveQueues.get(targetKey) === operation) {
        this.columnSaveQueues.delete(targetKey)
      }
    }
  }

  async remove(
    collectionId: string,
    folderPath: string,
    viewId: string
  ): Promise<SavedTableView[]> {
    const api = window.api
    if (!api) return this.getViews(collectionId, folderPath)
    const list = await api.deleteTableView(collectionId, folderPath, viewId)
    this.views = { ...this.views, [key(collectionId, folderPath)]: list }
    return list
  }

  async setDefault(
    collectionId: string,
    folderPath: string,
    viewId: string
  ): Promise<SavedTableView[]> {
    const api = window.api
    if (!api) return this.getViews(collectionId, folderPath)
    const list = await api.setDefaultTableView(collectionId, folderPath, viewId)
    this.views = { ...this.views, [key(collectionId, folderPath)]: list }
    return list
  }
}

/** Singleton saved-views store. */
export const tableViewsStore = new TableViewsStore()
