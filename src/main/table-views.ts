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
import { TextDecoder } from 'node:util'
import { initStore, getCollections } from './store'
import { atomicWriteFile } from './atomic-write'
import { withSerializedFileWrite } from './file-write-queue'
import { registerOwnWrite } from './own-writes'
import type { SavedTableView, TableColumnLayout, TableViewConfig } from '../preload/api'

/** Bump when the persisted view-config shape changes. */
export const CURRENT_VIEW_VERSION = 2

/** On-disk shape of `.markdownvdb/table-views.json`. */
interface TableViewsFile {
  version: number
  folders: Record<string, SavedTableView[]>
  /** Column layout for the built-in, unnamed "All fields" view. */
  defaultColumns: Record<string, TableColumnLayout[]>
}

type LegacyTableViewsMap = Record<string, Record<string, SavedTableView[]>>

interface TableViewsLocation {
  collectionId: string
  collectionRoot: string
  filePath: string
  queuePath: string
}

export interface TableViewsSnapshot {
  existed: boolean
  content: Buffer | null
}

interface LegacyTableViewsSnapshot {
  folders: Record<string, SavedTableView[]>
  fingerprint: string
}

interface LoadedTableViews {
  snapshot: TableViewsSnapshot
  folders: Record<string, SavedTableView[]>
  defaultColumns: Record<string, TableColumnLayout[]>
  legacy: LegacyTableViewsSnapshot | null
}

interface TableViewsMutation<T> {
  changed: boolean
  value: T
}

/** Final coordination hook used by callers/tests that need to prove the
 * exact-generation CAS. It runs after the temporary file is durable and
 * immediately before the baseline is re-read. */
export interface TableViewsMutationOptions {
  onPrepared?: (snapshot: TableViewsSnapshot) => void | Promise<void>
  beforeCommit?: () => void | Promise<void>
  onPublished?: (snapshot: TableViewsSnapshot) => void
}

class MalformedTableViewsError extends Error {
  constructor(filePath: string, detail = 'invalid JSON or file shape') {
    super(`Existing ${filePath} has ${detail}; refusing to overwrite it.`)
    this.name = 'MalformedTableViewsError'
  }
}

function tableViewsChangedError(filePath: string): Error {
  return new Error(
    `${filePath} changed after this edit was prepared; refusing to overwrite the newer saved views.`
  )
}

async function tableViewsLocation(collectionId: string): Promise<TableViewsLocation> {
  const collection = getCollections().find((c) => c.id === collectionId)
  if (!collection) {
    throw new Error('Unknown collection')
  }
  const canonicalRoot = await fs.realpath(collection.path)
  return {
    collectionId,
    collectionRoot: collection.path,
    filePath: join(collection.path, '.markdownvdb', 'table-views.json'),
    // Two collection entries can refer to one vault through path aliases or a
    // symlink. Queue by canonical vault identity so they cannot race each other.
    queuePath: join(canonicalRoot, '.markdownvdb', 'table-views.json')
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validatedFolders(value: unknown, source: string): Record<string, SavedTableView[]> {
  if (!isRecord(value)) throw new MalformedTableViewsError(source)
  for (const views of Object.values(value)) {
    if (
      !Array.isArray(views) ||
      views.some(
        (view) => !isRecord(view) || typeof view.id !== 'string' || typeof view.name !== 'string'
      )
    ) {
      throw new MalformedTableViewsError(source)
    }
  }
  return value as Record<string, SavedTableView[]>
}

function validatedDefaultColumns(
  value: unknown,
  source: string
): Record<string, TableColumnLayout[]> {
  if (value === undefined) return {}
  if (!isRecord(value)) throw new MalformedTableViewsError(source)
  for (const columns of Object.values(value)) {
    if (
      !Array.isArray(columns) ||
      columns.some(
        (column) =>
          !isRecord(column) ||
          typeof column.name !== 'string' ||
          typeof column.hidden !== 'boolean' ||
          typeof column.width !== 'number' ||
          !Number.isFinite(column.width) ||
          typeof column.order !== 'number' ||
          !Number.isFinite(column.order)
      )
    ) {
      throw new MalformedTableViewsError(source)
    }
  }
  return value as Record<string, TableColumnLayout[]>
}

function parseFile(
  raw: Buffer,
  filePath: string
): Pick<TableViewsFile, 'folders' | 'defaultColumns'> {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(raw)
  } catch {
    throw new MalformedTableViewsError(filePath, 'invalid UTF-8')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new MalformedTableViewsError(filePath)
  }
  if (!isRecord(parsed) || !isRecord(parsed.folders)) {
    throw new MalformedTableViewsError(filePath)
  }
  if (
    parsed.version !== undefined &&
    (typeof parsed.version !== 'number' || parsed.version > CURRENT_VIEW_VERSION)
  ) {
    throw new MalformedTableViewsError(filePath, 'an unsupported version')
  }
  return {
    folders: validatedFolders(parsed.folders, filePath),
    defaultColumns: validatedDefaultColumns(parsed.defaultColumns, filePath)
  }
}

async function captureSnapshot(filePath: string): Promise<TableViewsSnapshot> {
  try {
    return { existed: true, content: await fs.readFile(filePath) }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { existed: false, content: null }
    }
    throw error
  }
}

