<script lang="ts">
  import { quickOpenModalOpen, closeQuickOpen } from '../stores/quickopen'
  import { flatFileList, syncFileStoresFromTab } from '../stores/files'
  import { activeCollection } from '../stores/collections'
  import { workspace } from '../stores/workspace.svelte'
  import { recordNavigation } from '../stores/navigation'
  import { fuzzyFilter } from '../lib/fuzzy-match'
  import type { FileTreeNode, SearchResultFile } from '../types/cli'

  interface QuickOpenResult {
    path: string
    label: string
    state: string | null
    matchIndices: number[]
  }

  let currentOpen = $state(false)
  let currentFiles: FileTreeNode[] = $state([])
  let currentCollection: import('../../preload/api').Collection | null = $state(null)
  let query = $state('')
  let selectedIndex = $state(0)
  let inputEl: HTMLInputElement | undefined = $state(undefined)

  // CLI search state
  let searchResults: QuickOpenResult[] = $state([])
  let searchLoading = $state(false)
  let searchGeneration = 0
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  quickOpenModalOpen.subscribe((v) => (currentOpen = v))
  flatFileList.subscribe((v) => (currentFiles = v))
  activeCollection.subscribe((v) => (currentCollection = v))

  // Default results: file tree (no query)
  let defaultResults = $derived<QuickOpenResult[]>(
    currentFiles.slice(0, 50).map((f) => ({
      path: f.path,
      label: f.path,
      state: f.state,
      matchIndices: [],
    }))
  )

  // Fuzzy-filtered results for instant local matching
  let fuzzyResults = $derived.by<QuickOpenResult[]>(() => {
    if (!query.trim()) return []
    return fuzzyFilter(query, currentFiles, (f) => f.path)
      .slice(0, 50)
      .map(({ item, match }) => ({
        path: item.path,
        label: item.path,
        state: item.state,
        matchIndices: match.indices,
      }))
  })

  // Display results: search results if available, fuzzy as fallback, default if no query
  let displayResults = $derived<QuickOpenResult[]>(
    query.trim()
      ? (searchResults.length > 0 ? searchResults : fuzzyResults)
      : defaultResults
  )

  async function runCliSearch(searchQuery: string): Promise<void> {
    if (!currentCollection || !searchQuery.trim()) {
      searchResults = []
      searchLoading = false
      return
    }

    const generation = ++searchGeneration
    searchLoading = true

    try {
      let result;
      try {
        result = await window.api.search(currentCollection.path, searchQuery, {
          mode: 'hybrid',
          limit: 20,
        })
      } catch {
        result = await window.api.search(currentCollection.path, searchQuery, {
          mode: 'lexical',
          limit: 20,
        })
      }

      if (generation !== searchGeneration) return

      // Deduplicate by file path
      const seen = new Set<string>()
      const deduped: QuickOpenResult[] = []
      for (const r of result.results) {
        if (!seen.has(r.file.path)) {
          seen.add(r.file.path)
          deduped.push({
            path: r.file.path,
            label: r.file.path,
            state: null,
            matchIndices: findMatchIndices(r.file.path, searchQuery),
          })
        }
      }

      searchResults = deduped
    } catch {
      if (generation !== searchGeneration) return
      searchResults = []
    } finally {
      if (generation === searchGeneration) {
        searchLoading = false
      }
    }
  }

  /** Find character indices in the path that match the query (simple substring highlight). */
  function findMatchIndices(path: string, q: string): number[] {
    const lower = path.toLowerCase()
    const qLower = q.toLowerCase()
    const idx = lower.indexOf(qLower)
    if (idx === -1) return []
    return Array.from({ length: qLower.length }, (_, i) => idx + i)
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      handleClose()
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (!currentOpen) return

    if (e.key === 'Escape') {
      e.preventDefault()
      handleClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      selectedIndex = Math.min(selectedIndex + 1, displayResults.length - 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      selectedIndex = Math.max(selectedIndex - 1, 0)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (displayResults[selectedIndex]) {
        handleSelect(displayResults[selectedIndex])
      }
    }
  }

  function handleSelect(result: QuickOpenResult) {
    recordNavigation(result.path)
    workspace.openFile(result.path)
    syncFileStoresFromTab()
    handleClose()
  }

  function handleClose() {
    closeQuickOpen()
    query = ''
    selectedIndex = 0
    searchResults = []
    searchLoading = false
    searchGeneration++
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
  }

  // Focus input when modal opens
  $effect(() => {
    if (currentOpen && inputEl) {
      requestAnimationFrame(() => {
        inputEl?.focus()
      })
    }
  })

  // Debounced CLI search on query change
  $effect(() => {
    const q = query

    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }

    selectedIndex = 0

    if (!q.trim()) {
      searchResults = []
      searchLoading = false
      return
    }

    // Start CLI search after debounce (fuzzy results show instantly)
    searchLoading = true
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      runCliSearch(q)
    }, 200)
  })

  function escapeHtml(text: string): string {
    const div = document.createElement('div')
    div.textContent = text
    return div.innerHTML
  }

  function highlightMatches(text: string, indices: number[]): string {
    if (indices.length === 0) return escapeHtml(text)

    let result = ''
    for (let i = 0; i < text.length; i++) {
      const char = escapeHtml(text[i])
      if (indices.includes(i)) {
        result += `<mark>${char}</mark>`
      } else {
        result += char
      }
    }
    return result
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if currentOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal-backdrop" onclick={handleBackdropClick}>
    <div class="modal-content" role="dialog" aria-modal="true" aria-label="Quick Open">

      <div class="search-box">
        <span class="material-symbols-outlined search-icon">search</span>
        <input
          bind:this={inputEl}
          bind:value={query}
          type="text"
          class="search-input"
          placeholder="Search files..."
          autocomplete="off"
          spellcheck="false"
        />
        {#if query}
          <button
            class="clear-btn"
            onclick={() => { query = '' }}
            aria-label="Clear search"
          >
            <span class="material-symbols-outlined">close</span>
          </button>
        {/if}
      </div>

      <div class="results-container">
        {#if displayResults.length === 0}
          <div class="no-results">
            <span class="material-symbols-outlined">folder_off</span>
            <p>{searchLoading ? 'Searching...' : 'No files found'}</p>
          </div>
        {:else}
          <div class="results-list">
            {#each displayResults as result, index}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="result-item"
                class:selected={index === selectedIndex}
                onclick={() => handleSelect(result)}
                onmouseenter={() => { selectedIndex = index }}
              >
                <span class="material-symbols-outlined file-icon">description</span>
                <span class="file-path">
                  {@html highlightMatches(result.label, result.matchIndices)}
                </span>
                {#if result.state}
                  <span class="file-state state-{result.state}">{result.state}</span>
                {/if}
              </div>
            {/each}
          </div>
        {/if}
      </div>

      <div class="footer">
        <div class="hints">
          <span class="hint"><kbd>↑</kbd><kbd>↓</kbd> Navigate</span>
          <span class="hint"><kbd>Enter</kbd> Open</span>
          <span class="hint"><kbd>Esc</kbd> Close</span>
        </div>
      </div>

    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(4px);
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
    width: 600px;
    max-width: 90vw;
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
    overflow: hidden;
  }

  .search-box {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px 20px;
    border-bottom: 1px solid var(--color-border, #27272a);
  }

  .search-icon {
    font-size: 20px;
    color: var(--color-text-dim, #71717a);
  }

  .search-input {
    flex: 1;
    background: transparent;
    border: none;
    outline: none;
    font-size: 15px;
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
    width: 24px;
    height: 24px;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    color: var(--color-text-dim, #71717a);
    transition: background 0.15s ease, color 0.15s ease;
  }

  .clear-btn:hover {
    background: var(--color-border, #27272a);
    color: var(--color-text, #e4e4e7);
  }

  .clear-btn .material-symbols-outlined {
    font-size: 18px;
  }

  .results-container {
    flex: 1;
    overflow-y: auto;
    min-height: 0;
  }

  .no-results {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 48px 24px;
    color: var(--color-text-dim, #71717a);
  }

  .no-results .material-symbols-outlined {
    font-size: 48px;
    margin-bottom: 12px;
    opacity: 0.5;
  }

  .no-results p {
    font-size: 14px;
    margin: 0;
  }

  .results-list {
    display: flex;
    flex-direction: column;
  }

  .result-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 20px;
    cursor: pointer;
    transition: background 0.1s ease;
    border-bottom: 1px solid rgba(39, 39, 42, 0.3);
  }

  .result-item:last-child {
    border-bottom: none;
  }

  .result-item:hover,
  .result-item.selected {
    background: var(--color-border, #27272a);
  }

  .result-item.selected {
    background: var(--color-primary-dim, rgba(0, 229, 255, 0.1));
  }

  .file-icon {
    font-size: 18px;
    color: var(--color-text-dim, #71717a);
    flex-shrink: 0;
  }

  .file-path {
    flex: 1;
    font-size: 13px;
    font-family: 'JetBrains Mono', monospace;
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

  .file-state {
    font-size: 10px;
    padding: 2px 6px;
    border-radius: 3px;
    font-weight: 600;
    text-transform: uppercase;
    flex-shrink: 0;
  }

  .state-indexed {
    background: rgba(34, 197, 94, 0.15);
    color: #22c55e;
  }

  .state-modified {
    background: rgba(234, 179, 8, 0.15);
    color: #eab308;
  }

  .state-new {
    background: var(--color-primary-dim, rgba(0, 229, 255, 0.15));
    color: var(--color-primary, #00E5FF);
  }

  .state-deleted {
    background: rgba(239, 68, 68, 0.15);
    color: #ef4444;
  }

  .footer {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    padding: 12px 20px;
    border-top: 1px solid var(--color-border, #27272a);
    background: rgba(0, 0, 0, 0.2);
  }

  .hints {
    display: flex;
    gap: 16px;
  }

  .hint {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    color: var(--color-text-dim, #71717a);
  }

  kbd {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 20px;
    height: 20px;
    padding: 0 6px;
    font-size: 10px;
    font-family: 'JetBrains Mono', monospace;
    font-weight: 600;
    background: var(--color-border, #27272a);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    color: var(--color-text, #e4e4e7);
  }
</style>
