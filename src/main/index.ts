import { app } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import {
  registerIpcHandlers,
  registerStartupIpcHandlers,
  destroyWatcherManager,
  destroyAppUpdater,
  getAppUpdater
} from './ipc-handlers'
import { getVaultWatcher, destroyVaultWatcher } from './vault-watcher'
import {
  maybeSyncObsidianTopics,
  watchObsidianConfig,
  cancelScheduledObsidianSyncs
} from './obsidian-import'
import {
  addCollection,
  getActiveCollection,
  getCollections,
  initStore,
  setActiveCollection
} from './store'
import { buildAppMenu } from './menu'
import { WindowManager } from './window-manager'
import { PtyManager } from './pty'
import { registerTerminalHandlers } from './pty-handlers'
import {
  configureE2eRuntime,
  shouldAutoCompleteOnboarding,
  shouldAutoCreateExample
} from './e2e-runtime'
import { createExampleCollection } from './example-collection'
import { execCommand, findCli, getCliVersion } from './cli'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { installLocalMediaProtocol, registerLocalMediaScheme } from './media-protocol'

/** Singleton WindowManager for centralized multi-window lifecycle. */
export const windowManager = new WindowManager()

/** Singleton PtyManager for embedded terminal PTYs. */
export const ptyManager = new PtyManager()

// Custom streaming scheme for local audio/video. Privileges must be declared
// before Electron is ready; the request handler is installed below.
registerLocalMediaScheme()

// Set the app name explicitly so macOS menu and About dialog show "Tesseract"
// (in dev mode, Electron defaults to the package.json "name" field)
app.setName('Tesseract')

// Playwright launches real Electron processes. Give unseeded tests an isolated
// profile and bypass the production single-instance lock only under its
// explicit test flag; otherwise concurrent workers either exit or touch the
// user's actual Tesseract data.
const isE2e = configureE2eRuntime(app)
if (shouldAutoCompleteOnboarding()) {
  initStore().set('onboardingComplete', true)
}

async function prepareE2eExampleCollection(): Promise<void> {
  if (!shouldAutoCreateExample()) return

  const path = await createExampleCollection(app.getPath('userData'))
  await writeFile(
    join(path, '.markdownvdb', 'config.yaml'),
    'embedding:\n  provider: mock\n  dimensions: 8\n'
  )

  const collection =
    getCollections().find((candidate) => candidate.path === path) ?? addCollection(path)
  setActiveCollection(collection.id)

  // Run through the real CLI boundary once so search, properties, graph, and
  // file-tree suites exercise populated data instead of conditional no-ops.
  const store = initStore()
  store.set('cliPath', await findCli())
  store.set('cliVersion', await getCliVersion())
  await execCommand('ingest', [], path, { timeout: 60_000 })
}

// Single-instance lock (data safety): two instances would race on the same
// electron-store/session files and vault watchers. A second launch exits
// immediately and the running instance's primary window is focused instead.
if (!isE2e && !app.requestSingleInstanceLock()) {
  app.quit()
} else if (!isE2e) {
  app.on('second-instance', () => {
    windowManager.focusPrimaryWindow()
  })
}

app
  .whenReady()
  .then(async () => {
    await prepareE2eExampleCollection()
    electronApp.setAppUserModelId('md.tesseract.app')
    installLocalMediaProtocol()

    app.on('browser-window-created', (_, window) => {
      optimizer.watchWindowShortcuts(window, { escToCloseWindow: false, zoom: true })
    })

    // Kill a window's terminals when it closes to avoid leaked PTYs.
    windowManager.onWindowClosed((webContentsId) => {
      ptyManager.disposeByWindow(webContentsId)
    })

    // Preload performs a synchronous theme read before the first page paints.
    // Register only that bootstrap channel before creating the window, then
    // install the full feature surface immediately after load has started.
    registerStartupIpcHandlers()

    windowManager.createWindow()
    registerIpcHandlers(windowManager, ptyManager)
    registerTerminalHandlers(ptyManager)
    buildAppMenu(windowManager)

    // Start the Tier-1 vault watcher for the persisted active collection so
    // background file changes reach renderers from the first frame.
    const activeCollection = getActiveCollection()
    if (activeCollection) {
      getVaultWatcher()
        .start(activeCollection.path)
        .catch(() => {
          // Non-fatal: renderers fall back to focus-time verification
        })

      // Obsidian topic sync (phase 44): catch up on tag/graph-group changes
      // made while the app was closed, and watch .obsidian/ config edits.
      void maybeSyncObsidianTopics(activeCollection, windowManager)
      watchObsidianConfig(activeCollection, windowManager)
    }

    // Initialize auto-updater via the singleton (same instance used by IPC handlers)
    const updater = getAppUpdater()
    updater.setWindowManager(windowManager)
    updater.start()

    app.on('activate', () => {
      if (windowManager.getAllWindows().length === 0) {
        windowManager.createWindow()
      }
    })
  })
  .catch((error: unknown) => {
    // A rejected startup task otherwise leaves Electron alive without a window,
    // which is indistinguishable from a hang to users and automation.
    console.error('Tesseract failed to start:', error)
    app.exit(1)
  })

let appQuitConfirmed = false

app.on('before-quit', (event) => {
  if (!appQuitConfirmed && windowManager.getAllWindows().length > 0) {
    event.preventDefault()
    windowManager.requestAppQuit(() => {
      appQuitConfirmed = true
      app.quit()
    })
  }
})

app.on('will-quit', () => {
  // Clean up auto-updater
  destroyAppUpdater()

  // Kill all PTYs before quit so no zombie shell processes are left behind
  ptyManager.disposeAll()

  // Kill any spawned CLI child processes on quit
  destroyWatcherManager().catch(() => {
    // Best-effort cleanup during shutdown
  })

  // Close the Tier-1 vault watcher
  destroyVaultWatcher().catch(() => {
    // Best-effort cleanup during shutdown
  })

  // Drop pending Obsidian topic syncs and the .obsidian config watcher
  cancelScheduledObsidianSyncs()
  watchObsidianConfig(null, windowManager)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
