<script lang="ts">
  import { onMount } from 'svelte';
  import Sidebar from './components/Sidebar.svelte';
  import Header from './components/Header.svelte';
  import StatusBar from './components/StatusBar.svelte';
  import Editor from './components/Editor.svelte';
  import PropertiesPanel from './components/PropertiesPanel.svelte';
  import IngestModal from './components/IngestModal.svelte';
  import QuickOpen from './components/QuickOpen.svelte';
  import { loadCollections, setActiveCollection, activeCollectionId } from './stores/collections';
  import { selectFile, fileContent } from './stores/files';
  import { searchOpen, clearSearch } from './stores/search';
  import { scrollToLine } from './stores/editor';
  import { toggleSidebar } from './stores/ui';
  import { openQuickOpen } from './stores/quickopen';
  import { shortcutManager } from './lib/shortcuts';
  import type { SearchResult } from './types/cli';


  let propertiesOpen = $state(localStorage.getItem('mdvdb-properties-open') === 'true');
  let searchAreaEl: HTMLElement | undefined = $state(undefined);

  // Focus management refs for Tab navigation
  let sidebarEl: HTMLElement | undefined = $state(undefined);
  let editorEl: HTMLElement | undefined = $state(undefined);
  let propertiesEl: HTMLElement | undefined = $state(undefined);

  onMount(() => {
    loadCollections();

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

      // Cmd+B / Ctrl+B: Toggle sidebar
      shortcutManager.register({
        key: 'b',
        meta: true,
        handler: () => {
          toggleSidebar();
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

    // Clear search when active collection changes
    const unsub = activeCollectionId.subscribe(() => {
      clearSearch();
    });

    return () => {
      // Unregister all shortcuts
      unregisterShortcuts.forEach((unregister) => unregister());
      shortcutManager.detach();
      document.removeEventListener('mousedown', handleClickAway);
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
    // Track null→non-null transition to avoid race with stale content
    let sawNull = false;
    const unsub = fileContent.subscribe((content) => {
      if (content === null) { sawNull = true; return; }
      if (sawNull) {
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

<div class="app-shell bg-grain">
  <div class="sidebar-region" bind:this={sidebarEl} tabindex="-1">
    <Sidebar
      onnavigate={handleNavigate}
      onfileselect={handleFileSelect}
    />
  </div>

  <main class="main-area" bind:this={searchAreaEl}>
    <Header
      bind:propertiesOpen
      onsearchresultclick={navigateToResult}
      ontoggleproperties={handleToggleProperties}
    />

    <div class="content-area">
      <div class="editor-region" bind:this={editorEl} tabindex="-1">
        <Editor />
      </div>
      {#if propertiesOpen}
        <div class="properties-region" bind:this={propertiesEl} tabindex="-1">
          <PropertiesPanel onfileselect={(detail) => handleFileSelect({ folderId: '', fileId: detail.path })} />
        </div>
      {/if}
    </div>

    <StatusBar />
  </main>

  <IngestModal />
  <QuickOpen />
</div>

<style>
  .app-shell {
    display: flex;
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

  .sidebar-region {
    display: flex;
    flex-direction: column;
    height: 100%;
    outline: none;
  }

  .sidebar-region:focus-within {
    outline: 2px solid var(--color-primary, #00E5FF);
    outline-offset: -2px;
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
    outline: none;
  }

  .editor-region:focus-within {
    outline: 2px solid var(--color-primary, #00E5FF);
    outline-offset: -2px;
  }

  .properties-region {
    display: flex;
    flex-direction: column;
    height: 100%;
    outline: none;
  }

  .properties-region:focus-within {
    outline: 2px solid var(--color-primary, #00E5FF);
    outline-offset: -2px;
  }
</style>