function snapshotsEqual(left: TableViewsSnapshot, right: TableViewsSnapshot): boolean {
  return (
    left.existed === right.existed &&
    (left.content === null
      ? right.content === null
      : right.content !== null && left.content.equals(right.content))
  )
}

function cloneFolders(folders: Record<string, SavedTableView[]>): Record<string, SavedTableView[]> {
  return Object.fromEntries(
    Object.entries(folders).map(([folder, views]) => [folder, views.slice()])
  )
}

function cloneDefaultColumns(
  columns: Record<string, TableColumnLayout[]>
): Record<string, TableColumnLayout[]> {
  return Object.fromEntries(
    Object.entries(columns).map(([folder, layout]) => [
      folder,
      layout.map((column) => ({ ...column }))
    ])
  )
}

function legacySnapshot(collectionId: string): LegacyTableViewsSnapshot | null {
  const legacy = initStore().get('tableViews', {} as unknown)
  if (!isRecord(legacy)) {
    throw new MalformedTableViewsError(`legacy saved views for ${collectionId}`)
  }
  const rawFolders = legacy[collectionId]
  if (rawFolders === undefined) return null
  const folders = validatedFolders(rawFolders, `legacy saved views for ${collectionId}`)
  if (Object.keys(folders).length === 0) return null
  return {
    folders: Object.fromEntries(
      Object.entries(folders).map(([folder, views]) => [folder, views.map(migrateView)])
    ),
    fingerprint: JSON.stringify(rawFolders)
  }
}

/** Clear only the exact legacy generation that was successfully published.
 * If another main-process action changed it meanwhile, retain the newer copy. */
function clearPublishedLegacy(
  collectionId: string,
  publishedLegacy: LegacyTableViewsSnapshot
): void {
  try {
    const store = initStore()
    const current = store.get('tableViews', {} as LegacyTableViewsMap)
    if (JSON.stringify(current[collectionId]) !== publishedLegacy.fingerprint) return
    const next = { ...current }
    delete next[collectionId]
    store.set('tableViews', next)
  } catch (error) {
    // The file is already durably published. Retaining a duplicate legacy copy
    // is safer than turning a successful file mutation into a misleading error.
    console.warn(`table-views: could not clear migrated legacy views for ${collectionId}:`, error)
  }
}

async function loadCurrent(location: TableViewsLocation): Promise<LoadedTableViews> {
  const snapshot = await captureSnapshot(location.filePath)
  if (snapshot.existed) {
    const parsed = parseFile(snapshot.content ?? Buffer.alloc(0), location.filePath)
    return {
      snapshot,
      folders: parsed.folders,
      defaultColumns: parsed.defaultColumns,
      legacy: null
    }
  }
  const legacy = legacySnapshot(location.collectionId)
  return {
    snapshot,
    folders: legacy ? cloneFolders(legacy.folders) : {},
    defaultColumns: {},
    legacy
  }
}

function serializedFolders(
  folders: Record<string, SavedTableView[]>,
  defaultColumns: Record<string, TableColumnLayout[]>
): string {
  const payload: TableViewsFile = { version: CURRENT_VIEW_VERSION, folders, defaultColumns }
  return `${JSON.stringify(payload, null, 2)}\n`
}

