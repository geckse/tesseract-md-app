<script lang="ts">
  import Sidebar from './components/Sidebar.svelte';
  import Header from './components/Header.svelte';
  import StatusBar from './components/StatusBar.svelte';

  function handleNavigate(event: CustomEvent<{ id: string }>) {
    // TODO: handle navigation
  }

  function handleFileSelect(event: CustomEvent<{ folderId: string; fileId: string }>) {
    // TODO: handle file selection
  }

  function handleSearch(event: CustomEvent<{ query: string }>) {
    // TODO: handle search
  }

  function handleToggleProperties(event: CustomEvent<{ open: boolean }>) {
    // TODO: handle properties panel toggle
  }

  function handleEdit() {
    // TODO: handle edit mode
  }
</script>

<div class="app-shell bg-grain">
  <Sidebar
    on:navigate={handleNavigate}
    on:file-select={handleFileSelect}
  />

  <main class="main-area">
    <Header
      on:search={handleSearch}
      on:toggle-properties={handleToggleProperties}
      on:edit={handleEdit}
    />

    <div class="content-area">
      <div class="content-scroll">
        <div class="content-inner">
          <slot />
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
