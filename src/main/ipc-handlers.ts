/**
 * IPC handler registration for all CLI bridge channels.
 *
 * Each handler maps an IPC channel to a CLI command via execCommand().
 * Called once from the main process on app ready.
 */

import { app, ipcMain, shell, clipboard, BrowserWindow, dialog } from 'electron'
import { constants as fsConstants, promises as fs } from 'node:fs'
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve as resolvePath,
  sep
} from 'node:path'
import {
  findCli,
  getCliVersion,
  execCommand,
  execRaw,
  execWithInput,
  execModuleTransaction
} from './cli'
import { getGraphSnapshot } from './graph-snapshot-cache'
import { detectCli, installCli, checkLatestVersion } from './cli-install'
import { readSettingsConfig, SETTINGS_SECRET_KEYS, SETTINGS_YAML_KEYS } from './config-io'
import {
  getOnboardingComplete,
  setOnboardingComplete,
  getEditorFontSize,
  setEditorFontSize,
  getAutoShowDiff,
  setAutoShowDiff,
  getWatcherEnabled,
  setWatcherEnabled,
  getZoomLevel,
  setZoomLevel,
  setCliInfo,
  getWindowSessions,
  setWindowSessions,
  getPrimaryColor,
  setPrimaryColor,
  getCollectionColor,
  setCollectionColor,
  getThemeMode,
  setThemeMode,
  getCollectionTheme,
  setCollectionTheme,
  getTerminalShellPath,
  setTerminalShellPath,
  getTerminalShellArgs,
  setTerminalShellArgs,
  getTerminalFontSize,
  setTerminalFontSize,
  getCollectionSkillsDismissed,
  setCollectionSkillsDismissed,
  getActiveShardId,
  setActiveShardId
} from './store'
import type { PersistedWindowState } from './store'
import type {
  TabTransferData,
  PopupOpenOptions,
  SavedTableView,
  TableColumnLayout,
  PropertyOpRequest,
  OverlayFieldPatch,
  CollectionSkillsTargetId,
  ExternalDroppedFileDescriptor,
  ImportedDroppedFile
} from '../preload/api'
import type { NativeConfirmationOptions, NativeMessageOptions } from '../preload/api'
import type { PropertyValueColorSelection } from '../shared/value-colors'
import type { ImageEditRequest } from '../shared/image-edit'
import type { FrontmatterPatch } from './frontmatter'
import { WatcherManager, type WatcherState } from './watcher'
import { getVaultWatcher } from './vault-watcher'
import { registerOwnWrite, clearOwnWrites } from './own-writes'
import { atomicCreateFile, atomicWriteFile } from './atomic-write'
import { getAppUpdater } from './updater'
import { registerExportHandlers } from './export'
import type { WindowManager } from './window-manager'
import type { PtyManager } from './pty'
import {
  getCollections,
  addCollection,
  removeCollection,
  setActiveCollection,
  getActiveCollection
} from './store'
import type { Collection, FavoriteEntry } from './store'
import {
  pickCollectionFolder,
  validateCollectionPath,
  initCollection,
  confirmRemoveCollection,
  promptInitCollection
} from './collections'
import { createExampleCollection } from './example-collection'
import { getCollectionInfo } from './collection-info'
import { clearWindowMenuContext, refreshAppMenu, updateWindowMenuContext } from './menu'
import {
  maybeSyncObsidianTopics,
  scheduleObsidianSync,
  cancelScheduledObsidianSyncs,
  watchObsidianConfig
} from './obsidian-import'
import type {
  SearchOutput,
  IndexStatus,
  IngestResult,
  IngestPreview,
  FileTree,
  DocumentInfo,
  LinksOutput,
  BacklinksOutput,
  OrphansOutput,
  NeighborhoodResult,
  ClusterSummary,
  CustomClusterSummary,
  TopicDef,
  TopicUnassigned,
  GraphLevel,
  Schema,
  ScopedSchema,
  Config,
  DoctorResult,
  CollectionOutput,
  FormulaResultType,
  FormulaValidationResult,
  LookupRollupDefinition,
  EmbeddingModelsResponse,
  EmbeddingProbe,
  ModuleDescriptor,
  ModuleReport,
  ModuleRunResponse,
  ShardInfo,
  ShardList,
  ShardMutation
} from '../renderer/types/cli'
import type { SerializedError } from './errors'
import type { GraphMenuContext } from '../preload/api'
import {
  CliNotFoundError,
  CliExecutionError,
  CliParseError,
  CliTimeoutError,
  TerminalSpawnError,
  TerminalNotFoundError
} from './errors'
import { broadcastShardInvalidation, configureShardManifestWatcher } from './shard-watcher'
import {
  broadcastComputedSchemaApplied,
  flushDirtyDocumentsAcrossWindows,
  registerComputedEditorFlushResponseHandler,
  verifyCleanDocumentsAcrossWindows
} from './computed-editor-flush'
import { withSerializedFileWrite } from './file-write-queue'
import { assertComputedOutputKeyAbsentOnDisk } from './computed-output-preflight'
import { IngestProcessManager } from './ingest-manager'
import { ActivityLogStore } from './activity-log'
import { getMimeCategory } from './asset-scanner'

/** Ingest timeout: 5 minutes */
const INGEST_TIMEOUT_MS = 300_000

type ExternalFileKind = ExternalDroppedFileDescriptor['kind']
type ExternalMimeCategory = ExternalDroppedFileDescriptor['mimeCategory']

const FORBIDDEN_IMPORT_DIRECTORIES = new Set([
  '.git',
  '.markdownvdb',
  '.obsidian',
  'node_modules',
  'dist',
  'build',
  'out',
  'target'
])

interface SafeRegularFile {
  path: string
  metadata: Awaited<ReturnType<typeof fs.lstat>>
}

function pathIsWithin(root: string, candidate: string): boolean {
  const child = relative(root, candidate)
  return child === '' || (!child.startsWith('..') && !isAbsolute(child))
}

/** Resolve a user-dropped path once and reject link-based aliases/replacements. */
async function safeRegularFile(candidate: unknown): Promise<SafeRegularFile> {
  if (typeof candidate !== 'string' || candidate.trim() === '') {
    throw new TypeError('Dropped file path must be a non-empty string')
  }

  const normalized = resolvePath(candidate)
  const initial = await fs.lstat(normalized)
  if (!initial.isFile() || initial.isSymbolicLink() || initial.nlink > 1) {
    throw new Error('The dropped item is not a safe regular file')
  }

  const canonicalPath = await fs.realpath(normalized)
  const metadata = await fs.lstat(canonicalPath)
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink > 1) {
    throw new Error('The dropped item is not a safe regular file')
  }
  return { path: canonicalPath, metadata }
}

function classifyExternalFile(name: string): {
  kind: ExternalFileKind
  mimeCategory: ExternalMimeCategory
} {
  const extension = extname(name).toLowerCase()
  if (extension === '.md' || extension === '.markdown') {
    return { kind: 'markdown', mimeCategory: 'other' }
  }

  const mimeCategory = getMimeCategory(name) ?? 'other'
  return {
    kind: mimeCategory === 'other' ? 'other' : 'asset',
    mimeCategory
  }
}

async function collectionMembership(filePath: string): Promise<{
  collectionId: string | null
  relativePath: string | null
}> {
  let best: { id: string; root: string } | null = null
  for (const collection of getCollections()) {
    const root = await fs.realpath(resolvePath(collection.path)).catch(() => null)
    if (!root || !pathIsWithin(root, filePath)) continue
    if (!best || root.length > best.root.length) best = { id: collection.id, root }
  }
  if (!best) return { collectionId: null, relativePath: null }
  return {
    collectionId: best.id,
    relativePath: relative(best.root, filePath).split(sep).join('/')
  }
}

function requireExternalGrant(
  windowManager: WindowManager,
  senderId: number,
  grantId: unknown
): string {
  if (typeof grantId !== 'string' || grantId === '') {
    throw new TypeError('External file grant ID is required')
  }
  const grantedPath = windowManager.getExternalFilePath(senderId, grantId)
  if (!grantedPath) throw new Error('Access denied: external file grant is unavailable')
  return grantedPath
}

function normalizedImportSegments(targetDirectory: unknown): string[] {
  if (typeof targetDirectory !== 'string') {
    throw new TypeError('Collection target directory must be a string')
  }
  if (targetDirectory === '' || targetDirectory === '.') return []
  if (
    isAbsolute(targetDirectory) ||
    /^[A-Za-z]:[\\/]/.test(targetDirectory) ||
    targetDirectory.startsWith('\\\\')
  ) {
    throw new Error('Access denied: collection target directory must be relative')
  }

  const segments = targetDirectory.replace(/\\/g, '/').split('/')
  if (
    segments.some((segment) => {
      const normalized = segment.toLowerCase()
      return (
        !segment ||
        segment === '.' ||
        segment === '..' ||
        segment.startsWith('.') ||
        FORBIDDEN_IMPORT_DIRECTORIES.has(normalized)
      )
    })
  ) {
    throw new Error('Access denied: invalid collection target directory')
  }
  return segments
}

/** Resolve an existing, non-symlinked folder below a registered collection. */
async function safeImportDirectory(
  collectionId: unknown,
  targetDirectory: unknown
): Promise<{
  root: string
  path: string
}> {
  if (typeof collectionId !== 'string' || collectionId === '') {
    throw new TypeError('Collection ID is required')
  }
  const collection = getCollections().find((item) => item.id === collectionId)
  if (!collection) throw new Error('Access denied: unknown collection')

  const root = await fs.realpath(resolvePath(collection.path))
  const rootMetadata = await fs.lstat(root)
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink()) {
    throw new Error('Access denied: collection root is not a safe directory')
  }

  let target = root
  for (const segment of normalizedImportSegments(targetDirectory)) {
    target = join(target, segment)
    const metadata = await fs.lstat(target)
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new Error('Access denied: collection target is not a safe directory')
    }
  }
  if (!pathIsWithin(root, target)) {
    throw new Error('Access denied: collection target escaped its collection')
  }
  return { root, path: target }
}

async function copyDroppedFileExclusively(
  source: SafeRegularFile,
  target: { root: string; path: string }
): Promise<ImportedDroppedFile> {
  const sourceName = basename(source.path)
  const parsed = parse(sourceName)
  const classification = classifyExternalFile(sourceName)

  for (let suffix = 0; suffix < 10_000; suffix += 1) {
    const filename = suffix === 0 ? sourceName : `${parsed.name}-${suffix}${parsed.ext}`
    const destination = join(target.path, filename)
    if (!pathIsWithin(target.root, destination)) {
      throw new Error('Access denied: imported file escaped its collection')
    }

    const cancelOwnWrite = registerOwnWrite(destination, 'copy')
    try {
      await fs.copyFile(source.path, destination, fsConstants.COPYFILE_EXCL)
      return {
        sourceName,
        relativePath: relative(target.root, destination).split(sep).join('/'),
        size: source.metadata.size,
        ...classification
      }
    } catch (error) {
      cancelOwnWrite()
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue
      throw error
    }
  }

  throw new Error(`Could not find an available filename for "${sourceName}"`)
}

const graphMenuBooleanKeys = new Set<keyof GraphMenuContext>([
  'active',
  'ready',
  'labelsVisible',
  'linesVisible',
  'shapesVisible',
  'shapesAvailable',
  'unconnectedHighlighted',
  'hasSelection',
  'exportingScreenshot',
  'topicsAvailable'
])
const graphMenuPresentationStates = new Set(['idle', 'playing', 'paused'])
const graphMenuLevels = new Set(['document', 'chunk'])
const graphMenuColoringModes = new Set(['cluster', 'custom-cluster', 'folder', 'none'])
const menuContextSenders = new Set<number>()

/** Validate the small, transient renderer snapshot used by the native Graph menu. */
function validateGraphMenuContextUpdate(value: unknown): Partial<GraphMenuContext> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Menu context must be an object')
  }

  const update = value as Record<string, unknown>
  const allowedKeys = new Set<string>([
    ...graphMenuBooleanKeys,
    'unconnectedCount',
    'presentationState',
    'level',
    'coloringMode'
  ])
  for (const key of Object.keys(update)) {
    if (!allowedKeys.has(key)) throw new TypeError(`Unknown menu context field: ${key}`)
  }

  for (const key of graphMenuBooleanKeys) {
    if (key in update && typeof update[key] !== 'boolean') {
      throw new TypeError(`Menu context ${key} must be a boolean`)
    }
  }
  if (
    'unconnectedCount' in update &&
    (!Number.isInteger(update.unconnectedCount) || (update.unconnectedCount as number) < 0)
  ) {
    throw new TypeError('Menu context unconnectedCount must be a non-negative integer')
  }
  if (
    'presentationState' in update &&
    !graphMenuPresentationStates.has(update.presentationState as string)
  ) {
    throw new TypeError('Invalid graph presentation menu state')
  }
  if ('level' in update && !graphMenuLevels.has(update.level as string)) {
    throw new TypeError('Invalid graph menu level')
  }
  if ('coloringMode' in update && !graphMenuColoringModes.has(update.coloringMode as string)) {
    throw new TypeError('Invalid graph menu coloring mode')
  }

  return update as Partial<GraphMenuContext>
}

/**
 * Serialize any error into an IPC-safe object.
 * IPC strips Error prototypes, so we convert to plain objects.
 */
export function serializeError(error: unknown): SerializedError {
  if (
    error instanceof CliNotFoundError ||
    error instanceof CliExecutionError ||
    error instanceof CliParseError ||
    error instanceof CliTimeoutError ||
    error instanceof TerminalSpawnError ||
    error instanceof TerminalNotFoundError
  ) {
    return error.serialize()
  }

  if (error instanceof Error) {
    return { error: true as const, type: 'CliExecutionError' as const, message: error.message }
  }

  return { error: true as const, type: 'CliExecutionError' as const, message: String(error) }
}

/**
 * Wrap an async handler so errors are serialized for IPC transport.
 */
export function wrapHandler<T>(fn: () => Promise<T>): Promise<T | SerializedError> {
  return fn().catch((error: unknown) => {
    return serializeError(error)
  })
}

/** Singleton watcher manager instance */
let watcherManager: WatcherManager | null = null
let ingestProcessManager: IngestProcessManager | null = null
let activityLogStore: ActivityLogStore | null = null

