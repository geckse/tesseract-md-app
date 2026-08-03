import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { WindowManager } from '../../src/main/window-manager'

// Mock electron ipcMain and shell
const mockHandle = vi.fn()

// Mock CLI module
const mockFindCli = vi.fn()
const mockGetCliVersion = vi.fn()
const mockExecCommand = vi.fn()
const mockExecRaw = vi.fn()
const mockExecModuleTransaction = vi.fn()
vi.mock('../../src/main/cli', () => ({
  findCli: (...args: unknown[]) => mockFindCli(...args),
  getCliVersion: (...args: unknown[]) => mockGetCliVersion(...args),
  execCommand: (...args: unknown[]) => mockExecCommand(...args),
  execRaw: (...args: unknown[]) => mockExecRaw(...args),
  execModuleTransaction: (...args: unknown[]) => mockExecModuleTransaction(...args)
}))

// Mock store module
const mockGetCollections = vi.fn()
const mockAddCollection = vi.fn()
const mockRemoveCollection = vi.fn()
const mockSetActiveCollection = vi.fn()
const mockGetActiveCollection = vi.fn()
const mockGetCollectionSkillsDismissed = vi.fn()
const mockSetCollectionSkillsDismissed = vi.fn()
const mockGetActiveShardId = vi.fn()
const mockSetActiveShardId = vi.fn()
vi.mock('../../src/main/store', () => ({
  getCollections: (...args: unknown[]) => mockGetCollections(...args),
  addCollection: (...args: unknown[]) => mockAddCollection(...args),
  removeCollection: (...args: unknown[]) => mockRemoveCollection(...args),
  setActiveCollection: (...args: unknown[]) => mockSetActiveCollection(...args),
  getActiveCollection: (...args: unknown[]) => mockGetActiveCollection(...args),
  getCollectionSkillsDismissed: (...args: unknown[]) => mockGetCollectionSkillsDismissed(...args),
  setCollectionSkillsDismissed: (...args: unknown[]) => mockSetCollectionSkillsDismissed(...args),
  getActiveShardId: (...args: unknown[]) => mockGetActiveShardId(...args),
  setActiveShardId: (...args: unknown[]) => mockSetActiveShardId(...args),
  getOnboardingComplete: vi.fn().mockReturnValue(false),
  setOnboardingComplete: vi.fn(),
  getEditorFontSize: vi.fn().mockReturnValue(17),
  setEditorFontSize: vi.fn(),
  getZoomLevel: vi.fn().mockReturnValue(1.0),
  setZoomLevel: vi.fn(),
  getWindowSessions: vi.fn().mockReturnValue([]),
  setWindowSessions: vi.fn(),
  setCliInfo: vi.fn(),
  getThemeMode: vi.fn().mockReturnValue('dark'),
  setThemeMode: vi.fn(),
  initStore: vi.fn()
}))

const mockCheckCollectionSkills = vi.fn()
const mockInstallCollectionSkills = vi.fn()
vi.mock('../../src/main/collection-skills', () => ({
  checkCollectionSkills: (...args: unknown[]) => mockCheckCollectionSkills(...args),
  installCollectionSkills: (...args: unknown[]) => mockInstallCollectionSkills(...args)
}))

// Mock cli-install module
vi.mock('../../src/main/cli-install', () => ({
  detectCli: vi.fn().mockResolvedValue({ found: false }),
  installCli: vi
    .fn()
    .mockResolvedValue({ success: true, path: '/usr/local/bin/mdvdb', version: '0.1.0' }),
  checkLatestVersion: vi.fn().mockResolvedValue('0.1.0')
}))

// Mock config-io module
vi.mock('../../src/main/config-io', () => ({
  readConfig: vi.fn().mockResolvedValue({}),
  writeConfigKey: vi.fn().mockResolvedValue(undefined),
  deleteConfigKey: vi.fn().mockResolvedValue(undefined)
}))

// Mock the schema-overlay persistence boundary so formula lifecycle tests can
// assert transactional behavior independently from filesystem mechanics.
const mockCaptureOverlaySnapshot = vi.fn()
const mockRestoreOverlaySnapshot = vi.fn()
const mockResolveOverlayFormulaScope = vi.fn()
const mockResolveOverlayLookupRollupScope = vi.fn()
const mockResolveOverlayLookupRollupDefinition = vi.fn()
const mockUpsertOverlayField = vi.fn()
const mockRemoveOverlayField = vi.fn()
const mockReadOverlayValueColors = vi.fn()
const mockSetOverlayValueColor = vi.fn()
const mockRenameOverlayField = vi.fn()
vi.mock('../../src/main/schema-overlay', () => ({
  captureOverlaySnapshot: (...args: unknown[]) => mockCaptureOverlaySnapshot(...args),
  restoreOverlaySnapshot: (...args: unknown[]) => mockRestoreOverlaySnapshot(...args),
  resolveOverlayFormulaScope: (...args: unknown[]) => mockResolveOverlayFormulaScope(...args),
  resolveOverlayLookupRollupScope: (...args: unknown[]) =>
    mockResolveOverlayLookupRollupScope(...args),
  resolveOverlayLookupRollupDefinition: (...args: unknown[]) =>
    mockResolveOverlayLookupRollupDefinition(...args),
  upsertOverlayField: (...args: unknown[]) => mockUpsertOverlayField(...args),
  removeOverlayField: (...args: unknown[]) => mockRemoveOverlayField(...args),
  readOverlayValueColors: (...args: unknown[]) => mockReadOverlayValueColors(...args),
  setOverlayValueColor: (...args: unknown[]) => mockSetOverlayValueColor(...args),
  renameOverlayField: (...args: unknown[]) => mockRenameOverlayField(...args)
}))

const mockRenamePropertyInViews = vi.fn()
vi.mock('../../src/main/table-views', () => ({
  listTableViews: vi.fn(),
  getDefaultTableColumns: vi.fn(),
  saveDefaultTableColumns: vi.fn(),
  saveTableView: vi.fn(),
  updateTableView: vi.fn(),
  deleteTableView: vi.fn(),
  setDefaultTableView: vi.fn(),
  cleanupCollectionTableViews: vi.fn(),
  renamePropertyInViews: (...args: unknown[]) => mockRenamePropertyInViews(...args)
}))

const mockAssertComputedOutputKeyAbsentOnDisk = vi.fn()
vi.mock('../../src/main/computed-output-preflight', () => ({
  assertComputedOutputKeyAbsentOnDisk: (...args: unknown[]) =>
    mockAssertComputedOutputKeyAbsentOnDisk(...args)
}))

// Mock collections module
const mockPickCollectionFolder = vi.fn()
const mockValidateCollectionPath = vi.fn()
const mockInitCollection = vi.fn()
const mockConfirmRemoveCollection = vi.fn()
const mockPromptInitCollection = vi.fn()
vi.mock('../../src/main/collections', () => ({
  pickCollectionFolder: (...args: unknown[]) => mockPickCollectionFolder(...args),
  validateCollectionPath: (...args: unknown[]) => mockValidateCollectionPath(...args),
  initCollection: (...args: unknown[]) => mockInitCollection(...args),
  confirmRemoveCollection: (...args: unknown[]) => mockConfirmRemoveCollection(...args),
  promptInitCollection: (...args: unknown[]) => mockPromptInitCollection(...args)
}))

const mockCreateExampleCollection = vi.fn()
vi.mock('../../src/main/example-collection', () => ({
  createExampleCollection: (...args: unknown[]) => mockCreateExampleCollection(...args)
}))

// Mock node:fs for fs:read-file, fs:write-file, and cli:reset-index handlers
// (rename backs the atomic temp+rename write path in atomic-write.ts)
const mockReadFile = vi.fn()
const mockWriteFile = vi.fn()
const mockAtomicTempWriteFile = vi.fn()
const mockOpen = vi.fn()
const mockLstat = vi.fn()
const mockRealpath = vi.fn()
const mockHandleChmod = vi.fn()
const mockHandleSync = vi.fn()
const mockHandleClose = vi.fn()
const mockRename = vi.fn().mockResolvedValue(undefined)
const mockRm = vi.fn().mockResolvedValue(undefined)
const mockLink = vi.fn().mockResolvedValue(undefined)
const mockMkdir = vi.fn().mockResolvedValue(undefined)
const mockAccess = vi.fn()
const mockStat = vi.fn()
vi.mock('node:fs', () => ({
  default: {
    promises: {
      readFile: (...args: unknown[]) => mockReadFile(...args),
      writeFile: (...args: unknown[]) => mockWriteFile(...args),
      open: (...args: unknown[]) => mockOpen(...args),
      lstat: (...args: unknown[]) => mockLstat(...args),
      realpath: (...args: unknown[]) => mockRealpath(...args),
      rename: (...args: unknown[]) => mockRename(...args),
      rm: (...args: unknown[]) => mockRm(...args),
      link: (...args: unknown[]) => mockLink(...args),
      mkdir: (...args: unknown[]) => mockMkdir(...args),
      access: (...args: unknown[]) => mockAccess(...args),
      stat: (...args: unknown[]) => mockStat(...args)
    }
  },
  promises: {
    readFile: (...args: unknown[]) => mockReadFile(...args),
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
    open: (...args: unknown[]) => mockOpen(...args),
    lstat: (...args: unknown[]) => mockLstat(...args),
    realpath: (...args: unknown[]) => mockRealpath(...args),
    rename: (...args: unknown[]) => mockRename(...args),
    rm: (...args: unknown[]) => mockRm(...args),
    link: (...args: unknown[]) => mockLink(...args),
    mkdir: (...args: unknown[]) => mockMkdir(...args),
    access: (...args: unknown[]) => mockAccess(...args),
    stat: (...args: unknown[]) => mockStat(...args)
  }
}))

// Mock watcher module
const mockWatcherStart = vi.fn()
const mockWatcherStop = vi.fn()
const mockWatcherDestroy = vi.fn()
const mockWatcherGetState = vi.fn()
const mockWatcherIsRunning = vi.fn()
const mockWatcherGetRoot = vi.fn()
const mockWatcherOnEvent = vi.fn()
const mockWatcherOnError = vi.fn()
const mockWatcherOnStateChange = vi.fn()
const mockWatcherRemoveAllListeners = vi.fn()
vi.mock('../../src/main/watcher', () => ({
  WatcherManager: vi.fn().mockImplementation(() => ({
    start: (...args: unknown[]) => mockWatcherStart(...args),
    stop: (...args: unknown[]) => mockWatcherStop(...args),
    destroy: (...args: unknown[]) => mockWatcherDestroy(...args),
    getState: (...args: unknown[]) => mockWatcherGetState(...args),
    isRunning: (...args: unknown[]) => mockWatcherIsRunning(...args),
    getRoot: (...args: unknown[]) => mockWatcherGetRoot(...args),
    onEvent: (...args: unknown[]) => mockWatcherOnEvent(...args),
    onError: (...args: unknown[]) => mockWatcherOnError(...args),
    onStateChange: (...args: unknown[]) => mockWatcherOnStateChange(...args),
    removeAllListeners: (...args: unknown[]) => mockWatcherRemoveAllListeners(...args)
  }))
}))

// Mock menu module
const mockRefreshAppMenu = vi.fn()
const mockUpdateWindowMenuContext = vi.fn()
const mockClearWindowMenuContext = vi.fn()
vi.mock('../../src/main/menu', () => ({
  refreshAppMenu: (...args: unknown[]) => mockRefreshAppMenu(...args),
  updateWindowMenuContext: (...args: unknown[]) => mockUpdateWindowMenuContext(...args),
  clearWindowMenuContext: (...args: unknown[]) => mockClearWindowMenuContext(...args)
}))

// Mock Obsidian topic auto-import & sync (phase 44)
const mockMaybeSyncObsidianTopics = vi.fn().mockResolvedValue(undefined)
const mockScheduleObsidianSync = vi.fn()
const mockCancelScheduledObsidianSyncs = vi.fn()
const mockWatchObsidianConfig = vi.fn()
vi.mock('../../src/main/obsidian-import', () => ({
  maybeSyncObsidianTopics: (...args: unknown[]) => mockMaybeSyncObsidianTopics(...args),
  scheduleObsidianSync: (...args: unknown[]) => mockScheduleObsidianSync(...args),
  cancelScheduledObsidianSyncs: (...args: unknown[]) => mockCancelScheduledObsidianSyncs(...args),
  watchObsidianConfig: (...args: unknown[]) => mockWatchObsidianConfig(...args)
}))

const mockReadImageFile = vi.fn()
const mockEditImageFile = vi.fn()
const mockCancelImageEdit = vi.fn()
vi.mock('../../src/main/image-editor', () => ({
  readImageFile: (...args: unknown[]) => mockReadImageFile(...args),
  editImageFile: (...args: unknown[]) => mockEditImageFile(...args),
  cancelImageEdit: (...args: unknown[]) => mockCancelImageEdit(...args)
}))

// Mock updater module (the AppUpdater singleton lives here since phase 43)
const makeMockUpdater = (): Record<string, ReturnType<typeof vi.fn>> => ({
  setWindowManager: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  checkForUpdates: vi.fn(),
  downloadUpdate: vi.fn(),
  quitAndInstall: vi.fn(),
  skipVersion: vi.fn(),
  clearSkippedVersion: vi.fn(),
  getState: vi.fn().mockReturnValue('idle'),
  destroy: vi.fn()
})
vi.mock('../../src/main/updater', () => {
  let singleton: Record<string, ReturnType<typeof vi.fn>> | null = null
  return {
    AppUpdater: vi.fn().mockImplementation(() => makeMockUpdater()),
    getAppUpdater: vi.fn(() => {
      if (!singleton) singleton = makeMockUpdater()
      return singleton
    }),
    destroyAppUpdater: vi.fn(() => {
      singleton = null
    })
  }
})

// Mock electron-updater
vi.mock('electron-updater', () => ({
  autoUpdater: {
    autoDownload: false,
    autoInstallOnAppQuit: true,
    on: vi.fn(),
    removeAllListeners: vi.fn(),
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn()
  }
}))

// Mock @electron-toolkit/utils
vi.mock('@electron-toolkit/utils', () => ({
  is: { dev: true }
}))

// Mock electron shell, clipboard, and BrowserWindow
const mockShellOpenPath = vi.fn()
const mockClipboardWriteText = vi.fn()
const mockFromWebContents = vi.fn()
const mockShowMessageBox = vi.fn()
vi.mock('electron', () => ({
  app: {
    getVersion: () => '1.0.0-test',
    getPath: vi.fn().mockReturnValue('/Users/test/Documents')
  },
  ipcMain: {
    handle: (...args: unknown[]) => mockHandle(...args),
    on: vi.fn()
  },
  shell: {
    showItemInFolder: vi.fn(),
    openPath: (...args: unknown[]) => mockShellOpenPath(...args)
  },
  clipboard: {
    writeText: (...args: unknown[]) => mockClipboardWriteText(...args)
  },
  dialog: {
    showMessageBox: (...args: unknown[]) => mockShowMessageBox(...args)
  },
  BrowserWindow: {
    fromWebContents: (...args: unknown[]) => mockFromWebContents(...args)
  }
}))

import { registerIpcHandlers } from '../../src/main/ipc-handlers'
import { clearGraphSnapshotCache } from '../../src/main/graph-snapshot-cache'
import { clearOwnWrites, matchAndConsumeOwnWrite } from '../../src/main/own-writes'

/** Create a mock WindowManager with all required methods */
function createMockWindowManager() {
  const mockBroadcastToAll = vi.fn()
  const mockCreateWindow = vi.fn()
  const mockGetAllWindows = vi.fn().mockReturnValue([])
  const mockGetWindow = vi.fn()
  const mockCloseWindow = vi.fn()
  const mockIsPrimary = vi.fn().mockReturnValue(true)
  const mockUpdateTitleBarOverlay = vi.fn()
  const mockConfirmClose = vi.fn()
  const mockCancelAppQuit = vi.fn()
  const mockClearCloseTimer = vi.fn()
  const mockIsPopup = vi.fn().mockReturnValue(false)
  const mockSetWindowCollectionId = vi.fn()

  const wm = {
    broadcastToAll: mockBroadcastToAll,
    createWindow: mockCreateWindow,
    getAllWindows: mockGetAllWindows,
    getWindow: mockGetWindow,
    closeWindow: mockCloseWindow,
    isPrimary: mockIsPrimary,
    updateTitleBarOverlay: mockUpdateTitleBarOverlay,
    confirmClose: mockConfirmClose,
    cancelAppQuit: mockCancelAppQuit,
    clearCloseTimer: mockClearCloseTimer,
    isPopup: mockIsPopup,
    setWindowCollectionId: mockSetWindowCollectionId
  } as unknown as WindowManager

  return {
    wm,
    mockBroadcastToAll,
    mockCreateWindow,
    mockGetAllWindows,
    mockGetWindow,
    mockIsPrimary,
    mockCloseWindow,
    mockUpdateTitleBarOverlay,
    mockConfirmClose,
    mockCancelAppQuit,
    mockClearCloseTimer,
    mockIsPopup,
    mockSetWindowCollectionId
  }
}

