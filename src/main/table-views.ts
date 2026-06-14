/**
 * Saved table-view persistence (electron-store), keyed by collectionId → folder
 * path → list of views. Performs *structural* migration on read (version bump +
 * config defaulting); column-aware degradation (dropping views' references to
 * columns that no longer exist) happens client-side where the live `collection`
 * columns are known.
 */

import { initStore } from './store'
import type { SavedTableView, TableViewConfig } from '../preload/api'

/** Bump when the persisted view-config shape changes. */
export const CURRENT_VIEW_VERSION = 1

type TableViewsMap = Record<string, Record<string, SavedTableView[]>>

function readAll(): TableViewsMap {
  const s = initStore()
  return s.get('tableViews', {})
}

function writeAll(map: TableViewsMap): void {
  const s = initStore()
  s.set('tableViews', map)
}

/** Ensure a view has the current version and a fully-formed config. */
function migrateView(v: SavedTableView): SavedTableView {
  const config: Partial<TableViewConfig> = (v?.config as Partial<TableViewConfig>) ?? {}
  return {
    id: v.id,
    name: v.name,
    version: CURRENT_VIEW_VERSION,
    config: {
      sort: Array.isArray(config.sort) ? config.sort : [],
      filters: Array.isArray(config.filters) ? config.filters : [],
      columns: Array.isArray(config.columns) ? config.columns : [],
      groupBy: config.groupBy ?? null,
      collapsedGroups: Array.isArray(config.collapsedGroups) ? config.collapsedGroups : []
    },
    recursive: !!v.recursive,
    isDefault: v.isDefault ?? false,
    createdAt: typeof v.createdAt === 'number' ? v.createdAt : Date.now(),
    updatedAt: typeof v.updatedAt === 'number' ? v.updatedAt : Date.now()
  }
}

/** List the saved views for a folder (migrated to the current shape). */
export function listTableViews(collectionId: string, folderPath: string): SavedTableView[] {
  const all = readAll()
  const views = all[collectionId]?.[folderPath] ?? []
  return views.map(migrateView)
}

/** Insert or replace a view by id (upsert). Returns the migrated list. */
export function saveTableView(
  collectionId: string,
  folderPath: string,
  view: SavedTableView
): SavedTableView[] {
  const all = readAll()
  const byFolder = all[collectionId] ?? {}
  const views = (byFolder[folderPath] ?? []).slice()
  const migrated = migrateView({ ...view, updatedAt: Date.now() })
  const idx = views.findIndex((v) => v.id === migrated.id)
  if (idx >= 0) views[idx] = migrated
  else views.push(migrated)
  all[collectionId] = { ...byFolder, [folderPath]: views }
  writeAll(all)
  return views.map(migrateView)
}

/** Update an existing view (same upsert semantics as save). */
export const updateTableView = saveTableView

/** Delete a view by id. Returns the migrated remaining list. */
export function deleteTableView(
  collectionId: string,
  folderPath: string,
  viewId: string
): SavedTableView[] {
  const all = readAll()
  const byFolder = all[collectionId]
  if (!byFolder?.[folderPath]) return []
  const views = byFolder[folderPath].filter((v) => v.id !== viewId)
  all[collectionId] = { ...byFolder, [folderPath]: views }
  writeAll(all)
  return views.map(migrateView)
}

/** Mark exactly one view as the folder default (clears the flag on the rest). */
export function setDefaultTableView(
  collectionId: string,
  folderPath: string,
  viewId: string
): SavedTableView[] {
  const all = readAll()
  const byFolder = all[collectionId]
  if (!byFolder?.[folderPath]) return []
  const now = Date.now()
  const views = byFolder[folderPath].map((v) => ({
    ...v,
    isDefault: v.id === viewId,
    updatedAt: v.id === viewId ? now : v.updatedAt
  }))
  all[collectionId] = { ...byFolder, [folderPath]: views }
  writeAll(all)
  return views.map(migrateView)
}

/** Remove all saved views for a collection (on collection removal). */
export function cleanupCollectionTableViews(collectionId: string): void {
  const all = readAll()
  if (all[collectionId]) {
    delete all[collectionId]
    writeAll(all)
  }
}
