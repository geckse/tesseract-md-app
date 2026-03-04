<script lang="ts">
  import { onDestroy } from 'svelte';
  import { fade } from 'svelte/transition';
  import {
    searchQuery,
    searchResults,
    searchLoading,
    searchMode,
    searchError,
    highlightedIndex,
    setSearchMode,
  } from '../stores/search';
  import { activeCollection } from '../stores/collections';
  import type { SearchResult, SearchMode } from '../types/cli';
  import { calculateVirtualListState, throttleScroll } from '../lib/virtual-list';

  interface SearchResultsProps {
    onresultclick?: (result: SearchResult) => void;
    oncloserequest?: () => void;
  }

  let { onresultclick, oncloserequest }: SearchResultsProps = $props();

  let currentQuery = $state('');
  const unsub1 = searchQuery.subscribe((v) => (currentQuery = v));

  let currentResults: import('../types/cli').SearchOutput | null = $state(null);
  const unsub2 = searchResults.subscribe((v) => (currentResults = v));

  let currentLoading = $state(false);
  const unsub3 = searchLoading.subscribe((v) => (currentLoading = v));

  let currentMode: SearchMode = $state('hybrid');
  const unsub4 = searchMode.subscribe((v) => (currentMode = v));

  let currentError: string | null = $state(null);
  const unsub5 = searchError.subscribe((v) => (currentError = v));

  let currentHighlighted = $state(-1);
  const unsub6 = highlightedIndex.subscribe((v) => (currentHighlighted = v));

  let currentCollection: import('../../preload/api').Collection | null = $state(null);
  const unsub7 = activeCollection.subscribe((v) => (currentCollection = v));

  onDestroy(() => {
    unsub1(); unsub2(); unsub3(); unsub4(); unsub5(); unsub6(); unsub7();
  });

  let results = $derived(currentResults?.results ?? []);
  let totalResults = $derived(currentResults?.total_results ?? 0);
  let hasQuery = $derived(currentQuery.length >= 2);
  let hasResults = $derived(results.length > 0);

  const modes: SearchMode[] = ['hybrid', 'semantic', 'lexical'];

  // Virtual list configuration
  const VIRTUAL_LIST_THRESHOLD = 20;
  const ITEM_HEIGHT = 100; // Approximate height of each result card in pixels
  const CONTAINER_HEIGHT = 600; // Approximate max-height of results list (60vh)

  let scrollTop = $state(0);
  let useVirtualList = $derived(results.length > VIRTUAL_LIST_THRESHOLD);
  let virtualState = $derived(
    useVirtualList
      ? calculateVirtualListState(scrollTop, CONTAINER_HEIGHT, {
          itemHeight: ITEM_HEIGHT,
          totalItems: results.length,
          buffer: 5,
        })
      : null
  );
  let visibleResults = $derived(
    virtualState ? results.slice(virtualState.start, virtualState.end) : results
  );

  const handleScroll = throttleScroll((scrollTopValue: number) => {
    scrollTop = scrollTopValue;
  });

  function handleModeClick(mode: SearchMode) {
    setSearchMode(mode);
  }

  function handleResultClick(result: SearchResult) {
    onresultclick?.(result);
  }

  function handleOverlayClick(event: MouseEvent) {
    if (event.target === event.currentTarget) {
      oncloserequest?.();
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="search-results-overlay" onclick={handleOverlayClick}>
  <div class="search-results" transition:fade={{ duration: 150 }}>
    <!-- Screen reader announcements for search results -->
    <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {#if currentLoading}
        Searching...
      {:else if currentError}
        Search error: {currentError}
      {:else if hasQuery && hasResults}
        Found {totalResults} result{totalResults !== 1 ? 's' : ''} for {currentQuery}
      {:else if hasQuery && !hasResults}
        No results found for {currentQuery}
      {/if}
    </div>

    <!-- Mode toggle pills -->
    <div class="mode-bar">
      <div class="mode-pills">
        {#each modes as mode}
          <button
            class="mode-pill"
            class:active={currentMode === mode}
            onclick={() => handleModeClick(mode)}
          >
            {mode}
          </button>
        {/each}
      </div>
      {#if hasQuery && hasResults}
        <span class="results-count">{totalResults} result{totalResults !== 1 ? 's' : ''}</span>
      {/if}
    </div>

    <!-- Content area -->
    <div class="results-list" onscroll={handleScroll}>
      {#if currentLoading}
        <div class="state-message">
          <div class="spinner"></div>
          <span>Searching…</span>
        </div>
      {:else if currentError}
        <div class="state-message error">{currentError}</div>
      {:else if hasQuery && !hasResults}
        <div class="state-message">No results for "{currentQuery}"</div>
      {:else if !hasQuery}
        <div class="state-message">Type to search across {currentCollection?.name ?? 'collection'}</div>
      {:else if useVirtualList && virtualState}
        <!-- Virtual list for >20 results -->
        <div class="virtual-container" style="height: {virtualState.totalHeight}px;">
          {#each visibleResults as result, i (result.chunk.id ?? `${result.file.path}:${virtualState.start + i}`)}
            {@const actualIndex = virtualState.start + i}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="result-card virtual-item"
              class:highlighted={currentHighlighted === actualIndex}
              onclick={() => handleResultClick(result)}
              style="transform: translateY({actualIndex * ITEM_HEIGHT}px); height: {ITEM_HEIGHT}px;"
            >
              <div class="result-path">{result.file.path}</div>
              {#if result.chunk.heading_hierarchy.length > 0}
                <div class="result-heading">{result.chunk.heading_hierarchy.join(' > ')}</div>
              {/if}
              <div class="score-bar-track">
                <div class="score-bar-fill" style="width: {result.score * 100}%"></div>
              </div>
              <div class="result-snippet">{result.chunk.content}</div>
            </div>
          {/each}
        </div>
      {:else}
        <!-- Normal list for <=20 results -->
        {#each results as result, i (result.chunk.id ?? `${result.file.path}:${i}`)}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="result-card"
            class:highlighted={currentHighlighted === i}
            onclick={() => handleResultClick(result)}
            transition:fade={{ duration: 150 }}
          >
            <div class="result-path">{result.file.path}</div>
            {#if result.chunk.heading_hierarchy.length > 0}
              <div class="result-heading">{result.chunk.heading_hierarchy.join(' > ')}</div>
            {/if}
            <div class="score-bar-track">
              <div class="score-bar-fill" style="width: {result.score * 100}%"></div>
            </div>
            <div class="result-snippet">{result.chunk.content}</div>
          </div>
        {/each}
      {/if}
    </div>
  </div>
</div>

<style>
  .search-results-overlay {
    position: absolute;
    top: 100%;
    left: 0;
    right: 0;
    z-index: var(--z-overlay, 40);
    padding: 4px 0 0;
  }

  .search-results {
    background: var(--color-surface, #161617);
    border: 1px solid var(--color-border, #27272a);
    border-radius: var(--radius-lg, 8px);
    max-height: 60vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  }

  .mode-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 12px;
    border-bottom: 1px solid var(--color-border, #27272a);
  }

  .mode-pills {
    display: flex;
    gap: 4px;
  }

  .mode-pill {
    padding: 4px 10px;
    border: none;
    border-radius: var(--radius-full, 9999px);
    font-size: var(--text-xs, 10px);
    font-family: var(--font-mono, monospace);
    cursor: pointer;
    transition: all var(--transition-fast, 150ms ease);
    background: var(--color-surface-dark, #0a0a0a);
    color: var(--color-text-dim, #71717a);
    text-transform: capitalize;
  }

  .mode-pill.active {
    background: var(--color-primary, #00E5FF);
    color: var(--color-bg, #0f0f10);
    font-weight: var(--weight-medium, 500);
  }

  .mode-pill:hover:not(.active) {
    color: var(--color-text, #e4e4e7);
  }

  .results-count {
    font-size: var(--text-xs, 10px);
    color: var(--color-text-dim, #71717a);
    font-family: var(--font-mono, monospace);
  }

  .results-list {
    overflow-y: auto;
    flex: 1;
  }

  .state-message {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    padding: 24px 16px;
    color: var(--color-text-dim, #71717a);
    font-size: var(--text-sm, 12px);
    font-family: var(--font-mono, monospace);
  }

  .state-message.error {
    color: var(--color-error, #ef4444);
  }

  .spinner {
    width: 16px;
    height: 16px;
    border: 2px solid var(--color-border, #27272a);
    border-top-color: var(--color-primary, #00E5FF);
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .result-card {
    padding: 10px 12px;
    cursor: pointer;
    border-left: 2px solid transparent;
    transition: all var(--transition-fast, 150ms ease);
  }

  .result-card:hover {
    background: var(--color-surface-dark, #0a0a0a);
  }

  .result-card.highlighted {
    background: var(--color-surface-dark, #0a0a0a);
    border-left-color: var(--color-primary, #00E5FF);
  }

  .result-path {
    font-family: var(--font-mono, monospace);
    font-size: var(--text-xs, 10px);
    color: var(--color-text-dim, #71717a);
    margin-bottom: 2px;
  }

  .result-heading {
    font-size: var(--text-sm, 12px);
    color: var(--color-primary, #00E5FF);
    margin-bottom: 4px;
    font-weight: var(--weight-medium, 500);
  }

  .score-bar-track {
    max-width: 80px;
    height: 4px;
    background: var(--color-surface-dark, #0a0a0a);
    border-radius: var(--radius-full, 9999px);
    margin-bottom: 4px;
    overflow: hidden;
  }

  .score-bar-fill {
    height: 100%;
    background: var(--color-primary, #00E5FF);
    border-radius: var(--radius-full, 9999px);
    transition: width var(--transition-fast, 150ms ease);
  }

  .result-snippet {
    font-size: var(--text-sm, 12px);
    color: var(--color-text-dim, #71717a);
    line-height: var(--leading-normal, 1.5);
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  /* Virtual list styles */
  .virtual-container {
    position: relative;
    width: 100%;
  }

  .virtual-item {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    will-change: transform;
  }

  /* Screen reader only - visually hidden but available to assistive tech */
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border-width: 0;
  }
</style>