beforeEach(() => {
  clearGraphSnapshotCache()
  clearOwnWrites()
  mockHandle.mockReset()
  mockFindCli.mockReset()
  mockGetCliVersion.mockReset()
  mockExecCommand.mockReset()
  mockExecRaw.mockReset()
  mockExecModuleTransaction
    .mockReset()
    .mockImplementation(
      async (
        root: string,
        moduleId: string,
        scope: string | null,
        mutate: () => Promise<unknown>
      ) => {
        const value = await mutate()
        const args = ['run', moduleId]
        if (scope) args.push('--path', scope)
        const response = await mockExecCommand('modules', args, root, { timeout: 300_000 })
        return { value, response }
      }
    )
  mockGetCollections.mockReset()
  mockAddCollection.mockReset()
  mockRemoveCollection.mockReset()
  mockSetActiveCollection.mockReset()
  mockGetActiveCollection.mockReset()
  mockGetCollectionSkillsDismissed.mockReset().mockReturnValue(false)
  mockSetCollectionSkillsDismissed.mockReset()
  mockGetActiveShardId.mockReset()
  mockSetActiveShardId.mockReset()
  mockCheckCollectionSkills.mockReset()
  mockInstallCollectionSkills.mockReset()
  mockPickCollectionFolder.mockReset()
  mockValidateCollectionPath.mockReset()
  mockInitCollection.mockReset()
  mockConfirmRemoveCollection.mockReset()
  mockPromptInitCollection.mockReset()
  mockCreateExampleCollection.mockReset()
  mockReadFile.mockReset()
  mockWriteFile.mockReset()
  mockAtomicTempWriteFile.mockReset().mockResolvedValue(undefined)
  mockHandleChmod.mockReset().mockResolvedValue(undefined)
  mockHandleSync.mockReset().mockResolvedValue(undefined)
  mockHandleClose.mockReset().mockResolvedValue(undefined)
  mockOpen.mockReset().mockImplementation(async (path: string) => ({
    writeFile: (content: string | Buffer, encoding?: string) =>
      mockAtomicTempWriteFile(path, content, encoding),
    chmod: (...args: unknown[]) => mockHandleChmod(...args),
    sync: (...args: unknown[]) => mockHandleSync(...args),
    close: (...args: unknown[]) => mockHandleClose(...args)
  }))
  mockLstat.mockReset().mockResolvedValue({
    isSymbolicLink: () => false,
    nlink: 1,
    dev: 1,
    ino: 2,
    mode: 0o100644
  })
  mockRealpath.mockReset().mockImplementation(async (path: string) => path)
  mockRename.mockReset().mockResolvedValue(undefined)
  mockRm.mockReset().mockResolvedValue(undefined)
  mockLink.mockReset().mockResolvedValue(undefined)
  mockMkdir.mockReset().mockResolvedValue(undefined)
  mockAccess.mockReset()
  mockStat.mockReset()
  mockWatcherStart.mockReset()
  mockWatcherStop.mockReset()
  mockWatcherDestroy.mockReset()
  mockWatcherGetState.mockReset()
  mockWatcherIsRunning.mockReset()
  mockWatcherGetRoot.mockReset()
  mockWatcherOnEvent.mockReset()
  mockWatcherOnError.mockReset()
  mockWatcherOnStateChange.mockReset()
  mockWatcherRemoveAllListeners.mockReset()
  mockRefreshAppMenu.mockReset()
  mockMaybeSyncObsidianTopics.mockReset().mockResolvedValue(undefined)
  mockScheduleObsidianSync.mockReset()
  mockCancelScheduledObsidianSyncs.mockReset()
  mockWatchObsidianConfig.mockReset()
  mockReadImageFile.mockReset()
  mockEditImageFile.mockReset()
  mockCancelImageEdit.mockReset()
  mockCaptureOverlaySnapshot
    .mockReset()
    .mockResolvedValue({ existed: true, content: '# original\n' })
  mockRestoreOverlaySnapshot.mockReset().mockResolvedValue(undefined)
  mockResolveOverlayFormulaScope.mockReset().mockResolvedValue(undefined)
  mockResolveOverlayLookupRollupScope.mockReset().mockResolvedValue(undefined)
  mockResolveOverlayLookupRollupDefinition.mockReset().mockResolvedValue(undefined)
  mockUpsertOverlayField.mockReset().mockResolvedValue(undefined)
  mockRemoveOverlayField.mockReset().mockResolvedValue(true)
  mockReadOverlayValueColors.mockReset().mockResolvedValue({})
  mockSetOverlayValueColor.mockReset().mockResolvedValue({})
  mockRenameOverlayField.mockReset().mockResolvedValue(false)
  mockRenamePropertyInViews.mockReset().mockResolvedValue(undefined)
  mockAssertComputedOutputKeyAbsentOnDisk.mockReset().mockResolvedValue(undefined)
  mockShellOpenPath.mockReset()
  mockClipboardWriteText.mockReset()
  mockFromWebContents.mockReset()
  mockShowMessageBox.mockReset()
  mockUpdateWindowMenuContext.mockReset()
  mockClearWindowMenuContext.mockReset()
})

describe('registerIpcHandlers', () => {
  it('registers all expected IPC channels', () => {
    const { wm } = createMockWindowManager()
    registerIpcHandlers(wm)

    const channels = mockHandle.mock.calls.map((call: unknown[]) => call[0])
    expect(channels).toContain('cli:find')
    expect(channels).toContain('menu:set-context')
    expect(channels).toContain('cli:version')
    expect(channels).toContain('cli:search')
    expect(channels).toContain('cli:status')
    expect(channels).toContain('cli:ingest')
    expect(channels).toContain('cli:ingest-preview')
    expect(channels).toContain('cli:tree')
    expect(channels).toContain('cli:get')
    expect(channels).toContain('cli:links')
    expect(channels).toContain('cli:backlinks')
    expect(channels).toContain('cli:orphans')
    expect(channels).toContain('cli:clusters')
    expect(channels).toContain('cli:schema')
    expect(channels).toContain('cli:config')
    expect(channels).toContain('cli:doctor')
    expect(channels).toContain('cli:info')
    expect(channels).toContain('cli:init')
    expect(channels).toContain('cli:shards-list')
    expect(channels).toContain('cli:shards-get')
    expect(channels).toContain('cli:shards-add')
    expect(channels).toContain('cli:shards-update')
    expect(channels).toContain('cli:shards-remove')
    expect(channels).toContain('cli:shards-retarget')
    expect(channels).toContain('store:get-active-shard-id')
    expect(channels).toContain('store:set-active-shard-id')
    expect(channels).toContain('fs:file-thumbnail')
    expect(channels).toContain('link-preview:external')
    expect(channels).toContain('link-preview:local')
    expect(channels).toContain('collections:list')
    expect(channels).toContain('collections:add')
    expect(channels).toContain('collections:create-example')
    expect(channels).toContain('collections:remove')
    expect(channels).toContain('collections:set-active')
    expect(channels).toContain('collections:get-active')
    expect(channels).toContain('skills:check-collection')
    expect(channels).toContain('skills:install-collection')
    expect(channels).toContain('skills:set-collection-dismissed')
    expect(channels).toContain('fs:read-file')
    expect(channels).toContain('fs:write-file')
    expect(channels).toContain('fs:write-file-if-unchanged')
    expect(channels).toContain('fs:create-binary')
    expect(channels).toContain('fs:read-image')
    expect(channels).toContain('fs:edit-image')
    expect(channels).toContain('fs:cancel-image-edit')
    expect(channels).toContain('shell:show-item-in-folder')
    expect(channels).toContain('cli:ingest-file')
    expect(channels).toContain('watcher:start')
    expect(channels).toContain('watcher:stop')
    expect(channels).toContain('watcher:status')
    expect(channels).toContain('shell:open-path')
    expect(channels).toContain('clipboard:write-text')
    expect(channels).toContain('dialog:confirm')
    expect(channels).toContain('dialog:message')
    expect(channels).toContain('updater:app-version')
    expect(channels).toContain('window:new')
    expect(channels).toContain('tab:detach')
    expect(channels).toContain('tab:attach')
    expect(channels).toContain('session:save')
    expect(channels).toContain('session:get')
    expect(channels).toContain('store:get-zoom-level')
    expect(channels).toContain('store:set-zoom-level')
    expect(channels).toContain('cli:reset-index')
    expect(channels).toContain('cli:neighborhood')
    expect(channels).toContain('store:get-primary-color')
    expect(channels).toContain('store:set-primary-color')
    expect(channels).toContain('store:get-collection-color')
    expect(channels).toContain('store:set-collection-color')
    expect(channels).toContain('schema:get-value-colors')
    expect(channels).toContain('schema:set-value-color')
    expect(channels).toContain('store:get-theme')
    expect(channels).toContain('store:set-theme')
    expect(channels).toContain('store:get-collection-theme')
    expect(channels).toContain('store:set-collection-theme')
    expect(channels).toContain('store:get-terminal-shell-path')
    expect(channels).toContain('store:set-terminal-shell-path')
    expect(channels).toContain('store:get-terminal-shell-args')
    expect(channels).toContain('store:set-terminal-shell-args')
    expect(channels).toContain('store:get-terminal-font-size')
    expect(channels).toContain('store:set-terminal-font-size')
    expect(channels).toContain('os:homedir')
    // Collection (folder-as-table) + saved table views + frontmatter writer (phase-39)
    expect(channels).toContain('cli:collection')
    expect(channels).toContain('fs:update-frontmatter')
    expect(channels).toContain('tableviews:list')
    expect(channels).toContain('tableviews:get-default-columns')
    expect(channels).toContain('tableviews:save-default-columns')
    expect(channels).toContain('tableviews:save')
    expect(channels).toContain('tableviews:update')
    expect(channels).toContain('tableviews:delete')
    expect(channels).toContain('tableviews:set-default')
    // Vault watcher (Tier-1 raw fs events) + diff auto-show setting
    expect(channels).toContain('vault-watcher:status')
    expect(channels).toContain('store:get-auto-show-diff')
    expect(channels).toContain('store:set-auto-show-diff')
    // Persisted per-collection mdvdb watcher enabled state
    expect(channels).toContain('store:get-watcher-enabled')
    expect(channels).toContain('store:set-watcher-enabled')
    // Topics (custom clusters) management + generic YAML config write
    expect(channels).toContain('cli:clusters-add')
    expect(channels).toContain('cli:clusters-update')
    expect(channels).toContain('cli:clusters-remove')
    expect(channels).toContain('cli:clusters-unassigned')
    expect(channels).toContain('cli:config-set')
    // Property type conversion / schema-overlay editing (phase 41)
    expect(channels).toContain('schema:preview-property-op')
    expect(channels).toContain('schema:apply-property-op')
    expect(channels).toContain('schema:update-overlay-field')
    expect(channels).toContain('cli:modules-validate-formula')
    expect(channels).toContain('cli:modules-run-formula')
    expect(channels).toContain('schema:save-formula')
    expect(channels).toContain('schema:remove-formula')
    expect(channels).toContain('cli:modules-list')
    expect(channels).toContain('cli:modules-validate-rollup')
    expect(channels).toContain('schema:save-lookup-rollup')
    expect(channels).toContain('schema:remove-lookup-rollup')
    // Export via native save dialog (phase 43)
    expect(channels).toContain('export:save')
    expect(channels).toContain('export:pdf')
    // Dirty-close guard (data safety)
    expect(channels).toContain('app:confirm-close')
    expect(channels).toContain('app:cancel-close')
    expect(channels).toContain('cli:embedding-models')
    expect(channels).toContain('cli:embedding-probe')
    expect(channels).toHaveLength(162)
  })
})

