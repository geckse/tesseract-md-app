<script lang="ts">
  import { onMount } from 'svelte';
  import type { Snippet } from 'svelte';
  import Sidebar from './components/Sidebar.svelte';
  import Header from './components/Header.svelte';
  import StatusBar from './components/StatusBar.svelte';
  import { loadCollections, setActiveCollection } from './stores/collections';
  import { selectFile } from './stores/files';

  let { children }: { children?: Snippet } = $props();

  onMount(() => {
    loadCollections();
  });

  function handleNavigate(detail: { id: string }) {
    setActiveCollection(detail.id);
  }

  function handleFileSelect(detail: { folderId: string; fileId: string }) {
    selectFile(detail.fileId);
  }

  function handleSearch(detail: { query: string }) {
    // TODO: handle search (Phase 6)
  }

  function handleToggleProperties(detail: { open: boolean }) {
    // TODO: handle properties panel toggle
  }

  function handleEdit() {
    // TODO: handle edit mode
  }
</script>

<div class="app-shell bg-grain">
  <Sidebar
    onnavigate={handleNavigate}
    onfileselect={handleFileSelect}
  />

  <main class="main-area">
    <Header
      onsearch={handleSearch}
      ontoggleproperties={handleToggleProperties}
      onedit={handleEdit}
    />

    <div class="content-area">
      <div class="content-scroll">
        <div class="content-inner">
          {@render children?.()}
        </div>
      </div>
    </div>

    <StatusBar />
  </main>
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
    overflow: hidden;
    position: relative;
  }

  .content-scroll {
    flex: 1;
    overflow-y: auto;
    position: relative;
    z-index: 10;
  }

  .content-inner {
    max-width: 768px;
    margin: 0 auto;
    padding: 64px 40px;
  }
</style>