function recordActivity(operation: Promise<void> | undefined): void {
  void operation?.catch(() => {})
}

/**
 * Get or create the WatcherManager singleton.
 */
function getWatcherManager(): WatcherManager {
  if (!watcherManager) {
    watcherManager = new WatcherManager()
  }
  return watcherManager
}

// AppUpdater singleton now lives in updater.ts (the native menu needs it
// without importing this module). Re-exported for existing callers.
export { getAppUpdater, destroyAppUpdater } from './updater'

/**
 * Destroy the watcher manager (call on app quit).
 */
export async function destroyWatcherManager(): Promise<void> {
  if (ingestProcessManager) {
    await ingestProcessManager.destroy()
    ingestProcessManager = null
  }
  if (watcherManager) {
    await watcherManager.destroy()
    watcherManager = null
  }
  activityLogStore = null
}

/**
 * Run a callback with the watcher temporarily paused.
 * Stops the watcher if running, executes the callback, then restarts it.
 * If the watcher was not running, just executes the callback directly.
 * Exported for the phase-41 batch property converter (`property-ops.ts`).
 */
let watcherPauseQueue: Promise<void> = Promise.resolve()

export async function withWatcherPaused<T>(root: string, fn: () => Promise<T>): Promise<T> {
  const previous = watcherPauseQueue
  let release!: () => void
  watcherPauseQueue = new Promise<void>((resolve) => {
    release = resolve
  })
  await previous.catch(() => {})
  try {
    return await withWatcherPausedUnlocked(root, fn)
  } finally {
    release()
  }
}

async function withWatcherPausedUnlocked<T>(root: string, fn: () => Promise<T>): Promise<T> {
  const watcher = watcherManager
  // `start()` returns after spawning the child, while its state is still
  // `starting`. A schema/property operation can immediately request an ingest
  // during that window; the child already owns the index lock even though
  // `isRunning()` is still false. Treat both states as active so the ingest
  // cannot race the freshly restarted watcher.
  const state = watcher?.getState() ?? 'stopped'
  const wasActive = state === 'running' || state === 'starting'
  const restartRoot = watcher?.getRoot() ?? root

  if (watcher && (wasActive || state === 'stopping')) {
    await watcher.stop()
  }

  try {
    return await fn()
  } finally {
    if (wasActive && watcher) {
      try {
        const status = await execCommand<IndexStatus>('status', [], restartRoot)
        if (status?.reindex_required) {
          watcher.block(restartRoot)
          recordActivity(
            activityLogStore?.recordWatcherState(
              restartRoot,
              'blocked',
              status.embedding_compatibility_error ?? 'Reindex required'
            )
          )
        } else await watcher.start(restartRoot)
      } catch {
        // The original operation result/error is authoritative. A failed
        // watcher restore is surfaced by the next explicit start/status check.
        watcher.block(restartRoot)
      }
    }
  }
}

function normalizeModuleRunResponse(
  response: ModuleRunResponse,
  moduleId: string
): { primary: ModuleReport; reports: ModuleReport[] } {
  const reports =
    'module_reports' in response && Array.isArray(response.module_reports)
      ? response.module_reports
      : 'reports' in response && Array.isArray(response.reports)
        ? response.reports
        : 'module' in response
          ? [response]
          : []
  const primary = reports.find((report) => report.module === moduleId)
  if (!primary) throw new Error(`${moduleId} module did not return a report`)
  const moduleFailureCodes = new Set(['module_error', 'invalid_schema'])
  const failure = reports
    .flatMap((report) => report.diagnostics)
    .find((diagnostic) => moduleFailureCodes.has(diagnostic.code))
  if (failure) {
    const label = moduleId === 'formula' ? 'Formula' : 'Lookup/Rollup'
    throw new Error(`${label} module failed: ${failure.message}`)
  }
  return { primary, reports }
}

function normalizedScope(value: string | null | undefined): string | null {
  const normalized = value?.trim().replace(/^\.\/+|^\/+|\/+$/g, '') ?? ''
  return normalized && normalized !== '.' ? normalized : null
}