describe('IPC handler argument passing', () => {
  it('opens a validated collection in a new full window', async () => {
    mockGetCollections.mockReturnValue([
      { id: 'vault-1', name: 'Vault', path: '/tmp/project', addedAt: 1, lastOpenedAt: 1 }
    ])
    const { wm, mockCreateWindow } = createMockWindowManager()
    registerIpcHandlers(wm)
    const registration = mockHandle.mock.calls.find((call: unknown[]) => call[0] === 'window:new')
    const handler = registration?.[1] as (...args: unknown[]) => Promise<unknown>

    await handler(fakeEvent, 'vault-1')

    expect(mockCreateWindow).toHaveBeenCalledWith({ collectionId: 'vault-1' })
  })

  it('tracks collection switches for the requesting window', async () => {
    mockGetActiveCollection.mockReturnValue(null)
    const { wm, mockSetWindowCollectionId } = createMockWindowManager()
    registerIpcHandlers(wm)
    const registration = mockHandle.mock.calls.find(
      (call: unknown[]) => call[0] === 'collections:set-active'
    )
    const handler = registration?.[1] as (...args: unknown[]) => Promise<unknown>

    await handler({ sender: { id: 42 } }, 'vault-2')

    expect(mockSetWindowCollectionId).toHaveBeenCalledWith(42, 'vault-2')
  })

  /** Helper: register handlers, find the one for `channel`, invoke it */
  function getHandler(channel: string): (...args: unknown[]) => Promise<unknown> {
    const { wm } = createMockWindowManager()
    registerIpcHandlers(wm)
    const call = mockHandle.mock.calls.find((c: unknown[]) => c[0] === channel)
    if (!call) throw new Error(`No handler for channel: ${channel}`)
    return call[1] as (...args: unknown[]) => Promise<unknown>
  }

  const fakeEvent = { sender: { id: 1 } } // IPC event stub

  describe('menu:set-context', () => {
    it('validates, stores, and clears graph menu state per renderer', async () => {
      const handler = getHandler('menu:set-context')
      const once = vi.fn()
      const event = { sender: { id: 4242, once } }
      const context = {
        active: true,
        ready: true,
        presentationState: 'paused',
        level: 'chunk',
        coloringMode: 'folder',
        unconnectedCount: 3
      }

      await handler(event, context)

      expect(mockUpdateWindowMenuContext).toHaveBeenCalledWith(4242, context)
      expect(once).toHaveBeenCalledWith('destroyed', expect.any(Function))
      const destroyHandler = once.mock.calls[0][1] as () => void
      destroyHandler()
      expect(mockClearWindowMenuContext).toHaveBeenCalledWith(4242)
    })

    it('rejects malformed or unknown graph menu state', async () => {
      const handler = getHandler('menu:set-context')
      const event = { sender: { id: 4243, once: vi.fn() } }

      const wrongType = await handler(event, { active: 'yes' })
      const unknownField = await handler(event, { active: true, surprise: true })

      expect(wrongType).toMatchObject({ error: true })
      expect(unknownField).toMatchObject({ error: true })
      expect(mockUpdateWindowMenuContext).not.toHaveBeenCalled()
    })
  })

  describe('cli:find', () => {
    it('calls findCli', async () => {
      mockFindCli.mockResolvedValue('/usr/local/bin/mdvdb')
      const handler = getHandler('cli:find')
      const result = await handler()
      expect(result).toBe('/usr/local/bin/mdvdb')
      expect(mockFindCli).toHaveBeenCalled()
    })
  })

  describe('cli:version', () => {
    it('calls getCliVersion', async () => {
      mockGetCliVersion.mockResolvedValue('0.1.0')
      const handler = getHandler('cli:version')
      const result = await handler()
      expect(result).toBe('0.1.0')
      expect(mockGetCliVersion).toHaveBeenCalled()
    })
  })

  describe('named Shards', () => {
    it('constructs add and update arguments without leaking undefined options', async () => {
      mockExecCommand.mockResolvedValue({ action: 'added', shards: [] })
      const add = getHandler('cli:shards-add')
      await add(fakeEvent, '/tmp/project', 'deep-work', 'work/deep', {
        name: 'Deep Work',
        createDir: true
      })

      expect(mockExecCommand).toHaveBeenCalledWith(
        'shards',
        ['add', 'deep-work', '--path', 'work/deep', '--name', 'Deep Work', '--create-dir'],
        '/tmp/project'
      )

      mockExecCommand.mockClear()
      const update = getHandler('cli:shards-update')
      await update(fakeEvent, '/tmp/project', 'deep-work', {
        path: 'archive/deep',
        name: ''
      })

      expect(mockExecCommand).toHaveBeenCalledWith(
        'shards',
        ['update', 'deep-work', '--name', '', '--path', 'archive/deep'],
        '/tmp/project'
      )
    })

    it('passes list, get, remove, and retarget through their stable CLI contracts', async () => {
      mockExecCommand.mockResolvedValue({ shards: [], total_shards: 0 })

      await getHandler('cli:shards-list')(fakeEvent, '/tmp/project')
      await getHandler('cli:shards-get')(fakeEvent, '/tmp/project', 'research')
      await getHandler('cli:shards-remove')(fakeEvent, '/tmp/project', 'research')
      await getHandler('cli:shards-retarget')(
        fakeEvent,
        '/tmp/project',
        'work/research',
        'archive/research'
      )

      expect(mockExecCommand).toHaveBeenNthCalledWith(1, 'shards', ['list'], '/tmp/project')
      expect(mockExecCommand).toHaveBeenNthCalledWith(
        2,
        'shards',
        ['get', 'research'],
        '/tmp/project'
      )
      expect(mockExecCommand).toHaveBeenNthCalledWith(
        3,
        'shards',
        ['remove', 'research'],
        '/tmp/project'
      )
      expect(mockExecCommand).toHaveBeenNthCalledWith(
        4,
        'shards',
        ['retarget', 'work/research', 'archive/research'],
        '/tmp/project'
      )
    })

    it('persists the selected Shard only for a registered collection', async () => {
      mockGetCollections.mockReturnValue([{ id: 'vault-1' }])
      mockGetActiveShardId.mockReturnValue('research')

      const getSelected = getHandler('store:get-active-shard-id')
      const setSelected = getHandler('store:set-active-shard-id')

      await expect(getSelected(fakeEvent, 'vault-1')).resolves.toBe('research')
      await expect(setSelected(fakeEvent, 'vault-1', 'research')).resolves.toBeUndefined()
      expect(mockGetActiveShardId).toHaveBeenCalledWith('vault-1')
      expect(mockSetActiveShardId).toHaveBeenCalledWith('vault-1', 'research')

      await expect(setSelected(fakeEvent, 'missing', null)).resolves.toMatchObject({
        error: true,
        message: 'Collection not found: missing'
      })
      expect(mockSetActiveShardId).toHaveBeenCalledTimes(1)
    })

    it('retargets contained Shards after an in-app directory rename', async () => {
      mockGetCollections.mockReturnValue([
        {
          id: 'vault-1',
          name: 'Vault',
          path: '/tmp/project',
          addedAt: 1,
          lastOpenedAt: 1
        }
      ])
      mockAccess.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }))
      mockStat.mockResolvedValue({ isDirectory: () => true })
      mockExecCommand
        .mockResolvedValueOnce({
          shards: [
            {
              id: 'research',
              name: 'Research',
              path: 'work/research',
              parent_id: null,
              exists: true
            }
          ],
          total_shards: 1
        })
        .mockResolvedValueOnce({ action: 'retarget', shards: [] })

      const handler = getHandler('fs:rename-file')
      await handler(fakeEvent, '/tmp/project/work', '/tmp/project/archive')

      expect(mockRename).toHaveBeenCalledWith('/tmp/project/work', '/tmp/project/archive')
      expect(mockExecCommand).toHaveBeenNthCalledWith(
        2,
        'shards',
        ['retarget', 'work', 'archive'],
        '/tmp/project'
      )
    })

    it('rolls the directory rename back when Shard retargeting fails', async () => {
      mockGetCollections.mockReturnValue([
        {
          id: 'vault-1',
          name: 'Vault',
          path: '/tmp/project',
          addedAt: 1,
          lastOpenedAt: 1
        }
      ])
      mockAccess.mockRejectedValue(Object.assign(new Error('missing'), { code: 'ENOENT' }))
      mockStat.mockResolvedValue({ isDirectory: () => true })
      mockExecCommand
        .mockResolvedValueOnce({
          shards: [
            {
              id: 'research',
              name: 'Research',
              path: 'work/research',
              parent_id: null,
              exists: true
            }
          ],
          total_shards: 1
        })
        .mockRejectedValueOnce(new Error('manifest locked'))

      const handler = getHandler('fs:rename-file')
      const result = await handler(fakeEvent, '/tmp/project/work', '/tmp/project/archive')

      expect(mockRename).toHaveBeenNthCalledWith(1, '/tmp/project/work', '/tmp/project/archive')
      expect(mockRename).toHaveBeenNthCalledWith(2, '/tmp/project/archive', '/tmp/project/work')
      expect(result).toMatchObject({ error: true, message: 'manifest locked' })
    })
  })

  describe('cli:search', () => {
    it('passes query as first arg', async () => {
      mockExecCommand.mockResolvedValue({ results: [], query: 'test', total_results: 0 })
      const handler = getHandler('cli:search')
      await handler(fakeEvent, '/tmp/project', 'test')

      expect(mockExecCommand).toHaveBeenCalledWith('search', ['test'], '/tmp/project')
    })

    it('passes search options as CLI args', async () => {
      mockExecCommand.mockResolvedValue({ results: [], query: 'test', total_results: 0 })
      const handler = getHandler('cli:search')
      await handler(fakeEvent, '/tmp/project', 'test', {
        limit: 5,
        mode: 'semantic',
        path: 'docs/',
        filter: 'status:published'
      })

      const args = mockExecCommand.mock.calls[0][1] as string[]
      expect(args).toContain('test')
      expect(args).toContain('--limit')
      expect(args).toContain('5')
      expect(args).toContain('--mode')
      expect(args).toContain('semantic')
      expect(args).toContain('--path')
      expect(args).toContain('docs/')
      expect(args).toContain('--filter')
      expect(args).toContain('status:published')
    })

    it('omits undefined options', async () => {
      mockExecCommand.mockResolvedValue({ results: [], query: 'q', total_results: 0 })
      const handler = getHandler('cli:search')
      await handler(fakeEvent, '/tmp/project', 'q', {})

      const args = mockExecCommand.mock.calls[0][1] as string[]
      expect(args).toEqual(['q'])
    })
  })

  describe('cli:status', () => {
    it('calls execCommand with status and empty args', async () => {
      mockExecCommand.mockResolvedValue({ document_count: 5 })
      const handler = getHandler('cli:status')
      await handler(fakeEvent, '/tmp/project')

      expect(mockExecCommand).toHaveBeenCalledWith('status', [], '/tmp/project')
    })
  })

  describe('formula module bridge', () => {
    const successfulReport = {
      module: 'formula',
      event: 'manual_run',
      files_evaluated: 1,
      fields_updated: 1,
      diagnostics: [],
      duration_ms: 2
    }

    const failedReport = {
      ...successfulReport,
      fields_updated: 0,
      diagnostics: [
        {
          module: 'formula',
          path: null,
          field: '',
          code: 'module_error',
          message: 'formula hook failed',
          span_start: null,
          span_end: null
        }
      ]
    }

    it('passes JavaScript source and normalized result type to validation', async () => {
      mockExecCommand.mockResolvedValue({ valid: true, diagnostics: [] })
      const handler = getHandler('cli:modules-validate-formula')
      await handler(fakeEvent, '/tmp/project', 'price * quantity', 'Number')

      expect(mockExecCommand).toHaveBeenCalledWith(
        'modules',
        ['validate', 'formula', '--formula', 'price * quantity', '--result-type', 'number'],
        '/tmp/project'
      )
    })

    it('runs the formula module for a normalized non-root scope', async () => {
      mockExecCommand.mockResolvedValue({ module: 'formula' })
      const handler = getHandler('cli:modules-run-formula')
      await handler(fakeEvent, '/tmp/project', 'invoices/')

      expect(mockExecCommand).toHaveBeenCalledWith(
        'modules',
        ['run', 'formula', '--path', 'invoices'],
        '/tmp/project',
        { timeout: 300_000 }
      )
    })

    it('omits --path for the vault root', async () => {
      mockExecCommand.mockResolvedValue({ module: 'formula' })
      const handler = getHandler('cli:modules-run-formula')
      await handler(fakeEvent, '/tmp/project', '.')

      expect(mockExecCommand).toHaveBeenCalledWith('modules', ['run', 'formula'], '/tmp/project', {
        timeout: 300_000
      })
    })

    it('restores the overlay and recomputes old formulas inside a second transaction', async () => {
      mockGetCollections.mockReturnValue([
        { id: 'vault-1', name: 'Vault', path: '/tmp/project', addedAt: 1, lastOpenedAt: 1 }
      ])
      mockExecCommand
        .mockResolvedValueOnce({ valid: true, diagnostics: [] })
        .mockResolvedValueOnce(failedReport)
        .mockResolvedValueOnce(successfulReport)
      mockCaptureOverlaySnapshot
        .mockResolvedValueOnce({ existed: true, content: '# original\n' })
        .mockResolvedValueOnce({ existed: true, content: '# mutated\n' })
      const handler = getHandler('schema:save-formula')

      const result = await handler(
        fakeEvent,
        'vault-1',
        'invoices/2026',
        'total',
        'price * quantity',
        'Number'
      )

      expect(mockCaptureOverlaySnapshot).toHaveBeenCalledWith('/tmp/project')
      expect(mockResolveOverlayFormulaScope).toHaveBeenCalledWith(
        '/tmp/project',
        'invoices/2026',
        'total'
      )
      expect(mockUpsertOverlayField).toHaveBeenCalledWith(
        '/tmp/project',
        'invoices/2026',
        'total',
        {
          fieldType: 'formula',
          formula: 'price * quantity',
          resultType: 'Number'
        },
        expect.objectContaining({ onPublished: expect.any(Function) })
      )
      expect(mockRestoreOverlaySnapshot).toHaveBeenCalledWith(
        '/tmp/project',
        {
          existed: true,
          content: '# original\n'
        },
        {
          existed: true,
          content: '# mutated\n'
        }
      )
      expect(mockExecModuleTransaction).toHaveBeenCalledTimes(2)
      expect(mockExecModuleTransaction).toHaveBeenNthCalledWith(
        2,
        '/tmp/project',
        'formula',
        null,
        expect.any(Function)
      )
      expect(mockExecModuleTransaction.mock.invocationCallOrder[1]).toBeLessThan(
        mockRestoreOverlaySnapshot.mock.invocationCallOrder[0]
      )
      expect(mockExecCommand).toHaveBeenNthCalledWith(
        2,
        'modules',
        ['run', 'formula'],
        '/tmp/project',
        { timeout: 300_000 }
      )
      expect(mockExecCommand).toHaveBeenNthCalledWith(
        3,
        'modules',
        ['run', 'formula'],
        '/tmp/project',
        { timeout: 300_000 }
      )
      expect(result).toMatchObject({
        error: true,
        message: 'Formula module failed: formula hook failed'
      })
    })

    it('reports an overlay rollback failure when the transactional CAS restore fails', async () => {
      mockGetCollections.mockReturnValue([
        { id: 'vault-1', name: 'Vault', path: '/tmp/project', addedAt: 1, lastOpenedAt: 1 }
      ])
      mockExecCommand
        .mockResolvedValueOnce({ valid: true, diagnostics: [] })
        .mockResolvedValueOnce(failedReport)
      mockCaptureOverlaySnapshot
        .mockResolvedValueOnce({ existed: true, content: '# original\n' })
        .mockResolvedValueOnce({ existed: true, content: '# mutated\n' })
      mockRestoreOverlaySnapshot.mockRejectedValueOnce(new Error('overlay changed concurrently'))
      const handler = getHandler('schema:save-formula')

      const result = await handler(
        fakeEvent,
        'vault-1',
        'invoices',
        'total',
        'price * quantity',
        'Number'
      )

      expect(mockExecModuleTransaction).toHaveBeenCalledTimes(2)
      expect(result).toMatchObject({
        error: true,
        message:
          'Formula module failed: formula hook failed; overlay rollback failed: overlay changed concurrently'
      })
    })

    it('rolls back a published overlay when post-publication durability reporting fails', async () => {
      mockGetCollections.mockReturnValue([
        { id: 'vault-1', name: 'Vault', path: '/tmp/project', addedAt: 1, lastOpenedAt: 1 }
      ])
      const published = { existed: true, content: '# published formula\n' }
      mockExecCommand
        .mockResolvedValueOnce({ valid: true, diagnostics: [] })
        .mockResolvedValueOnce(successfulReport)
      mockCaptureOverlaySnapshot.mockResolvedValueOnce({ existed: true, content: '# original\n' })
      mockUpsertOverlayField.mockImplementationOnce(async (...args: unknown[]) => {
        const options = args[4] as { onPublished?: (snapshot: unknown) => void }
        options.onPublished?.(published)
        throw new Error('directory fsync failed after rename')
      })
      const handler = getHandler('schema:save-formula')

      const result = await handler(
        fakeEvent,
        'vault-1',
        'invoices',
        'total',
        'price * quantity',
        'Number'
      )

      expect(mockRestoreOverlaySnapshot).toHaveBeenCalledWith(
        '/tmp/project',
        { existed: true, content: '# original\n' },
        published
      )
      expect(mockCaptureOverlaySnapshot).toHaveBeenCalledTimes(1)
      expect(mockExecModuleTransaction).toHaveBeenCalledTimes(2)
      expect(result).toMatchObject({
        error: true,
        message: 'directory fsync failed after rename'
      })
    })

    it('reports rollback recompute separately after a successful transactional restore', async () => {
      mockGetCollections.mockReturnValue([
        { id: 'vault-1', name: 'Vault', path: '/tmp/project', addedAt: 1, lastOpenedAt: 1 }
      ])
      mockExecCommand
        .mockResolvedValueOnce({ valid: true, diagnostics: [] })
        .mockResolvedValueOnce(failedReport)
        .mockRejectedValueOnce(new Error('recompute process failed'))
      mockCaptureOverlaySnapshot
        .mockResolvedValueOnce({ existed: true, content: '# original\n' })
        .mockResolvedValueOnce({ existed: true, content: '# mutated\n' })
      const handler = getHandler('schema:save-formula')

      const result = await handler(
        fakeEvent,
        'vault-1',
        'invoices',
        'total',
        'price * quantity',
        'Number'
      )

      expect(mockRestoreOverlaySnapshot).toHaveBeenCalledOnce()
      expect(result).toMatchObject({
        error: true,
        message:
          'Formula module failed: formula hook failed; rollback recompute failed: recompute process failed'
      })
    })

    it('removes an inherited formula from its definition scope', async () => {
      mockGetCollections.mockReturnValue([
        { id: 'vault-1', name: 'Vault', path: '/tmp/project', addedAt: 1, lastOpenedAt: 1 }
      ])
      mockResolveOverlayFormulaScope.mockResolvedValue('invoices')
      mockExecCommand.mockResolvedValue(successfulReport)
      const handler = getHandler('schema:remove-formula')

      const result = await handler(fakeEvent, 'vault-1', 'invoices/2026', 'total')

      expect(mockResolveOverlayFormulaScope).toHaveBeenCalledWith(
        '/tmp/project',
        'invoices/2026',
        'total'
      )
      expect(mockRemoveOverlayField).toHaveBeenCalledWith(
        '/tmp/project',
        'invoices',
        'total',
        expect.objectContaining({ onPublished: expect.any(Function) })
      )
      expect(mockExecCommand).toHaveBeenCalledWith('modules', ['run', 'formula'], '/tmp/project', {
        timeout: 300_000
      })
      expect(result).toEqual(successfulReport)
    })

    it('accepts schema_overlay_missing when removing the final formula definition', async () => {
      mockGetCollections.mockReturnValue([
        { id: 'vault-1', name: 'Vault', path: '/tmp/project', addedAt: 1, lastOpenedAt: 1 }
      ])
      mockResolveOverlayFormulaScope.mockResolvedValue('invoices')
      const cleanupReport = {
        ...successfulReport,
        fields_updated: 0,
        diagnostics: [
          {
            module: 'formula',
            path: null,
            field: '',
            code: 'schema_overlay_missing',
            message: 'schema overlay is absent after cleanup',
            span_start: null,
            span_end: null
          }
        ]
      }
      mockExecCommand.mockResolvedValue(cleanupReport)
      const handler = getHandler('schema:remove-formula')

      const result = await handler(fakeEvent, 'vault-1', 'invoices', 'total')

      expect(result).toEqual(cleanupReport)
      expect(mockRestoreOverlaySnapshot).not.toHaveBeenCalled()
      expect(mockExecCommand).toHaveBeenCalledTimes(1)
    })

    it('restores the inherited definition when remove reports module_error', async () => {
      mockGetCollections.mockReturnValue([
        { id: 'vault-1', name: 'Vault', path: '/tmp/project', addedAt: 1, lastOpenedAt: 1 }
      ])
      mockResolveOverlayFormulaScope.mockResolvedValue('invoices')
      mockExecCommand.mockResolvedValueOnce(failedReport).mockResolvedValueOnce(successfulReport)
      mockCaptureOverlaySnapshot
        .mockResolvedValueOnce({ existed: true, content: '# original\n' })
        .mockResolvedValueOnce({ existed: true, content: '# mutated\n' })
      const handler = getHandler('schema:remove-formula')

      const result = await handler(fakeEvent, 'vault-1', 'invoices/2026', 'total')

      expect(mockRemoveOverlayField).toHaveBeenCalledWith(
        '/tmp/project',
        'invoices',
        'total',
        expect.objectContaining({ onPublished: expect.any(Function) })
      )
      expect(mockRestoreOverlaySnapshot).toHaveBeenCalledWith(
        '/tmp/project',
        {
          existed: true,
          content: '# original\n'
        },
        {
          existed: true,
          content: '# mutated\n'
        }
      )
      expect(mockExecCommand).toHaveBeenNthCalledWith(
        1,
        'modules',
        ['run', 'formula'],
        '/tmp/project',
        { timeout: 300_000 }
      )
      expect(mockExecCommand).toHaveBeenNthCalledWith(
        2,
        'modules',
        ['run', 'formula'],
        '/tmp/project',
        { timeout: 300_000 }
      )
      expect(result).toMatchObject({
        error: true,
        message: 'Formula module failed: formula hook failed'
      })
    })
  })

  describe('lookup/rollup definition transactions', () => {
    const formulaReport = {
      module: 'formula',
      event: 'manual_run',
      files_evaluated: 0,
      fields_updated: 0,
      diagnostics: [],
      duration_ms: 1
    }
    const lookupReport = {
      module: 'lookup_rollup',
      event: 'manual_run',
      files_evaluated: 1,
      fields_updated: 1,
      diagnostics: [],
      duration_ms: 2
    }
    const ownerCollection = {
      columns: [
        {
          name: 'client',
          field_type: 'Relation',
          relation_target: 'clients',
          in_schema: true
        }
      ],
      rows: []
    }
    const targetCollection = {
      columns: [
        { name: 'domain', field_type: 'String', in_schema: false },
        { name: 'industry', field_type: 'String', in_schema: false }
      ],
      rows: []
    }

    it('revalidates topology from collection keys and accepts a present-only Lookup target', async () => {
      mockGetCollections.mockReturnValue([
        { id: 'vault-1', name: 'Vault', path: '/tmp/project', addedAt: 1, lastOpenedAt: 1 }
      ])
      mockExecCommand
        .mockResolvedValueOnce(ownerCollection)
        .mockResolvedValueOnce(targetCollection)
        .mockResolvedValueOnce({
          ...lookupReport,
          module_reports: [formulaReport, lookupReport]
        })
      mockCaptureOverlaySnapshot
        .mockResolvedValueOnce({ existed: true, content: '# original\n' })
        .mockResolvedValueOnce({ existed: true, content: '# lookup\n' })
      const handler = getHandler('schema:save-lookup-rollup')

      const result = await handler(fakeEvent, 'vault-1', 'contacts', 'client_domain', {
        kind: 'lookup',
        relationField: 'client',
        targetField: 'domain',
        relationDirection: 'outgoing'
      })

      expect(mockExecCommand).toHaveBeenNthCalledWith(
        1,
        'collection',
        ['contacts', '--recursive', '--limit', '0'],
        '/tmp/project'
      )
      expect(mockExecCommand).toHaveBeenNthCalledWith(
        2,
        'collection',
        ['clients', '--recursive', '--limit', '0'],
        '/tmp/project'
      )
      expect(mockExecModuleTransaction).toHaveBeenCalledWith(
        '/tmp/project',
        'lookup_rollup',
        null,
        expect.any(Function)
      )
      expect(mockUpsertOverlayField).toHaveBeenCalledWith(
        '/tmp/project',
        'contacts',
        'client_domain',
        expect.objectContaining({
          fieldType: 'lookup',
          relationField: 'client',
          targetField: 'domain'
        }),
        expect.objectContaining({
          requireAbsent: true,
          onPublished: expect.any(Function)
        })
      )
      expect(mockAssertComputedOutputKeyAbsentOnDisk).toHaveBeenCalledTimes(2)
      expect(mockAssertComputedOutputKeyAbsentOnDisk).toHaveBeenNthCalledWith(
        1,
        '/tmp/project',
        'contacts',
        'client_domain'
      )
      expect(result).toEqual(lookupReport)
    })

    it('validates an inherited Lookup against its definition origin before updating it', async () => {
      mockGetCollections.mockReturnValue([
        { id: 'vault-1', name: 'Vault', path: '/tmp/project', addedAt: 1, lastOpenedAt: 1 }
      ])
      mockResolveOverlayLookupRollupDefinition.mockResolvedValue({
        scope: 'contacts',
        kind: 'lookup'
      })
      mockExecCommand
        .mockResolvedValueOnce(ownerCollection)
        .mockResolvedValueOnce(targetCollection)
        .mockResolvedValueOnce({
          ...lookupReport,
          module_reports: [formulaReport, lookupReport]
        })
      const handler = getHandler('schema:save-lookup-rollup')

      const result = await handler(
        fakeEvent,
        'vault-1',
        'contacts/enterprise',
        'client_domain',
        {
          kind: 'lookup',
          relationField: 'client',
          targetField: 'domain',
          relationDirection: 'outgoing'
        },
        'client_domain'
      )

      expect(mockResolveOverlayLookupRollupDefinition).toHaveBeenCalledWith(
        '/tmp/project',
        'contacts/enterprise',
        'client_domain'
      )
      expect(mockExecCommand).toHaveBeenNthCalledWith(
        1,
        'collection',
        ['contacts', '--recursive', '--limit', '0'],
        '/tmp/project'
      )
      expect(mockUpsertOverlayField).toHaveBeenCalledWith(
        '/tmp/project',
        'contacts',
        'client_domain',
        expect.objectContaining({ fieldType: 'lookup' }),
        expect.objectContaining({
          previousKey: 'client_domain',
          requireAbsent: false,
          onPublished: expect.any(Function)
        })
      )
      expect(mockAssertComputedOutputKeyAbsentOnDisk).not.toHaveBeenCalled()
      expect(result).toEqual(lookupReport)
    })

    it('renames an inherited Lookup at its true origin, updates views after success, and runs the module once', async () => {
      mockGetCollections.mockReturnValue([
        { id: 'vault-1', name: 'Vault', path: '/tmp/project', addedAt: 1, lastOpenedAt: 1 }
      ])
      mockResolveOverlayLookupRollupDefinition.mockResolvedValue({
        scope: 'contacts',
        kind: 'lookup'
      })
      mockExecCommand
        .mockResolvedValueOnce(ownerCollection)
        .mockResolvedValueOnce(targetCollection)
        .mockResolvedValueOnce({
          ...lookupReport,
          module_reports: [formulaReport, lookupReport]
        })
      mockCaptureOverlaySnapshot
        .mockResolvedValueOnce({ existed: true, content: '# original lookup\n' })
        .mockResolvedValueOnce({ existed: true, content: '# renamed lookup\n' })
      const { wm, mockBroadcastToAll } = createMockWindowManager()
      registerIpcHandlers(wm)
      const registration = mockHandle.mock.calls.find(
        (call: unknown[]) => call[0] === 'schema:save-lookup-rollup'
      )
      const handler = registration?.[1] as (...args: unknown[]) => Promise<unknown>

      const result = await handler(
        fakeEvent,
        'vault-1',
        'contacts/enterprise',
        'client_industry',
        {
          kind: 'lookup',
          relationField: 'client',
          targetField: 'industry',
          relationDirection: 'outgoing'
        },
        'client_domain'
      )

      expect(mockResolveOverlayLookupRollupDefinition).toHaveBeenCalledWith(
        '/tmp/project',
        'contacts/enterprise',
        'client_domain'
      )
      expect(mockExecCommand).toHaveBeenNthCalledWith(
        1,
        'collection',
        ['contacts', '--recursive', '--limit', '0'],
        '/tmp/project'
      )
      expect(mockUpsertOverlayField).toHaveBeenCalledWith(
        '/tmp/project',
        'contacts',
        'client_industry',
        expect.objectContaining({
          fieldType: 'lookup',
          relationField: 'client',
          targetField: 'industry'
        }),
        expect.objectContaining({
          previousKey: 'client_domain',
          onPrepared: expect.any(Function),
          onPublished: expect.any(Function)
        })
      )
      expect(mockExecModuleTransaction).toHaveBeenCalledTimes(1)
      expect(mockAssertComputedOutputKeyAbsentOnDisk).toHaveBeenCalledTimes(2)
      expect(mockAssertComputedOutputKeyAbsentOnDisk).toHaveBeenNthCalledWith(
        2,
        '/tmp/project',
        'contacts',
        'client_industry'
      )
      expect(mockRenamePropertyInViews).toHaveBeenCalledWith(
        'vault-1',
        'contacts',
        'client_domain',
        'client_industry'
      )
      expect(mockBroadcastToAll).toHaveBeenCalledWith('computed:schema-applied', {
        root: '/tmp/project',
        rename: {
          scope: 'contacts',
          oldKey: 'client_domain',
          newKey: 'client_industry'
        }
      })
      expect(mockRenamePropertyInViews.mock.invocationCallOrder[0]).toBeGreaterThan(
        mockExecCommand.mock.invocationCallOrder[2]
      )
      expect(result).toEqual(lookupReport)
    })

    it('rejects a rename when the destination exists in the effective owner schema', async () => {
      mockGetCollections.mockReturnValue([
        { id: 'vault-1', name: 'Vault', path: '/tmp/project', addedAt: 1, lastOpenedAt: 1 }
      ])
      mockResolveOverlayLookupRollupDefinition.mockResolvedValue({
        scope: 'contacts',
        kind: 'lookup'
      })
      mockExecCommand.mockResolvedValueOnce({
        ...ownerCollection,
        columns: [
          ...ownerCollection.columns,
          { name: 'client_industry', field_type: 'String', in_schema: false }
        ]
      })
      const handler = getHandler('schema:save-lookup-rollup')

      const result = await handler(
        fakeEvent,
        'vault-1',
        'contacts/enterprise',
        'client_industry',
        {
          kind: 'lookup',
          relationField: 'client',
          targetField: 'industry',
          relationDirection: 'outgoing'
        },
        'client_domain'
      )

      expect(mockUpsertOverlayField).not.toHaveBeenCalled()
      expect(mockRenamePropertyInViews).not.toHaveBeenCalled()
      expect(mockExecCommand).toHaveBeenCalledTimes(1)
      expect(result).toMatchObject({
        error: true,
        message: expect.stringMatching(/destination field already exists/)
      })
    })

    it.each([
      ['ordinary', 'String'],
      ['Formula', 'Formula'],
      ['Lookup', 'Lookup']
    ])(
      'treats an absent previousKey as create-only and cannot replace an existing %s field',
      async (_label, fieldType) => {
        mockGetCollections.mockReturnValue([
          { id: 'vault-1', name: 'Vault', path: '/tmp/project', addedAt: 1, lastOpenedAt: 1 }
        ])
        mockExecCommand.mockResolvedValueOnce({
          ...ownerCollection,
          columns: [
            ...ownerCollection.columns,
            { name: 'client_domain', field_type: fieldType, in_schema: true }
          ]
        })
        const handler = getHandler('schema:save-lookup-rollup')

        const result = await handler(fakeEvent, 'vault-1', 'contacts', 'client_domain', {
          kind: 'lookup',
          relationField: 'client',
          targetField: 'domain',
          relationDirection: 'outgoing'
        })

        expect(mockResolveOverlayLookupRollupDefinition).not.toHaveBeenCalled()
        expect(mockUpsertOverlayField).not.toHaveBeenCalled()
        expect(mockRestoreOverlaySnapshot).not.toHaveBeenCalled()
        expect(mockExecCommand.mock.calls.some(([command]) => command === 'modules')).toBe(false)
        expect(result).toMatchObject({
          error: true,
          message: expect.stringMatching(/Cannot create.*destination field already exists/)
        })
      }
    )

    it.each(['create', 'rename'] as const)(
      'blocks %s when current unindexed Markdown already owns the destination key',
      async (intent) => {
        mockGetCollections.mockReturnValue([
          { id: 'vault-1', name: 'Vault', path: '/tmp/project', addedAt: 1, lastOpenedAt: 1 }
        ])
        if (intent === 'rename') {
          mockResolveOverlayLookupRollupDefinition.mockResolvedValue({
            scope: 'contacts',
            kind: 'lookup'
          })
        }
        mockExecCommand
          .mockResolvedValueOnce(ownerCollection)
          .mockResolvedValueOnce(targetCollection)
        mockAssertComputedOutputKeyAbsentOnDisk.mockRejectedValueOnce(
          new Error(
            'Cannot claim computed field "client_industry": existing unowned frontmatter found in contacts/new.md'
          )
        )
        const handler = getHandler('schema:save-lookup-rollup')

        const args: unknown[] = [
          fakeEvent,
          'vault-1',
          'contacts',
          'client_industry',
          {
            kind: 'lookup',
            relationField: 'client',
            targetField: 'industry',
            relationDirection: 'outgoing'
          }
        ]
        if (intent === 'rename') args.push('client_domain')
        const result = await handler(...args)

        expect(mockAssertComputedOutputKeyAbsentOnDisk).toHaveBeenCalledWith(
          '/tmp/project',
          'contacts',
          'client_industry'
        )
        expect(mockCaptureOverlaySnapshot).not.toHaveBeenCalled()
        expect(mockUpsertOverlayField).not.toHaveBeenCalled()
        expect(mockRestoreOverlaySnapshot).not.toHaveBeenCalled()
        expect(mockRenamePropertyInViews).not.toHaveBeenCalled()
        expect(mockExecCommand.mock.calls.some(([command]) => command === 'modules')).toBe(false)
        expect(mockAtomicTempWriteFile).not.toHaveBeenCalled()
        expect(result).toMatchObject({
          error: true,
          message: expect.stringMatching(/contacts\/new\.md/)
        })
      }
    )

    it('rolls the overlay back if an unowned destination appears after publication but before module execution', async () => {
      mockGetCollections.mockReturnValue([
        { id: 'vault-1', name: 'Vault', path: '/tmp/project', addedAt: 1, lastOpenedAt: 1 }
      ])
      mockResolveOverlayLookupRollupDefinition.mockResolvedValue({
        scope: 'contacts',
        kind: 'lookup'
      })
      mockExecCommand
        .mockResolvedValueOnce(ownerCollection)
        .mockResolvedValueOnce(targetCollection)
        .mockResolvedValueOnce(lookupReport)
      const original = { existed: true, content: '# original lookup\n' }
      const published = { existed: true, content: '# renamed lookup\n' }
      mockCaptureOverlaySnapshot.mockResolvedValue(original)
      mockUpsertOverlayField.mockImplementationOnce(async (...args: unknown[]) => {
        const options = args[4] as {
          onPrepared?: (snapshot: typeof original) => void
          onPublished?: (snapshot: typeof published) => void
        }
        options.onPrepared?.(original)
        options.onPublished?.(published)
      })
      mockAssertComputedOutputKeyAbsentOnDisk
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(
          new Error(
            'Cannot claim computed field "client_industry": existing unowned frontmatter found in contacts/racing.md'
          )
        )
      const handler = getHandler('schema:save-lookup-rollup')

      const result = await handler(
        fakeEvent,
        'vault-1',
        'contacts',
        'client_industry',
        {
          kind: 'lookup',
          relationField: 'client',
          targetField: 'industry',
          relationDirection: 'outgoing'
        },
        'client_domain'
      )

      expect(mockAssertComputedOutputKeyAbsentOnDisk).toHaveBeenCalledTimes(2)
      expect(mockRestoreOverlaySnapshot).toHaveBeenCalledWith('/tmp/project', original, published)
      expect(mockExecCommand.mock.calls.filter(([command]) => command === 'modules')).toHaveLength(
        1
      )
      expect(mockRenamePropertyInViews).not.toHaveBeenCalled()
      expect(result).toMatchObject({
        error: true,
        message: expect.stringMatching(/contacts\/racing\.md/)
      })
    })

    it('does not publish or run the module when the atomic overlay transaction finds a downstream dependency', async () => {
      mockGetCollections.mockReturnValue([
        { id: 'vault-1', name: 'Vault', path: '/tmp/project', addedAt: 1, lastOpenedAt: 1 }
      ])
      mockResolveOverlayLookupRollupDefinition.mockResolvedValue({
        scope: 'contacts',
        kind: 'lookup'
      })
      mockExecCommand.mockResolvedValueOnce(ownerCollection).mockResolvedValueOnce(targetCollection)
      mockUpsertOverlayField.mockRejectedValueOnce(
        new Error(
          'Cannot rename computed field "client_domain" because Lookup/Rollup definitions retrieve it as target_field: reports.domains'
        )
      )
      const handler = getHandler('schema:save-lookup-rollup')

      const result = await handler(
        fakeEvent,
        'vault-1',
        'contacts',
        'account_domain',
        {
          kind: 'lookup',
          relationField: 'client',
          targetField: 'domain',
          relationDirection: 'outgoing'
        },
        'client_domain'
      )

      expect(mockUpsertOverlayField).toHaveBeenCalledOnce()
      expect(mockRestoreOverlaySnapshot).not.toHaveBeenCalled()
      expect(mockRenamePropertyInViews).not.toHaveBeenCalled()
      expect(mockExecCommand.mock.calls.some(([command]) => command === 'modules')).toBe(false)
      expect(result).toMatchObject({
        error: true,
        message: expect.stringMatching(/reports\.domains/)
      })
    })

    it('does not publish or run the module when an overlapping same-key definition blocks rename', async () => {
      mockGetCollections.mockReturnValue([
        { id: 'vault-1', name: 'Vault', path: '/tmp/project', addedAt: 1, lastOpenedAt: 1 }
      ])
      mockResolveOverlayLookupRollupDefinition.mockResolvedValue({
        scope: 'contacts',
        kind: 'lookup'
      })
      mockExecCommand.mockResolvedValueOnce(ownerCollection).mockResolvedValueOnce(targetCollection)
      mockUpsertOverlayField.mockRejectedValueOnce(
        new Error(
          'Cannot rename computed field "client_domain" because the same field is also defined in overlapping overlay scopes: contacts/vip'
        )
      )
      const handler = getHandler('schema:save-lookup-rollup')

      const result = await handler(
        fakeEvent,
        'vault-1',
        'contacts',
        'account_domain',
        {
          kind: 'lookup',
          relationField: 'client',
          targetField: 'domain',
          relationDirection: 'outgoing'
        },
        'client_domain'
      )

      expect(mockRestoreOverlaySnapshot).not.toHaveBeenCalled()
      expect(mockRenamePropertyInViews).not.toHaveBeenCalled()
      expect(mockExecCommand.mock.calls.some(([command]) => command === 'modules')).toBe(false)
      expect(result).toMatchObject({
        error: true,
        message: expect.stringMatching(/contacts\/vip/)
      })
    })

    it('rejects a missing source definition and Lookup/Rollup kind changes before mutation', async () => {
      mockGetCollections.mockReturnValue([
        { id: 'vault-1', name: 'Vault', path: '/tmp/project', addedAt: 1, lastOpenedAt: 1 }
      ])
      const handler = getHandler('schema:save-lookup-rollup')
      const lookup = {
        kind: 'lookup' as const,
        relationField: 'client',
        targetField: 'industry',
        relationDirection: 'outgoing' as const
      }

      const missing = await handler(
        fakeEvent,
        'vault-1',
        'contacts',
        'client_industry',
        lookup,
        'missing_lookup'
      )
      expect(missing).toMatchObject({
        error: true,
        message: expect.stringMatching(/not defined for this collection/)
      })

      mockResolveOverlayLookupRollupDefinition.mockResolvedValue({
        scope: 'contacts',
        kind: 'rollup'
      })
      const changedKind = await handler(
        fakeEvent,
        'vault-1',
        'contacts',
        'client_industry',
        lookup,
        'invoice_total'
      )
      expect(changedKind).toMatchObject({
        error: true,
        message: expect.stringMatching(/from rollup to lookup/)
      })
      expect(mockUpsertOverlayField).not.toHaveBeenCalled()
      expect(mockExecCommand).not.toHaveBeenCalled()
    })

    it('rejects reserved and structurally invalid rename keys at the IPC boundary', async () => {
      mockGetCollections.mockReturnValue([
        { id: 'vault-1', name: 'Vault', path: '/tmp/project', addedAt: 1, lastOpenedAt: 1 }
      ])
      const handler = getHandler('schema:save-lookup-rollup')
      const definition = {
        kind: 'lookup' as const,
        relationField: 'client',
        targetField: 'domain',
        relationDirection: 'outgoing' as const
      }

      const reserved = await handler(
        fakeEvent,
        'vault-1',
        'contacts',
        'title',
        definition,
        'client_domain'
      )
      const control = await handler(
        fakeEvent,
        'vault-1',
        'contacts',
        'client\ndomain',
        definition,
        'client_domain'
      )
      const invalidPrevious = await handler(
        fakeEvent,
        'vault-1',
        'contacts',
        'client_domain',
        definition,
        ' path'
      )

      expect(reserved).toMatchObject({ error: true, message: expect.stringMatching(/reserved/) })
      expect(control).toMatchObject({
        error: true,
        message: expect.stringMatching(/control characters/)
      })
      expect(invalidPrevious).toMatchObject({
        error: true,
        message: expect.stringMatching(/cannot start or end with spaces/)
      })
      expect(mockResolveOverlayLookupRollupDefinition).not.toHaveBeenCalled()
      expect(mockUpsertOverlayField).not.toHaveBeenCalled()
      expect(mockExecModuleTransaction).not.toHaveBeenCalled()
    })

    it('CAS-restores a published rename when publication reports a trailing failure', async () => {
      mockGetCollections.mockReturnValue([
        { id: 'vault-1', name: 'Vault', path: '/tmp/project', addedAt: 1, lastOpenedAt: 1 }
      ])
      mockResolveOverlayLookupRollupDefinition.mockResolvedValue({
        scope: 'contacts',
        kind: 'lookup'
      })
      mockExecCommand
        .mockResolvedValueOnce(ownerCollection)
        .mockResolvedValueOnce(targetCollection)
        .mockResolvedValueOnce(lookupReport)
      const original = { existed: true, content: '# original lookup\n' }
      const published = { existed: true, content: '# renamed lookup\n' }
      mockCaptureOverlaySnapshot.mockResolvedValue(original)
      mockUpsertOverlayField.mockImplementationOnce(async (...args: unknown[]) => {
        const options = args[4] as {
          onPrepared?: (snapshot: typeof original) => void
          onPublished?: (snapshot: typeof published) => void
        }
        options.onPrepared?.(original)
        options.onPublished?.(published)
        throw new Error('directory fsync failed after publication')
      })
      const handler = getHandler('schema:save-lookup-rollup')

      const result = await handler(
        fakeEvent,
        'vault-1',
        'contacts/enterprise',
        'client_industry',
        {
          kind: 'lookup',
          relationField: 'client',
          targetField: 'industry',
          relationDirection: 'outgoing'
        },
        'client_domain'
      )

      expect(mockRestoreOverlaySnapshot).toHaveBeenCalledWith('/tmp/project', original, published)
      expect(mockExecModuleTransaction).toHaveBeenCalledTimes(2)
      expect(mockRenamePropertyInViews).not.toHaveBeenCalled()
      expect(result).toMatchObject({
        error: true,
        message: 'directory fsync failed after publication'
      })
    })

    it('does not roll back a successful rename when auxiliary saved-view publication fails', async () => {
      mockGetCollections.mockReturnValue([
        { id: 'vault-1', name: 'Vault', path: '/tmp/project', addedAt: 1, lastOpenedAt: 1 }
      ])
      mockResolveOverlayLookupRollupDefinition.mockResolvedValue({
        scope: null,
        kind: 'lookup'
      })
      mockExecCommand
        .mockResolvedValueOnce(ownerCollection)
        .mockResolvedValueOnce(targetCollection)
        .mockResolvedValueOnce({
          ...lookupReport,
          module_reports: [formulaReport, lookupReport]
        })
      mockRenamePropertyInViews.mockRejectedValueOnce(new Error('views file locked'))
      const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const handler = getHandler('schema:save-lookup-rollup')

      const result = await handler(
        fakeEvent,
        'vault-1',
        'contacts',
        'client_industry',
        {
          kind: 'lookup',
          relationField: 'client',
          targetField: 'industry',
          relationDirection: 'outgoing'
        },
        'client_domain'
      )

      expect(mockRenamePropertyInViews).toHaveBeenCalledWith(
        'vault-1',
        '',
        'client_domain',
        'client_industry'
      )
      expect(mockRestoreOverlaySnapshot).not.toHaveBeenCalled()
      expect(mockExecModuleTransaction).toHaveBeenCalledTimes(1)
      expect(result).toEqual(lookupReport)
      warning.mockRestore()
    })

    it('CAS-restores a Lookup definition when the module reports invalid_schema', async () => {
      mockGetCollections.mockReturnValue([
        { id: 'vault-1', name: 'Vault', path: '/tmp/project', addedAt: 1, lastOpenedAt: 1 }
      ])
      const invalidReport = {
        ...lookupReport,
        fields_updated: 0,
        diagnostics: [
          {
            module: 'lookup_rollup',
            path: null,
            field: 'client_domain',
            code: 'invalid_schema',
            message: 'relation field drifted',
            span_start: null,
            span_end: null
          }
        ]
      }
      mockExecCommand
        .mockResolvedValueOnce(ownerCollection)
        .mockResolvedValueOnce(targetCollection)
        .mockResolvedValueOnce({
          ...invalidReport,
          module_reports: [formulaReport, invalidReport]
        })
        .mockResolvedValueOnce(lookupReport)
      mockCaptureOverlaySnapshot
        .mockResolvedValueOnce({ existed: true, content: '# original\n' })
        .mockResolvedValueOnce({ existed: true, content: '# lookup\n' })
      const handler = getHandler('schema:save-lookup-rollup')

      const result = await handler(fakeEvent, 'vault-1', 'contacts', 'client_domain', {
        kind: 'lookup',
        relationField: 'client',
        targetField: 'domain',
        relationDirection: 'outgoing'
      })

      expect(mockRestoreOverlaySnapshot).toHaveBeenCalledWith(
        '/tmp/project',
        { existed: true, content: '# original\n' },
        { existed: true, content: '# lookup\n' }
      )
      expect(result).toMatchObject({
        error: true,
        message: 'Lookup/Rollup module failed: relation field drifted'
      })
    })

    it('restores an inherited Lookup definition when removal recompute fails', async () => {
      mockGetCollections.mockReturnValue([
        { id: 'vault-1', name: 'Vault', path: '/tmp/project', addedAt: 1, lastOpenedAt: 1 }
      ])
      mockResolveOverlayLookupRollupScope.mockResolvedValue('contacts')
      const failedLookupReport = {
        ...lookupReport,
        fields_updated: 0,
        diagnostics: [
          {
            module: 'lookup_rollup',
            path: null,
            field: '',
            code: 'module_error',
            message: 'cleanup failed safely',
            span_start: null,
            span_end: null
          }
        ]
      }
      mockExecCommand
        .mockResolvedValueOnce({
          ...failedLookupReport,
          module_reports: [formulaReport, failedLookupReport]
        })
        .mockResolvedValueOnce(lookupReport)
      mockCaptureOverlaySnapshot
        .mockResolvedValueOnce({ existed: true, content: '# original lookup\n' })
        .mockResolvedValueOnce({ existed: true, content: '# lookup removed\n' })
      const handler = getHandler('schema:remove-lookup-rollup')

      const result = await handler(fakeEvent, 'vault-1', 'contacts/enterprise', 'client_domain')

      expect(mockResolveOverlayLookupRollupScope).toHaveBeenCalledWith(
        '/tmp/project',
        'contacts/enterprise',
        'client_domain'
      )
      expect(mockRemoveOverlayField).toHaveBeenCalledWith(
        '/tmp/project',
        'contacts',
        'client_domain',
        expect.objectContaining({ onPublished: expect.any(Function) })
      )
      expect(mockRestoreOverlaySnapshot).toHaveBeenCalledWith(
        '/tmp/project',
        { existed: true, content: '# original lookup\n' },
        { existed: true, content: '# lookup removed\n' }
      )
      expect(mockExecModuleTransaction).toHaveBeenCalledTimes(2)
      expect(mockExecModuleTransaction).toHaveBeenNthCalledWith(
        2,
        '/tmp/project',
        'lookup_rollup',
        null,
        expect.any(Function)
      )
      expect(result).toMatchObject({
        error: true,
        message: 'Lookup/Rollup module failed: cleanup failed safely'
      })
    })

    it('rejects a drifted incoming Relation before changing the overlay', async () => {
      mockGetCollections.mockReturnValue([
        { id: 'vault-1', name: 'Vault', path: '/tmp/project', addedAt: 1, lastOpenedAt: 1 }
      ])
      mockExecCommand
        .mockResolvedValueOnce({ valid: true, diagnostics: [] })
        .mockResolvedValueOnce({ columns: [], rows: [] })
        .mockResolvedValueOnce({
          columns: [
            {
              name: 'client',
              field_type: 'Relation',
              relation_target: 'other-clients'
            },
            { name: 'total', field_type: 'Number' }
          ]
        })
      const handler = getHandler('schema:save-lookup-rollup')

      const result = await handler(fakeEvent, 'vault-1', 'clients', 'invoice_total', {
        kind: 'rollup',
        relationField: 'client',
        targetField: 'total',
        relationDirection: 'incoming',
        relationScope: 'invoices',
        formula: 'values.reduce((sum, value) => sum + value, 0)',
        resultType: 'Number'
      })

      expect(mockUpsertOverlayField).not.toHaveBeenCalled()
      expect(result).toMatchObject({
        error: true,
        message: expect.stringContaining('must target the current collection')
      })
    })
  })

  describe('cli:ingest', () => {
    it('calls execCommand with 5 minute timeout', async () => {
      mockExecCommand.mockResolvedValue({ files_indexed: 3 })
      const handler = getHandler('cli:ingest')
      await handler(fakeEvent, '/tmp/project')

      expect(mockExecCommand).toHaveBeenCalledWith('ingest', [], '/tmp/project', {
        timeout: 300_000
      })
    })

    it('passes --reindex flag when requested', async () => {
      mockExecCommand.mockResolvedValue({ files_indexed: 3 })
      const handler = getHandler('cli:ingest')
      await handler(fakeEvent, '/tmp/project', { reindex: true })

      expect(mockExecCommand).toHaveBeenCalledWith('ingest', ['--reindex'], '/tmp/project', {
        timeout: 300_000
      })
    })

    it('omits --reindex flag when not requested', async () => {
      mockExecCommand.mockResolvedValue({ files_indexed: 3 })
      const handler = getHandler('cli:ingest')
      await handler(fakeEvent, '/tmp/project', { reindex: false })

      const args = mockExecCommand.mock.calls[0][1] as string[]
      expect(args).not.toContain('--reindex')
    })
  })

  describe('cli:ingest-preview', () => {
    it('passes --preview flag', async () => {
      mockExecCommand.mockResolvedValue({ files: [] })
      const handler = getHandler('cli:ingest-preview')
      await handler(fakeEvent, '/tmp/project')

      expect(mockExecCommand).toHaveBeenCalledWith('ingest', ['--preview'], '/tmp/project')
    })
  })

  describe('cli:tree', () => {
    it('calls with empty args when no path given', async () => {
      mockExecCommand.mockResolvedValue({ root: {} })
      const handler = getHandler('cli:tree')
      await handler(fakeEvent, '/tmp/project')

      expect(mockExecCommand).toHaveBeenCalledWith('tree', [], '/tmp/project')
    })

    it('passes --path when path specified', async () => {
      mockExecCommand.mockResolvedValue({ root: {} })
      const handler = getHandler('cli:tree')
      await handler(fakeEvent, '/tmp/project', 'docs/')

      expect(mockExecCommand).toHaveBeenCalledWith('tree', ['--path', 'docs/'], '/tmp/project')
    })
  })

  describe('cli:collection', () => {
    it('sends the folder path positionally and root sentinel for empty path', async () => {
      mockExecCommand.mockResolvedValue({ rows: [] })
      const handler = getHandler('cli:collection')
      await handler(fakeEvent, '/tmp/project', '')

      expect(mockExecCommand).toHaveBeenCalledWith('collection', ['.'], '/tmp/project')
    })

    it('uses separate --sort/--order flags and repeatable --filter', async () => {
      mockExecCommand.mockResolvedValue({ rows: [] })
      const handler = getHandler('cli:collection')
      await handler(fakeEvent, '/tmp/project', 'blog', {
        recursive: true,
        sort: 'date',
        order: 'desc',
        filter: ['status=published', 'lang=en'],
        limit: 50,
        offset: 10
      })

      expect(mockExecCommand).toHaveBeenCalledWith(
        'collection',
        [
          'blog',
          '--recursive',
          '--sort',
          'date',
          '--order',
          'desc',
          '--filter',
          'status=published',
          '--filter',
          'lang=en',
          '--limit',
          '50',
          '--offset',
          '10'
        ],
        '/tmp/project'
      )
    })

    it('omits optional flags when not provided', async () => {
      mockExecCommand.mockResolvedValue({ rows: [] })
      const handler = getHandler('cli:collection')
      await handler(fakeEvent, '/tmp/project', 'blog', {})

      expect(mockExecCommand).toHaveBeenCalledWith('collection', ['blog'], '/tmp/project')
    })

    it('appends --populate when requested (phase 42)', async () => {
      mockExecCommand.mockResolvedValue({ rows: [] })
      const handler = getHandler('cli:collection')
      await handler(fakeEvent, '/tmp/project', 'invoices', { populate: true })

      expect(mockExecCommand).toHaveBeenCalledWith(
        'collection',
        ['invoices', '--populate'],
        '/tmp/project'
      )
    })

    it('NEVER passes --populate when the option is absent or false', async () => {
      mockExecCommand.mockResolvedValue({ rows: [] })
      const handler = getHandler('cli:collection')
      await handler(fakeEvent, '/tmp/project', 'invoices', { populate: false })
      await handler(fakeEvent, '/tmp/project', 'invoices', {})
      await handler(fakeEvent, '/tmp/project', 'invoices')

      for (const call of mockExecCommand.mock.calls) {
        expect(call[1]).not.toContain('--populate')
      }
    })
  })

  describe('cli:get', () => {
    it('passes file path as positional arg', async () => {
      mockExecCommand.mockResolvedValue({ path: 'readme.md' })
      const handler = getHandler('cli:get')
      await handler(fakeEvent, '/tmp/project', 'readme.md')

      expect(mockExecCommand).toHaveBeenCalledWith('get', ['readme.md'], '/tmp/project')
    })

    it('appends --populate when requested and never otherwise (phase 42)', async () => {
      mockExecCommand.mockResolvedValue({ path: 'readme.md' })
      const handler = getHandler('cli:get')
      await handler(fakeEvent, '/tmp/project', 'readme.md', { populate: true })
      expect(mockExecCommand).toHaveBeenCalledWith(
        'get',
        ['readme.md', '--populate'],
        '/tmp/project'
      )

      mockExecCommand.mockClear()
      await handler(fakeEvent, '/tmp/project', 'readme.md', { populate: false })
      await handler(fakeEvent, '/tmp/project', 'readme.md', undefined)
      for (const call of mockExecCommand.mock.calls) {
        expect(call[1]).not.toContain('--populate')
      }
    })
  })

  describe('cli:links', () => {
    it('passes file path as positional arg', async () => {
      mockExecCommand.mockResolvedValue({ outgoing: [], incoming: [] })
      const handler = getHandler('cli:links')
      await handler(fakeEvent, '/tmp/project', 'notes.md')

      expect(mockExecCommand).toHaveBeenCalledWith('links', ['notes.md'], '/tmp/project')
    })
  })

  describe('cli:backlinks', () => {
    it('passes file path as positional arg', async () => {
      mockExecCommand.mockResolvedValue({ backlinks: [] })
      const handler = getHandler('cli:backlinks')
      await handler(fakeEvent, '/tmp/project', 'notes.md')

      expect(mockExecCommand).toHaveBeenCalledWith('backlinks', ['notes.md'], '/tmp/project')
    })
  })

  describe('cli:orphans', () => {
    it('calls with empty args', async () => {
      mockExecCommand.mockResolvedValue({ orphans: [] })
      const handler = getHandler('cli:orphans')
      await handler(fakeEvent, '/tmp/project')

      expect(mockExecCommand).toHaveBeenCalledWith('orphans', [], '/tmp/project')
    })
  })

  describe('cli:clusters', () => {
    it('calls with empty args', async () => {
      mockExecCommand.mockResolvedValue([])
      const handler = getHandler('cli:clusters')
      await handler(fakeEvent, '/tmp/project')

      expect(mockExecCommand).toHaveBeenCalledWith('clusters', [], '/tmp/project')
    })
  })

  describe('cli:graph', () => {
    it('requests and returns the compact versioned graph contract', async () => {
      const compact = {
        format: 'mdvdb.graph.compact',
        version: 1,
        nodes: [],
        edges: [],
        contexts: ['full context remains interned'],
        clusters: [],
        level: 'chunk',
        analysis: {
          context: 'shard',
          shard_id: 'research',
          shard_path: 'docs/research',
          clusters: 'ready',
          topics: 'none'
        }
      }
      mockExecCommand.mockResolvedValue(compact)
      const handler = getHandler('cli:graph')

      const result = await handler(fakeEvent, '/tmp/project', 'chunk', 'docs/research/', 'research')

      expect(result).toBe(compact)
      expect(mockExecCommand).toHaveBeenCalledWith(
        'graph',
        ['--compact', '--level', 'chunk', '--shard', 'research', '--path', 'docs/research/'],
        '/tmp/project',
        { signal: expect.any(AbortSignal) }
      )
    })
  })

  describe('cli:schema', () => {
    it('returns the global schema with empty args', async () => {
      const schema = { fields: [], last_updated: 1 }
      mockExecCommand.mockResolvedValue(schema)
      const handler = getHandler('cli:schema')
      const result = await handler(fakeEvent, '/tmp/project')

      expect(mockExecCommand).toHaveBeenCalledWith('schema', [], '/tmp/project')
      expect(result).toEqual(schema)
    })

    it('unwraps a path-scoped schema to the preload Schema contract', async () => {
      const schema = { fields: [], last_updated: 2 }
      mockExecCommand.mockResolvedValue({ scope: 'docs', schema })
      const handler = getHandler('cli:schema')
      const result = await handler(fakeEvent, '/tmp/project', 'docs')

      expect(mockExecCommand).toHaveBeenCalledWith('schema', ['--path', 'docs'], '/tmp/project')
      expect(result).toEqual(schema)
    })
  })

  describe('cli:config', () => {
    it('calls with empty args', async () => {
      mockExecCommand.mockResolvedValue({})
      const handler = getHandler('cli:config')
      await handler(fakeEvent, '/tmp/project')

      expect(mockExecCommand).toHaveBeenCalledWith('config', [], '/tmp/project')
    })
  })

  describe('cli:doctor', () => {
    it('calls with empty args', async () => {
      mockExecCommand.mockResolvedValue({ checks: [] })
      const handler = getHandler('cli:doctor')
      await handler(fakeEvent, '/tmp/project')

      expect(mockExecCommand).toHaveBeenCalledWith('doctor', [], '/tmp/project')
    })
  })

  describe('cli:info', () => {
    it('passes a folder scope when provided', async () => {
      mockExecCommand.mockResolvedValue({ scope: 'notes/' })
      const handler = getHandler('cli:info')
      await handler(fakeEvent, '/tmp/project', 'notes')

      expect(mockExecCommand).toHaveBeenCalledWith('info', ['notes'], '/tmp/project')
    })

    it('uses empty args for whole-vault information', async () => {
      mockExecCommand.mockResolvedValue({ scope: '.' })
      const handler = getHandler('cli:info')
      await handler(fakeEvent, '/tmp/project')

      expect(mockExecCommand).toHaveBeenCalledWith('info', [], '/tmp/project')
    })
  })

  describe('cli:init', () => {
    it('calls with empty args', async () => {
      mockExecRaw.mockResolvedValue('')
      const handler = getHandler('cli:init')
      await handler(fakeEvent, '/tmp/project')

      expect(mockExecRaw).toHaveBeenCalledWith('init', [], '/tmp/project')
    })
  })
})

