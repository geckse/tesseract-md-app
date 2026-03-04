<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import Sidebar from './components/Sidebar.svelte';
  import Titlebar from './components/Titlebar.svelte';
  import StatusBar from './components/StatusBar.svelte';
  import Editor from './components/Editor.svelte';
  import PropertiesPanel from './components/PropertiesPanel.svelte';
  import GraphView from './components/GraphView.svelte';
  import GraphPreview from './components/GraphPreview.svelte';
  import IngestModal from './components/IngestModal.svelte';
  import QuickOpen from './components/QuickOpen.svelte';
  import { loadCollections, setActiveCollection, activeCollectionId } from './stores/collections';
  import { selectFile, fileContentLoading } from './stores/files';
  import { searchOpen, clearSearch } from './stores/search';
  import { scrollToLine } from './stores/editor';
  import { loadFavorites } from './stores/favorites';
  import { openQuickOpen } from './stores/quickopen';
  import { shortcutManager } from './lib/shortcuts';
  import { setupWatcherListener, teardownWatcherListener, fetchWatcherStatus } from './stores/watcher';
  import { graphViewActive, graphSelectedNode, toggleGraphView, selectGraphNode, loadGraphData } from './stores/graph';
  import type { SearchResult } from './types/cli';


  let propertiesOpen = $state(localStorage.getItem('mdvdb-properties-open') === 'true');
  let searchAreaEl: HTMLElement | undefined = $state(undefined);

  // Focus management refs for Tab navigation
  let sidebarEl: HTMLElement | undefined = $state(undefined);
  let editorEl: HTMLElement | undefined = $state(undefined);
  let propertiesEl: HTMLElement | undefined = $state(undefined);

  onMount(() => {
    loadCollections();
    loadFavorites();
    setupWatcherListener();
    fetchWatcherStatus();

    // Listen for native menu "Open Recent" clicks
    window.api.onMenuOpenRecent(({ collectionId, filePath }) => {
      setActiveCollection(collectionId);
      // Small delay to let collection switch propagate before selecting file
      setTimeout(() => selectFile(filePath), 50);
    });

    // Register keyboard shortcuts
    const unregisterShortcuts = [
      // Cmd+P / Ctrl+P: Open quick file finder
      shortcutManager.register({
        key: 'p',
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

      // Cmd+W / Ctrl+W: Deselect file
      shortcutManager.register({
        key: 'w',
        meta: true,
        handler: () => {
          selectFile(null);
        },
      }),

      // Cmd+G / Ctrl+G: Toggle graph view
      shortcutManager.register({
        key: 'g',
        meta: true,
        handler: () => {
          toggleGraphView();
        },
      }),

      // Escape: Deselect graph node or exit graph view
      shortcutManager.register({
        key: 'Escape',
        handler: () => {
          if ($graphViewActive) {
            if ($graphSelectedNode) {
              selectGraphNode(null);
            } else {
              toggleGraphView();
            }
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

    // Clear search and reload graph when active collection changes
    const unsub = activeCollectionId.subscribe(() => {
      clearSearch();
      if (get(graphViewActive)) {
        loadGraphData();
      }
    });

    return () => {
      // Unregister all shortcuts
      unregisterShortcuts.forEach((unregister) => unregister());
      shortcutManager.detach();
      document.removeEventListener('mousedown', handleClickAway);
      teardownWatcherListener();
      window.api.removeMenuOpenRecentListener();
      unsub();
    };
  });

  function handleNavigate(detail: { id: string }) {
    setActiveCollection(detail.id);
  }

  function handleFileSelect(detail: { folderId: string; fileId: string }) {
    selectFile(detail.fileId);
  }

  function navigateToResult(result: SearchResult) {
    selectFile(result.file.path);
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

<!-- Skip navigation link for accessibility -->
<a href="#main-content" class="skip-link">Skip to main content</a>

<div class="app-shell bg-grain">
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
        {#if $graphViewActive}
          <div id="main-content" class="graph-region" tabindex="-1" role="main" aria-label="Graph view">
            <GraphView />
          </div>
          {#if $graphSelectedNode}
            <div class="preview-region" role="complementary" aria-label="File preview">
              <GraphPreview />
            </div>
          {/if}
        {:else}
          <div id="main-content" class="editor-region" bind:this={editorEl} tabindex="-1" role="main" aria-label="Editor">
            <Editor />
          </div>
          {#if propertiesOpen}
            <div class="properties-region" bind:this={propertiesEl} tabindex="-1" role="complementary" aria-label="File metadata">
              <PropertiesPanel onfileselect={(detail) => handleFileSelect({ folderId: '', fileId: detail.path })} />
            </div>
          {/if}
        {/if}
      </div>

      <StatusBar />
    </main>
  </div>

  <IngestModal />
  <QuickOpen />
</div>

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

  .editor-region {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .properties-region {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .graph-region {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .preview-region {
    display: flex;
    flex-direction: column;
    height: 100%;
  }
</style>
