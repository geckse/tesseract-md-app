<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import Sidebar from './components/Sidebar.svelte';
  import Titlebar from './components/Titlebar.svelte';
  import StatusBar from './components/StatusBar.svelte';
  import SplitPaneContainer from './components/SplitPaneContainer.svelte';
  import PropertiesPanel from './components/PropertiesPanel.svelte';
  import IngestModal from './components/IngestModal.svelte';
  import QuickOpen from './components/QuickOpen.svelte';
  import Onboarding from './components/Onboarding.svelte';
  import Settings from './components/Settings.svelte';
  import UpdateNotification from './components/UpdateNotification.svelte';
  import { loadCollections, setActiveCollection, activeCollectionId } from './stores/collections';
  import { fileContentLoading, resetFileState, syncFileStoresFromTab, loadAssetTree, loadFileTree } from './stores/files';
  import { searchOpen, clearSearch } from './stores/search';
  import { scrollToLine, editorMode, toggleEditorMode, requestSave, resetEditorState } from './stores/editor';
  import { loadFavorites } from './stores/favorites';
  import { openQuickOpen } from './stores/quickopen';
  import { shortcutManager } from './lib/shortcuts';
  import { setupWatcherListener, teardownWatcherListener, fetchWatcherStatus, clearWatcherEvents } from './stores/watcher';
  import { graphViewActive, toggleGraphView, loadGraphData, resetGraphState } from './stores/graph';
  import { goBack, goForward, setNavigating, clearNavigation, recordNavigation } from './stores/navigation';
  import { settingsOpen, onboardingComplete, loadOnboardingState, editorFontSize, loadEditorFontSize } from './stores/ui';
  import { setupUpdateListener, teardownUpdateListener } from './stores/updater';
  import { loadAccentColors, loadCollectionAccentColor, primaryVariants } from './stores/accent-color';
  import { applyAccentColor } from './lib/apply-accent-color';
  import { reinitMermaid } from './lib/mermaid-renderer';
  import { loadTheme, loadCollectionTheme, initSystemPreference, resolvedTheme, themeTokens } from './stores/theme';
  import { applyTheme } from './lib/apply-theme';
  import { workspace } from './stores/workspace.svelte';
  import { closedTabs } from './stores/closed-tabs.svelte';
  import type { SearchResult } from './types/cli';


  let propertiesOpen = $state(localStorage.getItem('mdvdb-properties-open') === 'true');
  let searchAreaEl: HTMLElement | undefined = $state(undefined);

  // Focus management refs for Tab navigation
  let sidebarEl: HTMLElement | undefined = $state(undefined);
  let editorEl: HTMLElement | undefined = $state(undefined);
  let propertiesEl: HTMLElement | undefined = $state(undefined);

  // Split pane state is managed by workspace + SplitPaneContainer

  onMount(() => {
    // Load collections first, then restore tab session once the active collection is known.
    // restoreSession() validates file existence via the preload API, so it needs an active collection.
    loadCollections().then(async () => {
      // Load file tree, asset tree, and graph data for the active collection
      loadFileTree().catch(() => {});
      loadAssetTree().catch(() => {});
      loadGraphData().catch(() => {});
      try {
        const session = await window.api.getWindowSession();
        if (session) {
          await workspace.restoreSession(session);
          syncFileStoresFromTab();
        } else {
          // No saved session — enable persistence so this session gets auto-saved
          workspace.enablePersistence();
        }
      } catch {
        // If restore fails, still enable persistence for this session
        workspace.enablePersistence();
      }
    });
    loadFavorites();
    setupWatcherListener();
    setupUpdateListener();
    fetchWatcherStatus();
    loadOnboardingState();
    loadEditorFontSize();
    loadAccentColors();
    loadTheme();

    // System preference listener for auto theme mode
    const cleanupSystemPref = initSystemPreference();

    // Apply theme tokens to CSS custom properties reactively
    let currentResolvedTheme: 'light' | 'dark' = 'dark';
    const unsubTheme = resolvedTheme.subscribe((mode) => { currentResolvedTheme = mode; });
    const unsubThemeTokens = themeTokens.subscribe((tokens) => {
      applyTheme(tokens, currentResolvedTheme);
      reinitMermaid();
    });

    // Apply accent color variants to CSS custom properties reactively
    const unsubAccent = primaryVariants.subscribe((variants) => {
      applyAccentColor(variants);
      reinitMermaid();
    });

    // Re-load collection accent color and theme when active collection changes
    const unsubCollectionColor = activeCollectionId.subscribe((id) => {
      loadCollectionAccentColor(id);
      loadCollectionTheme(id);
    });

    // Listen for native menu "Open Recent" clicks
    window.api.onMenuOpenRecent(({ collectionId, filePath }) => {
      setActiveCollection(collectionId);
      // Small delay to let collection switch propagate before opening tab
      setTimeout(() => {
        recordNavigation(filePath);
        workspace.openFile(filePath);
        syncFileStoresFromTab();
      }, 50);
    });

    // Register keyboard shortcuts
    const unregisterShortcuts = [
      // Cmd+O / Ctrl+O: Open quick file finder
      shortcutManager.register({
        key: 'o',
        meta: true,
        handler: () => {
          openQuickOpen();
        },
      }),

      // Cmd+K / Ctrl+K: Open search
      shortcutManager.register({
        key: 'k',
        meta: true,
        handler: () => {
          searchOpen.set(true);
        },
      }),

      // Cmd+Shift+B / Ctrl+Shift+B: Toggle properties panel
      shortcutManager.register({
        key: 'b',
        meta: true,
        shift: true,
        handler: () => {
          propertiesOpen = !propertiesOpen;
          localStorage.setItem('mdvdb-properties-open', String(propertiesOpen));
        },
      }),

      // Cmd+W / Ctrl+W: Close active tab (with dirty check) or deselect if no document tab
      shortcutManager.register({
        key: 'w',
        meta: true,
        handler: () => {
          const tab = workspace.focusedTab;
          if (tab && tab.kind === 'document') {
            if (tab.isDirty) {
              // Show save/discard/cancel prompt for dirty tabs
              const shouldClose = window.confirm(
                `"${tab.title}" has unsaved changes. Discard changes and close?`
              );
              if (!shouldClose) return;
            }
            const paneId = workspace.activePaneId;
            const closed = workspace.closeTab(tab.id);
            if (closed && closed.kind === 'document') {
              closedTabs.push(closed, paneId);
            }
          } else {
            // No document tab focused — deselect
            const pane = workspace.focusedPane;
            if (pane) {
              pane.activeTabId = null;
            }
          }
          syncFileStoresFromTab();
        },
      }),

      // Cmd+G / Ctrl+G: Switch to graph tab in focused pane (toggle)
      shortcutManager.register({
        key: 'g',
        meta: true,
        handler: () => {
          toggleGraphView();
          syncFileStoresFromTab();
        },
      }),

      // Cmd+T / Ctrl+T: New tab (open file picker)
      shortcutManager.register({
        key: 't',
        meta: true,
        handler: () => {
          openQuickOpen();
        },
      }),

      // Cmd+Shift+T / Ctrl+Shift+T: Reopen last closed tab
      shortcutManager.register({
        key: 't',
        meta: true,
        shift: true,
        handler: () => {
          const entry = closedTabs.pop();
          if (entry) {
            workspace.openTab(entry.tab.filePath);
            syncFileStoresFromTab();
          }
        },
      }),

      // Cmd+\ / Ctrl+\: Toggle split pane
      shortcutManager.register({
        key: '\\',
        meta: true,
        handler: () => {
          workspace.toggleSplit();
          syncFileStoresFromTab();
        },
      }),

      // Cmd+Option+1 / Ctrl+Alt+1: Focus pane 1 (left)
      shortcutManager.register({
        key: '1',
        meta: true,
        alt: true,
        handler: () => {
          const paneId = workspace.paneOrder[0];
          if (paneId) {
            workspace.setActivePane(paneId);
            syncFileStoresFromTab();
          }
        },
      }),

      // Cmd+Option+2 / Ctrl+Alt+2: Focus pane 2 (right)
      shortcutManager.register({
        key: '2',
        meta: true,
        alt: true,
        handler: () => {
          const paneId = workspace.paneOrder[1];
          if (paneId) {
            workspace.setActivePane(paneId);
            syncFileStoresFromTab();
          }
        },
      }),

      // Cmd+Option+Left / Ctrl+Alt+Left: Switch to previous tab
      shortcutManager.register({
        key: 'ArrowLeft',
        meta: true,
        alt: true,
        handler: () => {
          const pane = workspace.focusedPane;
          if (!pane) return;
          const docTabs = pane.tabOrder.filter((id) => workspace.tabs[id]?.kind === 'document');
          if (docTabs.length === 0) return;
          const currentIdx = pane.activeTabId ? docTabs.indexOf(pane.activeTabId) : -1;
          const prevIdx = currentIdx <= 0 ? docTabs.length - 1 : currentIdx - 1;
          workspace.switchTab(docTabs[prevIdx]);
          syncFileStoresFromTab();
        },
      }),

      // Cmd+Option+Right / Ctrl+Alt+Right: Switch to next tab
      shortcutManager.register({
        key: 'ArrowRight',
        meta: true,
        alt: true,
        handler: () => {
          const pane = workspace.focusedPane;
          if (!pane) return;
          const docTabs = pane.tabOrder.filter((id) => workspace.tabs[id]?.kind === 'document');
          if (docTabs.length === 0) return;
          const currentIdx = pane.activeTabId ? docTabs.indexOf(pane.activeTabId) : -1;
          const nextIdx = currentIdx < 0 || currentIdx >= docTabs.length - 1 ? 0 : currentIdx + 1;
          workspace.switchTab(docTabs[nextIdx]);
          syncFileStoresFromTab();
        },
      }),

      // Cmd+1 through Cmd+9 / Ctrl+1 through Ctrl+9: Switch to tab N
      ...Array.from({ length: 9 }, (_, i) =>
        shortcutManager.register({
          key: String(i + 1),
          meta: true,
          handler: () => {
            const pane = workspace.focusedPane;
            if (!pane) return;
            const docTabs = pane.tabOrder.filter((id) => workspace.tabs[id]?.kind === 'document');
            const tabIndex = i; // 0-based: Cmd+1 = index 0
            if (tabIndex < docTabs.length) {
              workspace.switchTab(docTabs[tabIndex]);
              syncFileStoresFromTab();
            }
          },
        })
      ),

      // Cmd+E / Ctrl+E: Toggle editor/preview mode
      shortcutManager.register({
        key: 'e',
        meta: true,
        handler: () => {
          if (!get(graphViewActive)) {
            toggleEditorMode();
          }
        },
      }),

      // Cmd+S / Ctrl+S: Global save (works in wysiwyg mode too)
      shortcutManager.register({
        key: 's',
        meta: true,
        handler: () => {
          const mode = get(editorMode);
          if (mode === 'wysiwyg') {
            requestSave();
          }
          // In editor mode, CodeMirror's own keymap handles Cmd+S
        },
      }),

      // Escape: Close settings if open
      shortcutManager.register({
        key: 'Escape',
        handler: () => {
          if (get(settingsOpen)) {
            settingsOpen.set(false);
          }
        },
      }),

      // Cmd+Shift+N / Ctrl+Shift+N: Open new window
      shortcutManager.register({
        key: 'n',
        meta: true,
        shift: true,
        handler: () => {
          window.api.newWindow();
        },
      }),

      // Cmd+, / Ctrl+,: Toggle settings panel
      shortcutManager.register({
        key: ',',
        meta: true,
        handler: () => {
          settingsOpen.update((v) => !v);
        },
      }),

      // Cmd+[ / Ctrl+[: Navigate back
      shortcutManager.register({
        key: '[',
        meta: true,
        handler: () => {
          const path = goBack();
          if (path) {
            setNavigating(true);
            workspace.replaceTab(path);
            syncFileStoresFromTab();
            setNavigating(false);
          }
        },
      }),

      // Cmd+] / Ctrl+]: Navigate forward
      shortcutManager.register({
        key: ']',
        meta: true,
        handler: () => {
          const path = goForward();
          if (path) {
            setNavigating(true);
            workspace.replaceTab(path);
            syncFileStoresFromTab();
            setNavigating(false);
          }
        },
      }),

      // Tab: Cycle focus forward through regions (sidebar → editor → metadata)
      shortcutManager.register({
        key: 'Tab',
        handler: (event) => {
          // Only handle Tab if we're not in an input/textarea
          const target = event.target as HTMLElement;
          if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
            return;
          }

          cycleFocus(false);
        },
        preventDefault: true,
      }),

      // Shift+Tab: Cycle focus backward through regions
      shortcutManager.register({
        key: 'Tab',
        shift: true,
        handler: (event) => {
          // Only handle Shift+Tab if we're not in an input/textarea
          const target = event.target as HTMLElement;
          if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
            return;
          }

          cycleFocus(true);
        },
        preventDefault: true,
      }),
    ];

    // Attach shortcut manager to document
    shortcutManager.attach();

    // Click-away to close search
    function handleClickAway(e: MouseEvent) {
      if (searchAreaEl && !searchAreaEl.contains(e.target as Node)) {
        clearSearch();
        searchOpen.set(false);
      }
    }

    document.addEventListener('mousedown', handleClickAway);

    // Reset all collection-dependent state when switching collections
    let firstRun = true;
    const unsub = activeCollectionId.subscribe(() => {
      // Skip the initial subscription fire — state is already clean on mount
      if (firstRun) {
        firstRun = false;
        return;
      }
      // Clear file selection, tree, properties, and editor state FIRST
      // to prevent stale paths from being used in CLI calls
      resetFileState();
      resetEditorState();
      clearSearch();
      clearNavigation();
      clearWatcherEvents();
      // Reset graph state (clears old data immediately) then reload if active
      const wasGraphActive = get(graphViewActive);
      resetGraphState();
      if (wasGraphActive) {
        loadGraphData();
      }
    });

    return () => {
      // Unregister all shortcuts
      unregisterShortcuts.forEach((unregister) => unregister());
      shortcutManager.detach();
      document.removeEventListener('mousedown', handleClickAway);
      teardownWatcherListener();
      teardownUpdateListener();
      window.api.removeMenuOpenRecentListener();
      unsub();
      unsubAccent();
      unsubCollectionColor();
      unsubTheme();
      unsubThemeTokens();
      cleanupSystemPref();
    };
  });

  function handleNavigate(detail: { id: string }) {
    setActiveCollection(detail.id);
  }

  function handleFileSelect(detail: { folderId: string; fileId: string; forceNewTab?: boolean }) {
    recordNavigation(detail.fileId);
    workspace.openFile(detail.fileId, { forceNewTab: detail.forceNewTab });
    syncFileStoresFromTab();
  }

  function navigateToResult(result: SearchResult) {
    recordNavigation(result.file.path);
    workspace.openFile(result.file.path);
    syncFileStoresFromTab();
    // Wait for loading to finish, then scroll to the result line
    let wasLoading = false;
    const unsub = fileContentLoading.subscribe((loading) => {
      if (loading) { wasLoading = true; return; }
      if (wasLoading) {
        // Defer scroll so the editor's content $effect creates the view first
        requestAnimationFrame(() => {
          scrollToLine.set(result.chunk.start_line);
        });
        unsub();
      }
    });
    clearSearch();
    searchOpen.set(false);
  }

  function handleToggleProperties(detail: { open: boolean }) {
    propertiesOpen = detail.open;
    localStorage.setItem('mdvdb-properties-open', String(propertiesOpen));
  }

  /**
   * Cycle focus between the three main regions: sidebar, editor, and metadata panel.
   * @param reverse - If true, cycle backward (Shift+Tab), otherwise forward (Tab)
   */
  function cycleFocus(reverse: boolean = false) {
    const regions = [sidebarEl, editorEl, propertiesOpen ? propertiesEl : null].filter(Boolean) as HTMLElement[];

    if (regions.length === 0) return;

    // Find currently focused region
    const activeElement = document.activeElement as HTMLElement;
    let currentIndex = -1;

    for (let i = 0; i < regions.length; i++) {
      if (regions[i] === activeElement || regions[i].contains(activeElement)) {
        currentIndex = i;
        break;
      }
    }

    // Calculate next index
    let nextIndex: number;
    if (currentIndex === -1) {
      // No region focused, start at the beginning
      nextIndex = reverse ? regions.length - 1 : 0;
    } else {
      if (reverse) {
        nextIndex = (currentIndex - 1 + regions.length) % regions.length;
      } else {
        nextIndex = (currentIndex + 1) % regions.length;
      }
    }

    // Focus the next region
    regions[nextIndex]?.focus();
  }