describe('Collection IPC handlers', () => {
  function getHandler(channel: string): (...args: unknown[]) => Promise<unknown> {
    const { wm } = createMockWindowManager()
    registerIpcHandlers(wm)
    const call = mockHandle.mock.calls.find((c: unknown[]) => c[0] === channel)
    if (!call) throw new Error(`No handler for channel: ${channel}`)
    return call[1] as (...args: unknown[]) => Promise<unknown>
  }

  const fakeEvent = { sender: { id: 1 } }

  describe('collections:list', () => {
    it('returns all collections', async () => {
      const cols = [{ id: '1', name: 'docs', path: '/docs', addedAt: 1, lastOpenedAt: 1 }]
      mockGetCollections.mockReturnValue(cols)
      const handler = getHandler('collections:list')
      const result = await handler()
      expect(result).toEqual(cols)
      expect(mockGetCollections).toHaveBeenCalled()
    })
  })

  describe('collections:add', () => {
    it('returns null when folder picker is canceled', async () => {
      mockPickCollectionFolder.mockResolvedValue(null)
      const handler = getHandler('collections:add')
      const result = await handler()
      expect(result).toBeNull()
    })

    it('adds collection when path is valid with config', async () => {
      const col = { id: '1', name: 'proj', path: '/proj', addedAt: 1, lastOpenedAt: 1 }
      mockPickCollectionFolder.mockResolvedValue('/proj')
      mockValidateCollectionPath.mockResolvedValue({ valid: true, hasConfig: true, name: 'proj' })
      mockAddCollection.mockReturnValue(col)
      const handler = getHandler('collections:add')
      const result = await handler()
      expect(result).toEqual(col)
      expect(mockAddCollection).toHaveBeenCalledWith('/proj')
    })

    it('prompts init when path has no config and user accepts', async () => {
      const col = { id: '1', name: 'proj', path: '/proj', addedAt: 1, lastOpenedAt: 1 }
      mockPickCollectionFolder.mockResolvedValue('/proj')
      mockValidateCollectionPath.mockResolvedValue({ valid: true, hasConfig: false, name: 'proj' })
      mockPromptInitCollection.mockResolvedValue(true)
      mockInitCollection.mockResolvedValue(undefined)
      mockAddCollection.mockReturnValue(col)
      const handler = getHandler('collections:add')
      const result = await handler()
      expect(mockPromptInitCollection).toHaveBeenCalledWith('proj')
      expect(mockInitCollection).toHaveBeenCalledWith('/proj')
      expect(result).toEqual(col)
    })

    it('returns null when user declines init', async () => {
      mockPickCollectionFolder.mockResolvedValue('/proj')
      mockValidateCollectionPath.mockResolvedValue({ valid: true, hasConfig: false, name: 'proj' })
      mockPromptInitCollection.mockResolvedValue(false)
      const handler = getHandler('collections:add')
      const result = await handler()
      expect(result).toBeNull()
    })

    it('returns error when path is invalid', async () => {
      mockPickCollectionFolder.mockResolvedValue('/bad')
      mockValidateCollectionPath.mockResolvedValue({
        valid: false,
        hasConfig: false,
        name: 'bad',
        error: 'Path does not exist'
      })
      const handler = getHandler('collections:add')
      const result = await handler()
      expect(result).toEqual(
        expect.objectContaining({ error: true, message: 'Path does not exist' })
      )
    })

    it('kicks off the Obsidian topic sync for the new collection', async () => {
      const col = { id: '1', name: 'vault', path: '/vault', addedAt: 1, lastOpenedAt: 1 }
      mockPickCollectionFolder.mockResolvedValue('/vault')
      mockValidateCollectionPath.mockResolvedValue({ valid: true, hasConfig: true, name: 'vault' })
      mockAddCollection.mockReturnValue(col)
      const handler = getHandler('collections:add')
      await handler()
      expect(mockMaybeSyncObsidianTopics).toHaveBeenCalledWith(col, expect.anything())
    })

    it('does not attempt the Obsidian sync when the picker is canceled', async () => {
      mockPickCollectionFolder.mockResolvedValue(null)
      const handler = getHandler('collections:add')
      await handler()
      expect(mockMaybeSyncObsidianTopics).not.toHaveBeenCalled()
    })
  })

  describe('collections:create-example', () => {
    it('creates and registers a new example below the Documents folder', async () => {
      const col = {
        id: 'example-1',
        name: 'Tesseract Example',
        path: '/Users/test/Documents/Tesseract Example',
        addedAt: 1,
        lastOpenedAt: 1
      }
      mockCreateExampleCollection.mockResolvedValue(col.path)
      mockGetCollections.mockReturnValue([])
      mockAddCollection.mockReturnValue(col)

      const result = await getHandler('collections:create-example')()

      expect(mockCreateExampleCollection).toHaveBeenCalledWith('/Users/test/Documents')
      expect(mockAddCollection).toHaveBeenCalledWith(col.path)
      expect(result).toEqual(col)
    })

    it('reuses the registered collection when the example already exists', async () => {
      const col = {
        id: 'example-1',
        name: 'Tesseract Example',
        path: '/Users/test/Documents/Tesseract Example',
        addedAt: 1,
        lastOpenedAt: 1
      }
      mockCreateExampleCollection.mockResolvedValue(col.path)
      mockGetCollections.mockReturnValue([col])

      const result = await getHandler('collections:create-example')()

      expect(mockAddCollection).not.toHaveBeenCalled()
      expect(result).toEqual(col)
    })
  })

  describe('collections:remove', () => {
    it('removes collection when user confirms', async () => {
      mockGetCollections.mockReturnValue([{ id: 'x', name: 'proj', path: '/proj' }])
      mockConfirmRemoveCollection.mockResolvedValue(true)
      const handler = getHandler('collections:remove')
      await handler(fakeEvent, 'x')
      expect(mockConfirmRemoveCollection).toHaveBeenCalledWith('proj')
      expect(mockRemoveCollection).toHaveBeenCalledWith('x')
    })

    it('does not remove when user cancels', async () => {
      mockGetCollections.mockReturnValue([{ id: 'x', name: 'proj', path: '/proj' }])
      mockConfirmRemoveCollection.mockResolvedValue(false)
      const handler = getHandler('collections:remove')
      await handler(fakeEvent, 'x')
      expect(mockRemoveCollection).not.toHaveBeenCalled()
    })

    it('returns error when collection not found', async () => {
      mockGetCollections.mockReturnValue([])
      const handler = getHandler('collections:remove')
      const result = await handler(fakeEvent, 'missing')
      expect(result).toEqual(expect.objectContaining({ error: true }))
    })
  })

  describe('collections:set-active', () => {
    it('calls setActiveCollection with id', async () => {
      const handler = getHandler('collections:set-active')
      await handler(fakeEvent, 'abc')
      expect(mockSetActiveCollection).toHaveBeenCalledWith('abc')
    })

    it('kicks off the Obsidian topic sync and retargets the config watcher', async () => {
      const col = { id: 'abc', name: 'vault', path: '/vault', addedAt: 1, lastOpenedAt: 1 }
      mockGetActiveCollection.mockReturnValue(col)
      const handler = getHandler('collections:set-active')
      await handler(fakeEvent, 'abc')
      expect(mockCancelScheduledObsidianSyncs).toHaveBeenCalled()
      expect(mockWatchObsidianConfig).toHaveBeenCalledWith(col, expect.anything())
      expect(mockMaybeSyncObsidianTopics).toHaveBeenCalledWith(col, expect.anything())
    })

    it('skips the Obsidian sync when activation yields no collection', async () => {
      mockGetActiveCollection.mockReturnValue(null)
      const handler = getHandler('collections:set-active')
      await handler(fakeEvent, 'abc')
      expect(mockMaybeSyncObsidianTopics).not.toHaveBeenCalled()
      expect(mockWatchObsidianConfig).toHaveBeenCalledWith(null, expect.anything())
    })
  })

  describe('collections:get-active', () => {
    it('returns active collection', async () => {
      const col = { id: '1', name: 'proj', path: '/proj', addedAt: 1, lastOpenedAt: 1 }
      mockGetActiveCollection.mockReturnValue(col)
      const handler = getHandler('collections:get-active')
      const result = await handler()
      expect(result).toEqual(col)
    })

    it('returns null when no active collection', async () => {
      mockGetActiveCollection.mockReturnValue(null)
      const handler = getHandler('collections:get-active')
      const result = await handler()
      expect(result).toBeNull()
    })
  })

  describe('collection skills', () => {
    const collection = {
      id: 'skills-collection',
      name: 'Project',
      path: '/project',
      addedAt: 1,
      lastOpenedAt: 1
    }
    const status = {
      state: 'missing',
      bundleVersion: '1.0.0',
      bundleFingerprint: 'bundle-hash',
      skillCount: 9,
      targets: [],
      recommendedTargetId: 'agents',
      dismissedForever: false
    }

    it('checks the bundled skills against a known collection path', async () => {
      mockGetCollections.mockReturnValue([collection])
      mockGetCollectionSkillsDismissed.mockReturnValue(true)
      mockCheckCollectionSkills.mockResolvedValue(status)

      const result = await getHandler('skills:check-collection')(fakeEvent, collection.id)

      expect(mockCheckCollectionSkills).toHaveBeenCalledWith('/project')
      expect(mockGetCollectionSkillsDismissed).toHaveBeenCalledWith(collection.id)
      expect(result).toEqual({ ...status, dismissedForever: true })
    })

    it('installs the bundle only in the explicitly selected agent target', async () => {
      mockGetCollections.mockReturnValue([collection])
      mockInstallCollectionSkills.mockResolvedValue({ ...status, state: 'current' })

      const result = await getHandler('skills:install-collection')(
        fakeEvent,
        collection.id,
        'claude'
      )

      expect(mockInstallCollectionSkills).toHaveBeenCalledWith('/project', 'claude')
      expect(result).toEqual({ ...status, state: 'current', dismissedForever: false })
    })

    it('rejects checks and installs for an unknown collection', async () => {
      mockGetCollections.mockReturnValue([])

      const checked = await getHandler('skills:check-collection')(fakeEvent, 'missing')
      const installed = await getHandler('skills:install-collection')(
        fakeEvent,
        'missing',
        'agents'
      )

      expect(checked).toEqual(expect.objectContaining({ error: true }))
      expect(installed).toEqual(expect.objectContaining({ error: true }))
      expect(mockCheckCollectionSkills).not.toHaveBeenCalled()
      expect(mockInstallCollectionSkills).not.toHaveBeenCalled()
    })

    it('persists permanent dismissal only for a known collection', async () => {
      mockGetCollections.mockReturnValue([collection])

      const result = await getHandler('skills:set-collection-dismissed')(
        fakeEvent,
        collection.id,
        true
      )

      expect(result).toBeUndefined()
      expect(mockSetCollectionSkillsDismissed).toHaveBeenCalledWith(collection.id, true)
    })
  })

  describe('fs:read-file', () => {
    it('reads file within a known collection', async () => {
      mockGetCollections.mockReturnValue([{ id: '1', name: 'proj', path: '/proj' }])
      mockReadFile.mockResolvedValue('# Hello')
      const handler = getHandler('fs:read-file')
      const result = await handler(fakeEvent, '/proj/readme.md')
      expect(mockReadFile).toHaveBeenCalledWith('/proj/readme.md', 'utf-8')
      expect(result).toBe('# Hello')
    })

    it('denies access to paths outside collections', async () => {
      mockGetCollections.mockReturnValue([{ id: '1', name: 'proj', path: '/proj' }])
      const handler = getHandler('fs:read-file')
      const result = await handler(fakeEvent, '/etc/passwd')
      expect(result).toEqual(
        expect.objectContaining({
          error: true,
          message: 'Access denied: path is not within a known collection'
        })
      )
      expect(mockReadFile).not.toHaveBeenCalled()
    })
  })

  describe('fs:write-file', () => {
    // fs:write-file reads event.sender.id to exclude the sender from the
    // cross-window saved broadcast.
    const writeEvent = { sender: { id: 1 } }

    it('writes atomically within a known collection (dotfile temp + rename)', async () => {
      mockGetCollections.mockReturnValue([{ id: '1', name: 'proj', path: '/proj' }])
      const handler = getHandler('fs:write-file')
      const result = await handler(writeEvent, '/proj/readme.md', '# Updated')
      // Content goes to a dotfile temp in the SAME directory...
      expect(mockAtomicTempWriteFile).toHaveBeenCalledWith(
        expect.stringMatching(
          /^\/proj\/\.\d+\.\d+\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.mdvdb\.tmp$/
        ),
        '# Updated',
        'utf-8'
      )
      // ...then the temp is renamed over the target.
      const tmpPath = mockAtomicTempWriteFile.mock.calls[0][0]
      expect(mockRename).toHaveBeenCalledWith(tmpPath, '/proj/readme.md')
      expect(result).toBeUndefined()
    })

    it('denies access to paths outside collections', async () => {
      mockGetCollections.mockReturnValue([{ id: '1', name: 'proj', path: '/proj' }])
      const handler = getHandler('fs:write-file')
      const result = await handler(writeEvent, '/etc/shadow', 'malicious')
      expect(result).toEqual(
        expect.objectContaining({
          error: true,
          message: 'Access denied: path is not within a known collection'
        })
      )
      expect(mockAtomicTempWriteFile).not.toHaveBeenCalled()
    })

    it('passes utf-8 encoding to the temporary file handle', async () => {
      mockGetCollections.mockReturnValue([{ id: '1', name: 'proj', path: '/proj' }])
      const handler = getHandler('fs:write-file')
      await handler(writeEvent, '/proj/notes.md', 'Héllo wörld 日本語')
      expect(mockAtomicTempWriteFile).toHaveBeenCalledWith(
        expect.stringMatching(/\.mdvdb\.tmp$/),
        'Héllo wörld 日本語',
        'utf-8'
      )
    })

    it('returns serialized error and never touches the target when the temp write fails', async () => {
      mockGetCollections.mockReturnValue([{ id: '1', name: 'proj', path: '/proj' }])
      mockAtomicTempWriteFile.mockRejectedValue(new Error('EACCES: permission denied'))
      const handler = getHandler('fs:write-file')
      const result = await handler(writeEvent, '/proj/readme.md', 'content')
      expect(result).toEqual(
        expect.objectContaining({ error: true, message: 'EACCES: permission denied' })
      )
      // The target file is never written directly, and the temp is cleaned up.
      expect(mockRename).not.toHaveBeenCalled()
      expect(mockRm).toHaveBeenCalledWith(expect.stringMatching(/\.mdvdb\.tmp$/), { force: true })
    })

    it('revokes watcher suppression when publication fails after registration', async () => {
      mockGetCollections.mockReturnValue([{ id: '1', name: 'proj', path: '/proj' }])
      mockRename.mockRejectedValue(new Error('rename failed'))
      const handler = getHandler('fs:write-file')

      const result = await handler(writeEvent, '/proj/readme.md', 'replacement')

      expect(result).toEqual(expect.objectContaining({ error: true, message: 'rename failed' }))
      expect(matchAndConsumeOwnWrite('/proj/readme.md', 'change', undefined, 'replacement')).toBe(
        false
      )
    })
  })

  describe('fs:write-file-if-unchanged', () => {
    const writeEvent = { sender: { id: 1 } }

    it('atomically replaces a file only when its exact baseline still matches', async () => {
      mockGetCollections.mockReturnValue([{ id: '1', name: 'proj', path: '/proj' }])
      mockReadFile.mockResolvedValue('old')
      const handler = getHandler('fs:write-file-if-unchanged')

      const result = await handler(writeEvent, '/proj/readme.md', 'old', 'new')

      expect(mockReadFile).toHaveBeenCalledWith('/proj/readme.md', 'utf-8')
      expect(mockAtomicTempWriteFile).toHaveBeenCalledWith(
        expect.stringMatching(/\.mdvdb\.tmp$/),
        'new',
        'utf-8'
      )
      expect(mockRename).toHaveBeenCalledWith(
        expect.stringMatching(/\.mdvdb\.tmp$/),
        '/proj/readme.md'
      )
      expect(result).toBeUndefined()
    })

    it('rejects a stale baseline without writing a temporary file', async () => {
      mockGetCollections.mockReturnValue([{ id: '1', name: 'proj', path: '/proj' }])
      mockReadFile.mockResolvedValue('changed')
      const handler = getHandler('fs:write-file-if-unchanged')

      const result = await handler(writeEvent, '/proj/readme.md', 'old', 'new')

      expect(result).toEqual(
        expect.objectContaining({ error: true, message: expect.stringMatching(/changed on disk/) })
      )
      expect(mockAtomicTempWriteFile).not.toHaveBeenCalled()
      expect(mockRename).not.toHaveBeenCalled()
    })

    it('serializes concurrent app writes so only one consumer can claim a baseline', async () => {
      mockGetCollections.mockReturnValue([{ id: '1', name: 'proj', path: '/proj' }])
      let diskContent = 'old'
      const temporaryContents = new Map<string, string>()
      mockReadFile.mockImplementation(async () => diskContent)
      mockAtomicTempWriteFile.mockImplementation(async (path: string, content: string) => {
        temporaryContents.set(path, content)
      })
      mockRename.mockImplementation(async (temporaryPath: string) => {
        diskContent = temporaryContents.get(temporaryPath) ?? diskContent
      })
      const handler = getHandler('fs:write-file-if-unchanged')

      const [first, second] = await Promise.all([
        handler(writeEvent, '/proj/readme.md', 'old', 'first'),
        handler(writeEvent, '/proj/readme.md', 'old', 'second')
      ])

      expect(first).toBeUndefined()
      expect(second).toEqual(
        expect.objectContaining({ error: true, message: expect.stringMatching(/changed on disk/) })
      )
      expect(mockRename).toHaveBeenCalledOnce()
      expect(diskContent).toBe('first')
    })

    it('rechecks the exact baseline immediately before rename and leaves no stale own-write marker', async () => {
      mockGetCollections.mockReturnValue([{ id: '1', name: 'proj', path: '/proj' }])
      let diskContent = 'old'
      mockReadFile.mockImplementation(async () => diskContent)
      mockAtomicTempWriteFile.mockImplementation(async () => {
        diskContent = 'concurrent edit'
      })
      const handler = getHandler('fs:write-file-if-unchanged')

      const result = await handler(writeEvent, '/proj/readme.md', 'old', 'stale replacement')

      expect(result).toEqual(
        expect.objectContaining({ error: true, message: expect.stringMatching(/changed on disk/) })
      )
      expect(mockRename).not.toHaveBeenCalled()
      expect(diskContent).toBe('concurrent edit')
      expect(
        matchAndConsumeOwnWrite('/proj/readme.md', 'change', undefined, 'stale replacement')
      ).toBe(false)
    })

    it('rejects a symlinked ancestor that canonically escapes the collection', async () => {
      mockGetCollections.mockReturnValue([{ id: '1', name: 'proj', path: '/proj' }])
      mockReadFile.mockResolvedValue('old')
      mockRealpath.mockImplementation(async (path: string) =>
        path === '/proj/escape' ? '/outside' : path
      )
      const handler = getHandler('fs:write-file-if-unchanged')

      const result = await handler(writeEvent, '/proj/escape/readme.md', 'old', 'new')

      expect(result).toEqual(
        expect.objectContaining({ error: true, message: expect.stringMatching(/outside/) })
      )
      expect(mockAtomicTempWriteFile).not.toHaveBeenCalled()
      expect(mockRename).not.toHaveBeenCalled()
    })
  })

  describe('image editing IPC', () => {
    const imageResult = {
      width: 320,
      height: 240,
      size: 1024,
      sha256: 'new-hash',
      mtimeMs: 2,
      mimeType: 'image/png'
    }
    const editRequest = {
      requestId: 'image-request-1',
      expectedSha256: 'old-hash',
      recipe: { rotation: 90, crop: null, width: 320, height: 240 }
    }

    it('reads image metadata only inside a known collection', async () => {
      mockGetCollections.mockReturnValue([{ id: '1', name: 'proj', path: '/proj' }])
      mockReadImageFile.mockResolvedValue({ ...imageResult, base64: 'png' })
      const handler = getHandler('fs:read-image')

      await expect(handler(fakeEvent, '/proj/images/photo.png')).resolves.toEqual({
        ...imageResult,
        base64: 'png'
      })
      expect(mockReadImageFile).toHaveBeenCalledWith('/proj/images/photo.png')

      const denied = await handler(fakeEvent, '/project-lookalike/photo.png')
      expect(denied).toEqual(
        expect.objectContaining({ error: true, message: expect.stringMatching(/Access denied/) })
      )
    })

    it('applies a recipe and notifies every other open window', async () => {
      mockGetCollections.mockReturnValue([{ id: '1', name: 'proj', path: '/proj' }])
      mockEditImageFile.mockResolvedValue(imageResult)
      const { wm, mockGetAllWindows } = createMockWindowManager()
      const receiverSend = vi.fn()
      mockGetAllWindows.mockReturnValue([
        { webContents: { id: 10, send: vi.fn() }, isDestroyed: () => false },
        { webContents: { id: 11, send: receiverSend }, isDestroyed: () => false },
        { webContents: { id: 12, send: vi.fn() }, isDestroyed: () => true }
      ])
      registerIpcHandlers(wm)
      const call = mockHandle.mock.calls.find((entry: unknown[]) => entry[0] === 'fs:edit-image')
      const handler = call?.[1] as (...args: unknown[]) => Promise<unknown>

      const result = await handler({ sender: { id: 10 } }, '/proj/images/photo.png', editRequest)

      expect(result).toEqual(imageResult)
      expect(mockEditImageFile).toHaveBeenCalledWith('/proj/images/photo.png', editRequest)
      expect(receiverSend).toHaveBeenCalledWith('image:saved-externally', {
        path: '/proj/images/photo.png',
        result: imageResult
      })
    })

    it('rejects out-of-bound edits and forwards cancellation', async () => {
      mockGetCollections.mockReturnValue([{ id: '1', name: 'proj', path: '/proj' }])
      const editHandler = getHandler('fs:edit-image')
      const denied = await editHandler({ sender: { id: 10 } }, '/tmp/photo.png', editRequest)
      expect(denied).toEqual(
        expect.objectContaining({ error: true, message: expect.stringMatching(/Access denied/) })
      )
      expect(mockEditImageFile).not.toHaveBeenCalled()

      const cancelHandler = getHandler('fs:cancel-image-edit')
      await cancelHandler(fakeEvent, 'image-request-1')
      expect(mockCancelImageEdit).toHaveBeenCalledWith('image-request-1')
    })
  })

  describe('fs:create-binary', () => {
    it('creates a clipboard image atomically and returns its decoded size', async () => {
      mockGetCollections.mockReturnValue([{ id: '1', name: 'proj', path: '/proj' }])
      const handler = getHandler('fs:create-binary')
      const data = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64')

      const result = await handler(fakeEvent, '/proj/notes/image.png', data)

      expect(mockMkdir).toHaveBeenCalledWith('/proj/notes', { recursive: true })
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringMatching(/^\/proj\/notes\/\..+\.mdvdb-create\.tmp$/),
        Buffer.from([0x89, 0x50, 0x4e, 0x47]),
        { flag: 'wx' }
      )
      expect(mockLink).toHaveBeenCalledWith(mockWriteFile.mock.calls[0][0], '/proj/notes/image.png')
      expect(result).toEqual({ size: 4 })
    })

    it('returns a collision error without replacing the target', async () => {
      mockGetCollections.mockReturnValue([{ id: '1', name: 'proj', path: '/proj' }])
      mockLink.mockRejectedValue(Object.assign(new Error('already exists'), { code: 'EEXIST' }))
      const handler = getHandler('fs:create-binary')

      const result = await handler(
        fakeEvent,
        '/proj/image.png',
        Buffer.from('image').toString('base64')
      )

      expect(result).toEqual(expect.objectContaining({ error: true, message: 'already exists' }))
      expect(mockRename).not.toHaveBeenCalled()
      expect(mockRm).toHaveBeenCalledWith(expect.stringMatching(/\.mdvdb-create\.tmp$/), {
        force: true
      })
    })

    it('rejects paths outside or inside internal collection directories', async () => {
      mockGetCollections.mockReturnValue([{ id: '1', name: 'proj', path: '/proj' }])
      const handler = getHandler('fs:create-binary')
      const data = Buffer.from('image').toString('base64')

      const outside = await handler(fakeEvent, '/tmp/image.png', data)
      const internal = await handler(fakeEvent, '/proj/.markdownvdb/image.png', data)

      expect(outside).toEqual(
        expect.objectContaining({ error: true, message: expect.stringMatching(/Access denied/) })
      )
      expect(internal).toEqual(
        expect.objectContaining({ error: true, message: expect.stringMatching(/invalid/) })
      )
      expect(mockWriteFile).not.toHaveBeenCalled()
    })

    it('rejects reserved filenames and empty image data', async () => {
      mockGetCollections.mockReturnValue([{ id: '1', name: 'proj', path: '/proj' }])
      const handler = getHandler('fs:create-binary')

      const reserved = await handler(
        fakeEvent,
        '/proj/CON.png',
        Buffer.from('image').toString('base64')
      )
      const empty = await handler(fakeEvent, '/proj/image.png', '')

      expect(reserved).toEqual(
        expect.objectContaining({ error: true, message: expect.stringMatching(/filename/) })
      )
      expect(empty).toEqual(
        expect.objectContaining({ error: true, message: expect.stringMatching(/empty/) })
      )
      expect(mockLink).not.toHaveBeenCalled()
    })
  })
})