async function publishFolders(
  location: TableViewsLocation,
  folders: Record<string, SavedTableView[]>,
  defaultColumns: Record<string, TableColumnLayout[]>,
  baseline: TableViewsSnapshot,
  options: TableViewsMutationOptions
): Promise<void> {
  await fs.mkdir(dirname(location.filePath), { recursive: true })
  const content = serializedFolders(folders, defaultColumns)
  const publishedSnapshot: TableViewsSnapshot = {
    existed: true,
    content: Buffer.from(content, 'utf-8')
  }
  let cancelOwnWrite: (() => void) | null = null
  let published = false
  try {
    await atomicWriteFile(location.filePath, content, {
      allowedRoot: location.collectionRoot,
      beforeCommit: async () => {
        await options.beforeCommit?.()
        if (!snapshotsEqual(await captureSnapshot(location.filePath), baseline)) {
          throw tableViewsChangedError(location.filePath)
        }
        cancelOwnWrite = registerOwnWrite(location.filePath, 'write', content)
      },
      onPublished: () => {
        published = true
        options.onPublished?.(publishedSnapshot)
      }
    })
  } catch (error) {
    if (!published) cancelOwnWrite?.()
    throw error
  }
}

/** One owner for every saved-view read/modify/write. The complete source read,
 * mutation, exact-baseline check, and publication share the per-file queue. */
