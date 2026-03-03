<script lang="ts">
  import {
    searchQuery,
    searchResults,
    searchLoading,
    searchOpen,
    highlightedIndex,
    executeSearch,
    clearSearch,
  } from '../stores/search';
  import type { SearchOutput, SearchResult } from '../types/cli';

  interface SearchProps {
    onsearchresultclick?: (result: SearchResult) => void;
  }

  let { onsearchresultclick }: SearchProps = $props();

  let currentQuery = $state('');
  searchQuery.subscribe((v) => (currentQuery = v));

  let currentResults: SearchOutput | null = $state(null);
  searchResults.subscribe((v) => (currentResults = v));

  let currentLoading = $state(false);
  searchLoading.subscribe((v) => (currentLoading = v));

  let currentOpen = $state(false);
  searchOpen.subscribe((v) => (currentOpen = v));

  let currentHighlightedIndex = $state(-1);
  highlightedIndex.subscribe((v) => (currentHighlightedIndex = v));

  let inputEl: HTMLInputElement | undefined = $state();
  let focused = $state(false);

  // Auto-focus input when search opens (e.g. via Cmd+K)
  $effect(() => {
    if (currentOpen && inputEl) {
      inputEl.focus();
    }
  });

  function handleInput(event: Event) {
    const target = event.target as HTMLInputElement;
    const query = target.value;
    searchOpen.set(true);
    executeSearch(query);
  }

  function handleFocus() {
    focused = true;
  }

  function handleBlur() {
    focused = false;
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      clearSearch();
      inputEl?.blur();
      return;
    }

    const results = currentResults?.results ?? [];

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const next = currentHighlightedIndex + 1;
      highlightedIndex.set(next < results.length ? next : 0);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      const prev = currentHighlightedIndex - 1;
      highlightedIndex.set(prev >= 0 ? prev : results.length - 1);
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      if (results.length === 0) return;
      const idx = currentHighlightedIndex >= 0 ? currentHighlightedIndex : 0;
      const result = results[idx];
      if (result) {
        onsearchresultclick?.(result);
        clearSearch();
      }
    }
  }
</script>

<div class="search-wrapper">
  <span class="material-symbols-outlined search-icon">search</span>
  <input
    bind:this={inputEl}
    class="search-input"
    type="text"
    placeholder="Search database..."
    value={currentQuery}
    oninput={handleInput}
    onfocus={handleFocus}
    onblur={handleBlur}
    onkeydown={handleKeydown}
  />
  {#if !focused}
    <div class="search-shortcut">
      <kbd class="kbd"><span class="kbd-symbol">⌘</span>K</kbd>
    </div>
  {/if}
</div>

<style>
  .search-wrapper {
    position: relative;
    display: flex;
    align-items: center;
  }

  .search-icon {
    position: absolute;
    left: 12px;
    font-size: 18px;
    color: var(--color-text-dim, #71717a);
    pointer-events: none;
    transition: color 0.15s;
  }

  .search-wrapper:focus-within .search-icon {
    color: var(--color-primary, #00E5FF);
  }

  .search-input {
    background: var(--color-surface-darker, #0a0a0a);
    border: 1px solid var(--color-border, #27272a);
    border-radius: 6px;
    padding: 6px 48px 6px 36px;
    font-size: 12px;
    color: #fff;
    width: 224px;
    transition: all 0.2s;
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    outline: none;
  }

  .search-input::placeholder {
    color: rgba(113, 113, 122, 0.5);
  }

  .search-input:focus {
    border-color: var(--color-primary, #00E5FF);
    box-shadow: 0 0 0 1px var(--color-primary, #00E5FF);
    width: 288px;
  }

  .search-shortcut {
    position: absolute;
    right: 8px;
    pointer-events: none;
  }

  .kbd {
    display: inline-flex;
    height: 20px;
    align-items: center;
    gap: 2px;
    border-radius: 4px;
    border: 1px solid var(--color-border, #27272a);
    background: var(--color-surface, #161617);
    padding: 0 6px;
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: 10px;
    font-weight: 500;
    color: var(--color-text-dim, #71717a);
  }

  .kbd-symbol {
    font-size: 10px;
  }
</style>