describe('shell:open-path IPC handler', () => {
  function getHandler(channel: string): (...args: unknown[]) => Promise<unknown> {
    const { wm } = createMockWindowManager()
    registerIpcHandlers(wm)
    const call = mockHandle.mock.calls.find((c: unknown[]) => c[0] === channel)
    if (!call) throw new Error(`No handler for channel: ${channel}`)
    return call[1] as (...args: unknown[]) => Promise<unknown>
  }

  const fakeEvent = {}

  it('opens path within a known collection', async () => {
    mockGetCollections.mockReturnValue([{ id: '1', name: 'proj', path: '/proj' }])
    mockShellOpenPath.mockResolvedValue('')
    const handler = getHandler('shell:open-path')
    await handler(fakeEvent, '/proj/readme.md')
    expect(mockShellOpenPath).toHaveBeenCalledWith('/proj/readme.md')
  })

  it('denies access to paths outside collections', async () => {
    mockGetCollections.mockReturnValue([{ id: '1', name: 'proj', path: '/proj' }])
    const handler = getHandler('shell:open-path')
    const result = await handler(fakeEvent, '/etc/passwd')
    expect(result).toEqual(
      expect.objectContaining({
        error: true,
        message: 'Access denied: path is not within a known collection'
      })
    )
    expect(mockShellOpenPath).not.toHaveBeenCalled()
  })
})