function validatedComputedFieldName(value: unknown, label = 'Computed field name'): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} is required`)
  if (value !== value.trim()) throw new Error(`${label} cannot start or end with spaces`)
  if (
    [...value].some((character) => {
      const code = character.codePointAt(0) ?? 0
      return code <= 0x1f || code === 0x7f
    })
  ) {
    throw new Error(`${label} cannot contain control characters`)
  }
  if (value === 'title' || value === 'path') {
    throw new Error(`"${value}" is reserved and cannot be a computed field`)
  }
  return value
}

async function loadCollectionFieldsForScope(
  root: string,
  scope: string | null
): Promise<CollectionOutput['columns']> {
  // Topology validation must recognize exact indexed frontmatter keys omitted
  // by a persisted scoped schema. `collection` returns schema fields unioned
  // with keys present in every matching row, and computes columns before
  // pagination, so limit 0 avoids transferring any document payload.
  const result = await execCommand<CollectionOutput>(
    'collection',
    [scope ?? '.', '--recursive', '--limit', '0'],
    root
  )
  return result.columns
}

/** Revalidate relation topology at the privileged IPC boundary. Renderer
 * selectors are guidance only; a stale or forged request must not create a
 * plausible-but-empty aggregate. */
async function validateLookupRollupTopology(
  root: string,
  ownerScope: string | null,
  definition: LookupRollupDefinition,
  mutation: { previousKey?: string; key: string }
): Promise<void> {
  let ownerFields: CollectionOutput['columns'] | null = null
  if (mutation.previousKey === undefined || mutation.previousKey !== mutation.key) {
    ownerFields = await loadCollectionFieldsForScope(root, normalizedScope(ownerScope))
    if (ownerFields.some((field) => field.name === mutation.key)) {
      const action = mutation.previousKey === undefined ? 'create' : 'rename'
      const source = mutation.previousKey === undefined ? '' : ` "${mutation.previousKey}" to`
      throw new Error(
        `Cannot ${action} computed field${source} "${mutation.key}": the destination field already exists`
      )
    }
  }

  if (definition.relationDirection === 'incoming') {
    const sourceScope = normalizedScope(definition.relationScope)
    if (!sourceScope) throw new Error('Incoming Rollup relation scope is required')
    const sourceFields = await loadCollectionFieldsForScope(root, sourceScope)
    const relation = sourceFields.find((field) => field.name === definition.relationField)
    if (relation?.field_type !== 'Relation') {
      throw new Error(`"${definition.relationField}" is not a Relation field in ${sourceScope}`)
    }
    const expectedTarget = normalizedScope(ownerScope)
    if (
      !relation.relation_target?.trim() ||
      normalizedScope(relation.relation_target) !== expectedTarget
    ) {
      throw new Error(
        `Relation "${definition.relationField}" must target the current collection (${expectedTarget ?? 'root'})`
      )
    }
    if (!sourceFields.some((field) => field.name === definition.targetField)) {
      throw new Error(`Target field "${definition.targetField}" does not exist in ${sourceScope}`)
    }
    return
  }

  ownerFields ??= await loadCollectionFieldsForScope(root, normalizedScope(ownerScope))
  const relation = ownerFields.find((field) => field.name === definition.relationField)
  if (relation?.field_type !== 'Relation' || !relation.relation_target?.trim()) {
    throw new Error(
      `"${definition.relationField}" must be a Relation field with a target collection`
    )
  }
  const targetScope = normalizedScope(relation.relation_target)
  const targetFields = await loadCollectionFieldsForScope(root, targetScope)
  if (!targetFields.some((field) => field.name === definition.targetField)) {
    throw new Error(`Target field "${definition.targetField}" does not exist in ${targetScope}`)
  }
}

function broadcastModuleReports(windowManager: WindowManager, reports: ModuleReport[]): void {
  for (const report of reports) {
    windowManager.broadcastToAll('watcher:event', { type: 'module-report', data: report })
  }
}

async function restoreComputedOverlay(
  windowManager: WindowManager,
  root: string,
  previous: import('./schema-overlay').OverlaySnapshot,
  mutated: import('./schema-overlay').OverlaySnapshot,
  moduleId: 'formula' | 'lookup_rollup',
  primaryError: unknown
): Promise<never> {
  const primaryMessage = primaryError instanceof Error ? primaryError.message : String(primaryError)
  let overlayRestored = false
  let transaction: Awaited<ReturnType<typeof execModuleTransaction>>
  try {
    transaction = await execModuleTransaction(root, moduleId, null, async () => {
      const { restoreOverlaySnapshot } = await import('./schema-overlay')
      await restoreOverlaySnapshot(root, previous, mutated)
      overlayRestored = true
    })
  } catch (rollbackError) {
    const phase = overlayRestored ? 'rollback recompute' : 'overlay rollback'
    throw new Error(
      `${primaryMessage}; ${phase} failed: ${
        rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
      }`
    )
  }

  try {
    const rollback = normalizeModuleRunResponse(transaction.response as ModuleRunResponse, moduleId)
    broadcastModuleReports(windowManager, rollback.reports)
    broadcastComputedSchemaApplied(windowManager, root)
  } catch (rollbackError) {
    throw new Error(
      `${primaryMessage}; rollback recompute failed: ${
        rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
      }`
    )
  }
  throw primaryError
}

/**
 * Register all IPC handlers for CLI bridge channels.
 * Must be called once after app is ready.
 *
 * @param windowManager - The WindowManager for broadcasting events to all windows
 * @param ptyManager - PTY registry, used to rebind terminals during cross-window transfers
 */
/**
 * Register IPC required by the preload before its first page can paint.
 * Keep this deliberately tiny: loading every feature handler before creating
 * a window delays startup and has caused Electron automation races.
 */
export function registerStartupIpcHandlers(): void {
  ipcMain.on('store:get-theme-sync', (event) => {
    event.returnValue = getThemeMode()
  })
}

export function registerIpcHandlers(windowManager: WindowManager, ptyManager?: PtyManager): void {
  // Export (phase 43): Save a Copy… / Export ▸ via native save dialog
  registerExportHandlers()
  registerComputedEditorFlushResponseHandler()

  activityLogStore = new ActivityLogStore(getCollections, (event) => {
    windowManager.broadcastToAll('activity-log:changed', event)
  })
  ingestProcessManager = new IngestProcessManager(async (event) => {
    windowManager.broadcastToAll('cli:ingest-event', event)
    await activityLogStore?.recordIngest(event)
  })

  // Focused renderer state for contextual native Graph-menu enablement/checkmarks.
  ipcMain.handle('menu:set-context', (event, value: unknown) =>
    wrapHandler(async () => {
      const update = validateGraphMenuContextUpdate(value)
      updateWindowMenuContext(event.sender.id, update)
      if (!menuContextSenders.has(event.sender.id)) {
        menuContextSenders.add(event.sender.id)
        event.sender.once('destroyed', () => {
          menuContextSenders.delete(event.sender.id)
          clearWindowMenuContext(event.sender.id)
        })
      }
    })
  )

  // CLI detection
  ipcMain.handle('cli:find', () => wrapHandler(() => findCli()))

  ipcMain.handle('cli:version', () => wrapHandler(() => getCliVersion()))

  // Search
  ipcMain.handle(
    'cli:search',
    (
      _event,
      root: string,
      query: string,
      options?: {
        limit?: number
        mode?: string
        path?: string
        filter?: string
        expand?: number
        hops?: number
        boostLinks?: boolean
      }
    ) => {
      const args: string[] = [query]
      if (options?.limit != null) args.push('--limit', String(options.limit))
      if (options?.mode) args.push('--mode', options.mode)
      if (options?.path) args.push('--path', options.path)
      if (options?.filter) args.push('--filter', options.filter)
      if (options?.boostLinks) {
        args.push('--boost-links')
        if (options?.hops != null) args.push('--hops', String(options.hops))
      }
      if (options?.expand != null && options.expand > 0)
        args.push('--expand', String(options.expand))
      return wrapHandler(() => execCommand<SearchOutput>('search', args, root))
    }
  )

  ipcMain.handle('cli:modules-list', (_event, root: string) =>
    wrapHandler(() => execCommand<ModuleDescriptor[]>('modules', ['list'], root))
  )

  ipcMain.handle(
    'cli:modules-validate-rollup',
    (_event, root: string, formula: string, resultType: FormulaResultType) =>
      wrapHandler(() =>
        execCommand<FormulaValidationResult>(
          'modules',
          [
            'validate',
            'lookup_rollup',
            '--formula',
            formula,
            '--result-type',
            resultType.toLowerCase()
          ],
          root
        )
      )
  )

  // Status
  ipcMain.handle('cli:status', (_event, root: string) =>
    wrapHandler(() => execCommand<IndexStatus>('status', [], root))
  )

  // Built-in Formula module. Validation is read-only; a manual run materializes
  // values into Markdown and therefore shares the watcher pause discipline used
  // by ingest.
  ipcMain.handle(
    'cli:modules-validate-formula',
    (_event, root: string, formula: string, resultType: FormulaResultType) =>
      wrapHandler(() =>
        execCommand<FormulaValidationResult>(
          'modules',
          ['validate', 'formula', '--formula', formula, '--result-type', resultType.toLowerCase()],
          root
        )
      )
  )

  ipcMain.handle('cli:modules-run-formula', (_event, root: string, scope?: string) =>
    wrapHandler(() =>
      withWatcherPaused(root, () => {
        const args = ['run', 'formula']
        const normalized = scope?.replace(/\/+$/, '')
        if (normalized && normalized !== '.') args.push('--path', normalized)
        return execCommand<ModuleReport>('modules', args, root, { timeout: INGEST_TIMEOUT_MS })
      })
    )
  )

  // Named Shards. Definitions are project-local and CLI-owned; Electron only
  // transports the stable JSON contracts and persists the last selected id.
  ipcMain.handle('cli:shards-list', (_event, root: string) =>
    wrapHandler(() => execCommand<ShardList>('shards', ['list'], root))
  )

  ipcMain.handle('cli:shards-get', (_event, root: string, id: string) =>
    wrapHandler(() => execCommand<ShardInfo>('shards', ['get', id], root))
  )

  ipcMain.handle(
    'cli:shards-add',
    (
      _event,
      root: string,
      id: string,
      path: string,
      options?: { name?: string; createDir?: boolean }
    ) =>
      wrapHandler(async () => {
        const args = ['add', id, '--path', path]
        if (options?.name) args.push('--name', options.name)
        if (options?.createDir) args.push('--create-dir')
        const result = await execCommand<ShardMutation>('shards', args, root)
        broadcastShardInvalidation(root)
        return result
      })
  )

  ipcMain.handle(
    'cli:shards-update',
    (
      _event,
      root: string,
      id: string,
      options: { name?: string; path?: string; createDir?: boolean }
    ) =>
      wrapHandler(async () => {
        const args = ['update', id]
        if (options.name !== undefined) args.push('--name', options.name)
        if (options.path !== undefined) args.push('--path', options.path)
        if (options.createDir) args.push('--create-dir')
        const result = await execCommand<ShardMutation>('shards', args, root)
        broadcastShardInvalidation(root)
        return result
      })
  )

  ipcMain.handle('cli:shards-remove', (_event, root: string, id: string) =>
    wrapHandler(async () => {
      const result = await execCommand<ShardMutation>('shards', ['remove', id], root)
      broadcastShardInvalidation(root)
      return result
    })
  )

  ipcMain.handle(
    'cli:shards-retarget',
    (_event, root: string, oldPrefix: string, newPrefix: string) =>
      wrapHandler(async () => {
        const result = await execCommand<ShardMutation>(
          'shards',
          ['retarget', oldPrefix, newPrefix],
          root
        )
        broadcastShardInvalidation(root)
        return result
      })
  )

  ipcMain.handle('store:get-active-shard-id', (_event, collectionId: string) =>
    wrapHandler(async () => getActiveShardId(collectionId))
  )

  ipcMain.handle(
    'store:set-active-shard-id',
    (_event, collectionId: string, shardId: string | null) =>
      wrapHandler(async () => {
        if (!getCollections().some((collection) => collection.id === collectionId)) {
          throw new Error(`Collection not found: ${collectionId}`)
        }
        setActiveShardId(collectionId, shardId)
      })
  )

  // Ingest
  ipcMain.handle('cli:ingest', (_event, root: string, options?: { reindex?: boolean }) => {
    return wrapHandler(async () => {
      const manager = ingestProcessManager
      if (!manager) throw new Error('Ingest process manager is not initialized')
      const reindex = Boolean(options?.reindex)
      const result = await withWatcherPaused(root, () => manager.run(root, reindex))
      if (reindex && !result.cancelled) {
        const normalizedRoot = resolvePath(root)
        const collection = getCollections().find(
          (item) => resolvePath(item.path) === normalizedRoot
        )
        const watcher = getWatcherManager()
        if (
          collection &&
          getWatcherEnabled(collection.id) &&
          watcher.getRoot() !== null &&
          resolvePath(watcher.getRoot()!) === normalizedRoot &&
          !watcher.isRunning()
        ) {
          await watcher.start(root)
        }
      }
      return result
    })
  })

  ipcMain.handle('cli:cancel-ingest', (_event, root: string) =>
    wrapHandler(async () => {
      const manager = ingestProcessManager
      if (!manager) return false
      return manager.cancel(root)
    })
  )

  // Ingest preview
  ipcMain.handle('cli:ingest-preview', (_event, root: string, options?: { reindex?: boolean }) =>
    wrapHandler(() =>
      execCommand<IngestPreview>(
        'ingest',
        options?.reindex ? ['--preview', '--reindex'] : ['--preview'],
        root
      )
    )
  )

  ipcMain.handle('activity-log:open-today', (_event, collectionId: string) =>
    wrapHandler(async () => {
      if (!activityLogStore) throw new Error('Activity log is not initialized')
      return activityLogStore.openToday(collectionId)
    })
  )

  ipcMain.handle('activity-log:read', (_event, collectionId: string, date: string) =>
    wrapHandler(async () => {
      if (!activityLogStore) throw new Error('Activity log is not initialized')
      return activityLogStore.read(collectionId, date)
    })
  )

  // File tree
  ipcMain.handle('cli:tree', (_event, root: string, path?: string) => {
    const args: string[] = []
    if (path) args.push('--path', path)
    return wrapHandler(() => execCommand<FileTree>('tree', args, root))
  })

  // Get document. `populate` (phase 42) resolves frontmatter relations +
  // referenced_by inline — only pass it when the CLI supports phase 31.
  ipcMain.handle(
    'cli:get',
    (_event, root: string, filePath: string, options?: { populate?: boolean }) => {
      const args = [filePath]
      if (options?.populate) args.push('--populate')
      return wrapHandler(() => execCommand<DocumentInfo>('get', args, root))
    }
  )

  // Links
  ipcMain.handle('cli:links', (_event, root: string, filePath: string) =>
    wrapHandler(() => execCommand<LinksOutput>('links', [filePath], root))
  )

  // Backlinks
  ipcMain.handle('cli:backlinks', (_event, root: string, filePath: string) =>
    wrapHandler(() => execCommand<BacklinksOutput>('backlinks', [filePath], root))
  )

  // Neighborhood (multi-hop link tree)
  ipcMain.handle('cli:neighborhood', (_event, root: string, filePath: string, depth: number) => {
    const d = Math.min(3, Math.max(1, depth))
    return wrapHandler(() =>
      execCommand<NeighborhoodResult>('links', [filePath, '--depth', String(d)], root)
    )
  })

  // Orphans
  ipcMain.handle('cli:orphans', (_event, root: string) =>
    wrapHandler(() => execCommand<OrphansOutput>('orphans', [], root))
  )

  // Clusters. An optional Shard selects its project-local analysis scope;
  // omitting it preserves the collection-wide CLI contract byte-for-byte.
  ipcMain.handle('cli:clusters', (_event, root: string, shardId?: string) =>
    wrapHandler(() =>
      execCommand<ClusterSummary[]>('clusters', shardId ? ['--shard', shardId] : [], root)
    )
  )

  // Custom clusters / topics (computed assignments from index)
  ipcMain.handle('cli:custom-clusters', (_event, root: string, shardId?: string) =>
    wrapHandler(() =>
      execCommand<CustomClusterSummary[]>(
        'clusters',
        shardId ? ['--shard', shardId, '--custom'] : ['--custom'],
        root
      )
    )
  )

  // Topic definitions (from config, no index needed).
  // NOTE: execCommand already injects --json — do not add it again.
  ipcMain.handle('cli:clusters-list', (_event, root: string, shardId?: string) =>
    wrapHandler(() =>
      execCommand<TopicDef[]>('clusters', shardId ? ['--shard', shardId, 'list'] : ['list'], root)
    )
  )

  // Add a topic definition (writes .markdownvdb/config.yaml via the CLI;
  // with --json the CLI prints only to stderr, so stdout stays empty)
  ipcMain.handle('cli:clusters-add', (_event, root: string, def: TopicDef, shardId?: string) => {
    const args = shardId ? ['--shard', shardId, 'add', def.name] : ['add', def.name]
    if (def.seeds.length > 0) args.push('--seeds', def.seeds.join(','))
    if (def.description) args.push('--description', def.description)
    if (def.threshold != null) args.push('--threshold', String(def.threshold))
    return wrapHandler(() => execCommand<void>('clusters', args, root))
  })

  // Update a topic definition. Always sends --description and --threshold so
  // clearing works: --description "" clears it, and a negative threshold
  // (equals-form, clap rejects a bare `-1` value) clears the threshold.
  ipcMain.handle(
    'cli:clusters-update',
    (_event, root: string, name: string, def: TopicDef, shardId?: string) => {
      const args = shardId ? ['--shard', shardId, 'update', name] : ['update', name]
      if (def.seeds.length > 0) args.push('--seeds', def.seeds.join(','))
      args.push('--description', def.description ?? '')
      if (def.threshold != null) args.push('--threshold', String(def.threshold))
      else args.push('--threshold=-1')
      if (def.name && def.name !== name) args.push('--rename', def.name)
      return wrapHandler(() => execCommand<void>('clusters', args, root))
    }
  )

  // Remove a topic definition
  ipcMain.handle('cli:clusters-remove', (_event, root: string, name: string, shardId?: string) =>
    wrapHandler(() =>
      execCommand<void>(
        'clusters',
        shardId ? ['--shard', shardId, 'remove', name] : ['remove', name],
        root
      )
    )
  )

  // Documents matching no topic (the Unassigned bucket)
  ipcMain.handle('cli:clusters-unassigned', (_event, root: string, shardId?: string) =>
    wrapHandler(() =>
      execCommand<TopicUnassigned>(
        'clusters',
        shardId ? ['--shard', shardId, 'unassigned'] : ['unassigned'],
        root
      )
    )
  )

  // Generic YAML config write: `mdvdb config set <dotted.key> <value>`
  ipcMain.handle('cli:config-set', (_event, root: string, key: string, value: string) =>
    wrapHandler(() => execCommand<void>('config', ['set', key, value], root))
  )

  ipcMain.handle('cli:embedding-models', (_event, root: string, provider?: string) =>
    wrapHandler(() =>
      execCommand<EmbeddingModelsResponse>(
        'embedding',
        provider ? ['models', '--provider', provider] : ['models'],
        root
      )
    )
  )

  ipcMain.handle('cli:embedding-probe', (_event, root: string) =>
    wrapHandler(() =>
      execCommand<EmbeddingProbe>('embedding', ['probe'], root, { timeout: 120_000 })
    )
  )

  // Graph data
  ipcMain.handle(
    'cli:graph',
    (_event, root: string, level?: GraphLevel, path?: string, shardId?: string) =>
      wrapHandler(() => getGraphSnapshot(root, level, path, shardId))
  )

  // Schema
  ipcMain.handle('cli:schema', (_event, root: string, path?: string) => {
    const args: string[] = []
    if (path) args.push('--path', path)
    return wrapHandler(async () => {
      const result = await execCommand<Schema | ScopedSchema>('schema', args, root)
      return 'schema' in result ? result.schema : result
    })
  })

  // Collection (folder-as-table). NOTE the corrected arg grammar:
  // `--sort` and `--order` are SEPARATE flags, and `--filter` is REPEATABLE
  // (one KEY=VALUE per occurrence). The folder path is positional; '.' = root.
  ipcMain.handle(
    'cli:collection',
    (
      _event,
      root: string,
      folderPath: string,
      options?: {
        recursive?: boolean
        sort?: string
        order?: 'asc' | 'desc'
        filter?: string[]
        limit?: number
        offset?: number
        populate?: boolean
      }
    ) => {
      const args: string[] = [folderPath || '.']
      if (options?.recursive) args.push('--recursive')
      if (options?.sort) args.push('--sort', options.sort)
      if (options?.order) args.push('--order', options.order)
      for (const f of options?.filter ?? []) args.push('--filter', f)
      if (options?.limit != null) args.push('--limit', String(options.limit))
      if (options?.offset != null) args.push('--offset', String(options.offset))
      if (options?.populate) args.push('--populate')
      return wrapHandler(() => execCommand<CollectionOutput>('collection', args, root))
    }
  )

  // Config
  ipcMain.handle('cli:config', (_event, root: string) =>
    wrapHandler(() => execCommand<Config>('config', [], root))
  )

  // Doctor
  ipcMain.handle('cli:doctor', (_event, root: string) =>
    wrapHandler(() => execCommand<DoctorResult>('doctor', [], root))
  )

  // Vault/folder information
  ipcMain.handle('cli:info', (_event, root: string, path?: string) =>
    wrapHandler(() => getCollectionInfo(root, path))
  )

  // Init
  ipcMain.handle('cli:init', (_event, root: string) => wrapHandler(() => execRaw('init', [], root)))

  // Reset index (delete .markdownvdb/index and .markdownvdb/fts/ to recover from corruption)
  ipcMain.handle('cli:reset-index', (_event, root: string) =>
    wrapHandler(async () => {
      const path = await import('node:path')
      const indexFile = path.join(root, '.markdownvdb', 'index')
      const ftsDir = path.join(root, '.markdownvdb', 'fts')
      await fs.rm(indexFile, { force: true })
      await fs.rm(ftsDir, { recursive: true, force: true })
    })
  )

  // Native dialogs for simple message + action prompts. Complex workflows stay
  // in renderer modals where richer content and interaction are required.
  ipcMain.handle('dialog:confirm', (event, options: NativeConfirmationOptions) =>
    wrapHandler(async () => {
      const title = options.title || 'Please confirm'
      const message = options.message || ''
      const messageBoxOptions = {
        type: options.tone === 'danger' ? ('warning' as const) : ('question' as const),
        title,
        message: title,
        detail: message,
        buttons: [options.cancelLabel || 'Cancel', options.confirmLabel || 'Continue'],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      }
      const parent = BrowserWindow.fromWebContents(event.sender)
      const result = parent
        ? await dialog.showMessageBox(parent, messageBoxOptions)
        : await dialog.showMessageBox(messageBoxOptions)
      return result.response === 1
    })
  )

  ipcMain.handle('dialog:message', (event, options: NativeMessageOptions) =>
    wrapHandler(async () => {
      const title = options.title || 'Tesseract'
      const messageBoxOptions = {
        type: options.type ?? ('info' as const),
        title,
        message: title,
        detail: options.message || '',
        buttons: ['OK'],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      }
      const parent = BrowserWindow.fromWebContents(event.sender)
      if (parent) await dialog.showMessageBox(parent, messageBoxOptions)
      else await dialog.showMessageBox(messageBoxOptions)
    })
  )

  // Collection management
  ipcMain.handle('collections:list', () => wrapHandler(async () => getCollections()))

  ipcMain.handle('collections:add', () =>
    wrapHandler(async (): Promise<Collection | null> => {
      const path = await pickCollectionFolder()
      if (!path) return null

      const validation = await validateCollectionPath(path)
      if (!validation.valid) {
        throw new Error(validation.error ?? 'Invalid collection path')
      }

      if (!validation.hasConfig) {
        const shouldInit = await promptInitCollection(validation.name)
        if (!shouldInit) return null
        await initCollection(path)
      }

      const collection = addCollection(path)
      if (process.env.NODE_ENV !== 'test') {
        void configureShardManifestWatcher(getCollections(), windowManager)
      }
      refreshAppMenu()
      // Obsidian vaults: derive topics from the user's tags/graph groups
      // (phase 44). Fire-and-forget — never blocks adding the collection.
      void maybeSyncObsidianTopics(collection, windowManager)
      return collection
    })
  )

  ipcMain.handle('collections:create-example', () =>
    wrapHandler(async (): Promise<Collection> => {
      // Real users get a visible Documents folder. Automation stays inside its
      // disposable profile and must never write to a developer's Documents.
      const baseDirectory =
        process.env['TESSERACT_E2E'] === '1' ? app.getPath('userData') : app.getPath('documents')
      const path = await createExampleCollection(baseDirectory)
      const existing = getCollections().find((collection) => collection.path === path)
      const collection = existing ?? addCollection(path)
      if (process.env.NODE_ENV !== 'test') {
        void configureShardManifestWatcher(getCollections(), windowManager)
      }
      refreshAppMenu()
      return collection
    })
  )

  ipcMain.handle('collections:remove', (_event, id: string) =>
    wrapHandler(async () => {
      const collections = getCollections()
      const collection = collections.find((c) => c.id === id)
      if (!collection) {
        throw new Error(`Collection not found: ${id}`)
      }

      const confirmed = await confirmRemoveCollection(collection.name)
      if (!confirmed) return

      removeCollection(id)
      setActiveShardId(id, null)
      if (process.env.NODE_ENV !== 'test') {
        void configureShardManifestWatcher(getCollections(), windowManager)
      }

      // Stop the vault watcher if it was watching the removed collection
      if (getVaultWatcher().getStatus().root === collection.path) {
        await getVaultWatcher().stop()
      }

      // Clean up stale favorites and recents for this collection
      const s = await import('./store').then((m) => m.initStore())

      const favorites = s.get('favorites', [])
      s.set(
        'favorites',
        favorites.filter((f) => f.collectionId !== id)
      )

      const recents = s.get('recentFiles', [])
      s.set(
        'recentFiles',
        recents.filter((r) => r.collectionId !== id)
      )
      refreshAppMenu()

      // Clean up saved table views for this collection
      await import('./table-views').then((m) => m.cleanupCollectionTableViews(id))

      // Clean up accent color override for this collection
      const colors = s.get('collectionColors', {})
      if (id in colors) {
        delete colors[id]
        s.set('collectionColors', colors)
      }

      // Clean up theme override for this collection
      const themes = s.get('collectionThemes', {})
      if (id in themes) {
        delete themes[id]
        s.set('collectionThemes', themes)
      }

      // Clean up the Obsidian topic sync state for this collection
      const obsidianSync = s.get('obsidianTopicSync', {})
      if (id in obsidianSync) {
        delete obsidianSync[id]
        s.set('obsidianTopicSync', obsidianSync)
      }

      // Clean up a permanent skills-banner dismissal for this collection.
      const skillsDismissed = s.get('collectionSkillsDismissed', {})
      if (id in skillsDismissed) {
        delete skillsDismissed[id]
        s.set('collectionSkillsDismissed', skillsDismissed)
      }
    })
  )

  ipcMain.handle('collections:set-active', (event, id: string) =>
    wrapHandler(async () => {
      setActiveCollection(id)
      windowManager.setWindowCollectionId(event.sender.id, id)

      const active = getActiveCollection()

      // The mdvdb watcher stays manual, but never leave it running against a
      // stale root after a collection switch.
      const watcher = watcherManager
      if (watcher?.isRunning() && active && watcher.getRoot() !== active.path) {
        await watcher.stop()
      }

      // Retarget the Tier-1 vault watcher (own-writes are root-scoped too).
      clearOwnWrites()
      if (active) {
        await getVaultWatcher().start(active.path)
      } else {
        await getVaultWatcher().stop()
      }

      // Collection menu reflects the active collection (radio, watcher checkbox)
      refreshAppMenu()

      // Obsidian topic sync (phase 44): sync now, retarget the .obsidian
      // config watcher, and drop pending debounced syncs for the old root.
      cancelScheduledObsidianSyncs()
      watchObsidianConfig(active ?? null, windowManager)
      if (active) {
        void maybeSyncObsidianTopics(active, windowManager)
      }
    })
  )

  ipcMain.handle('collections:get-active', () => wrapHandler(async () => getActiveCollection()))

  ipcMain.handle('skills:check-collection', (_event, collectionId: string) =>
    wrapHandler(async () => {
      const collection = getCollections().find((candidate) => candidate.id === collectionId)
      if (!collection) throw new Error(`Collection not found: ${collectionId}`)
      const { checkCollectionSkills } = await import('./collection-skills')
      const status = await checkCollectionSkills(collection.path)
      return {
        ...status,
        dismissedForever: getCollectionSkillsDismissed(collectionId)
      }
    })
  )

  ipcMain.handle(
    'skills:install-collection',
    (_event, collectionId: string, targetId: CollectionSkillsTargetId) =>
      wrapHandler(async () => {
        const collection = getCollections().find((candidate) => candidate.id === collectionId)
        if (!collection) throw new Error(`Collection not found: ${collectionId}`)
        const { installCollectionSkills } = await import('./collection-skills')
        const status = await installCollectionSkills(collection.path, targetId)
        return {
          ...status,
          dismissedForever: getCollectionSkillsDismissed(collectionId)
        }
      })
  )

  ipcMain.handle(
    'skills:set-collection-dismissed',
    (_event, collectionId: string, dismissed: boolean) =>
      wrapHandler(async () => {
        if (!getCollections().some((candidate) => candidate.id === collectionId)) {
          throw new Error(`Collection not found: ${collectionId}`)
        }
        setCollectionSkillsDismissed(collectionId, dismissed)
      })
  )

  // Favorites management
  ipcMain.handle('favorites:list', () =>
    wrapHandler(async (): Promise<FavoriteEntry[]> => {
      const s = await import('./store').then((m) => m.initStore())
      return s.get('favorites', [])
    })
  )

  ipcMain.handle('favorites:add', (_event, collectionId: string, filePath: string) =>
    wrapHandler(async () => {
      const s = await import('./store').then((m) => m.initStore())
      const favorites = s.get('favorites', [])
      const exists = favorites.some(
        (f) => f.collectionId === collectionId && f.filePath === filePath
      )
      if (!exists) {
        favorites.push({ collectionId, filePath, addedAt: Date.now() })
        s.set('favorites', favorites)
      }
    })
  )

  ipcMain.handle('favorites:remove', (_event, collectionId: string, filePath: string) =>
    wrapHandler(async () => {
      const s = await import('./store').then((m) => m.initStore())
      const favorites = s.get('favorites', [])
      s.set(
        'favorites',
        favorites.filter((f) => !(f.collectionId === collectionId && f.filePath === filePath))
      )
    })
  )

  ipcMain.handle('favorites:is-favorite', (_event, collectionId: string, filePath: string) =>
    wrapHandler(async (): Promise<boolean> => {
      const s = await import('./store').then((m) => m.initStore())
      const favorites = s.get('favorites', [])
      return favorites.some((f) => f.collectionId === collectionId && f.filePath === filePath)
    })
  )

  // Recents management
  ipcMain.handle('recents:list', () =>
    wrapHandler(async () => {
      const s = await import('./store').then((m) => m.initStore())
      return s.get('recentFiles', [])
    })
  )

  ipcMain.handle('recents:add', (_event, collectionId: string, filePath: string) =>
    wrapHandler(async () => {
      const s = await import('./store').then((m) => m.initStore())
      let recents = s.get('recentFiles', [])
      // Remove existing entry for same file (dedup)
      recents = recents.filter((r) => !(r.collectionId === collectionId && r.filePath === filePath))
      // Add to front (most recent first)
      recents.unshift({ collectionId, filePath, openedAt: Date.now() })
      // Cap at 50 entries
      recents = recents.slice(0, 50)
      s.set('recentFiles', recents)
      refreshAppMenu()
    })
  )

  ipcMain.handle('recents:clear', () =>
    wrapHandler(async () => {
      const s = await import('./store').then((m) => m.initStore())
      s.set('recentFiles', [])
      refreshAppMenu()
    })
  )

  // Saved table views (per collection + folder)
  ipcMain.handle('tableviews:list', (_event, collectionId: string, folderPath: string) =>
    wrapHandler(async () => {
      const m = await import('./table-views')
      return m.listTableViews(collectionId, folderPath)
    })
  )

  ipcMain.handle(
    'tableviews:get-default-columns',
    (_event, collectionId: string, folderPath: string) =>
      wrapHandler(async () => {
        const m = await import('./table-views')
        return m.getDefaultTableColumns(collectionId, folderPath)
      })
  )

  ipcMain.handle(
    'tableviews:save-default-columns',
    (_event, collectionId: string, folderPath: string, columns: TableColumnLayout[]) =>
      wrapHandler(async () => {
        const m = await import('./table-views')
        return m.saveDefaultTableColumns(collectionId, folderPath, columns)
      })
  )

  ipcMain.handle(
    'tableviews:save',
    (_event, collectionId: string, folderPath: string, view: SavedTableView) =>
      wrapHandler(async () => {
        const m = await import('./table-views')
        return m.saveTableView(collectionId, folderPath, view)
      })
  )

  ipcMain.handle(
    'tableviews:update',
    (_event, collectionId: string, folderPath: string, view: SavedTableView) =>
      wrapHandler(async () => {
        const m = await import('./table-views')
        return m.updateTableView(collectionId, folderPath, view)
      })
  )

  ipcMain.handle(
    'tableviews:delete',
    (_event, collectionId: string, folderPath: string, viewId: string) =>
      wrapHandler(async () => {
        const m = await import('./table-views')
        return m.deleteTableView(collectionId, folderPath, viewId)
      })
  )

  ipcMain.handle(
    'tableviews:set-default',
    (_event, collectionId: string, folderPath: string, viewId: string) =>
      wrapHandler(async () => {
        const m = await import('./table-views')
        return m.setDefaultTableView(collectionId, folderPath, viewId)
      })
  )

  // Reveal file in OS file manager (Finder on macOS, Explorer on Windows)
  ipcMain.handle('shell:show-item-in-folder', (_event, absolutePath: string) =>
    wrapHandler(async () => {
      const { resolve, sep } = await import('node:path')
      const normalizedPath = resolve(absolutePath)
      const collections = getCollections()
      const isWithinCollection = collections.some(
        (c) => normalizedPath === c.path || normalizedPath.startsWith(c.path + sep)
      )
      if (!isWithinCollection) {
        throw new Error('Access denied: path is not within a known collection')
      }
      shell.showItemInFolder(normalizedPath)
    })
  )

  // Ingest a single file
  ipcMain.handle(
    'cli:ingest-file',
    (_event, root: string, filePath: string, options?: { reindex?: boolean }) => {
      const args: string[] = ['--file', filePath]
      if (options?.reindex) args.push('--reindex')
      return wrapHandler(() =>
        withWatcherPaused(root, () =>
          execCommand<IngestResult>('ingest', args, root, { timeout: INGEST_TIMEOUT_MS })
        )
      )
    }
  )

  // File reading (with security validation)
  ipcMain.handle('standalone:get-document', (event) =>
    wrapHandler(async () => {
      const grantedPath = windowManager.getStandaloneFilePath(event.sender.id)
      if (!grantedPath) throw new Error('Access denied: no standalone document is granted')

      const metadata = await fs.lstat(grantedPath)
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.nlink > 1) {
        throw new Error('The standalone document is no longer a safe regular file')
      }

      return {
        path: grantedPath,
        name: basename(grantedPath),
        directory: dirname(grantedPath),
        content: await fs.readFile(grantedPath, 'utf-8')
      }
    })
  )

  ipcMain.handle('standalone:save-document', (event, expectedContent: string, content: string) =>
    wrapHandler(async () => {
      if (typeof expectedContent !== 'string' || typeof content !== 'string') {
        throw new TypeError('Standalone document content must be text')
      }
      const grantedPath = windowManager.getStandaloneFilePath(event.sender.id)
      if (!grantedPath) throw new Error('Access denied: no standalone document is granted')

      await withSerializedFileWrite(grantedPath, async () => {
        const currentContent = await fs.readFile(grantedPath, 'utf-8')
        if (currentContent !== expectedContent) {
          throw new Error('The file changed on disk after this editor opened it')
        }

        await atomicWriteFile(grantedPath, content, {
          allowedRoot: dirname(grantedPath),
          beforeCommit: async () => {
            const latestContent = await fs.readFile(grantedPath, 'utf-8')
            if (latestContent !== expectedContent) {
              throw new Error('The file changed on disk after this editor opened it')
            }
          }
        })
      })
    })
  )

  ipcMain.handle('standalone:reveal-document', (event) =>
    wrapHandler(async () => {
      const grantedPath = windowManager.getStandaloneFilePath(event.sender.id)
      if (!grantedPath) throw new Error('Access denied: no standalone document is granted')
      shell.showItemInFolder(grantedPath)
    })
  )

  // External OS drag capabilities. Only the initial open/import bridge accepts
  // native paths; every follow-up is scoped to an opaque sender-owned grant.
  ipcMain.handle('external:open-dropped-file', (event, candidate: string) =>
    wrapHandler(async (): Promise<ExternalDroppedFileDescriptor> => {
      const file = await safeRegularFile(candidate)
      const name = basename(file.path)
      const classification = classifyExternalFile(name)
      const membership = await collectionMembership(file.path)
      const content =
        classification.kind === 'markdown' ? await fs.readFile(file.path, 'utf-8') : undefined
      const id = windowManager.grantExternalFile(event.sender.id, file.path)

      return {
        id,
        path: file.path,
        name,
        directory: dirname(file.path),
        size: file.metadata.size,
        ...classification,
        ...(content === undefined ? {} : { content }),
        ...membership
      }
    })
  )

  ipcMain.handle('external:read-document', (event, grantId: string) =>
    wrapHandler(async () => {
      const grantedPath = requireExternalGrant(windowManager, event.sender.id, grantId)
      const file = await safeRegularFile(grantedPath)
      if (classifyExternalFile(file.path).kind !== 'markdown') {
        throw new Error('The external file is not a Markdown document')
      }
      return fs.readFile(file.path, 'utf-8')
    })
  )

  ipcMain.handle(
    'external:save-document',
    (event, grantId: string, expectedContent: string, content: string) =>
      wrapHandler(async () => {
        if (typeof expectedContent !== 'string' || typeof content !== 'string') {
          throw new TypeError('External document content must be text')
        }
        const grantedPath = requireExternalGrant(windowManager, event.sender.id, grantId)
        const file = await safeRegularFile(grantedPath)
        if (classifyExternalFile(file.path).kind !== 'markdown') {
          throw new Error('The external file is not a Markdown document')
        }

        await withSerializedFileWrite(file.path, async () => {
          const currentContent = await fs.readFile(file.path, 'utf-8')
          if (currentContent !== expectedContent) {
            throw new Error('The file changed on disk after this editor opened it')
          }

          await atomicWriteFile(file.path, content, {
            allowedRoot: dirname(file.path),
            beforeCommit: async () => {
              const latestContent = await fs.readFile(file.path, 'utf-8')
              if (latestContent !== expectedContent) {
                throw new Error('The file changed on disk after this editor opened it')
              }
            }
          })
        })
      })
  )

  ipcMain.handle('external:reveal-file', (event, grantId: string) =>
    wrapHandler(async () => {
      const grantedPath = requireExternalGrant(windowManager, event.sender.id, grantId)
      const file = await safeRegularFile(grantedPath)
      shell.showItemInFolder(file.path)
    })
  )

  ipcMain.handle('external:open-file', (event, grantId: string) =>
    wrapHandler(async () => {
      const grantedPath = requireExternalGrant(windowManager, event.sender.id, grantId)
      const file = await safeRegularFile(grantedPath)
      const error = await shell.openPath(file.path)
      if (error) throw new Error(error)
    })
  )

  ipcMain.handle('external:release-file', (event, grantId: string) =>
    wrapHandler(async () => {
      if (typeof grantId !== 'string' || grantId === '') {
        throw new TypeError('External file grant ID is required')
      }
      windowManager.releaseExternalFile(event.sender.id, grantId)
    })
  )

  ipcMain.handle(
    'external:import-dropped-files',
    (_event, candidates: string[], collectionId: string, targetDirectory: string) =>
      wrapHandler(async (): Promise<ImportedDroppedFile[]> => {
        if (!Array.isArray(candidates)) throw new TypeError('Dropped files must be an array')
        if (candidates.length > 100) throw new Error('Cannot import more than 100 files at once')

        const target = await safeImportDirectory(collectionId, targetDirectory)
        const imported: ImportedDroppedFile[] = []
        for (const candidate of candidates) {
          const source = await safeRegularFile(candidate)
          imported.push(await copyDroppedFileExclusively(source, target))
        }
        return imported
      })
  )

  // Collection-scoped file reading (with security validation)
  ipcMain.handle('fs:read-file', (_event, absolutePath: string) =>
    wrapHandler(async () => {
      const { resolve, sep } = await import('node:path')
      const normalizedPath = resolve(absolutePath)
      const collections = getCollections()
      const isWithinCollection = collections.some(
        (c) => normalizedPath === c.path || normalizedPath.startsWith(c.path + sep)
      )
      if (!isWithinCollection) {
        throw new Error('Access denied: path is not within a known collection')
      }
      return fs.readFile(normalizedPath, 'utf-8')
    })
  )

  // File writing (with security validation)
  ipcMain.handle('fs:write-file', (event, absolutePath: string, content: string) =>
    wrapHandler(async () => {
      const { resolve, sep } = await import('node:path')
      const normalizedPath = resolve(absolutePath)
      const collections = getCollections()
      const collection = collections.find(
        (c) => normalizedPath === c.path || normalizedPath.startsWith(c.path + sep)
      )
      if (!collection) {
        throw new Error('Access denied: path is not within a known collection')
      }
      await withSerializedFileWrite(normalizedPath, async () => {
        let cancelOwnWrite: (() => void) | null = null
        let published = false
        try {
          await atomicWriteFile(normalizedPath, content, {
            allowedRoot: collection.path,
            beforeCommit: () => {
              cancelOwnWrite = registerOwnWrite(normalizedPath, 'write', content)
            },
            onPublished: () => {
              published = true
            }
          })
        } catch (error) {
          if (!published) cancelOwnWrite?.()
          throw error
        }

        // Notify all OTHER windows that this file was saved, so they can
        // silently reload it instead of showing a conflict prompt.
        const senderId = event.sender.id
        for (const win of windowManager.getAllWindows()) {
          if (win.webContents.id !== senderId && !win.isDestroyed()) {
            win.webContents.send('file:saved-externally', { path: normalizedPath, content })
          }
        }
      })
    })
  )

  // Exact-baseline write used while flushing editors for a computed-schema
  // transaction. The comparison and atomic replacement share one per-path
  // main-process queue, closing the cross-window read-then-write race.
  ipcMain.handle(
    'fs:write-file-if-unchanged',
    (event, absolutePath: string, expectedContent: string, content: string) =>
      wrapHandler(async () => {
        const { resolve, sep } = await import('node:path')
        const normalizedPath = resolve(absolutePath)
        const collections = getCollections()
        const collection = collections.find(
          (c) => normalizedPath === c.path || normalizedPath.startsWith(c.path + sep)
        )
        if (!collection) {
          throw new Error('Access denied: path is not within a known collection')
        }

        await withSerializedFileWrite(normalizedPath, async () => {
          const currentContent = await fs.readFile(normalizedPath, 'utf-8')
          if (currentContent !== expectedContent) {
            throw new Error('The file changed on disk after this editor opened it')
          }

          let cancelOwnWrite: (() => void) | null = null
          let published = false
          try {
            await atomicWriteFile(normalizedPath, content, {
              allowedRoot: collection.path,
              beforeCommit: async () => {
                const latestContent = await fs.readFile(normalizedPath, 'utf-8')
                if (latestContent !== expectedContent) {
                  throw new Error('The file changed on disk after this editor opened it')
                }
                cancelOwnWrite = registerOwnWrite(normalizedPath, 'write', content)
              },
              onPublished: () => {
                published = true
              }
            })
          } catch (error) {
            if (!published) cancelOwnWrite?.()
            throw error
          }

          const senderId = event.sender.id
          for (const win of windowManager.getAllWindows()) {
            if (win.webContents.id !== senderId && !win.isDestroyed()) {
              win.webContents.send('file:saved-externally', { path: normalizedPath, content })
            }
          }
        })
      })
  )

  // Safe single-key frontmatter edit (phase-39b). The renderer passes
  // (collectionId, relativePath, patch); the absolute path + collection boundary
  // are resolved/enforced in main. Returns the updated frontmatter object.
  ipcMain.handle(
    'fs:update-frontmatter',
    (event, collectionId: string, relativePath: string, patch: FrontmatterPatch) =>
      wrapHandler(async () => {
        const m = await import('./frontmatter')
        return m.updateFrontmatter(event, windowManager, collectionId, relativePath, patch)
      })
  )

  // Property type conversion / rename across a folder database (phase 41).
  // Preview computes the per-file plan (no writes); apply runs the batch with
  // the watcher paused and streams `schema:property-op-progress` events.
  ipcMain.handle('schema:preview-property-op', (_event, req: PropertyOpRequest) =>
    wrapHandler(async () => {
      const m = await import('./property-ops')
      return m.previewPropertyOp(req)
    })
  )

  ipcMain.handle('schema:apply-property-op', (event, opId: string, req: PropertyOpRequest) =>
    wrapHandler(async () => {
      const m = await import('./property-ops')
      return m.applyPropertyOp(event, windowManager, opId, req)
    })
  )

  // Schema-overlay annotation edits (description/required/allowed values) —
  // writes only `.markdownvdb.schema.yml`, never markdown files.
  ipcMain.handle(
    'schema:update-overlay-field',
    (_event, collectionId: string, scope: string | null, key: string, patch: OverlayFieldPatch) =>
      wrapHandler(async () => {
        const m = await import('./property-ops')
        return m.updateOverlayField(collectionId, scope, key, patch)
      })
  )

  // Formula definition lifecycle: validate before touching disk, then keep the
  // watcher stopped across the comment-preserving overlay write and Markdown
  // materialization so tables never observe a half-applied definition.
  ipcMain.handle(
    'schema:save-formula',
    (
      _event,
      collectionId: string,
      scope: string | null,
      key: string,
      formula: string,
      resultType: FormulaResultType
    ) =>
      wrapHandler(async () => {
        const collection = getCollections().find((item) => item.id === collectionId)
        if (!collection) throw new Error(`Collection not found: ${collectionId}`)
        const field = key.trim()
        if (!field) throw new Error('Formula field name is required')
        if (field !== key) throw new Error('Formula field names cannot start or end with spaces')
        if (field === 'title' || field === 'path') {
          throw new Error(`"${field}" is reserved and cannot be a formula field`)
        }
        if (!formula.trim()) throw new Error('Formula expression is required')

        const validation = await execCommand<FormulaValidationResult>(
          'modules',
          ['validate', 'formula', '--formula', formula, '--result-type', resultType.toLowerCase()],
          collection.path
        )
        if (!validation.valid) {
          throw new Error(
            validation.diagnostics.map((diagnostic) => diagnostic.message).join('\n') ||
              'Formula is not valid'
          )
        }

        const scopeKey = scope && scope !== '.' ? scope.replace(/\/+$/, '') : null
        await flushDirtyDocumentsAcrossWindows(windowManager, collection.id, collection.path)
        return withWatcherPaused(collection.path, async () => {
          const { captureOverlaySnapshot, resolveOverlayFormulaScope, upsertOverlayField } =
            await import('./schema-overlay')
          let snapshot: import('./schema-overlay').OverlaySnapshot | null = null
          let mutatedSnapshot: import('./schema-overlay').OverlaySnapshot | null = null
          try {
            const transaction = await execModuleTransaction(
              collection.path,
              'formula',
              null,
              async () => {
                const existingScope = await resolveOverlayFormulaScope(
                  collection.path,
                  scopeKey,
                  field
                )
                const targetScope = existingScope === undefined ? scopeKey : existingScope
                await verifyCleanDocumentsAcrossWindows(
                  windowManager,
                  collection.id,
                  collection.path
                )
                snapshot = await captureOverlaySnapshot(collection.path)
                await upsertOverlayField(
                  collection.path,
                  targetScope,
                  field,
                  {
                    fieldType: 'formula',
                    formula,
                    resultType
                  },
                  {
                    onPublished: (published) => {
                      mutatedSnapshot = published
                    }
                  }
                )
                mutatedSnapshot = await captureOverlaySnapshot(collection.path)
              }
            )
            const outcome = normalizeModuleRunResponse(
              transaction.response as ModuleRunResponse,
              'formula'
            )
            broadcastModuleReports(windowManager, outcome.reports)
            broadcastComputedSchemaApplied(windowManager, collection.path)
            return outcome.primary
          } catch (error) {
            if (snapshot && mutatedSnapshot) {
              return restoreComputedOverlay(
                windowManager,
                collection.path,
                snapshot,
                mutatedSnapshot,
                'formula',
                error
              )
            }
            throw error
          }
        })
      })
  )

  ipcMain.handle(
    'schema:remove-formula',
    (_event, collectionId: string, scope: string | null, key: string) =>
      wrapHandler(async () => {
        const collection = getCollections().find((item) => item.id === collectionId)
        if (!collection) throw new Error(`Collection not found: ${collectionId}`)
        const scopeKey = scope && scope !== '.' ? scope.replace(/\/+$/, '') : null
        await flushDirtyDocumentsAcrossWindows(windowManager, collection.id, collection.path)
        return withWatcherPaused(collection.path, async () => {
          const { captureOverlaySnapshot, removeOverlayField, resolveOverlayFormulaScope } =
            await import('./schema-overlay')
          let snapshot: import('./schema-overlay').OverlaySnapshot | null = null
          let mutatedSnapshot: import('./schema-overlay').OverlaySnapshot | null = null
          try {
            const transaction = await execModuleTransaction(
              collection.path,
              'formula',
              null,
              async () => {
                const origin = await resolveOverlayFormulaScope(collection.path, scopeKey, key)
                if (origin === undefined) {
                  throw new Error(`Formula "${key}" is not defined for this collection`)
                }
                await verifyCleanDocumentsAcrossWindows(
                  windowManager,
                  collection.id,
                  collection.path
                )
                snapshot = await captureOverlaySnapshot(collection.path)
                const removed = await removeOverlayField(collection.path, origin, key, {
                  onPublished: (published) => {
                    mutatedSnapshot = published
                  }
                })
                if (!removed) throw new Error(`Formula "${key}" could not be removed`)
                mutatedSnapshot = await captureOverlaySnapshot(collection.path)
              }
            )
            const outcome = normalizeModuleRunResponse(
              transaction.response as ModuleRunResponse,
              'formula'
            )
            broadcastModuleReports(windowManager, outcome.reports)
            broadcastComputedSchemaApplied(windowManager, collection.path)
            return outcome.primary
          } catch (error) {
            if (snapshot && mutatedSnapshot) {
              return restoreComputedOverlay(
                windowManager,
                collection.path,
                snapshot,
                mutatedSnapshot,
                'formula',
                error
              )
            }
            throw error
          }
        })
      })
  )

  ipcMain.handle(
    'schema:save-lookup-rollup',
    (
      _event,
      collectionId: string,
      scope: string | null,
      key: string,
      definition: LookupRollupDefinition,
      previousKey?: string
    ) =>
      wrapHandler(async () => {
        const collection = getCollections().find((item) => item.id === collectionId)
        if (!collection) throw new Error(`Collection not found: ${collectionId}`)
        const field = validatedComputedFieldName(key)
        const previousField =
          previousKey === undefined
            ? undefined
            : validatedComputedFieldName(previousKey, 'Previous computed field name')
        if (!definition || (definition.kind !== 'lookup' && definition.kind !== 'rollup')) {
          throw new Error('A Lookup or Rollup definition is required')
        }
        for (const [label, value] of [
          ['Relation field', definition.relationField],
          ['Target field', definition.targetField]
        ] as const) {
          if (!value?.trim() || value !== value.trim()) {
            throw new Error(`${label} must be non-empty and have no surrounding spaces`)
          }
        }
        if (definition.kind === 'lookup' && definition.relationDirection !== 'outgoing') {
          throw new Error('Lookup fields support outgoing relations only')
        }
        if (definition.kind === 'rollup') {
          if (!definition.formula.trim()) throw new Error('Rollup formula is required')
          if (definition.relationDirection === 'incoming') {
            const relationScope = definition.relationScope
            if (
              !relationScope?.trim() ||
              relationScope !== relationScope.trim() ||
              relationScope.endsWith('/')
            ) {
              throw new Error('Incoming Rollup relation scope is required without a trailing slash')
            }
          }
          const validation = await execCommand<FormulaValidationResult>(
            'modules',
            [
              'validate',
              'lookup_rollup',
              '--formula',
              definition.formula,
              '--result-type',
              definition.resultType.toLowerCase()
            ],
            collection.path
          )
          if (!validation.valid) {
            throw new Error(
              validation.diagnostics.map((diagnostic) => diagnostic.message).join('\n') ||
                'Rollup formula is not valid'
            )
          }
        }

        const scopeKey = scope && scope !== '.' ? scope.replace(/\/+$/, '') : null
        await flushDirtyDocumentsAcrossWindows(windowManager, collection.id, collection.path)
        return withWatcherPaused(collection.path, async () => {
          const {
            captureOverlaySnapshot,
            resolveOverlayLookupRollupDefinition,
            upsertOverlayField
          } = await import('./schema-overlay')
          let snapshot: import('./schema-overlay').OverlaySnapshot | null = null
          let mutatedSnapshot: import('./schema-overlay').OverlaySnapshot | null = null
          let definitionOrigin: string | null = scopeKey
          try {
            const transaction = await execModuleTransaction(
              collection.path,
              'lookup_rollup',
              null,
              async () => {
                const existingDefinition =
                  previousField === undefined
                    ? undefined
                    : await resolveOverlayLookupRollupDefinition(
                        collection.path,
                        scopeKey,
                        previousField
                      )
                if (previousField !== undefined && existingDefinition === undefined) {
                  throw new Error(
                    `Lookup/Rollup definition "${previousField}" is not defined for this collection`
                  )
                }
                if (
                  previousField !== undefined &&
                  existingDefinition !== undefined &&
                  existingDefinition.kind !== definition.kind
                ) {
                  throw new Error(
                    `Cannot change computed field "${previousField}" from ${existingDefinition.kind} to ${definition.kind}`
                  )
                }
                const targetScope =
                  existingDefinition === undefined ? scopeKey : existingDefinition.scope
                definitionOrigin = targetScope
                // An inherited definition is mutated at its true origin. Its
                // relation topology must therefore be valid at that origin as
                // well; validating against the currently viewed child could
                // otherwise let child-only fields corrupt a parent definition.
                await validateLookupRollupTopology(collection.path, targetScope, definition, {
                  previousKey: previousField,
                  key: field
                })
                await verifyCleanDocumentsAcrossWindows(
                  windowManager,
                  collection.id,
                  collection.path
                )
                const mustClaimAbsentOutput = previousField === undefined || previousField !== field
                if (mustClaimAbsentOutput) {
                  await assertComputedOutputKeyAbsentOnDisk(collection.path, targetScope, field)
                }
                snapshot = await captureOverlaySnapshot(collection.path)
                await upsertOverlayField(
                  collection.path,
                  targetScope,
                  field,
                  {
                    fieldType: definition.kind,
                    relationField: definition.relationField,
                    targetField: definition.targetField,
                    relationDirection:
                      definition.kind === 'rollup' && definition.relationDirection === 'incoming'
                        ? 'incoming'
                        : null,
                    relationScope:
                      definition.kind === 'rollup' && definition.relationDirection === 'incoming'
                        ? definition.relationScope
                        : null,
                    formula: definition.kind === 'rollup' ? definition.formula : null,
                    resultType: definition.kind === 'rollup' ? definition.resultType : null
                  },
                  {
                    previousKey: previousField,
                    requireAbsent: previousField === undefined,
                    onPrepared: (prepared) => {
                      snapshot = prepared
                    },
                    onPublished: (published) => {
                      mutatedSnapshot = published
                    }
                  }
                )
                // Test doubles and older mutation implementations may not
                // expose publication callbacks. The real writer always does;
                // this fallback preserves compatibility without weakening its
                // exact-generation rollback snapshots.
                if (!mutatedSnapshot) {
                  mutatedSnapshot = await captureOverlaySnapshot(collection.path)
                }
                // Close the largest external-editor race window: re-read every
                // current owner after overlay publication but before the
                // transaction process is allowed to evaluate/write outputs.
                if (mustClaimAbsentOutput) {
                  await assertComputedOutputKeyAbsentOnDisk(collection.path, targetScope, field)
                }
              }
            )
            const outcome = normalizeModuleRunResponse(
              transaction.response as ModuleRunResponse,
              'lookup_rollup'
            )
            if (previousField !== undefined && previousField !== field) {
              // Saved views are auxiliary. Update them only after the module
              // accepted the renamed definition; a views-file failure must
              // never roll back valid Markdown or overlay state.
              try {
                const { renamePropertyInViews } = await import('./table-views')
                await renamePropertyInViews(
                  collection.id,
                  definitionOrigin ?? '',
                  previousField,
                  field
                )
              } catch (error) {
                console.warn(
                  `lookup-rollup: could not rename saved-view property "${previousField}":`,
                  error
                )
              }
            }
            broadcastModuleReports(windowManager, outcome.reports)
            broadcastComputedSchemaApplied(
              windowManager,
              collection.path,
              previousField !== undefined && previousField !== field
                ? { scope: definitionOrigin, oldKey: previousField, newKey: field }
                : undefined
            )
            return outcome.primary
          } catch (error) {
            if (snapshot && mutatedSnapshot) {
              return restoreComputedOverlay(
                windowManager,
                collection.path,
                snapshot,
                mutatedSnapshot,
                'lookup_rollup',
                error
              )
            }
            throw error
          }
        })
      })
  )

  ipcMain.handle(
    'schema:remove-lookup-rollup',
    (_event, collectionId: string, scope: string | null, key: string) =>
      wrapHandler(async () => {
        const collection = getCollections().find((item) => item.id === collectionId)
        if (!collection) throw new Error(`Collection not found: ${collectionId}`)
        const scopeKey = scope && scope !== '.' ? scope.replace(/\/+$/, '') : null
        await flushDirtyDocumentsAcrossWindows(windowManager, collection.id, collection.path)
        return withWatcherPaused(collection.path, async () => {
          const { captureOverlaySnapshot, removeOverlayField, resolveOverlayLookupRollupScope } =
            await import('./schema-overlay')
          let snapshot: import('./schema-overlay').OverlaySnapshot | null = null
          let mutatedSnapshot: import('./schema-overlay').OverlaySnapshot | null = null
          try {
            const transaction = await execModuleTransaction(
              collection.path,
              'lookup_rollup',
              null,
              async () => {
                const origin = await resolveOverlayLookupRollupScope(collection.path, scopeKey, key)
                if (origin === undefined) {
                  throw new Error(`Lookup/Rollup "${key}" is not defined for this collection`)
                }
                await verifyCleanDocumentsAcrossWindows(
                  windowManager,
                  collection.id,
                  collection.path
                )
                snapshot = await captureOverlaySnapshot(collection.path)
                const removed = await removeOverlayField(collection.path, origin, key, {
                  onPublished: (published) => {
                    mutatedSnapshot = published
                  }
                })
                if (!removed) throw new Error(`Lookup/Rollup "${key}" could not be removed`)
                mutatedSnapshot = await captureOverlaySnapshot(collection.path)
              }
            )
            const outcome = normalizeModuleRunResponse(
              transaction.response as ModuleRunResponse,
              'lookup_rollup'
            )
            broadcastModuleReports(windowManager, outcome.reports)
            broadcastComputedSchemaApplied(windowManager, collection.path)
            return outcome.primary
          } catch (error) {
            if (snapshot && mutatedSnapshot) {
              return restoreComputedOverlay(
                windowManager,
                collection.path,
                snapshot,
                mutatedSnapshot,
                'lookup_rollup',
                error
              )
            }
            throw error
          }
        })
      })
  )

  // Synced Select/Tags value-color annotations in `.markdownvdb.schema.yml`.
  ipcMain.handle('schema:get-value-colors', (_event, collectionId: string, scope: string | null) =>
    wrapHandler(async () => {
      const collection = getCollections().find((item) => item.id === collectionId)
      if (!collection) throw new Error(`Collection not found: ${collectionId}`)
      const { readOverlayValueColors } = await import('./schema-overlay')
      return readOverlayValueColors(collection.path, scope)
    })
  )

  ipcMain.handle(
    'schema:set-value-color',
    (
      _event,
      collectionId: string,
      scope: string | null,
      field: string,
      value: string,
      selection: PropertyValueColorSelection | null
    ) =>
      wrapHandler(async () => {
        const collection = getCollections().find((item) => item.id === collectionId)
        if (!collection) throw new Error(`Collection not found: ${collectionId}`)
        const { setOverlayValueColor } = await import('./schema-overlay')
        return setOverlayValueColor(collection.path, scope, field, value, selection)
      })
  )

  // Create file (exclusive create — fails if exists)
  ipcMain.handle('fs:create-file', (_event, absolutePath: string, content: string) =>
    wrapHandler(async () => {
      const { resolve, sep, dirname } = await import('node:path')
      const normalizedPath = resolve(absolutePath)
      const collections = getCollections()
      const isWithinCollection = collections.some(
        (c) => normalizedPath === c.path || normalizedPath.startsWith(c.path + sep)
      )
      if (!isWithinCollection) {
        throw new Error('Access denied: path is not within a known collection')
      }
      // Ensure parent directory exists
      registerOwnWrite(dirname(normalizedPath), 'mkdir')
      await fs.mkdir(dirname(normalizedPath), { recursive: true })
      // Exclusive create: fails if file already exists
      registerOwnWrite(normalizedPath, 'create', content)
      await fs.writeFile(normalizedPath, content, { encoding: 'utf-8', flag: 'wx' })
    })
  )

  // Create directory
  ipcMain.handle('fs:create-directory', (_event, absolutePath: string) =>
    wrapHandler(async () => {
      const { resolve, sep } = await import('node:path')
      const normalizedPath = resolve(absolutePath)
      const collections = getCollections()
      const isWithinCollection = collections.some(
        (c) => normalizedPath === c.path || normalizedPath.startsWith(c.path + sep)
      )
      if (!isWithinCollection) {
        throw new Error('Access denied: path is not within a known collection')
      }
      registerOwnWrite(normalizedPath, 'mkdir')
      await fs.mkdir(normalizedPath, { recursive: true })
    })
  )

  // Scan for non-markdown asset files in a collection
  ipcMain.handle('fs:scan-assets', (_event, collectionPath: string) =>
    wrapHandler(async () => {
      const { resolve } = await import('node:path')
      const normalizedRoot = resolve(collectionPath)
      if (!getCollections().some((collection) => resolve(collection.path) === normalizedRoot)) {
        throw new Error('Access denied: path is not a known collection')
      }
      const { scanAssets } = await import('./asset-scanner')
      return scanAssets(normalizedRoot)
    })
  )

  // Generate a small OS-backed preview without transferring the full file.
  ipcMain.handle(
    'fs:file-thumbnail',
    (_event, absolutePath: string, width?: number, height?: number) =>
      wrapHandler(async () => {
        const { fileThumbnail } = await import('./file-thumbnail')
        return fileThumbnail(
          absolutePath,
          getCollections().map((collection) => collection.path),
          width,
          height
        )
      })
  )

  // Fetch only bounded, text-only metadata for a public HTTP(S) URL.
  ipcMain.handle('link-preview:external', (_event, url: string) =>
    wrapHandler(async () => {
      const { externalLinkPreview } = await import('./link-preview')
      return externalLinkPreview(url)
    })
  )

  // Read a small metadata prefix from a Markdown file in a known collection.
  ipcMain.handle('link-preview:local', (_event, collectionPath: string, relativePath: string) =>
    wrapHandler(async () => {
      const { localLinkPreview } = await import('./link-preview')
      return localLinkPreview(
        collectionPath,
        relativePath,
        getCollections().map((collection) => collection.path)
      )
    })
  )

  // Read a file as base64 (for images, PDFs, etc.)
  ipcMain.handle('fs:read-binary', (_event, absolutePath: string) =>
    wrapHandler(async () => {
      const { resolve, sep } = await import('node:path')
      const normalizedPath = resolve(absolutePath)
      const collections = getCollections()
      const isWithinCollection = collections.some(
        (c) => normalizedPath === c.path || normalizedPath.startsWith(c.path + sep)
      )
      if (!isWithinCollection) {
        throw new Error('Access denied: path is not within a known collection')
      }
      // Guard against overly large files (50MB)
      const stat = await fs.stat(normalizedPath)
      if (stat.size > 50 * 1024 * 1024) {
        throw new Error('File too large for binary IPC transfer (max 50MB)')
      }
      const buffer = await fs.readFile(normalizedPath)
      return buffer.toString('base64')
    })
  )

  // Read an editable image together with a content hash used for optimistic
  // concurrency when the renderer later requests an overwrite.
  ipcMain.handle('fs:read-image', (_event, absolutePath: string) =>
    wrapHandler(async () => {
      const { resolve, sep } = await import('node:path')
      const normalizedPath = resolve(absolutePath)
      const isWithinCollection = getCollections().some((collection) => {
        const root = resolve(collection.path)
        return normalizedPath.startsWith(root + sep)
      })
      if (!isWithinCollection) {
        throw new Error('Access denied: path is not within a known collection')
      }
      const { readImageFile } = await import('./image-editor')
      return readImageFile(normalizedPath)
    })
  )

  // Apply a validated non-destructive edit recipe and atomically replace the
  // source image only when its hash still matches the renderer's baseline.
  ipcMain.handle('fs:edit-image', (event, absolutePath: string, request: ImageEditRequest) =>
    wrapHandler(async () => {
      const { resolve, sep } = await import('node:path')
      const normalizedPath = resolve(absolutePath)
      const isWithinCollection = getCollections().some((collection) => {
        const root = resolve(collection.path)
        return normalizedPath.startsWith(root + sep)
      })
      if (!isWithinCollection) {
        throw new Error('Access denied: path is not within a known collection')
      }

      const { editImageFile } = await import('./image-editor')
      const result = await editImageFile(normalizedPath, request)

      const senderId = event.sender.id
      for (const win of windowManager.getAllWindows()) {
        if (win.webContents.id !== senderId && !win.isDestroyed()) {
          win.webContents.send('image:saved-externally', {
            path: normalizedPath,
            result
          })
        }
      }
      return result
    })
  )

  ipcMain.handle('fs:cancel-image-edit', (_event, requestId: string) =>
    wrapHandler(async () => {
      const { cancelImageEdit } = await import('./image-editor')
      cancelImageEdit(requestId)
    })
  )

  // Exclusively create a binary file (for clipboard-pasted images)
  ipcMain.handle('fs:create-binary', (_event, absolutePath: string, base64Data: string) =>
    wrapHandler(async () => {
      const { resolve, sep, dirname, relative, extname, basename } = await import('node:path')
      const normalizedPath = resolve(absolutePath)
      const collections = getCollections()
      const collection = collections.find((c) => normalizedPath.startsWith(resolve(c.path) + sep))
      if (!collection) {
        throw new Error('Access denied: path is not within a known collection')
      }

      const relativePath = relative(resolve(collection.path), normalizedPath)
      const segments = relativePath.split(sep)
      const forbiddenDirectories = new Set([
        '.git',
        '.markdownvdb',
        '.obsidian',
        'node_modules',
        'dist',
        'build',
        'out',
        'target'
      ])
      if (
        !relativePath ||
        relativePath.startsWith(`..${sep}`) ||
        segments.some((segment, index) => {
          const normalized = segment.toLowerCase()
          return (
            !segment ||
            segment === '.' ||
            segment === '..' ||
            (index < segments.length - 1 &&
              (segment.startsWith('.') || forbiddenDirectories.has(normalized)))
          )
        })
      ) {
        throw new Error('Access denied: invalid collection destination')
      }

      const imageExtensions = new Set([
        '.png',
        '.jpg',
        '.jpeg',
        '.gif',
        '.webp',
        '.bmp',
        '.svg',
        '.ico',
        '.avif'
      ])
      // eslint-disable-next-line no-control-regex
      const invalidName = /[<>:"|?*\x00-\x1f]/
      const filename = basename(normalizedPath)
      const windowsReservedName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i
      if (
        !imageExtensions.has(extname(filename).toLowerCase()) ||
        invalidName.test(filename) ||
        windowsReservedName.test(filename) ||
        /^[. ]|[. ]$/.test(filename)
      ) {
        throw new Error('Invalid clipboard image filename')
      }

      registerOwnWrite(dirname(normalizedPath), 'mkdir')
      await fs.mkdir(dirname(normalizedPath), { recursive: true })
      const buffer = Buffer.from(base64Data, 'base64')
      if (buffer.byteLength === 0) {
        throw new Error('Clipboard image data is empty')
      }
      if (buffer.byteLength > 50 * 1024 * 1024) {
        throw new Error('Clipboard image is too large (max 50MB)')
      }
      registerOwnWrite(normalizedPath, 'create', buffer)
      await atomicCreateFile(normalizedPath, buffer)
      return { size: buffer.byteLength }
    })
  )

  // Get file metadata (size, mtime)
  ipcMain.handle('fs:file-info', (_event, absolutePath: string) =>
    wrapHandler(async () => {
      const { resolve, sep } = await import('node:path')
      const normalizedPath = resolve(absolutePath)
      const collections = getCollections()
      const isWithinCollection = collections.some(
        (c) => normalizedPath === c.path || normalizedPath.startsWith(c.path + sep)
      )
      if (!isWithinCollection) {
        throw new Error('Access denied: path is not within a known collection')
      }
      const stat = await fs.stat(normalizedPath)
      return { size: stat.size, mtime: stat.mtime.toISOString() }
    })
  )

  // Copy a file into a collection (for external drag-and-drop import)
  ipcMain.handle('fs:copy-file', (_event, sourcePath: string, destPath: string) =>
    wrapHandler(async () => {
      const { resolve, sep, dirname } = await import('node:path')
      const normalizedDest = resolve(destPath)
      const collections = getCollections()
      // Destination must be within a collection
      const isDestWithinCollection = collections.some((c) =>
        normalizedDest.startsWith(c.path + sep)
      )
      if (!isDestWithinCollection) {
        throw new Error('Access denied: destination is not within a known collection')
      }
      registerOwnWrite(dirname(normalizedDest), 'mkdir')
      await fs.mkdir(dirname(normalizedDest), { recursive: true })
      registerOwnWrite(normalizedDest, 'copy')
      await fs.copyFile(resolve(sourcePath), normalizedDest)
    })
  )

  // Check if a path is within any known collection
  ipcMain.handle('fs:is-within-collection', (_event, absolutePath: string) =>
    wrapHandler(async () => {
      const { resolve, sep } = await import('node:path')
      const normalizedPath = resolve(absolutePath)
      const collections = getCollections()
      const match = collections.find(
        (c) => normalizedPath === c.path || normalizedPath.startsWith(c.path + sep)
      )
      return {
        within: !!match,
        collectionPath: match?.path ?? null
      }
    })
  )

  // Rename/move a file within a collection
  ipcMain.handle('fs:rename-file', (_event, oldPath: string, newPath: string) =>
    wrapHandler(async () => {
      const { resolve, sep, dirname } = await import('node:path')
      const normalizedOld = resolve(oldPath)
      const normalizedNew = resolve(newPath)
      const collections = getCollections()
      const oldCollection = collections.find(
        (c) => normalizedOld === c.path || normalizedOld.startsWith(c.path + sep)
      )
      if (!oldCollection) {
        throw new Error('Access denied: source path is not within a known collection')
      }
      const isNewWithinSame =
        normalizedNew === oldCollection.path || normalizedNew.startsWith(oldCollection.path + sep)
      if (!isNewWithinSame) {
        throw new Error('Access denied: destination must be within the same collection')
      }
      // Check target doesn't already exist
      try {
        await fs.access(normalizedNew)
        throw new Error('A file with that name already exists')
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
      }
      // Ensure parent dir exists
      registerOwnWrite(dirname(normalizedNew), 'mkdir')
      await fs.mkdir(dirname(normalizedNew), { recursive: true })

      const stat = await fs.stat(normalizedOld).catch(() => null)
      registerOwnWrite(normalizedOld, 'rename-from')
      registerOwnWrite(normalizedNew, 'rename-to')
      await fs.rename(normalizedOld, normalizedNew)

      // chokidar cannot pair renames (it sees unlink + add) — synthesize the
      // paired event so renderers can retarget tabs/tree nodes in one step.
      const { relative: rel } = await import('node:path')
      const oldRelative = rel(oldCollection.path, normalizedOld).split(sep).join('/')
      const newRelative = rel(oldCollection.path, normalizedNew).split(sep).join('/')
      if (stat?.isDirectory()) {
        try {
          const shardList = await execCommand<ShardList>('shards', ['list'], oldCollection.path)
          const affectsShard = shardList.shards.some(
            (shard) => shard.path === oldRelative || shard.path.startsWith(`${oldRelative}/`)
          )
          if (affectsShard) {
            await execCommand<ShardMutation>(
              'shards',
              ['retarget', oldRelative, newRelative],
              oldCollection.path
            )
            broadcastShardInvalidation(oldCollection.path)
          }
        } catch (error) {
          // Keep the filesystem and Shard manifest transactional for in-app
          // directory renames. If rollback also fails, report both failures.
          try {
            registerOwnWrite(normalizedNew, 'rename-from')
            registerOwnWrite(normalizedOld, 'rename-to')
            await fs.rename(normalizedNew, normalizedOld)
          } catch (rollbackError) {
            throw new Error(
              `Shard retarget failed: ${
                error instanceof Error ? error.message : String(error)
              }; folder rollback failed: ${
                rollbackError instanceof Error ? rollbackError.message : String(rollbackError)
              }`
            )
          }
          throw error
        }
      }
      getVaultWatcher().emitAppEvent({
        kind: 'renamed',
        path: newRelative,
        oldPath: oldRelative,
        isDirectory: stat?.isDirectory() ?? false
      })
    })
  )

  ipcMain.handle('fs:delete', (_event, absolutePath: string) =>
    wrapHandler(async () => {
      const { resolve, sep } = await import('node:path')
      const normalizedPath = resolve(absolutePath)
      const collections = getCollections()
      const collection = collections.find((c) => normalizedPath.startsWith(c.path + sep))
      if (!collection) {
        throw new Error('Access denied: path is not within a known collection')
      }
      // Prevent deleting the collection root itself
      if (normalizedPath === collection.path) {
        throw new Error('Cannot delete the collection root directory')
      }
      registerOwnWrite(normalizedPath, 'delete')
      await shell.trashItem(normalizedPath)
    })
  )

  // Window state persistence
  ipcMain.handle('store:set-sidebar-width', (_event, width: number) =>
    wrapHandler(async () => {
      const { initStore } = await import('./store')
      const store = initStore()
      store.set('sidebarWidth', width)
    })
  )

  ipcMain.handle('store:set-metadata-panel-width', (_event, width: number) =>
    wrapHandler(async () => {
      const { initStore } = await import('./store')
      const store = initStore()
      store.set('metadataPanelWidth', width)
    })
  )

  ipcMain.handle('store:get-sidebar-width', () =>
    wrapHandler(async () => {
      const { initStore } = await import('./store')
      const store = initStore()
      return store.get('sidebarWidth', 280)
    })
  )

  ipcMain.handle('store:get-metadata-panel-width', () =>
    wrapHandler(async () => {
      const { initStore } = await import('./store')
      const store = initStore()
      return store.get('metadataPanelWidth', 320)
    })
  )

  // Open file/folder in default app (e.g., open markdown in default editor)
  ipcMain.handle('shell:open-path', (_event, absolutePath: string) =>
    wrapHandler(async () => {
      const { resolve, sep } = await import('node:path')
      const normalizedPath = resolve(absolutePath)
      const collections = getCollections()
      const isWithinCollection = collections.some(
        (c) => normalizedPath === c.path || normalizedPath.startsWith(c.path + sep)
      )
      if (!isWithinCollection) {
        throw new Error('Access denied: path is not within a known collection')
      }
      await shell.openPath(normalizedPath)
    })
  )

  // Copy text to clipboard
  ipcMain.handle('clipboard:write-text', (_event, text: string) =>
    wrapHandler(async () => {
      clipboard.writeText(text)
    })
  )

  // CLI detection and installation
  ipcMain.handle('cli:detect', () =>
    wrapHandler(async () => {
      const result = await detectCli()
      if (result.found && result.path) {
        setCliInfo(result.path, result.version ?? null)
      }
      return result
    })
  )

  ipcMain.handle('cli:install', (event) =>
    wrapHandler(async () => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) {
        throw new Error('No window available for install progress')
      }
      const result = await installCli(win)
      if (result.success) {
        setCliInfo(result.path, result.version ?? null)
      }
      return result
    })
  )

  ipcMain.handle('cli:check-latest-version', () => wrapHandler(() => checkLatestVersion()))

  // User-level canonical YAML + secret .env.
  ipcMain.handle('settings:get-user-config', () =>
    wrapHandler(async () => {
      const { join } = await import('node:path')
      const { homedir } = await import('node:os')
      const dir = process.env.MDVDB_CONFIG_HOME?.trim() || join(homedir(), '.mdvdb')
      return readSettingsConfig(join(dir, 'config.yaml'), join(dir, '.env'))
    })
  )

  ipcMain.handle('settings:set-user-config', (_event, key: string, value: string) =>
    wrapHandler(async () => {
      const { homedir } = await import('node:os')
      if (SETTINGS_SECRET_KEYS.has(key)) {
        await execWithInput(
          'config',
          ['--global', 'secret', 'set', key, '--stdin'],
          homedir(),
          value
        )
        return
      }
      const yamlKey = SETTINGS_YAML_KEYS[key]
      if (!yamlKey) throw new Error(`Unsupported setting: ${key}`)
      await execCommand<void>('config', ['--global', 'set', yamlKey, value], homedir())
    })
  )

  ipcMain.handle('settings:delete-user-config', (_event, key: string) =>
    wrapHandler(async () => {
      const { homedir } = await import('node:os')
      if (SETTINGS_SECRET_KEYS.has(key)) {
        await execCommand<void>('config', ['--global', 'secret', 'unset', key], homedir())
        return
      }
      const yamlKey = SETTINGS_YAML_KEYS[key]
      if (!yamlKey) throw new Error(`Unsupported setting: ${key}`)
      await execCommand<void>('config', ['--global', 'unset', yamlKey], homedir())
    })
  )

  // Collection-level canonical YAML + secret .env.
  ipcMain.handle('settings:get-collection-config', (_event, root: string) =>
    wrapHandler(async () => {
      const { join } = await import('node:path')
      const dir = join(root, '.markdownvdb')
      return readSettingsConfig(join(dir, 'config.yaml'), join(dir, '.env'))
    })
  )

  ipcMain.handle(
    'settings:set-collection-config',
    (_event, root: string, key: string, value: string) =>
      wrapHandler(async () => {
        if (SETTINGS_SECRET_KEYS.has(key)) {
          await execWithInput('config', ['secret', 'set', key, '--stdin'], root, value)
          return
        }
        const yamlKey = SETTINGS_YAML_KEYS[key]
        if (!yamlKey) throw new Error(`Unsupported setting: ${key}`)
        await execCommand<void>('config', ['set', yamlKey, value], root)
      })
  )

  ipcMain.handle('settings:delete-collection-config', (_event, root: string, key: string) =>
    wrapHandler(async () => {
      if (SETTINGS_SECRET_KEYS.has(key)) {
        await execCommand<void>('config', ['secret', 'unset', key], root)
        return
      }
      const yamlKey = SETTINGS_YAML_KEYS[key]
      if (!yamlKey) throw new Error(`Unsupported setting: ${key}`)
      await execCommand<void>('config', ['unset', yamlKey], root)
    })
  )

  // Onboarding and editor font size store
  ipcMain.handle('store:get-onboarding-complete', () =>
    wrapHandler(async () => getOnboardingComplete())
  )

  ipcMain.handle('store:set-onboarding-complete', (_event, value: boolean) =>
    wrapHandler(async () => {
      setOnboardingComplete(value)
    })
  )

  ipcMain.handle('store:get-editor-font-size', () => wrapHandler(async () => getEditorFontSize()))

  ipcMain.handle('store:get-auto-show-diff', () => wrapHandler(async () => getAutoShowDiff()))

  ipcMain.handle('store:set-auto-show-diff', (_event, value: boolean) =>
    wrapHandler(async () => setAutoShowDiff(value))
  )

  ipcMain.handle('store:get-watcher-enabled', (_event, collectionId: string) =>
    wrapHandler(async () => getWatcherEnabled(collectionId))
  )

  ipcMain.handle('store:set-watcher-enabled', (_event, collectionId: string, enabled: boolean) =>
    wrapHandler(async () => {
      setWatcherEnabled(collectionId, enabled)
      // Keep the Collection menu's "Watch for Changes" checkbox in sync
      refreshAppMenu()
    })
  )

  ipcMain.handle('store:set-editor-font-size', (_event, value: number) =>
    wrapHandler(async () => {
      setEditorFontSize(value)
    })
  )

  ipcMain.handle('store:get-zoom-level', () => wrapHandler(async () => getZoomLevel()))

  ipcMain.handle('store:set-zoom-level', (event, value: number) =>
    wrapHandler(async () => {
      setZoomLevel(value)
      // Apply zoom to the requesting window immediately
      const win = BrowserWindow.fromWebContents(event.sender)
      if (win && !win.isDestroyed()) {
        win.webContents.setZoomFactor(value)
      }
    })
  )

  // Accent color
  ipcMain.handle('store:get-primary-color', () => wrapHandler(async () => getPrimaryColor()))

  ipcMain.handle('store:set-primary-color', (_event, hex: string | null) =>
    wrapHandler(async () => {
      setPrimaryColor(hex)
    })
  )

  ipcMain.handle('store:get-collection-color', (_event, collectionId: string) =>
    wrapHandler(async () => getCollectionColor(collectionId))
  )

  ipcMain.handle('store:set-collection-color', (_event, collectionId: string, hex: string | null) =>
    wrapHandler(async () => {
      setCollectionColor(collectionId, hex)
    })
  )

  // Theme
  ipcMain.handle('store:get-theme', () => wrapHandler(async () => getThemeMode()))

  ipcMain.handle('store:set-theme', (_event, mode: string) =>
    wrapHandler(async () => {
      setThemeMode(mode)
      // Re-color the Windows/Linux native window controls to match (no-op on macOS)
      windowManager.updateTitleBarOverlay()
    })
  )

  ipcMain.handle('store:get-collection-theme', (_event, collectionId: string) =>
    wrapHandler(async () => getCollectionTheme(collectionId))
  )

  ipcMain.handle(
    'store:set-collection-theme',
    (_event, collectionId: string, mode: string | null) =>
      wrapHandler(async () => {
        setCollectionTheme(collectionId, mode)
      })
  )

  // Watcher management
  ipcMain.handle('watcher:start', (_event, root: string) =>
    wrapHandler(async () => {
      const watcher = getWatcherManager()

      // Forward watcher events to all windows via broadcastToAll
      watcher.removeAllListeners()

      watcher.onEvent((watchEvent) => {
        windowManager.broadcastToAll('watcher:event', { type: 'watch-event', data: watchEvent })
        if ('event_type' in watchEvent) {
          recordActivity(activityLogStore?.recordWatchEvent(root, watchEvent as WatchEventReport))
        }
      })

      watcher.onError((error) => {
        windowManager.broadcastToAll('watcher:event', {
          type: 'error',
          data: { message: error.message }
        })
        recordActivity(activityLogStore?.recordWatcherState(root, 'error', error.message))
      })

      let previousWatcherState = watcher.getState()
      watcher.onStateChange((state: WatcherState) => {
        windowManager.broadcastToAll('watcher:event', { type: 'state-change', data: state })
        if (state !== 'error' && state !== 'blocked') {
          const activityState =
            state === 'starting' && previousWatcherState === 'running' ? 'restarting' : state
          recordActivity(activityLogStore?.recordWatcherState(root, activityState))
        }
        previousWatcherState = state
      })

      const status = await execCommand<IndexStatus>('status', [], root)
      if (status?.reindex_required) {
        const reason =
          status.embedding_compatibility_error ??
          'Embedding settings changed; a full reindex is required before watching.'
        watcher.block(root)
        windowManager.broadcastToAll('watcher:event', {
          type: 'blocked',
          data: { message: reason, action: 'reindex' }
        })
        recordActivity(activityLogStore?.recordWatcherState(root, 'blocked', reason))
        return
      }

      await watcher.start(root)
    })
  )

  ipcMain.handle('watcher:stop', () =>
    wrapHandler(async () => {
      const watcher = getWatcherManager()
      await watcher.stop()
    })
  )

  ipcMain.handle('watcher:status', () =>
    wrapHandler(async () => {
      const watcher = getWatcherManager()
      return {
        state: watcher.getState(),
        running: watcher.isRunning(),
        root: watcher.getRoot()
      }
    })
  )

  // Vault watcher (Tier-1): forward batches + status to all windows.
  // Lifecycle is main-owned (app ready / collection switch / quit) — renderers
  // only listen, so there are no start/stop channels.
  const vaultWatcher = getVaultWatcher()
  vaultWatcher.removeAllListeners()
  vaultWatcher.onBatch((batch) => {
    windowManager.broadcastToAll('vault:file-events', batch)

    // Obsidian topic sync (phase 44): external markdown edits (own writes are
    // already filtered out of batches) may change tags — schedule a debounced
    // re-sync for the collection that owns this batch.
    if (batch.events.some((event) => event.fileKind === 'markdown')) {
      const collection = getCollections().find((c) => c.path === batch.root)
      if (collection) scheduleObsidianSync(collection, windowManager)
    }
  })
  vaultWatcher.onStatusChange((status) => {
    windowManager.broadcastToAll('vault:watcher-status', status)
  })

  ipcMain.handle('vault-watcher:status', () =>
    wrapHandler(async () => getVaultWatcher().getStatus())
  )

  // Updater management
  const updater = getAppUpdater()

  // Wire event forwarding from AppUpdater to all windows
  updater.setWindowManager(windowManager)

  ipcMain.handle('updater:check', () =>
    wrapHandler(async () => {
      await updater.checkForUpdates()
    })
  )

  ipcMain.handle('updater:download', () =>
    wrapHandler(async () => {
      await updater.downloadUpdate()
    })
  )

  ipcMain.handle('updater:install', () =>
    wrapHandler(async () => {
      updater.quitAndInstall()
    })
  )

  ipcMain.handle('updater:status', () =>
    wrapHandler(async () => {
      return { state: updater.getState() }
    })
  )

  ipcMain.handle('updater:skip-version', (_event, version: string) =>
    wrapHandler(async () => {
      updater.skipVersion(version)
    })
  )

  ipcMain.handle('updater:app-version', () => wrapHandler(async () => app.getVersion()))

  // Window session persistence. Only the PRIMARY main window owns the saved
  // session — extra windows (Cmd+Shift+N) start fresh and never clobber it.
  ipcMain.handle('session:save', (event, session: PersistedWindowState) =>
    wrapHandler(async () => {
      if (!windowManager.isPrimary(event.sender.id)) return
      // For single-window mode, store as a single-element array
      setWindowSessions([session])
    })
  )

  ipcMain.handle('session:get', (event) =>
    wrapHandler(async (): Promise<PersistedWindowState | null> => {
      if (!windowManager.isPrimary(event.sender.id)) return null
      const sessions = getWindowSessions()
      return sessions.length > 0 ? sessions[0] : null
    })
  )

  // Synchronous session flush, used from beforeunload so a layout change in
  // the last debounce window survives quitting the app.
  ipcMain.on('session:save-sync', (event, session: PersistedWindowState) => {
    try {
      if (windowManager.isPrimary(event.sender.id)) {
        setWindowSessions([session])
      }
    } finally {
      // Must be set, or the sending renderer blocks forever.
      event.returnValue = true
    }
  })

  // Multi-window management
  ipcMain.handle('window:new', (_event, collectionId?: string, shardId?: string) =>
    wrapHandler(async () => {
      if (collectionId && !getCollections().some((collection) => collection.id === collectionId)) {
        throw new Error(`Collection not found: ${collectionId}`)
      }
      windowManager.createWindow({ collectionId, shardId })
    })
  )

  // Cross-window tab transfer
  //
  // tab:detach: Serialized tab data from the source window.
  // Spawns a popup window (lightweight, chrome-free) and sends
  // dirty content via popup:init once the renderer has loaded.
  ipcMain.handle('tab:detach', (_event, tabData: TabTransferData) =>
    wrapHandler(async () => {
      // Convert TabTransferData to PopupWindowOptions
      const activeCollection = getActiveCollection()
      const popupOpts = {
        kind: tabData.kind,
        filePath: tabData.filePath,
        editorMode: tabData.editorMode,
        isUntitled: tabData.isUntitled,
        collectionId: activeCollection?.id,
        collectionPath: activeCollection?.path,
        mimeCategory: tabData.mimeCategory,
        graphLevel: tabData.graphLevel,
        graphColoringMode: tabData.graphColoringMode,
        shardId: tabData.shardId ?? undefined,
        graphPathFilter: tabData.graphPathFilter ?? undefined,
        isDirty: tabData.isDirty,
        content: tabData.content,
        savedContent: tabData.savedContent,
        imageEditDraft: tabData.imageEditDraft,
        recursive: tabData.recursive,
        tableViewId: tabData.tableViewId,
        terminalId: tabData.terminalId,
        title: tabData.title,
        shell: tabData.shell,
        cwd: tabData.cwd
      }
      windowManager.createPopupWindow(popupOpts)
    })
  )

  // tab:attach: Relay tab data to a specific target window.
  // Used for cross-window drag-drop where the target window
  // is already identified. The main process forwards the data
  // as a push event so the renderer can add it to the workspace.
  ipcMain.handle('tab:attach', (event, tabData: TabTransferData) =>
    wrapHandler(async () => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (win && !win.isDestroyed()) {
        win.webContents.send('tab:attach', tabData)
      }
    })
  )

  // Popup windows
  //
  // popup:open: Create a new popup window from context menus or other triggers.
  ipcMain.handle('popup:open', (_event, options: PopupOpenOptions) =>
    wrapHandler(async () => {
      windowManager.createPopupWindow(options)
    })
  )

  // popup:title-update: Update the OS window title from the popup renderer.
  ipcMain.handle('popup:title-update', (event, title: string) =>
    wrapHandler(async () => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (win && !win.isDestroyed()) {
        win.setTitle(title)
      }
    })
  )

  // popup:set-always-on-top: Toggle always-on-top for the calling window.
  ipcMain.handle('popup:set-always-on-top', (event, enabled: boolean) =>
    wrapHandler(async () => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (win && !win.isDestroyed()) {
        win.setAlwaysOnTop(enabled, 'floating')
      }
    })
  )

  // Terminal settings
  ipcMain.handle('store:get-terminal-shell-path', () =>
    wrapHandler(async () => getTerminalShellPath())
  )

  ipcMain.handle('store:set-terminal-shell-path', (_event, value: string) =>
    wrapHandler(async () => {
      setTerminalShellPath(value)
    })
  )

  ipcMain.handle('store:get-terminal-shell-args', () =>
    wrapHandler(async () => getTerminalShellArgs())
  )

  ipcMain.handle('store:set-terminal-shell-args', (_event, value: string) =>
    wrapHandler(async () => {
      setTerminalShellArgs(value)
    })
  )

  ipcMain.handle('store:get-terminal-font-size', () =>
    wrapHandler(async () => getTerminalFontSize())
  )

  ipcMain.handle('store:set-terminal-font-size', (_event, value: number) =>
    wrapHandler(async () => {
      setTerminalFontSize(value)
    })
  )

  // Home directory (fallback cwd for terminals)
  ipcMain.handle('os:homedir', () =>
    wrapHandler(async (): Promise<string> => {
      const { homedir } = await import('node:os')
      return homedir()
    })
  )

  // popup:pop-back: Send the popup's document back to the main window, then close the popup.
  ipcMain.handle('popup:pop-back', (event, tabData: TabTransferData) =>
    wrapHandler(async () => {
      // Find a non-popup window to send the tab to
      const allWindows = windowManager.getAllWindows()
      const senderWin = BrowserWindow.fromWebContents(event.sender)
      const targetWin = allWindows.find(
        (w) => w !== senderWin && !windowManager.isPopup(w.webContents.id)
      )

      if (targetWin && !targetWin.isDestroyed()) {
        // Terminals: transfer PTY ownership to the target BEFORE the popup
        // closes — otherwise disposeByWindow(popup) kills the shell mid-move.
        // The target's adopt rebinds again (idempotent) to fetch scrollback.
        if (tabData.kind === 'terminal' && tabData.terminalId && ptyManager) {
          try {
            ptyManager.rebind(tabData.terminalId, targetWin.webContents)
          } catch {
            // PTY already gone — the target respawns from shell+cwd
          }
        }
        targetWin.webContents.send('tab:attach', tabData)
        targetWin.focus()
      }

      // Close the popup. Bypass the dirty-close guard: the tab (including any
      // dirty content) was just transferred to the target window, so prompting
      // the popup renderer would be a false "unsaved changes" warning.
      if (senderWin && !senderWin.isDestroyed()) {
        windowManager.confirmClose(senderWin.webContents.id)
      }
    })
  )

  // Dirty-close guard (data safety): the renderer answers a main-initiated
  // 'app:close-request' with this channel once it decided the window may
  // really close (clean, or the user confirmed discarding changes).
  ipcMain.handle('app:confirm-close', (event) =>
    wrapHandler(async () => {
      windowManager.confirmClose(event.sender.id)
    })
  )

  // A dirty renderer declined the close confirmation. Cancel any application-
  // level quit so closing the last window later does not unexpectedly quit.
  ipcMain.handle('app:cancel-close', () =>
    wrapHandler(async () => {
      windowManager.cancelAppQuit()
    })
  )

  // Receipt ack for 'app:close-request' — cancels the hung-renderer fallback
  // timer so a slow user decision (confirm dialog) never force-closes a live
  // window. Sent automatically by the preload listener wrapper.
  ipcMain.on('app:close-ack', (event) => {
    windowManager.clearCloseTimer(event.sender.id)
  })
}
