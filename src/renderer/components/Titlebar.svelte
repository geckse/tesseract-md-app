<script lang="ts">
  import { searchOpen, clearSearch } from '../stores/search'
  import { graphViewActive, toggleGraphView } from '../stores/graph'
  import { canGoBack, canGoForward, goBack, goForward, setNavigating } from '../stores/navigation'
  import { syncFileStoresFromTab } from '../stores/files'
  import { workspace } from '../stores/workspace.svelte'
  import { propertiesOpen as propertiesOpenStore, togglePropertiesPanel } from '../stores/ui'
  import type { SearchResult } from '../types/cli'
  import Search from './Search.svelte'
  import SearchResults from './SearchResults.svelte'

  interface TitlebarProps {
    onsearchresultclick?: (result: SearchResult) => void
  }

  let { onsearchresultclick }: TitlebarProps = $props()

  let propertiesOpen = $state(false)
  propertiesOpenStore.subscribe((v) => (propertiesOpen = v))

  let currentGraphActive = $state(false)
  graphViewActive.subscribe((v) => (currentGraphActive = v))

  let currentSearchOpen = $state(false)
  searchOpen.subscribe((v) => (currentSearchOpen = v))

  let currentCanGoBack = $state(false)
  canGoBack.subscribe((v) => (currentCanGoBack = v))

  let currentCanGoForward = $state(false)
  canGoForward.subscribe((v) => (currentCanGoForward = v))

  function handleBack() {
    const path = goBack()
    if (path) {
      setNavigating(true)
      workspace.replaceTab(path)
      syncFileStoresFromTab()
      setNavigating(false)
    }
  }

  function handleForward() {
    const path = goForward()
    if (path) {
      setNavigating(true)
      workspace.replaceTab(path)
      syncFileStoresFromTab()
      setNavigating(false)
    }
  }

  function handleResultClick(result: SearchResult) {
    onsearchresultclick?.(result)
  }

  function handleCloseRequest() {
    clearSearch()
  }

  function toggleProperties() {
    togglePropertiesPanel()
  }
</script>

<div class="titlebar">
  <div class="titlebar-left">
    <div class="nav-arrows">
      <button
        class="nav-button"
        class:disabled={!currentCanGoBack}
        disabled={!currentCanGoBack}
        title="Go Back"
        onclick={handleBack}
      >
        <span class="material-symbols-outlined">arrow_back</span>
      </button>
      <button
        class="nav-button"
        class:disabled={!currentCanGoForward}
        disabled={!currentCanGoForward}
        title="Go Forward"
        onclick={handleForward}
      >
        <span class="material-symbols-outlined">arrow_forward</span>
      </button>
    </div>
  </div>

  <div class="titlebar-center">
    <Search onsearchresultclick={handleResultClick} />
  </div>

  <div class="titlebar-right">
    <button
      class="icon-button"
      class:active={currentGraphActive}
      title="Toggle Graph View"
      onclick={toggleGraphView}
    >
      <span class="material-symbols-outlined">hub</span>
    </button>

    <button
      class="icon-button"
      class:active={propertiesOpen}
      title="Toggle Properties"
      onclick={toggleProperties}
    >
      <span class="material-symbols-outlined">side_navigation</span>
    </button>
  </div>
</div>

{#if currentSearchOpen}
  <div class="search-results-anchor">
    <SearchResults onresultclick={handleResultClick} oncloserequest={handleCloseRequest} />
  </div>
{/if}

<style>
  .titlebar {
    height: 35px;
    min-height: 35px;
    width: 100%;
    display: flex;
    align-items: center;
    background: var(--color-surface-darker, #0a0a0a);
    -webkit-app-region: drag;
    border-bottom: 1px solid var(--color-border, #27272a);
    z-index: 35;
    padding: 0 12px 7px 12px;
    box-sizing: border-box;
  }

  /* macOS: inset traffic lights sit in the top-left corner */
  :global([data-platform='darwin']) .titlebar {
    padding-left: 80px;
  }

  /* Windows/Linux (Window Controls Overlay): keep our buttons clear of the
     native minimize/maximize/close controls drawn over the top-right corner.
     env(titlebar-area-width) is the drag-safe width left of the controls. */
  :global([data-platform='win32']) .titlebar,
  :global([data-platform='linux']) .titlebar {
    padding-right: calc(100vw - env(titlebar-area-width, 100vw) + 12px);
  }

  .titlebar-left {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
  }

  .titlebar-center {
    -webkit-app-region: no-drag;
    flex-shrink: 0;
  }

  .titlebar-right {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 8px;
  }

  .search-results-anchor {
    position: absolute;
    top: 35px;
    left: 50%;
    transform: translateX(-50%);
    width: 600px;
    max-width: 90vw;
    z-index: var(--z-overlay, 40);
  }

  .icon-button {
    -webkit-app-region: no-drag;
    padding: 6px;
    color: var(--color-text-dim, #71717a);
    background: none;
    border: none;
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.15s;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .icon-button:hover,
  .icon-button.active {
    color: var(--color-primary, #00e5ff);
    background: var(--color-surface-darker, #0a0a0a);
  }

  .icon-button .material-symbols-outlined {
    font-size: 18px;
  }

  /* ── Navigation arrows ─────────────────────── */

  .nav-arrows {
    -webkit-app-region: no-drag;
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .nav-button {
    -webkit-app-region: no-drag;
    padding: 4px;
    color: var(--color-text-dim, #71717a);
    background: none;
    border: none;
    border-radius: 5px;
    cursor: pointer;
    transition: all 0.15s;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .nav-button:hover:not(:disabled) {
    color: var(--color-text, #e4e4e7);
    background: var(--color-surface-darker, #0a0a0a);
  }

  .nav-button:disabled {
    color: var(--color-text-dim, #71717a);
    opacity: 0.3;
    cursor: default;
  }

  .nav-button .material-symbols-outlined {
    font-size: 16px;
  }

  @media (prefers-reduced-motion: reduce) {
    .nav-button {
      transition: none;
    }
  }
</style>