describe('clipboard:write-text IPC handler', () => {
  function getHandler(channel: string): (...args: unknown[]) => Promise<unknown> {
    const { wm } = createMockWindowManager()
    registerIpcHandlers(wm)
    const call = mockHandle.mock.calls.find((c: unknown[]) => c[0] === channel)
    if (!call) throw new Error(`No handler for channel: ${channel}`)
    return call[1] as (...args: unknown[]) => Promise<unknown>
  }

  const fakeEvent = {}

  it('writes text to clipboard', async () => {
    const handler = getHandler('clipboard:write-text')
    await handler(fakeEvent, '/proj/readme.md')
    expect(mockClipboardWriteText).toHaveBeenCalledWith('/proj/readme.md')
  })
})

describe('native dialog IPC handlers', () => {
  function getHandler(channel: string): (...args: unknown[]) => Promise<unknown> {
    const { wm } = createMockWindowManager()
    registerIpcHandlers(wm)
    const call = mockHandle.mock.calls.find((c: unknown[]) => c[0] === channel)
    if (!call) throw new Error(`No handler for channel: ${channel}`)
    return call[1] as (...args: unknown[]) => Promise<unknown>
  }

  const fakeEvent = { sender: { id: 42 } }

  it('parents a destructive confirmation and keeps the safe action as the default', async () => {
    const parent = { id: 'parent-window' }
    mockFromWebContents.mockReturnValue(parent)
    mockShowMessageBox.mockResolvedValue({ response: 1, checkboxChecked: false })

    const result = await getHandler('dialog:confirm')(fakeEvent, {
      title: 'Discard unsaved changes?',
      message: 'Your document will return to the last saved version.',
      confirmLabel: 'Discard Changes',
      cancelLabel: 'Keep Editing',
      tone: 'danger'
    })

    expect(result).toBe(true)
    expect(mockShowMessageBox).toHaveBeenCalledWith(
      parent,
      expect.objectContaining({
        type: 'warning',
        message: 'Discard unsaved changes?',
        detail: 'Your document will return to the last saved version.',
        buttons: ['Keep Editing', 'Discard Changes'],
        defaultId: 0,
        cancelId: 0,
        noLink: true
      })
    )
  })

  it('returns false when the native confirmation is cancelled', async () => {
    mockShowMessageBox.mockResolvedValue({ response: 0, checkboxChecked: false })

    await expect(
      getHandler('dialog:confirm')(fakeEvent, { title: 'Close tab?', message: 'Unsaved work.' })
    ).resolves.toBe(false)
  })

  it('shows simple errors as native one-action messages', async () => {
    mockShowMessageBox.mockResolvedValue({ response: 0, checkboxChecked: false })

    await getHandler('dialog:message')(fakeEvent, {
      title: 'Export Failed',
      message: 'Permission denied',
      type: 'error'
    })

    expect(mockShowMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'error',
        message: 'Export Failed',
        detail: 'Permission denied',
        buttons: ['OK']
      })
    )
  })
})

