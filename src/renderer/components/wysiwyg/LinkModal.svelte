<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { Editor } from '@tiptap/core';
  import { activeCollection } from '../../stores/collections';
  import { flatFileList } from '../../stores/files';
  import { fuzzyFilter } from '../../lib/fuzzy-match';
  import type { FileTreeNode } from '../../types/cli';

  interface Props {
    editor: Editor;
    initialQuery?: string;
    onclose: () => void;
  }

  let { editor, initialQuery = '', onclose }: Props = $props();

  let inputEl: HTMLInputElement | undefined = $state(undefined);
  let query = $state(initialQuery);
  let selectedIndex = $state(0);
  let currentCollection: import('../../../preload/api').Collection | null = $state(null);
  let currentFiles: FileTreeNode[] = $state([]);

  const unsubCollection = activeCollection.subscribe((v) => (currentCollection = v));
  const unsubFiles = flatFileList.subscribe((v) => (currentFiles = v));

  // CLI search state
  let searchResults: ResultItem[] = $state([]);
  let searchLoading = $state(false);
  let searchGeneration = 0;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  interface ResultItem {
    path: string;
    label: string;
    type: 'file' | 'url';
    matchIndices: number[];
  }

  // Check if query looks like a URL
  function isUrl(q: string): boolean {
    return /^(https?:\/\/|mailto:|\/|\.\/|\.\.\/)/.test(q.trim());
  }

  // Fuzzy local results
  let fuzzyResults = $derived.by<ResultItem[]>(() => {
    const q = query.trim();
    if (!q || isUrl(q)) return [];
    return fuzzyFilter(q, currentFiles, (f) => f.path)
      .slice(0, 8)
      .map(({ item, match }) => ({
        path: item.path,
        label: item.path,
        type: 'file' as const,
        matchIndices: match.indices,
      }));
  });

  // Combined display results
  let displayResults = $derived.by<ResultItem[]>(() => {
    const q = query.trim();
    if (!q) {
      // Show recent files
      return currentFiles.slice(0, 8).map((f) => ({
        path: f.path,
        label: f.path,
        type: 'file' as const,
        matchIndices: [],
      }));
    }

    const results: ResultItem[] = [];

    // If it looks like a URL, show it as the first option
    if (isUrl(q)) {
      results.push({
        path: q,
        label: q,
        type: 'url',
        matchIndices: [],
      });
    }

    // Add search results (CLI or fuzzy fallback)
    if (searchResults.length > 0) {
      results.push(...searchResults);
    } else {
      results.push(...fuzzyResults);
    }

    return results;
  });

  async function runCliSearch(searchQuery: string): Promise<void> {
    if (!currentCollection || !searchQuery.trim() || isUrl(searchQuery)) {
      searchResults = [];
      searchLoading = false;
      return;
    }

    const generation = ++searchGeneration;
    searchLoading = true;

    try {
      let result;
      try {
        result = await window.api.search(currentCollection.path, searchQuery, {
          mode: 'hybrid',
          limit: 10,
        });
      } catch {
        result = await window.api.search(currentCollection.path, searchQuery, {
          mode: 'lexical',
          limit: 10,
        });
      }

      if (generation !== searchGeneration) return;

      const seen = new Set<string>();
      const deduped: ResultItem[] = [];
      for (const r of result.results) {
        if (!seen.has(r.file.path)) {
          seen.add(r.file.path);
          deduped.push({
            path: r.file.path,
            label: r.file.path,
            type: 'file',
            matchIndices: findMatchIndices(r.file.path, searchQuery),
          });
        }
      }
      searchResults = deduped;
    } catch {
      if (generation !== searchGeneration) return;
      searchResults = [];
    } finally {
      if (generation === searchGeneration) searchLoading = false;
    }
  }

  function findMatchIndices(path: string, q: string): number[] {
    const lower = path.toLowerCase();
    const qLower = q.toLowerCase();
    const idx = lower.indexOf(qLower);
    if (idx === -1) return [];
    return Array.from({ length: qLower.length }, (_, i) => idx + i);
  }

  function handleSelect(item: ResultItem) {
    const { from, to } = editor.state.selection;
    const hasSelection = from !== to;

    if (hasSelection) {
      // Text is selected — extend to full link mark range, remove old link, set new one
      const chain = editor.chain().focus();
      if (editor.isActive('link')) {
        chain.extendMarkRange('link');
      }
      chain.unsetLink().setLink({ href: item.path }).run();
    } else if (item.type === 'url') {
      // No selection, external URL — insert as linked text
      editor
        .chain()
        .focus()
        .insertContent(`<a href="${item.path}">${item.path}</a>`)
        .run();
    } else {
      // No selection, internal document — insert as wikilink
      editor
        .chain()
        .focus()
        .insertContent({
          type: 'wikilink',
          attrs: {
            target: item.path,
            anchor: null,
            display: null,
          },
        })
        .run();
    }
    onclose();
  }

  function handleSubmit() {
    const q = query.trim();
    if (!q) return;

    if (displayResults[selectedIndex]) {
      handleSelect(displayResults[selectedIndex]);
      return;
    }

    // Treat raw input as URL
    if (isUrl(q)) {
      editor.chain().focus().setLink({ href: q }).run();
      onclose();
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      editor.commands.focus();
      onclose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, displayResults.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, 0);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      editor.commands.focus();
      onclose();
    }
  }

  // Debounced CLI search
  $effect(() => {
    const q = query;
    if (debounceTimer) clearTimeout(debounceTimer);
    selectedIndex = 0;

    if (!q.trim() || isUrl(q)) {
      searchResults = [];
      searchLoading = false;
      return;
    }

    searchLoading = true;
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      runCliSearch(q);
    }, 200);
  });

  onMount(() => {
    requestAnimationFrame(() => inputEl?.focus());
  });

  onDestroy(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    searchGeneration++;
    unsubCollection();
    unsubFiles();
  });

  function escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function highlightMatches(text: string, indices: number[]): string {
    if (indices.length === 0) return escapeHtml(text);
    let result = '';
    for (let i = 0; i < text.length; i++) {
      const char = escapeHtml(text[i]);
      if (indices.includes(i)) {
        result += `<mark>${char}</mark>`;
      } else {
        result += char;
      }
    }
    return result;
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-backdrop" onclick={handleBackdropClick}>
  <div class="modal-content" role="dialog" aria-modal="true" aria-label="Add link">
    <div class="search-box">
      <span class="material-symbols-outlined search-icon">link</span>
      <input
        bind:this={inputEl}
        bind:value={query}
        type="text"
        class="search-input"
        placeholder="Search files or paste a URL..."
        autocomplete="off"
        spellcheck="false"
        onkeydown={handleKeydown}
      />
      {#if query}
        <button class="clear-btn" onclick={() => { query = ''; }} aria-label="Clear">
          <span class="material-symbols-outlined">close</span>
        </button>
      {/if}
    </div>

    <div class="results-container">
      {#if displayResults.length === 0}
        <div class="no-results">
          <p>{searchLoading ? 'Searching...' : 'Type to search files or paste a URL'}</p>
        </div>
      {:else}
        <div class="results-list">
          {#each displayResults as item, index}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="result-item"
              class:selected={index === selectedIndex}
              onclick={() => handleSelect(item)}
              onmouseenter={() => { selectedIndex = index; }}
            >
              <span class="material-symbols-outlined file-icon">
                {item.type === 'url' ? 'language' : 'description'}
              </span>
              <span class="file-path">
                {@html highlightMatches(item.label, item.matchIndices)}
              </span>
              <span class="result-type">{item.type === 'url' ? 'URL' : 'File'}</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <div class="footer">
      <span class="hint"><kbd>Enter</kbd> Select</span>
      <span class="hint"><kbd>Esc</kbd> Cancel</span>
    </div>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.5);
    backdrop-filter: blur(2px);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 15vh;
    z-index: 100;
  }

  .modal-content {
    background: var(--color-surface, #161617);
    border: 1px solid var(--color-border, #27272a);
    border-radius: 8px;
    width: 500px;
    max-width: 90vw;
    max-height: 60vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
    overflow: hidden;
  }

  .search-box {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 14px 16px;
    border-bottom: 1px solid var(--color-border, #27272a);
  }

  .search-icon {
    font-size: 18px;
    color: var(--color-primary, #00E5FF);
  }

  .search-input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    font-size: 14px;
    font-family: inherit;
    color: var(--color-text, #e4e4e7);
  }

  .search-input::placeholder {
    color: var(--color-text-dim, #71717a);
  }

  .clear-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    color: var(--color-text-dim, #71717a);
  }

  .clear-btn:hover {
    background: var(--color-border, #27272a);
    color: var(--color-text, #e4e4e7);
  }

  .clear-btn .material-symbols-outlined {
    font-size: 16px;
  }

  .results-container {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
  }

  .no-results {
    padding: 24px 16px;
    text-align: center;
    color: var(--color-text-dim, #71717a);
    font-size: 13px;
  }

  .no-results p {
    margin: 0;
  }

  .results-list {
    display: flex;
    flex-direction: column;
  }

  .result-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 16px;
    cursor: pointer;
    transition: background 0.1s ease;
  }

  .result-item:hover,
  .result-item.selected {
    background: var(--color-primary-dim, rgba(0, 229, 255, 0.1));
  }

  .file-icon {
    font-size: 16px;
    color: var(--color-text-dim, #71717a);
    flex-shrink: 0;
  }

  .file-path {
    flex: 1;
    font-size: 13px;
    font-family: var(--font-mono, monospace);
    color: var(--color-text, #e4e4e7);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file-path :global(mark) {
    background: transparent;
    color: var(--color-primary, #00E5FF);
    font-weight: 600;
  }

  .result-type {
    font-size: 10px;
    padding: 1px 5px;
    border-radius: 3px;
    font-weight: 600;
    text-transform: uppercase;
    flex-shrink: 0;
    background: rgba(255, 255, 255, 0.06);
    color: var(--color-text-dim, #71717a);
  }

  .footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 14px;
    padding: 10px 16px;
    border-top: 1px solid var(--color-border, #27272a);
    background: rgba(0, 0, 0, 0.2);
  }

  .hint {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    color: var(--color-text-dim, #71717a);
  }

  kbd {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    font-size: 10px;
    font-family: var(--font-mono, monospace);
    font-weight: 600;
    background: var(--color-border, #27272a);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 3px;
    color: var(--color-text, #e4e4e7);
  }
</style>