</script>

{#if !$onboardingComplete}
  <Onboarding />
{:else}
<!-- Skip navigation link for accessibility -->
<a href="#main-content" class="skip-link">Skip to main content</a>

<div class="app-shell bg-grain" style="--editor-font-size: {$editorFontSize}px">
  <UpdateNotification />
  <div class="titlebar-region" bind:this={searchAreaEl}>
    <Titlebar
      bind:propertiesOpen
      onsearchresultclick={navigateToResult}
      ontoggleproperties={handleToggleProperties}
    />
  </div>

  <div class="body-region">
    <div class="sidebar-region" bind:this={sidebarEl} tabindex="-1" role="navigation" aria-label="File navigation">
      <Sidebar
        onnavigate={handleNavigate}
        onfileselect={handleFileSelect}
      />
    </div>

    <main class="main-area">
      <div class="content-area">
          <div id="main-content" class="tab-pane-region" bind:this={editorEl} tabindex="-1">
            <SplitPaneContainer />
          </div>
          {#if propertiesOpen}
            <div class="properties-region" bind:this={propertiesEl} tabindex="-1" role="complementary" aria-label="File metadata">
              <PropertiesPanel onfileselect={(detail) => handleFileSelect({ folderId: '', fileId: detail.path })} />
            </div>
          {/if}
      </div>

      <StatusBar />
    </main>
  </div>

  {#if $settingsOpen}
    <Settings onclose={() => settingsOpen.set(false)} />
  {/if}
  <IngestModal />
  <QuickOpen />
</div>
{/if}

<style>
  /* Skip link for accessibility - only visible on keyboard focus */
  .skip-link {
    position: absolute;
    top: -40px;
    left: 0;
    background: var(--color-primary, #00E5FF);
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
    outline: 2px solid var(--color-text-main, #e4e4e7);
    outline-offset: 2px;
  }

  .app-shell {
    display: flex;
    flex-direction: column;
    height: 100vh;
    width: 100vw;
    overflow: hidden;
    background: var(--color-background, #0f0f10);
    color: var(--color-text-main, #e4e4e7);
    font-family: var(--font-display, 'Space Grotesk', sans-serif);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    position: relative;
  }

  .app-shell::selection,
  .app-shell :global(::selection) {
    background: var(--color-primary, #00E5FF);
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