describe('IPC error serialization', () => {
  function getHandler(channel: string): (...args: unknown[]) => Promise<unknown> {
    const { wm } = createMockWindowManager()
    registerIpcHandlers(wm)
    const call = mockHandle.mock.calls.find((c: unknown[]) => c[0] === channel)
    if (!call) throw new Error(`No handler for channel: ${channel}`)
    return call[1] as (...args: unknown[]) => Promise<unknown>
  }

  it('serializes CliNotFoundError for IPC transport', async () => {
    const { CliNotFoundError } = await import('../../src/main/errors')
    mockFindCli.mockRejectedValue(new CliNotFoundError())
    const handler = getHandler('cli:find')

    const result = await handler()
    expect(result).toEqual({
      error: true,
      type: 'CliNotFoundError',
      message: 'mdvdb CLI binary not found on PATH'
    })
  })

  it('serializes CliExecutionError with exitCode and stderr', async () => {
    const { CliExecutionError } = await import('../../src/main/errors')
    mockExecCommand.mockRejectedValue(new CliExecutionError('command failed', 2, 'index not found'))
    const handler = getHandler('cli:status')

    const result = await handler({}, '/tmp/project')
    expect(result).toEqual({
      error: true,
      type: 'CliExecutionError',
      message: 'command failed',
      exitCode: 2,
      stderr: 'index not found'
    })
  })

  it('serializes CliTimeoutError for IPC transport', async () => {
    const { CliTimeoutError } = await import('../../src/main/errors')
    mockExecCommand.mockRejectedValue(new CliTimeoutError())
    const handler = getHandler('cli:ingest')

    const result = await handler({}, '/tmp/project')
    expect(result).toEqual({
      error: true,
      type: 'CliTimeoutError',
      message: 'CLI command timed out'
    })
  })

  it('serializes generic errors with type and message', async () => {
    mockExecCommand.mockRejectedValue(new TypeError('unexpected'))
    const handler = getHandler('cli:status')

    const result = await handler({}, '/tmp/project')
    expect(result).toEqual({
      error: true,
      type: 'CliExecutionError',
      message: 'unexpected'
    })
  })

  it('serializes non-Error values as strings', async () => {
    mockExecCommand.mockRejectedValue('string error')
    const handler = getHandler('cli:status')

    const result = await handler({}, '/tmp/project')
    expect(result).toEqual({
      error: true,
      type: 'CliExecutionError',
      message: 'string error'
    })
  })
})

describe('Watcher IPC handlers', () => {
  function getHandler(channel: string): (...args: unknown[]) => Promise<unknown> {
    const { wm } = createMockWindowManager()
    registerIpcHandlers(wm)
    const call = mockHandle.mock.calls.find((c: unknown[]) => c[0] === channel)
    if (!call) throw new Error(`No handler for channel: ${channel}`)
    return call[1] as (...args: unknown[]) => Promise<unknown>
  }

  const fakeEvent = {}

  describe('watcher:start', () => {
    it('calls watcher start with root path', async () => {
      mockWatcherStart.mockResolvedValue(undefined)
      const handler = getHandler('watcher:start')
      await handler(fakeEvent, '/tmp/project')
      expect(mockWatcherStart).toHaveBeenCalledWith('/tmp/project')
    })

    it('sets up event forwarding listeners via windowManager', async () => {
      mockWatcherStart.mockResolvedValue(undefined)
      mockHandle.mockReset()
      const { wm } = createMockWindowManager()
      registerIpcHandlers(wm)
      const call = mockHandle.mock.calls.find((c: unknown[]) => c[0] === 'watcher:start')
      const handler = call![1] as (...args: unknown[]) => Promise<unknown>
      await handler(fakeEvent, '/tmp/project')
      expect(mockWatcherRemoveAllListeners).toHaveBeenCalled()
      expect(mockWatcherOnEvent).toHaveBeenCalled()
      expect(mockWatcherOnError).toHaveBeenCalled()
      expect(mockWatcherOnStateChange).toHaveBeenCalled()
    })
  })

  describe('watcher:stop', () => {
    it('calls watcher stop', async () => {
      mockWatcherStop.mockResolvedValue(undefined)
      const handler = getHandler('watcher:stop')
      await handler(fakeEvent)
      expect(mockWatcherStop).toHaveBeenCalled()
    })
  })

  describe('watcher:status', () => {
    it('returns watcher state, running status, and root', async () => {
      mockWatcherGetState.mockReturnValue('running')
      mockWatcherIsRunning.mockReturnValue(true)
      mockWatcherGetRoot.mockReturnValue('/proj')
      const handler = getHandler('watcher:status')
      const result = await handler(fakeEvent)
      expect(result).toEqual({ state: 'running', running: true, root: '/proj' })
    })

    it('returns stopped state when not running', async () => {
      mockWatcherGetState.mockReturnValue('stopped')
      mockWatcherIsRunning.mockReturnValue(false)
      mockWatcherGetRoot.mockReturnValue(null)
      const handler = getHandler('watcher:status')
      const result = await handler(fakeEvent)
      expect(result).toEqual({ state: 'stopped', running: false, root: null })
    })
  })
})

describe('cli:ingest-file IPC handler', () => {
  function getHandler(channel: string): (...args: unknown[]) => Promise<unknown> {
    const { wm } = createMockWindowManager()
    registerIpcHandlers(wm)
    const call = mockHandle.mock.calls.find((c: unknown[]) => c[0] === channel)
    if (!call) throw new Error(`No handler for channel: ${channel}`)
    return call[1] as (...args: unknown[]) => Promise<unknown>
  }

  const fakeEvent = {}

  it('passes --file flag with file path', async () => {
    mockExecCommand.mockResolvedValue({ files_indexed: 1 })
    const handler = getHandler('cli:ingest-file')
    await handler(fakeEvent, '/tmp/project', 'readme.md')

    expect(mockExecCommand).toHaveBeenCalledWith(
      'ingest',
      ['--file', 'readme.md'],
      '/tmp/project',
      { timeout: 300_000 }
    )
  })

  it('passes --reindex flag when requested', async () => {
    mockExecCommand.mockResolvedValue({ files_indexed: 1 })
    const handler = getHandler('cli:ingest-file')
    await handler(fakeEvent, '/tmp/project', 'readme.md', { reindex: true })

    const args = mockExecCommand.mock.calls[0][1] as string[]
    expect(args).toContain('--file')
    expect(args).toContain('readme.md')
    expect(args).toContain('--reindex')
  })
})

describe('Watcher pause during ingest', () => {
  function getHandler(channel: string): (...args: unknown[]) => Promise<unknown> {
    const { wm } = createMockWindowManager()
    registerIpcHandlers(wm)
    const call = mockHandle.mock.calls.find((c: unknown[]) => c[0] === channel)
    if (!call) throw new Error(`No handler for channel: ${channel}`)
    return call[1] as (...args: unknown[]) => Promise<unknown>
  }

  const fakeEvent = {}

  it('stops watcher before ingest and restarts after', async () => {
    // Trigger watcher:start first to initialise the watcherManager singleton
    mockWatcherStart.mockResolvedValue(undefined)
    const startHandler = getHandler('watcher:start')
    await startHandler(fakeEvent, '/tmp/project')

    // Now the watcher is "running"
    mockWatcherGetState.mockReturnValue('running')
    mockWatcherStop.mockResolvedValue(undefined)
    mockExecCommand.mockResolvedValue({ files_indexed: 3 })

    const ingestHandler = getHandler('cli:ingest')
    await ingestHandler(fakeEvent, '/tmp/project')

    // Watcher should have been stopped before ingest
    expect(mockWatcherStop).toHaveBeenCalled()
    // Ingest should have run
    expect(mockExecCommand).toHaveBeenCalledWith('ingest', [], '/tmp/project', { timeout: 300_000 })
    // Watcher should have been restarted after ingest
    expect(mockWatcherStart).toHaveBeenCalledWith('/tmp/project')
  })

  it('stops a starting watcher before ingest so it cannot retain the index lock', async () => {
    mockWatcherStart.mockResolvedValue(undefined)
    const startHandler = getHandler('watcher:start')
    await startHandler(fakeEvent, '/tmp/project')

    mockWatcherIsRunning.mockReturnValue(false)
    mockWatcherGetState.mockReturnValue('starting')
    mockWatcherStop.mockResolvedValue(undefined)
    mockExecCommand.mockResolvedValue({ files_indexed: 0 })

    const ingestHandler = getHandler('cli:ingest')
    await ingestHandler(fakeEvent, '/tmp/project')

    expect(mockWatcherStop).toHaveBeenCalled()
    expect(mockExecCommand).toHaveBeenCalledWith('ingest', [], '/tmp/project', {
      timeout: 300_000
    })
    expect(mockWatcherStart).toHaveBeenCalledWith('/tmp/project')
  })

  it('stops watcher before ingest-file and restarts after', async () => {
    mockWatcherStart.mockResolvedValue(undefined)
    const startHandler = getHandler('watcher:start')
    await startHandler(fakeEvent, '/tmp/project')

    mockWatcherGetState.mockReturnValue('running')
    mockWatcherStop.mockResolvedValue(undefined)
    mockExecCommand.mockResolvedValue({ files_indexed: 1 })

    const handler = getHandler('cli:ingest-file')
    await handler(fakeEvent, '/tmp/project', 'readme.md', { reindex: true })

    expect(mockWatcherStop).toHaveBeenCalled()
    expect(mockExecCommand).toHaveBeenCalled()
    expect(mockWatcherStart).toHaveBeenCalledWith('/tmp/project')
  })

  it('does not stop or restart watcher when it is not running', async () => {
    mockWatcherIsRunning.mockReturnValue(false)
    mockExecCommand.mockResolvedValue({ files_indexed: 3 })

    const handler = getHandler('cli:ingest')
    await handler(fakeEvent, '/tmp/project')

    expect(mockWatcherStop).not.toHaveBeenCalled()
    expect(mockExecCommand).toHaveBeenCalled()
    // watcher.start should not be called for restart
    // (it may have been called during registerIpcHandlers, so check call count)
    const startCallsAfterIngest = mockWatcherStart.mock.calls.filter(
      (c: unknown[]) => c[0] === '/tmp/project'
    )
    expect(startCallsAfterIngest).toHaveLength(0)
  })

  it('restarts watcher even when ingest fails', async () => {
    mockWatcherStart.mockResolvedValue(undefined)
    const startHandler = getHandler('watcher:start')
    await startHandler(fakeEvent, '/tmp/project')

    mockWatcherIsRunning.mockReturnValue(true)
    mockWatcherStop.mockResolvedValue(undefined)
    mockExecCommand.mockRejectedValue(new Error('Tantivy lock error'))

    const handler = getHandler('cli:ingest')
    const result = await handler(fakeEvent, '/tmp/project')

    // Should be an error result (wrapHandler catches it)
    expect(result).toEqual(expect.objectContaining({ error: true }))
    // Watcher should still have been restarted
    expect(mockWatcherStart).toHaveBeenCalledWith('/tmp/project')
  })
})

