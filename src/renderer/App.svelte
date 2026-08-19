<script lang="ts">
  import { onMount } from 'svelte'
  import { get } from 'svelte/store'
  import { cliFeatures } from './lib/cli-features.svelte'
  import Sidebar from './components/Sidebar.svelte'
  import Titlebar from './components/Titlebar.svelte'
  import StatusBar from './components/StatusBar.svelte'
  import SplitPaneContainer from './components/SplitPaneContainer.svelte'
  import PropertiesPanel from './components/PropertiesPanel.svelte'
  import IngestModal from './components/IngestModal.svelte'
  import ConvertTypeModal from './components/ConvertTypeModal.svelte'
  import QuickOpen from './components/QuickOpen.svelte'
  import Onboarding from './components/Onboarding.svelte'
  import Settings from './components/Settings.svelte'
  import UpdateNotification from './components/UpdateNotification.svelte'
  import ObsidianImportNotification from './components/ObsidianImportNotification.svelte'
  import CollectionSkillsNotification from './components/CollectionSkillsNotification.svelte'
  import { requestConfirmation } from './stores/confirmation'
  import { setupObsidianImportListener } from './stores/obsidian-import'
  import {
    loadCollections,
    setActiveCollection,
    activeCollectionId,
    activeCollection
  } from './stores/collections'
  import {
    fileContentLoading,
    resetFileState,
    syncFileStoresFromTab,
    loadAssetTree,
    loadFileTree
  } from './stores/files'
  import { searchOpen, clearSearch } from './stores/search'
  import {
    scrollToLine,
    editorMode,
    toggleEditorMode,
    requestSave,
    resetEditorState
  } from './stores/editor'
  import { loadFavorites } from './stores/favorites'
  import { markImageChanged, requestImageSave } from './stores/image-editor'
  import { openQuickOpen } from './stores/quickopen'
  import { shortcutManager, isEditableTarget } from './lib/shortcuts'
  import { tableStore } from './stores/table.svelte'
  import { clearSchema } from './stores/schema'
  import { openNewNotePopup } from './lib/new-note'
  import {
    setupWatcherListener,
    teardownWatcherListener,
    fetchWatcherStatus,
    clearWatcherEvents,
    restoreWatcherForCollection
  } from './stores/watcher'
  import { setupVaultListener, teardownVaultListener } from './stores/vault-events'
  import { setupIngestListener, teardownIngestListener } from './stores/ingest'
  import { setupActivityLogListener, teardownActivityLogListener } from './stores/activity-log'
  import {
    setupFileSyncListener,
    teardownFileSyncListener,
    resetFileSyncState,
    applySavedContentToOpenTabs
  } from './stores/file-sync'
  import DiffView from './components/DiffView.svelte'
  import {
    graphViewActive,
    openGraphView,
    resetGraphForCollectionSwitch,
    setupGraphShardContextSync
  } from './stores/graph'
  import {
    goBack,
    goForward,
    setNavigating,
    clearNavigation,
    recordNavigation
  } from './stores/navigation'
  import {
    settingsOpen,
    shortcutsModalOpen,
    propertiesOpen,
    togglePropertiesPanel,
    sidebarVisible,
    onboardingComplete,
    loadOnboardingState,
    editorFontSize,
    loadEditorFontSize
  } from './stores/ui'
  import { handleMenuCommand } from './lib/menu-commands'
  import {
    closeFocusedTabWithConfirm,
    reopenLastClosedTab,
    cycleTab
  } from './stores/workspace-actions'
  import DoctorModal from './components/DoctorModal.svelte'
  import CollectionInfoModal from './components/CollectionInfoModal.svelte'
  import KeyboardShortcuts from './components/KeyboardShortcuts.svelte'
  import { setupUpdateListener, teardownUpdateListener } from './stores/updater'
  import {
    loadAccentColors,
    loadCollectionAccentColor,
    primaryVariants
  } from './stores/accent-color'
  import { applyAccentColor } from './lib/apply-accent-color'
  import { reinitMermaid } from './lib/mermaid-renderer'
  import {
    loadTheme,
    loadCollectionTheme,
    initSystemPreference,
    resolvedTheme,
    themeTokens
  } from './stores/theme'
  import { applyTheme } from './lib/apply-theme'
  import { workspace } from './stores/workspace.svelte'
  import PopupShell from './components/PopupShell.svelte'
  import StandaloneShell from './components/StandaloneShell.svelte'
  import BottomPanel from './components/BottomPanel.svelte'
  import { terminalStore } from './stores/terminal.svelte'
  import { clearCollectionSkillsNotice, refreshCollectionSkills } from './stores/collection-skills'
  import type { SearchResult } from './types/cli'
  import {
    activeShardId,
    activeScopePath,
    refreshShards,
    restoreShardForCollection,
    setupShardInvalidationListener,
    teardownShardInvalidationListener
  } from './stores/shards'
  import {
    setupComputedEditorFlushListener,
    setupComputedSchemaAppliedListener
  } from './stores/computed-editor-flush'

  // ── Popup Mode Detection ──────────────────────────────────────────
  const popupParams = new URLSearchParams(window.location.search)
  const isPopupMode = popupParams.get('mode') === 'popup'
  const isStandaloneMode = popupParams.get('mode') === 'standalone'
  const isAuxiliaryMode = isPopupMode || isStandaloneMode
  const initialCollectionId = isAuxiliaryMode ? null : popupParams.get('collectionId')
  const initialShardId = isAuxiliaryMode ? null : popupParams.get('shardId')

  let searchAreaEl: HTMLElement | undefined = $state(undefined)

  // Focus management refs for Tab navigation
  let sidebarEl: HTMLElement | undefined = $state(undefined)
  let editorEl: HTMLElement | undefined = $state(undefined)
  let propertiesEl: HTMLElement | undefined = $state(undefined)

  // Split pane state is managed by workspace + SplitPaneContainer

  onMount(() => {
    // Standalone documents have their own exact-file capability and do not
    // initialize collection, CLI, watcher, or session infrastructure.
    if (isStandaloneMode) return

    // One aggregate listener per renderer coordinates all editor pools and
    // inactive workspace tabs before a computed-field transaction may start.
    const teardownComputedEditorFlush = setupComputedEditorFlushListener()
    const teardownComputedSchemaApplied = setupComputedSchemaAppliedListener()

    // Detect CLI capabilities (phase 42: relation UI gates on the CLI version).
    // Runs in popup windows too — popped-out tables also gate on it.
    void cliFeatures.init()

    // Popup windows render PopupShell — skip all heavyweight initialization
    if (isPopupMode) {
      return () => {
        teardownComputedEditorFlush()
        teardownComputedSchemaApplied()
      }
    }

    // Load collections first, then restore tab session once the active collection is known.
    // restoreSession() validates file existence via the preload API, so it needs an active collection.
    const mainWindowReady = loadCollections(initialCollectionId).then(async () => {
      const collectionId = get(activeCollectionId)
      if (collectionId) await restoreShardForCollection(collectionId, initialShardId)
      // Load the navigation trees for the active collection. Graph data stays
      // cold until a graph tab is restored or explicitly activated.
      loadFileTree().catch(() => {})
      loadAssetTree().catch(() => {})
      try {
        const session = await window.api.getWindowSession()
        if (session) {
          await workspace.restoreSession(session)
          syncFileStoresFromTab()
        } else {
          // No saved session — enable persistence so this session gets auto-saved
          workspace.enablePersistence()
        }
      } catch {
        // If restore fails, still enable persistence for this session
        workspace.enablePersistence()
      }
      // Restart the mdvdb watcher if it was left running for this collection
      restoreWatcherForCollection().catch(() => {})
    })
    loadFavorites()
    setupWatcherListener()
    setupIngestListener()
    setupActivityLogListener()
    setupVaultListener()
    setupFileSyncListener()
    setupUpdateListener()
    setupObsidianImportListener()
    setupShardInvalidationListener()
    fetchWatcherStatus()
    loadOnboardingState()
    loadEditorFontSize()
    loadAccentColors()
    loadTheme()

    // Flush the session synchronously on quit/reload — the debounced save
    // would silently drop a layout change made in its last 500ms.
    const flushSession = (): void => workspace.flushSessionSync()
    window.addEventListener('beforeunload', flushSession)

    // Dirty-close guard: main intercepts native window close and asks us.
    // Flush the session first, then confirm immediately when clean or after
    // an explicit discard confirmation when any document tab is dirty.
    window.api.onCloseRequest(() => {
      flushSession()
      if (!workspace.hasDirtyTabs) {
        void window.api.confirmClose()
        return
      }
      void requestConfirmation({
        title: 'Close with unsaved changes?',
        message: 'This window contains unsaved work. Discard those changes and close it?',
        confirmLabel: 'Discard and Close',
        cancelLabel: 'Keep Editing',
        tone: 'danger'
      }).then((shouldClose) => {
        if (shouldClose) {
          void window.api.confirmClose()
        } else {
          void window.api.cancelClose()
        }
      })
    })

    // System preference listener for auto theme mode
    const cleanupSystemPref = initSystemPreference()

    // Apply theme tokens to CSS custom properties reactively
    let currentResolvedTheme: 'light' | 'dark' = 'dark'
    const unsubTheme = resolvedTheme.subscribe((mode) => {
      currentResolvedTheme = mode
    })
    const unsubThemeTokens = themeTokens.subscribe((tokens) => {
      applyTheme(tokens, currentResolvedTheme)
      reinitMermaid()
    })

    // Apply accent color variants to CSS custom properties reactively
    const unsubAccent = primaryVariants.subscribe((variants) => {
      applyAccentColor(variants)
      reinitMermaid()
    })

    // Re-load collection accent color and theme when active collection changes
    const unsubCollectionColor = activeCollectionId.subscribe((id) => {
      loadCollectionAccentColor(id)
      loadCollectionTheme(id)
    })

    // Cross-window saves share the external-update router: clean tabs update
    // immediately; dirty tabs retain their edits and surface a conflict.
    window.api.onFileSavedExternally(({ path: savedPath, content }) => {
      const collection = get(activeCollection)
      if (!collection) return
      const normalizedRoot = collection.path.replace(/\\/g, '/').replace(/\/+$/, '')
      const normalizedSaved = savedPath.replace(/\\/g, '/')
      if (!normalizedSaved.startsWith(`${normalizedRoot}/`)) return
      applySavedContentToOpenTabs(normalizedSaved.slice(normalizedRoot.length + 1), content)
    })
    window.api.onImageSavedExternally(({ path: savedPath, result }) => {
      const collection = get(activeCollection)
      if (!collection) return
      const root = collection.path.replace(/[\\/]+$/, '')
      const normalizedSaved = savedPath.replace(/\\/g, '/')
      const normalizedRoot = root.replace(/\\/g, '/')
      if (!normalizedSaved.startsWith(`${normalizedRoot}/`)) return
      markImageChanged(normalizedSaved.slice(normalizedRoot.length + 1), result.size)
    })

    // Listen for native menu "Open Recent" clicks
    window.api.onMenuOpenRecent(({ collectionId, filePath }) => {
      // Cold OS file opens can arrive as soon as the renderer loads. Wait for
      // collection/session restoration so the requested document is not
      // overwritten by startup state a few milliseconds later.
      void mainWindowReady
        .then(async () => {
          if (get(activeCollectionId) !== collectionId) {
            await setActiveCollection(collectionId)
          }
          recordNavigation(filePath)
          workspace.openFile(filePath)
          syncFileStoresFromTab()
        })
        .catch((error: unknown) => {
          console.error('Failed to open collection document:', error)
        })
    })

    // Native menu commands (File/Format/View/Graph/Collection/Help — phase 43)
    window.api.onMenuCommand(handleMenuCommand)

    // Keep the app-global native menu tied to this window's focused tab.
    const reportMenuContext = (active = get(graphViewActive)): void => {
      void window.api.setMenuContext({ active })
    }
    const unsubGraphMenuContext = graphViewActive.subscribe((active) => reportMenuContext(active))
    const reportMenuContextOnFocus = (): void => {
      reportMenuContext()
      const collectionId = get(activeCollectionId)
      if (collectionId) {
        void refreshCollectionSkills(collectionId)
        void refreshShards(collectionId)
      }
    }
    window.addEventListener('focus', reportMenuContextOnFocus)

    // Check project-local Tesseract skills on startup and collection changes.
    const unsubCollectionSkills = activeCollectionId.subscribe((collectionId) => {
      if (collectionId) {
        void refreshCollectionSkills(collectionId)
      } else {
        clearCollectionSkillsNotice()
      }
    })

    // Register keyboard shortcuts
    const unregisterShortcuts = [
      // Cmd+O / Ctrl+O: Open quick file finder
      shortcutManager.register({
        key: 'o',
        meta: true,
        handler: () => {
          openQuickOpen()
        }
      }),

      // Cmd+K / Ctrl+K: Open search
      shortcutManager.register({
        key: 'k',
        meta: true,
        handler: () => {
          searchOpen.set(true)
        }
      }),

      // Cmd+Shift+B / Ctrl+Shift+B: Toggle properties panel
      shortcutManager.register({
        key: 'b',
        meta: true,
        shift: true,
        handler: () => {
          togglePropertiesPanel()
        }
      }),

      // Cmd+W / Ctrl+W: Close active tab (with dirty check) or deselect if no document tab
      shortcutManager.register({
        key: 'w',
        meta: true,
        handler: () => {
          closeFocusedTabWithConfirm()
        }
      }),

      // Cmd+G / Ctrl+G: Open the focused pane's graph tab.
      shortcutManager.register({
        key: 'g',
        meta: true,
        handler: () => {
          openGraphView()
          syncFileStoresFromTab()
        }
      }),

      // Cmd+T / Ctrl+T: New tab (open file picker)
      shortcutManager.register({
        key: 't',
        meta: true,
        handler: () => {
          openQuickOpen()
        }
      }),

      // Cmd+Shift+T / Ctrl+Shift+T: Reopen last closed tab
      shortcutManager.register({
        key: 't',
        meta: true,
        shift: true,
        handler: () => {
          reopenLastClosedTab()
        }
      }),

      // Cmd+N / Ctrl+N: New note in a popped-out window
      shortcutManager.register({
        key: 'n',
        meta: true,
        handler: () => {
          openNewNotePopup()
        }
      }),

      // Cmd+Z / Ctrl+Z: Undo in the focused table tab. preventDefault:false +
      // explicit shift so native undo inside inputs / CodeMirror / Tiptap is
      // never overridden; we preventDefault manually only when we handle it.
      shortcutManager.register({
        key: 'z',
        meta: true,
        shift: false,
        preventDefault: false,
        handler: (event) => {
          const tab = workspace.focusedTab
          if (!tab || tab.kind !== 'table') return
          if (event.defaultPrevented || isEditableTarget(event.target)) return
          event.preventDefault()
          void tableStore.undo(tab.id)
        }
      }),

      // Cmd+Shift+Z / Ctrl+Shift+Z: Redo in the focused table tab
      shortcutManager.register({
        key: 'z',
        meta: true,
        shift: true,
        preventDefault: false,
        handler: (event) => {
          const tab = workspace.focusedTab
          if (!tab || tab.kind !== 'table') return
          if (event.defaultPrevented || isEditableTarget(event.target)) return
          event.preventDefault()
          void tableStore.redo(tab.id)
        }
      }),

      // Cmd+\ / Ctrl+\: Toggle split pane
      shortcutManager.register({
        key: '\\',
        meta: true,
        handler: () => {
          workspace.toggleSplit()
          syncFileStoresFromTab()
        }
      }),

      // Cmd+Option+1 / Ctrl+Alt+1: Focus pane 1 (left)
      shortcutManager.register({
        key: '1',
        meta: true,
        alt: true,
        handler: () => {
          const paneId = workspace.paneOrder[0]
          if (paneId) {
            workspace.setActivePane(paneId)
            syncFileStoresFromTab()
          }
        }
      }),

      // Cmd+Option+2 / Ctrl+Alt+2: Focus pane 2 (right)
      shortcutManager.register({
        key: '2',
        meta: true,
        alt: true,
        handler: () => {
          const paneId = workspace.paneOrder[1]
          if (paneId) {
            workspace.setActivePane(paneId)
            syncFileStoresFromTab()
          }
        }
      }),

      // Cmd+Option+Left / Ctrl+Alt+Left: Switch to previous tab
      shortcutManager.register({
        key: 'ArrowLeft',
        meta: true,
        alt: true,
        handler: () => {
          cycleTab(-1)
        }
      }),

      // Cmd+Option+Right / Ctrl+Alt+Right: Switch to next tab
      shortcutManager.register({
        key: 'ArrowRight',
        meta: true,
        alt: true,
        handler: () => {
          cycleTab(1)
        }
      }),

      // Cmd+1 through Cmd+9 / Ctrl+1 through Ctrl+9: Switch to tab N
      ...Array.from({ length: 9 }, (_, i) =>
        shortcutManager.register({
          key: String(i + 1),
          meta: true,
          handler: () => {
            const pane = workspace.focusedPane
            if (!pane) return
            const docTabs = pane.tabOrder.filter((id) => workspace.tabs[id]?.kind === 'document')
            const tabIndex = i // 0-based: Cmd+1 = index 0
            if (tabIndex < docTabs.length) {
              workspace.switchTab(docTabs[tabIndex])
              syncFileStoresFromTab()
            }
          }
        })
      ),

      // Cmd+E / Ctrl+E: Toggle editor/preview mode
      shortcutManager.register({
        key: 'e',
        meta: true,
        handler: () => {
          if (!get(graphViewActive)) {
            toggleEditorMode()
          }
        }
      }),

      // Cmd+S / Ctrl+S: Global save (works in wysiwyg mode too)
      shortcutManager.register({
        key: 's',
        meta: true,
        handler: () => {
          const focused = workspace.focusedTab
          if (focused?.kind === 'asset' && focused.mimeCategory === 'image') {
            requestImageSave(focused.id)
            return
          }
          const mode = get(editorMode)
          if (mode === 'wysiwyg') {
            requestSave()
          }
          // In editor mode, CodeMirror's own keymap handles Cmd+S
        }
      }),

      // Escape: Close settings if open
      shortcutManager.register({
        key: 'Escape',
        handler: () => {
          if (get(settingsOpen)) {
            settingsOpen.set(false)
          }
        }
      }),

      // Cmd+Shift+N / Ctrl+Shift+N: Open new window
      shortcutManager.register({
        key: 'n',
        meta: true,
        shift: true,
        handler: () => {
          void window.api.newWindow(
            get(activeCollectionId) ?? undefined,
            get(activeShardId) ?? undefined
          )
        }
      }),

      // Cmd+, / Ctrl+,: Toggle settings panel
      shortcutManager.register({
        key: ',',
        meta: true,
        handler: () => {
          settingsOpen.update((v) => !v)
        }
      }),

      // Cmd+[ / Ctrl+[: Navigate back
      shortcutManager.register({
        key: '[',
        meta: true,
        handler: () => {
          const path = goBack()
          if (path) {
            setNavigating(true)
            workspace.replaceTab(path)
            syncFileStoresFromTab()
            setNavigating(false)
          }
        }
      }),

      // Cmd+] / Ctrl+]: Navigate forward
      shortcutManager.register({
        key: ']',
        meta: true,
        handler: () => {
          const path = goForward()
          if (path) {
            setNavigating(true)
            workspace.replaceTab(path)
            syncFileStoresFromTab()
            setNavigating(false)
          }
        }
      }),

      // Tab: Cycle focus forward through regions (sidebar → editor → metadata)
      shortcutManager.register({
        key: 'Tab',
        shift: false,
        handler: (event) => {
          // Only handle Tab if we're not in an input/textarea
          const target = event.target as HTMLElement
          if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
            return
          }

          cycleFocus(false)
        },
        preventDefault: true
      }),

      // Shift+Tab: Cycle focus backward through regions
      shortcutManager.register({
        key: 'Tab',
        shift: true,
        handler: (event) => {
          // Only handle Shift+Tab if we're not in an input/textarea
          const target = event.target as HTMLElement
          if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
            return
          }

          cycleFocus(true)
        },
        preventDefault: true
      }),

      // Cmd+` / Ctrl+`: Toggle the bottom panel
      shortcutManager.register({
        key: '`',
        meta: true,
        handler: () => {
          void terminalStore.toggleBottomPanel()
        },
        preventDefault: true
      }),

      // Cmd+Shift+` / Ctrl+Shift+`: New terminal in the bottom panel
      shortcutManager.register({
        key: '`',
        meta: true,
        shift: true,
        handler: () => {
          void terminalStore.newBottomTerminal()
        },
        preventDefault: true
      })
    ]

    // Attach shortcut manager to document
    shortcutManager.attach()

    // Click-away to close search
    function handleClickAway(e: MouseEvent) {
      if (searchAreaEl && !searchAreaEl.contains(e.target as Node)) {
        clearSearch()
        searchOpen.set(false)
      }
    }

    document.addEventListener('mousedown', handleClickAway)

    // Reset all collection-dependent state when switching collections
    let firstRun = true
    const unsub = activeCollectionId.subscribe((collectionId) => {
      // Skip the initial subscription fire — state is already clean on mount
      if (firstRun) {
        firstRun = false
        return
      }
      // Capture this before resetFileState() resets the workspace and makes
      // graphViewActive false, otherwise an active graph is never reloaded.
      const wasGraphActive = get(graphViewActive)

      // Terminal PTYs are collection-scoped. Close them before workspace.reset()
      // can carry an old collection's terminal into the new bottom panel.
      terminalStore.resetForCollectionSwitch()

      // Clear file selection, tree, properties, and editor state FIRST
      // to prevent stale paths from being used in CLI calls
      resetFileState()
      resetFileSyncState()
      resetEditorState()
      clearSchema()
      clearSearch()
      clearNavigation()
      clearWatcherEvents()
      // Clear the old graph immediately, restore the Graph tab if it was the
      // active view, and load the newly active collection. The graph store's
      // generation guard discards results from rapid consecutive switches.
      void resetGraphForCollectionSwitch(wasGraphActive)
      if (collectionId) void restoreShardForCollection(collectionId)
      // Restart the mdvdb watcher if the new collection had it running
      restoreWatcherForCollection().catch(() => {})
    })

    // Shard activation is a context change, not a collection switch: preserve
    // every tab/editor/watcher and only invalidate scoped reads.
    const unsubGraphShardScope = setupGraphShardContextSync()
    let previousScope = get(activeScopePath)
    const unsubShardScope = activeScopePath.subscribe((scope) => {
      if (scope === previousScope) return
      previousScope = scope
      clearSearch()
      clearSchema()
    })

    return () => {
      // Unregister all shortcuts
      unregisterShortcuts.forEach((unregister) => unregister())
      shortcutManager.detach()
      window.removeEventListener('beforeunload', flushSession)
      window.api.removeCloseRequestListener()
      document.removeEventListener('mousedown', handleClickAway)
      teardownWatcherListener()
      teardownIngestListener()
      teardownActivityLogListener()
      teardownVaultListener()
      teardownFileSyncListener()
      teardownUpdateListener()
      teardownShardInvalidationListener()
      window.api.removeObsidianTopicsSyncedListener()
      window.api.removeMenuOpenRecentListener()
      window.api.removeMenuCommandListener()
      window.removeEventListener('focus', reportMenuContextOnFocus)
      unsubCollectionSkills()
      unsubGraphMenuContext()
      window.api.removeFileSavedExternallyListener()
      window.api.removeImageSavedExternallyListener()
      unsub()
      unsubGraphShardScope()
      unsubShardScope()
      unsubAccent()
      unsubCollectionColor()
      unsubTheme()
      unsubThemeTokens()
      cleanupSystemPref()
      teardownComputedEditorFlush()
      teardownComputedSchemaApplied()
    }
  })

  function handleNavigate(detail: { id: string }) {
    setActiveCollection(detail.id)
  }

  function handleFileSelect(detail: { folderId: string; fileId: string; forceNewTab?: boolean }) {
    recordNavigation(detail.fileId)
    workspace.openFile(detail.fileId, { forceNewTab: detail.forceNewTab })
    syncFileStoresFromTab()
  }

  function navigateToResult(result: SearchResult) {
    recordNavigation(result.file.path)
    workspace.openFile(result.file.path)
    syncFileStoresFromTab()
    // Wait for loading to finish, then scroll to the result line
    let wasLoading = false
    const unsub = fileContentLoading.subscribe((loading) => {
      if (loading) {
        wasLoading = true
        return
      }
      if (wasLoading) {
        // Defer scroll so the editor's content $effect creates the view first
        requestAnimationFrame(() => {
          scrollToLine.set(result.chunk.start_line)
        })
        unsub()
      }
    })
    clearSearch()
    searchOpen.set(false)
  }

  /**
   * Cycle focus between the three main regions: sidebar, editor, and metadata panel.
   * @param reverse - If true, cycle backward (Shift+Tab), otherwise forward (Tab)
   */
  function cycleFocus(reverse: boolean = false) {
    const regions = [sidebarEl, editorEl, $propertiesOpen ? propertiesEl : null].filter(
      Boolean
    ) as HTMLElement[]

    if (regions.length === 0) return

    // Find currently focused region
    const activeElement = document.activeElement as HTMLElement
    let currentIndex = -1

    for (let i = 0; i < regions.length; i++) {
      if (regions[i] === activeElement || regions[i].contains(activeElement)) {
        currentIndex = i
        break
      }
    }

    // Calculate next index
    let nextIndex: number
    if (currentIndex === -1) {
      // No region focused, start at the beginning
      nextIndex = reverse ? regions.length - 1 : 0
    } else {
      if (reverse) {
        nextIndex = (currentIndex - 1 + regions.length) % regions.length
      } else {
        nextIndex = (currentIndex + 1) % regions.length
      }
    }

    // Focus the next region
    regions[nextIndex]?.focus()
  }
