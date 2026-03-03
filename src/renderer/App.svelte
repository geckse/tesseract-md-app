<script lang="ts">
  import { onMount } from 'svelte';
  import Sidebar from './components/Sidebar.svelte';
  import Header from './components/Header.svelte';
  import StatusBar from './components/StatusBar.svelte';
  import Editor from './components/Editor.svelte';
  import PropertiesPanel from './components/PropertiesPanel.svelte';
  import IngestModal from './components/IngestModal.svelte';
  import { loadCollections, setActiveCollection } from './stores/collections';
  import { selectFile } from './stores/files';


  let propertiesOpen = $state(false);

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
    propertiesOpen = detail.open;
  }

</script>

<div class="app-shell bg-grain">
  <Sidebar
    onnavigate={handleNavigate}
    onfileselect={handleFileSelect}
  />

  <main class="main-area">
    <Header
      bind:propertiesOpen
      onsearch={handleSearch}
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