describe('Watcher event envelope wrapping', () => {
  it('wraps watch events in { type: "watch-event", data } envelope', async () => {
    mockWatcherStart.mockResolvedValue(undefined)
    mockHandle.mockReset()

    const { wm, mockBroadcastToAll } = createMockWindowManager()
    registerIpcHandlers(wm)

    const startCall = mockHandle.mock.calls.find((c: unknown[]) => c[0] === 'watcher:start')
    const handler = startCall![1] as (...args: unknown[]) => Promise<unknown>
    await handler({}, '/tmp/project')

    // Get the onEvent callback that was registered
    const onEventCall = mockWatcherOnEvent.mock.calls[0]
    const onEventCallback = onEventCall[0] as (event: unknown) => void

    // Simulate a raw watcher event (as it comes from NDJSON)
    const rawEvent = {
      event_type: 'Modified',
      path: 'readme.md',
      chunks_processed: 3,
      duration_ms: 42,
      success: true,
      error: null
    }
    onEventCallback(rawEvent)

    expect(mockBroadcastToAll).toHaveBeenCalledWith('watcher:event', {
      type: 'watch-event',
      data: rawEvent
    })
  })

  it('wraps errors in { type: "error", data } envelope', async () => {
    mockWatcherStart.mockResolvedValue(undefined)
    mockHandle.mockReset()

    const { wm, mockBroadcastToAll } = createMockWindowManager()
    registerIpcHandlers(wm)

    const startCall = mockHandle.mock.calls.find((c: unknown[]) => c[0] === 'watcher:start')
    const handler = startCall![1] as (...args: unknown[]) => Promise<unknown>
    await handler({}, '/tmp/project')

    const onErrorCall = mockWatcherOnError.mock.calls[0]
    const onErrorCallback = onErrorCall[0] as (error: Error) => void

    onErrorCallback(new Error('watcher crashed'))

    expect(mockBroadcastToAll).toHaveBeenCalledWith('watcher:event', {
      type: 'error',
      data: { message: 'watcher crashed' }
    })
  })

  it('wraps state changes in { type: "state-change", data } envelope', async () => {
    mockWatcherStart.mockResolvedValue(undefined)
    mockHandle.mockReset()

    const { wm, mockBroadcastToAll } = createMockWindowManager()
    registerIpcHandlers(wm)

    const startCall = mockHandle.mock.calls.find((c: unknown[]) => c[0] === 'watcher:start')
    const handler = startCall![1] as (...args: unknown[]) => Promise<unknown>
    await handler({}, '/tmp/project')

    const onStateCall = mockWatcherOnStateChange.mock.calls[0]
    const onStateCallback = onStateCall[0] as (state: string) => void

    onStateCallback('running')

    expect(mockBroadcastToAll).toHaveBeenCalledWith('watcher:event', {
      type: 'state-change',
      data: 'running'
    })
  })

  it('sends all event types on the single watcher:event channel', async () => {
    mockWatcherStart.mockResolvedValue(undefined)
    mockHandle.mockReset()

    const { wm, mockBroadcastToAll } = createMockWindowManager()
    registerIpcHandlers(wm)

    const startCall = mockHandle.mock.calls.find((c: unknown[]) => c[0] === 'watcher:start')
    const handler = startCall![1] as (...args: unknown[]) => Promise<unknown>
    await handler({}, '/tmp/project')

    // Fire all three callback types
    const onEventCb = mockWatcherOnEvent.mock.calls[0][0] as (e: unknown) => void
    const onErrorCb = mockWatcherOnError.mock.calls[0][0] as (e: Error) => void
    const onStateCb = mockWatcherOnStateChange.mock.calls[0][0] as (s: string) => void

    onEventCb({ event_type: 'Created', path: 'new.md' })
    onErrorCb(new Error('fail'))
    onStateCb('stopped')

    // All three should go to 'watcher:event' channel, not separate channels
    const channels = mockBroadcastToAll.mock.calls.map((c: unknown[]) => c[0])
    expect(channels.every((ch: string) => ch === 'watcher:event')).toBe(true)
    expect(mockBroadcastToAll).toHaveBeenCalledTimes(3)
  })
  describe('session persistence gating (primary window only)', () => {
    function getHandler(channel: string): (event: unknown, ...args: unknown[]) => Promise<unknown> {
      const call = mockHandle.mock.calls.find((c: unknown[]) => c[0] === channel)
      expect(call).toBeDefined()
      return call![1] as (event: unknown, ...args: unknown[]) => Promise<unknown>
    }

    const session = { panes: [], splitEnabled: false, splitRatio: 0.5 }

    it('registers the synchronous session:save-sync channel via ipcMain.on', async () => {
      const { wm } = createMockWindowManager()
      registerIpcHandlers(wm)
      const { ipcMain } = await import('electron')
      const onChannels = vi.mocked(ipcMain.on).mock.calls.map((c: unknown[]) => c[0])
      expect(onChannels).toContain('session:save-sync')
    })

    it('ignores session:save from non-primary windows', async () => {
      const { wm, mockIsPrimary } = createMockWindowManager()
      registerIpcHandlers(wm)
      const storeModule = await import('../../src/main/store')
      const setSessions = vi.mocked(storeModule.setWindowSessions)
      setSessions.mockClear()

      const handler = getHandler('session:save')

      mockIsPrimary.mockReturnValue(false)
      await handler({ sender: { id: 7 } }, session)
      expect(setSessions).not.toHaveBeenCalled()

      mockIsPrimary.mockReturnValue(true)
      await handler({ sender: { id: 1 } }, session)
      expect(setSessions).toHaveBeenCalledWith([session])
    })

    it('returns null from session:get for non-primary windows', async () => {
      const { wm, mockIsPrimary } = createMockWindowManager()
      registerIpcHandlers(wm)
      const storeModule = await import('../../src/main/store')
      vi.mocked(storeModule.getWindowSessions).mockReturnValue([session])

      const handler = getHandler('session:get')

      mockIsPrimary.mockReturnValue(false)
      expect(await handler({ sender: { id: 7 } })).toBeNull()

      mockIsPrimary.mockReturnValue(true)
      expect(await handler({ sender: { id: 1 } })).toEqual(session)
    })
  })
})

// ─── Topics (custom clusters) handlers ───────────────────────────────

describe('Topics IPC handlers', () => {
  function getHandler(channel: string): (...args: unknown[]) => Promise<unknown> {
    const { wm } = createMockWindowManager()
    registerIpcHandlers(wm)
    const call = mockHandle.mock.calls.find((c: unknown[]) => c[0] === channel)
    if (!call) throw new Error(`No handler for channel: ${channel}`)
    return call[1] as (...args: unknown[]) => Promise<unknown>
  }

  const fakeEvent = {}

  beforeEach(() => {
    mockExecCommand.mockResolvedValue(undefined)
  })

  describe('cli:clusters-add', () => {
    it('passes name, seeds, description, and threshold', async () => {
      const handler = getHandler('cli:clusters-add')
      await handler(fakeEvent, '/vault', {
        name: 'AI',
        seeds: ['neural nets', 'transformers'],
        description: 'Machine learning notes',
        threshold: 0.4
      })
      expect(mockExecCommand).toHaveBeenCalledWith(
        'clusters',
        [
          'add',
          'AI',
          '--seeds',
          'neural nets,transformers',
          '--description',
          'Machine learning notes',
          '--threshold',
          '0.4'
        ],
        '/vault'
      )
    })

    it('omits optional flags for a seeds-only topic', async () => {
      const handler = getHandler('cli:clusters-add')
      await handler(fakeEvent, '/vault', { name: 'Web', seeds: ['html'] })
      expect(mockExecCommand).toHaveBeenCalledWith(
        'clusters',
        ['add', 'Web', '--seeds', 'html'],
        '/vault'
      )
    })

    it('supports description-only topics (no --seeds)', async () => {
      const handler = getHandler('cli:clusters-add')
      await handler(fakeEvent, '/vault', {
        name: 'Rust',
        seeds: [],
        description: 'Notes about Rust'
      })
      const args = mockExecCommand.mock.calls[0][1] as string[]
      expect(args).not.toContain('--seeds')
      expect(args).toContain('--description')
    })

    it('never injects a duplicate --json flag', async () => {
      const handler = getHandler('cli:clusters-add')
      await handler(fakeEvent, '/vault', { name: 'X', seeds: ['y'] })
      const args = mockExecCommand.mock.calls[0][1] as string[]
      expect(args).not.toContain('--json')
    })

    it('prefixes a Shard scope before the add subcommand', async () => {
      const handler = getHandler('cli:clusters-add')
      await handler(fakeEvent, '/vault', { name: 'Local', seeds: ['notes'] }, 'research')
      expect(mockExecCommand).toHaveBeenCalledWith(
        'clusters',
        ['--shard', 'research', 'add', 'Local', '--seeds', 'notes'],
        '/vault'
      )
    })
  })

  describe('cli:clusters-update', () => {
    it('clears description and threshold when unset, renames when name differs', async () => {
      const handler = getHandler('cli:clusters-update')
      await handler(fakeEvent, '/vault', 'Old', { name: 'New', seeds: ['a', 'b'] })
      expect(mockExecCommand).toHaveBeenCalledWith(
        'clusters',
        [
          'update',
          'Old',
          '--seeds',
          'a,b',
          '--description',
          '',
          '--threshold=-1',
          '--rename',
          'New'
        ],
        '/vault'
      )
    })

    it('sends threshold and description when present, no rename for same name', async () => {
      const handler = getHandler('cli:clusters-update')
      await handler(fakeEvent, '/vault', 'AI', {
        name: 'AI',
        seeds: ['nets'],
        description: 'ML',
        threshold: 0.5
      })
      const args = mockExecCommand.mock.calls[0][1] as string[]
      expect(args).toEqual([
        'update',
        'AI',
        '--seeds',
        'nets',
        '--description',
        'ML',
        '--threshold',
        '0.5'
      ])
      expect(args).not.toContain('--rename')
    })

    it('prefixes a Shard scope before the update subcommand', async () => {
      const handler = getHandler('cli:clusters-update')
      await handler(fakeEvent, '/vault', 'Local', { name: 'Local', seeds: ['updated'] }, 'research')
      expect(mockExecCommand).toHaveBeenCalledWith(
        'clusters',
        [
          '--shard',
          'research',
          'update',
          'Local',
          '--seeds',
          'updated',
          '--description',
          '',
          '--threshold=-1'
        ],
        '/vault'
      )
    })
  })

  describe('cli:clusters-remove', () => {
    it('passes the topic name', async () => {
      const handler = getHandler('cli:clusters-remove')
      await handler(fakeEvent, '/vault', 'Old Topic')
      expect(mockExecCommand).toHaveBeenCalledWith('clusters', ['remove', 'Old Topic'], '/vault')
    })

    it('prefixes a Shard scope before remove', async () => {
      const handler = getHandler('cli:clusters-remove')
      await handler(fakeEvent, '/vault', 'Local', 'research')
      expect(mockExecCommand).toHaveBeenCalledWith(
        'clusters',
        ['--shard', 'research', 'remove', 'Local'],
        '/vault'
      )
    })
  })

  describe('cli:clusters-unassigned', () => {
    it('calls clusters unassigned', async () => {
      mockExecCommand.mockResolvedValue({ count: 2, paths: ['a.md', 'b.md'] })
      const handler = getHandler('cli:clusters-unassigned')
      const result = await handler(fakeEvent, '/vault')
      expect(mockExecCommand).toHaveBeenCalledWith('clusters', ['unassigned'], '/vault')
      expect(result).toEqual({ count: 2, paths: ['a.md', 'b.md'] })
    })

    it('prefixes a Shard scope before unassigned', async () => {
      const handler = getHandler('cli:clusters-unassigned')
      await handler(fakeEvent, '/vault', 'research')
      expect(mockExecCommand).toHaveBeenCalledWith(
        'clusters',
        ['--shard', 'research', 'unassigned'],
        '/vault'
      )
    })
  })

  describe('cli:config-set', () => {
    it('passes dotted key and value to config set', async () => {
      const handler = getHandler('cli:config-set')
      await handler(fakeEvent, '/vault', 'clustering.topics.min_similarity', '0.45')
      expect(mockExecCommand).toHaveBeenCalledWith(
        'config',
        ['set', 'clustering.topics.min_similarity', '0.45'],
        '/vault'
      )
    })
  })

  describe('cli:clusters-list', () => {
    it('does not pass a duplicate --json (execCommand injects it)', async () => {
      mockExecCommand.mockResolvedValue([])
      const handler = getHandler('cli:clusters-list')
      await handler(fakeEvent, '/vault')
      expect(mockExecCommand).toHaveBeenCalledWith('clusters', ['list'], '/vault')
    })

    it('prefixes a Shard scope before list', async () => {
      const handler = getHandler('cli:clusters-list')
      await handler(fakeEvent, '/vault', 'research')
      expect(mockExecCommand).toHaveBeenCalledWith(
        'clusters',
        ['--shard', 'research', 'list'],
        '/vault'
      )
    })
  })

  describe('computed cluster scopes', () => {
    it('passes optional Shard scope to auto and custom summaries', async () => {
      await getHandler('cli:clusters')(fakeEvent, '/vault', 'research')
      expect(mockExecCommand).toHaveBeenLastCalledWith(
        'clusters',
        ['--shard', 'research'],
        '/vault'
      )

      await getHandler('cli:custom-clusters')(fakeEvent, '/vault', 'research')
      expect(mockExecCommand).toHaveBeenLastCalledWith(
        'clusters',
        ['--shard', 'research', '--custom'],
        '/vault'
      )
    })
  })
})

// ─── Dirty-close guard + titlebar overlay handlers (D1/E3) ───────────

describe('Close guard & titlebar overlay IPC handlers', () => {
  function getHandlerFor(
    wm: WindowManager,
    channel: string
  ): (...args: unknown[]) => Promise<unknown> {
    registerIpcHandlers(wm)
    const call = mockHandle.mock.calls.find((c: unknown[]) => c[0] === channel)
    if (!call) throw new Error(`No handler for channel: ${channel}`)
    return call[1] as (...args: unknown[]) => Promise<unknown>
  }

  it('store:set-theme re-colors the window controls overlay on every window', async () => {
    const { wm, mockUpdateTitleBarOverlay } = createMockWindowManager()
    const handler = getHandlerFor(wm, 'store:set-theme')
    const storeModule = await import('../../src/main/store')

    await handler({ sender: { id: 1 } }, 'light')

    expect(vi.mocked(storeModule.setThemeMode)).toHaveBeenCalledWith('light')
    expect(mockUpdateTitleBarOverlay).toHaveBeenCalledTimes(1)
  })

  it("app:confirm-close force-closes the sender's window", async () => {
    const { wm, mockConfirmClose } = createMockWindowManager()
    const handler = getHandlerFor(wm, 'app:confirm-close')

    const result = await handler({ sender: { id: 42 } })

    expect(mockConfirmClose).toHaveBeenCalledWith(42)
    expect(result).toBeUndefined()
  })

  it('app:cancel-close cancels a pending application quit', async () => {
    const { wm, mockCancelAppQuit } = createMockWindowManager()
    const handler = getHandlerFor(wm, 'app:cancel-close')

    const result = await handler({ sender: { id: 42 } })

    expect(mockCancelAppQuit).toHaveBeenCalledOnce()
    expect(result).toBeUndefined()
  })

  it('app:close-ack clears the hung-renderer fallback timer via ipcMain.on', async () => {
    const { wm, mockClearCloseTimer } = createMockWindowManager()
    registerIpcHandlers(wm)
    const { ipcMain } = await import('electron')
    // The ipcMain.on mock accumulates across tests — take THIS registration.
    const calls = vi
      .mocked(ipcMain.on)
      .mock.calls.filter((c: unknown[]) => c[0] === 'app:close-ack')
    expect(calls.length).toBeGreaterThan(0)

    const listener = calls[calls.length - 1][1] as (event: unknown) => void
    listener({ sender: { id: 7 } })

    expect(mockClearCloseTimer).toHaveBeenCalledWith(7)
  })

  it('popup:pop-back bypasses the dirty-close guard when closing the popup', async () => {
    const { wm, mockConfirmClose, mockGetAllWindows } = createMockWindowManager()
    mockGetAllWindows.mockReturnValue([])
    const senderWin = { isDestroyed: () => false, webContents: { id: 9 } }
    mockFromWebContents.mockReturnValue(senderWin)
    const handler = getHandlerFor(wm, 'popup:pop-back')

    await handler({ sender: { id: 9 } }, { kind: 'graph' })

    // The transferred tab was already handed off — closing must not re-prompt.
    expect(mockConfirmClose).toHaveBeenCalledWith(9)
  })
})