async function mutateFolders<T>(
  collectionId: string,
  mutate: (
    folders: Record<string, SavedTableView[]>,
    defaultColumns: Record<string, TableColumnLayout[]>
  ) => TableViewsMutation<T>,
  options: TableViewsMutationOptions = {}
): Promise<T> {
  const location = await tableViewsLocation(collectionId)
  return withSerializedFileWrite(location.queuePath, async () => {
    const loaded = await loadCurrent(location)
    await options.onPrepared?.(loaded.snapshot)
    const folders = cloneFolders(loaded.folders)
    const defaultColumns = cloneDefaultColumns(loaded.defaultColumns)
    const result = mutate(folders, defaultColumns)
    if (result.changed || loaded.legacy !== null) {
      await publishFolders(location, folders, defaultColumns, loaded.snapshot, options)
      if (loaded.legacy) clearPublishedLegacy(collectionId, loaded.legacy)
    }
    return result.value
  })
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

/** Read one complete generation. A corrupt file may render as an empty list,
 * but mutations remain fail-closed and can never replace its bytes. */
async function readFolders(collectionId: string): Promise<Record<string, SavedTableView[]>> {
  try {
    return await mutateFolders(collectionId, (folders) => ({ changed: false, value: folders }))
  } catch (error) {
    if (!(error instanceof MalformedTableViewsError)) throw error
    console.warn(`table-views: could not read saved views, starting empty:`, error)
    return {}
  }
}

/** List the saved views for a folder (migrated to the current shape). */
export async function listTableViews(
  collectionId: string,
  folderPath: string
): Promise<SavedTableView[]> {
  const folders = await readFolders(collectionId)
  return (folders[folderPath] ?? []).map(migrateView)
}

/** Read the durable column layout for the built-in "All fields" view. */
export async function getDefaultTableColumns(
  collectionId: string,
  folderPath: string
): Promise<TableColumnLayout[] | null> {
  try {
    return await mutateFolders(collectionId, (_folders, defaultColumns) => ({
      changed: false,
      value: defaultColumns[folderPath]?.map((column) => ({ ...column })) ?? null
    }))
  } catch (error) {
    if (!(error instanceof MalformedTableViewsError)) throw error
    console.warn(`table-views: could not read default columns, starting empty:`, error)
    return null
  }
}

/** Replace the durable column layout for the built-in "All fields" view. */
export async function saveDefaultTableColumns(
  collectionId: string,
  folderPath: string,
  columns: TableColumnLayout[],
  options: TableViewsMutationOptions = {}
): Promise<TableColumnLayout[]> {
  const plain = validatedDefaultColumns({ [folderPath]: columns }, 'All fields column layout')[
    folderPath
  ].map((column) => ({ ...column }))
  return mutateFolders(
    collectionId,
    (_folders, defaultColumns) => {
      defaultColumns[folderPath] = plain
      return { changed: true, value: plain.map((column) => ({ ...column })) }
    },
    options
  )
}

/** Insert or replace a view by id (upsert). Returns the migrated list. */
export async function saveTableView(
  collectionId: string,
  folderPath: string,
  view: SavedTableView,
  options: TableViewsMutationOptions = {}
): Promise<SavedTableView[]> {
  return mutateFolders(
    collectionId,
    (folders) => {
      const views = (folders[folderPath] ?? []).slice()
      const migrated = migrateView({ ...view, updatedAt: Date.now() })
      const idx = views.findIndex((v) => v.id === migrated.id)
      if (idx >= 0) views[idx] = migrated
      else views.push(migrated)
      folders[folderPath] = views
      return { changed: true, value: views.map(migrateView) }
    },
    options
  )
}

/** Update an existing view (same upsert semantics as save). */
export const updateTableView = saveTableView

/** Delete a view by id. Returns the migrated remaining list. */
export async function deleteTableView(
  collectionId: string,
  folderPath: string,
  viewId: string,
  options: TableViewsMutationOptions = {}
): Promise<SavedTableView[]> {
  return mutateFolders(
    collectionId,
    (folders) => {
      if (!folders[folderPath]) return { changed: false, value: [] }
      const current = folders[folderPath]
      const views = current.filter((v) => v.id !== viewId)
      if (views.length === current.length) {
        return { changed: false, value: views.map(migrateView) }
      }
      folders[folderPath] = views
      return { changed: true, value: views.map(migrateView) }
    },
    options
  )
}

/** Mark exactly one view as the folder default (clears the flag on the rest). */
export async function setDefaultTableView(
  collectionId: string,
  folderPath: string,
  viewId: string,
  options: TableViewsMutationOptions = {}
): Promise<SavedTableView[]> {
  return mutateFolders(
    collectionId,
    (folders) => {
      if (!folders[folderPath]) return { changed: false, value: [] }
      const now = Date.now()
      let changed = false
      const views = folders[folderPath].map((v) => {
        const isDefault = v.id === viewId
        if (v.isDefault === isDefault) return v
        changed = true
        return {
          ...v,
          isDefault,
          updatedAt: isDefault ? now : v.updatedAt
        }
      })
      if (changed) folders[folderPath] = views
      return { changed, value: views.map(migrateView) }
    },
    options
  )
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
  newKey: string,
  options: TableViewsMutationOptions = {}
): Promise<void> {
  await mutateFolders(
    collectionId,
    (folders, defaultColumns) => {
      const inScope = (folderPath: string): boolean =>
        scope === '' || folderPath === scope || folderPath.startsWith(`${scope}/`)
      const isRecursiveAncestor = (folderPath: string, view: SavedTableView): boolean =>
        view.recursive &&
        scope !== '' &&
        (folderPath === '' || scope === folderPath || scope.startsWith(`${folderPath}/`))

      let dirty = false
      const now = Date.now()
      for (const [folderPath, views] of Object.entries(folders)) {
        folders[folderPath] = views.map((raw) => {
          const v = migrateView(raw)
          if (!inScope(folderPath) && !isRecursiveAncestor(folderPath, v)) return v
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

      for (const [folderPath, columns] of Object.entries(defaultColumns)) {
        if (!inScope(folderPath)) continue
        let changed = false
        defaultColumns[folderPath] = columns.map((column) => {
          if (column.name !== oldKey) return column
          changed = true
          return { ...column, name: newKey }
        })
        if (changed) dirty = true
      }
      return { changed: dirty, value: undefined }
    },
    options
  )
}

/**
 * Remove every saved-view reference to a dropped property.
 *
 * Dropping a column is vault-wide, so this intentionally visits every folder
 * rather than applying the scoped filtering used by rename.
 */
export async function removePropertyFromViews(
  collectionId: string,
  key: string,
  options: TableViewsMutationOptions = {}
): Promise<void> {
  await mutateFolders(
    collectionId,
    (folders, defaultColumns) => {
      let dirty = false
      const now = Date.now()

      for (const [folderPath, views] of Object.entries(folders)) {
        folders[folderPath] = views.map((raw) => {
          const view = migrateView(raw)
          const sort = view.config.sort.filter((item) => item.columnName !== key)
          const filters = view.config.filters.filter((item) => item.columnName !== key)
          const columns = view.config.columns.filter((item) => item.name !== key)
          const groupBy = view.config.groupBy === key ? null : view.config.groupBy
          const collapsedGroups = view.config.groupBy === key ? [] : view.config.collapsedGroups
          const changed =
            sort.length !== view.config.sort.length ||
            filters.length !== view.config.filters.length ||
            columns.length !== view.config.columns.length ||
            groupBy !== view.config.groupBy ||
            collapsedGroups.length !== view.config.collapsedGroups.length

          if (!changed) return view
          dirty = true
          return {
            ...view,
            config: { ...view.config, sort, filters, columns, groupBy, collapsedGroups },
            updatedAt: now
          }
        })
      }

      for (const [folderPath, columns] of Object.entries(defaultColumns)) {
        const kept = columns.filter((column) => column.name !== key)
        if (kept.length === columns.length) continue
        defaultColumns[folderPath] = kept
        dirty = true
      }

      return { changed: dirty, value: undefined }
    },
    options
  )
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