</script>

{#if isStandaloneMode}
  <StandaloneShell />
{:else if isPopupMode}
  <PopupShell urlParams={popupParams} />
{:else if !$onboardingComplete}
  <Onboarding />
{:else}
  <!-- Skip navigation link for accessibility -->
  <a href="#main-content" class="skip-link">Skip to main content</a>

  <div class="app-shell" style="--editor-font-size: {$editorFontSize}px">
    <ObsidianImportNotification />
    <div class="titlebar-region" bind:this={searchAreaEl}>
      <Titlebar onsearchresultclick={navigateToResult} />
    </div>

    <div class="body-region">
      {#if $sidebarVisible}
        <div
          class="sidebar-region"
          bind:this={sidebarEl}
          tabindex="-1"
          role="navigation"
          aria-label="File navigation"
        >
          <Sidebar onnavigate={handleNavigate} onfileselect={handleFileSelect} />
        </div>
      {/if}

      <main class="main-area">
        <div class="content-area">
          <div id="main-content" class="tab-pane-region" bind:this={editorEl} tabindex="-1">
            <SplitPaneContainer />
          </div>
          {#if $propertiesOpen}
            <div
              class="properties-region"
              bind:this={propertiesEl}
              tabindex="-1"
              role="complementary"
              aria-label="File metadata"
            >
              <PropertiesPanel
                onfileselect={(detail) => handleFileSelect({ folderId: '', fileId: detail.path })}
              />
            </div>
          {/if}
        </div>

        <BottomPanel />

        <UpdateNotification />
        <CollectionSkillsNotification />
        <StatusBar />
      </main>
    </div>

    {#if $settingsOpen}
      <Settings onclose={() => settingsOpen.set(false)} />
    {/if}
    <IngestModal />
    <DoctorModal />
    <CollectionInfoModal />
    <QuickOpen />
    <DiffView />
    <ConvertTypeModal />
    <KeyboardShortcuts open={$shortcutsModalOpen} onclose={() => shortcutsModalOpen.set(false)} />
  </div>
{/if}

<style>
  /* Skip link for accessibility - only visible on keyboard focus */
  .skip-link {
    position: absolute;
    top: -40px;
    left: 0;
    background: var(--color-primary, #00e5ff);
    color: var(--color-surface-darker, #0a0a0a);
    padding: 8px 16px;
    text-decoration: none;
    border-radius: 4px;
    font-weight: 600;
    z-index: 1000;
    transition: top 0.2s ease-out;
  }

  .skip-link:focus {
    top: 8px;
    left: 8px;
    outline: 2px solid var(--color-text, #e4e4e7);
    outline-offset: 2px;
  }

  .app-shell {
    display: flex;
    flex-direction: column;
    height: 100vh;
    width: 100vw;
    overflow: hidden;
    background: var(--color-bg, #0f0f10);
    color: var(--color-text, #e4e4e7);
    font-family: var(--font-display, 'Space Grotesk Variable', system-ui, sans-serif);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    position: relative;
  }

  .app-shell::selection,
  .app-shell :global(::selection) {
    background: var(--color-primary, #00e5ff);
    color: var(--color-surface-darker, #0a0a0a);
  }

  .titlebar-region {
    flex-shrink: 0;
    z-index: 35;
    position: relative;
  }

  .body-region {
    flex: 1;
    display: flex;
    flex-direction: row;
    min-height: 0;
    overflow: hidden;
  }

  .sidebar-region {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .main-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
    position: relative;
    z-index: 10;
  }

  .content-area {
    flex: 1;
    display: flex;
    flex-direction: row;
    overflow: hidden;
    position: relative;
    min-height: 0;
  }

  .tab-pane-region {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .properties-region {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
</style>
