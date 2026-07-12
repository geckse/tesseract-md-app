/**
 * Saved table-view persistence — stored INSIDE the collection at
 * `.markdownvdb/table-views.json` so views travel with the vault (git/sync
 * shareable) instead of living only in this machine's electron-store.
 *
 * Legacy views saved in electron-store (`tableViews[collectionId]`) are
 * migrated into the collection file on first read, then removed from the
 * app store. Structural migration on read (version bump + config defaulting)
 * is preserved; column-aware degradation stays client-side.
 */

import { promises as fs } from 'node:fs'
import { join, dirname } from 'node:path'
import { initStore, getCollections } from './store'
import type { SavedTableView, TableViewConfig } from '../preload/api'

/** Bump when the persisted view-config shape changes. */
export const CURRENT_VIEW_VERSION = 1

/** On-disk shape of `.markdownvdb/table-views.json`. */
interface TableViewsFile {
  version: number
  folders: Record<string, SavedTableView[]>
}

type LegacyTableViewsMap = Record<string, Record<string, SavedTableView[]>>

function viewsFilePath(collectionId: string): string {
  const collection = getCollections().find((c) => c.id === collectionId)
  if (!collection) {
    throw new Error('Unknown collection')
  }
  return join(collection.path, '.markdownvdb', 'table-views.json')
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

/**
 * Read the collection's views file. A missing file triggers a one-time
 * migration of any legacy electron-store views for this collection; a corrupt
 * file logs and starts empty (app config data — not user markdown).
 */
async function readFolders(collectionId: string): Promise<Record<string, SavedTableView[]>> {
  const filePath = viewsFilePath(collectionId)
  try {
    const raw = await fs.readFile(filePath, 'utf-8')
    const parsed = JSON.parse(raw) as TableViewsFile
    return parsed && typeof parsed.folders === 'object' && parsed.folders !== null
      ? parsed.folders
      : {}
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return migrateLegacyViews(collectionId)
    }
    console.warn(`table-views: could not read ${filePath}, starting empty:`, err)
    return {}
  }
}

/** Atomic write (temp + rename), creating `.markdownvdb/` if needed. */
async function writeFolders(
  collectionId: string,
  folders: Record<string, SavedTableView[]>
): Promise<void> {
  const filePath = viewsFilePath(collectionId)
  const payload: TableViewsFile = { version: CURRENT_VIEW_VERSION, folders }
  const content = JSON.stringify(payload, null, 2) + '\n'
  await fs.mkdir(dirname(filePath), { recursive: true })
  const tmpPath = join(dirname(filePath), `.${Date.now()}.${process.pid}.table-views.tmp`)
  await fs.writeFile(tmpPath, content, 'utf-8')
  try {
    await fs.rename(tmpPath, filePath)
  } catch (err) {
    await fs.rm(tmpPath, { force: true }).catch(() => {})
    throw err
  }
}

/** Move any legacy electron-store views for this collection into the file. */
async function migrateLegacyViews(collectionId: string): Promise<Record<string, SavedTableView[]>> {
  const s = initStore()
  const legacy = s.get('tableViews', {} as LegacyTableViewsMap)
  const folders = legacy[collectionId]
  if (!folders || Object.keys(folders).length === 0) return {}
  await writeFolders(collectionId, folders)
  delete legacy[collectionId]
  s.set('tableViews', legacy)
  return folders
}

/** List the saved views for a folder (migrated to the current shape). */
export async function listTableViews(
  collectionId: string,
  folderPath: string
): Promise<SavedTableView[]> {
  const folders = await readFolders(collectionId)
  return (folders[folderPath] ?? []).map(migrateView)
}

/** Insert or replace a view by id (upsert). Returns the migrated list. */
export async function saveTableView(
  collectionId: string,
  folderPath: string,
  view: SavedTableView
): Promise<SavedTableView[]> {
  const folders = await readFolders(collectionId)
  const views = (folders[folderPath] ?? []).slice()
  const migrated = migrateView({ ...view, updatedAt: Date.now() })
  const idx = views.findIndex((v) => v.id === migrated.id)
  if (idx >= 0) views[idx] = migrated
  else views.push(migrated)
  folders[folderPath] = views
  await writeFolders(collectionId, folders)
  return views.map(migrateView)
}

/** Update an existing view (same upsert semantics as save). */
export const updateTableView = saveTableView

/** Delete a view by id. Returns the migrated remaining list. */
export async function deleteTableView(
  collectionId: string,
  folderPath: string,
  viewId: string
): Promise<SavedTableView[]> {
  const folders = await readFolders(collectionId)
  if (!folders[folderPath]) return []
  const views = folders[folderPath].filter((v) => v.id !== viewId)
  folders[folderPath] = views
  await writeFolders(collectionId, folders)
  return views.map(migrateView)
}

/** Mark exactly one view as the folder default (clears the flag on the rest). */
export async function setDefaultTableView(
  collectionId: string,
  folderPath: string,
  viewId: string
): Promise<SavedTableView[]> {
  const folders = await readFolders(collectionId)
  if (!folders[folderPath]) return []
  const now = Date.now()
  const views = folders[folderPath].map((v) => ({
    ...v,
    isDefault: v.id === viewId,
    updatedAt: v.id === viewId ? now : v.updatedAt
  }))
  folders[folderPath] = views
  await writeFolders(collectionId, folders)
  return views.map(migrateView)
}

/**
 * Best-effort rename of a frontmatter key inside saved views (phase 41).
 * Touches views for the scope folder AND its descendants (`scope: ''` =
 * vault-wide). Anything missed degrades via the client-side column-aware
 * view degradation — this never errors on absent folders.
 */
export async function renamePropertyInViews(
  collectionId: string,
  scope: string,
  oldKey: string,
  newKey: string
): Promise<void> {
  const folders = await readFolders(collectionId)
  const inScope = (folderPath: string): boolean =>
    scope === '' || folderPath === scope || folderPath.startsWith(`${scope}/`)

  let dirty = false
  const now = Date.now()
  for (const [folderPath, views] of Object.entries(folders)) {
    if (!inScope(folderPath)) continue
    folders[folderPath] = views.map((raw) => {
      const v = migrateView(raw)
      let changed = false
      const rename = (name: string): string => {
        if (name === oldKey) {
          changed = true
          return newKey
        }
        return name
      }
      const config: TableViewConfig = {
        ...v.config,
        sort: v.config.sort.map((s) => ({ ...s, columnName: rename(s.columnName) })),
        filters: v.config.filters.map((f) => ({ ...f, columnName: rename(f.columnName) })),
        columns: v.config.columns.map((c) => ({ ...c, name: rename(c.name) })),
        groupBy: v.config.groupBy === null ? null : rename(v.config.groupBy)
      }
      if (!changed) return v
      dirty = true
      return { ...v, config, updatedAt: now }
    })
  }
  if (dirty) await writeFolders(collectionId, folders)
}

/**
 * On collection removal, clear only any legacy electron-store entry. The
 * `.markdownvdb/table-views.json` file belongs to the vault and is left
 * intact so re-adding the collection (or another machine) keeps its views.
 */
export function cleanupCollectionTableViews(collectionId: string): void {
  const s = initStore()
  const legacy = s.get('tableViews', {} as LegacyTableViewsMap)
  if (legacy[collectionId]) {
    delete legacy[collectionId]
    s.set('tableViews', legacy)
  }
}
