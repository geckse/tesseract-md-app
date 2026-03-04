<script lang="ts">
  import { onMount } from 'svelte';
  import Sidebar from './components/Sidebar.svelte';
  import Header from './components/Header.svelte';
  import StatusBar from './components/StatusBar.svelte';
  import Editor from './components/Editor.svelte';
  import PropertiesPanel from './components/PropertiesPanel.svelte';
  import IngestModal from './components/IngestModal.svelte';
  import { loadCollections, setActiveCollection, activeCollectionId } from './stores/collections';
  import { selectFile, fileContent } from './stores/files';
  import { searchOpen, clearSearch } from './stores/search';
  import { scrollToLine } from './stores/editor';
  import { toggleSidebar } from './stores/ui';
  import { shortcutManager } from './lib/shortcuts';
  import type { SearchResult } from './types/cli';


  let propertiesOpen = $state(localStorage.getItem('mdvdb-properties-open') === 'true');
  let searchAreaEl: HTMLElement | undefined = $state(undefined);

  onMount(() => {
    loadCollections();

    // Register keyboard shortcuts
    const unregisterShortcuts = [
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

</script>

<div class="app-shell bg-grain">
  <Sidebar
    onnavigate={handleNavigate}
    onfileselect={handleFileSelect}
  />

  <main class="main-area" bind:this={searchAreaEl}>
    <Header
      bind:propertiesOpen
      onsearchresultclick={navigateToResult}
      ontoggleproperties={handleToggleProperties}
    />

    <div class="content-area">
      <Editor />
      {#if propertiesOpen}
        <PropertiesPanel onfileselect={(detail) => handleFileSelect({ folderId: '', fileId: detail.path })} />
      {/if}
    </div>

    <StatusBar />
  </main>

  <IngestModal />
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
</style>
