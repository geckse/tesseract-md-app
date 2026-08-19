<script lang="ts">
  import { quickOpenModalOpen, closeQuickOpen } from '../stores/quickopen'
  import { flatFileList, loadAssetTree, loadFileTree, syncFileStoresFromTab } from '../stores/files'
  import { activeCollection, collections, setActiveCollection } from '../stores/collections'
  import { workspace } from '../stores/workspace.svelte'
  import { recordNavigation } from '../stores/navigation'
  import { fuzzyFilter } from '../lib/fuzzy-match'
  import type { CollectionRow, FileTreeNode, JsonValue } from '../types/cli'
  import type { Collection } from '../../preload/api'
  import { activeScopePath, isPathInShard, pathRelativeToShard } from '../stores/shards'

  type QuickOpenTab = 'documents' | 'data' | 'collection'

  interface QuickOpenResult {
    key: string
    kind: 'document' | 'collection'
    path: string
    label: string
    detail: string | null
    icon: string
    state: string | null
    badge: string | null
    matchIndices: number[]
    collection?: Collection
  }

  const tabs: Array<{ id: QuickOpenTab; label: string }> = [
    { id: 'documents', label: 'Documents' },
    { id: 'data', label: 'Data' },
    { id: 'collection', label: 'Collection' }
  ]

  let currentOpen = $state(false)
  let currentFiles: FileTreeNode[] = $state([])
  let currentCollections: Collection[] = $state([])
  let currentCollection: import('../../preload/api').Collection | null = $state(null)
  let currentScopePath: string | null = $state(null)
  let activeTab = $state<QuickOpenTab>('documents')
  let query = $state('')
  let selectedIndex = $state(0)
  let inputEl: HTMLInputElement | undefined = $state(undefined)
  let modalEl: HTMLDivElement | undefined = $state(undefined)
  let resultsEl: HTMLDivElement | undefined = $state(undefined)
  let returnFocusEl: HTMLElement | null = null
  let wasOpen = false

  // Document-search state. Only the Documents tab invokes mdvdb search.
  let searchResults: QuickOpenResult[] = $state([])
  let searchLoading = $state(false)
  let searchGeneration = 0
  let debounceTimer: ReturnType<typeof setTimeout> | null = null

  // Frontmatter rows are loaded lazily once per modal collection/scope.
  let dataRows: CollectionRow[] = $state([])
  let dataLoading = $state(false)
  let dataError = $state<string | null>(null)
  let dataLoadedKey = $state<string | null>(null)
  let dataGeneration = 0

  quickOpenModalOpen.subscribe((v) => (currentOpen = v))
  flatFileList.subscribe((v) => (currentFiles = v))
  collections.subscribe((v) => (currentCollections = v))
  activeCollection.subscribe((v) => (currentCollection = v))
  activeScopePath.subscribe((v) => (currentScopePath = v))

  let scopedFiles = $derived(
    currentFiles.filter((file) => isPathInShard(file.path, currentScopePath))
  )

  // Default results: file tree (no query)
  let defaultResults = $derived<QuickOpenResult[]>(
    scopedFiles.slice(0, 50).map((f) => ({
      key: `document:${f.path}`,
      kind: 'document',
      path: f.path,
      label: pathRelativeToShard(f.path, currentScopePath),
      detail: null,
      icon: 'description',
      state: f.state,
      badge: null,
      matchIndices: []
    }))
  )

  // Fuzzy-filtered results for instant local matching
  let fuzzyResults = $derived.by<QuickOpenResult[]>(() => {
    if (!query.trim()) return []
    const candidates = scopedFiles.map((file) => ({
      file,
      label: pathRelativeToShard(file.path, currentScopePath)
    }))
    return fuzzyFilter(query, candidates, (candidate) => candidate.label)
      .slice(0, 50)
      .map(({ item, match }) => ({
        key: `document:${item.file.path}`,
        kind: 'document' as const,
        path: item.file.path,
        label: item.label,
        detail: null,
        icon: 'description',
        state: item.file.state,
        badge: null,
        matchIndices: match.indices
      }))
  })

  let documentResults = $derived<QuickOpenResult[]>(
    query.trim() ? (searchResults.length > 0 ? searchResults : fuzzyResults) : defaultResults
  )

  function formatFrontmatterValue(value: JsonValue): string {
    if (value === null) return 'null'
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }

  function frontmatterEntries(row: CollectionRow): Array<[string, string]> {
    return Object.entries(row.frontmatter).map(([key, value]) => [
      key,
      formatFrontmatterValue(value)
    ])
  }

  function dataDetail(entries: Array<[string, string]>, needle: string): string {
    const matching = needle
      ? entries.filter(([key, value]) => `${key}: ${value}`.toLocaleLowerCase().includes(needle))
      : entries
    const preview = (matching.length > 0 ? matching : entries)
      .slice(0, 2)
      .map(([key, value]) => `${key}: ${value}`)
      .join(' · ')
    return preview
  }

  let dataResults = $derived.by<QuickOpenResult[]>(() => {
    const needle = query.trim().toLocaleLowerCase()
    const terms = needle.split(/\s+/).filter(Boolean)
    const results: QuickOpenResult[] = []

    for (const row of dataRows) {
      const entries = frontmatterEntries(row)
      if (entries.length === 0) continue
      const searchable = entries
        .map(([key, value]) => `${key}: ${value}`)
        .join('\n')
        .toLocaleLowerCase()
      if (terms.length > 0 && !terms.every((term) => searchable.includes(term))) continue

      results.push({
        key: `data:${row.path}`,
        kind: 'document',
        path: row.path,
        label: pathRelativeToShard(row.path, currentScopePath),
        detail: dataDetail(entries, needle),
        icon: 'database',
        state: row.state,
        badge: null,
        matchIndices: []
      })
      if (results.length >= 50) break
    }
    return results
  })

  let collectionResults = $derived.by<QuickOpenResult[]>(() => {
    const needle = query.trim().toLocaleLowerCase()
    return currentCollections
      .filter(
        (collection) =>
          !needle ||
          collection.name.toLocaleLowerCase().includes(needle) ||
          collection.path.toLocaleLowerCase().includes(needle)
      )
      .slice(0, 50)
      .map((collection) => ({
        key: `collection:${collection.id}`,
        kind: 'collection' as const,
        path: collection.path,
        label: collection.name,
        detail: collection.path,
        icon: collection.id === currentCollection?.id ? 'folder_open' : 'folder',
        state: null,
        badge: collection.id === currentCollection?.id ? 'Current' : null,
        matchIndices: findMatchIndices(collection.name, query),
        collection
      }))
  })

  let displayResults = $derived.by<QuickOpenResult[]>(() => {
    if (activeTab === 'data') return dataResults
    if (activeTab === 'collection') return collectionResults
    return documentResults
  })

  let placeholder = $derived(
    activeTab === 'data'
      ? 'Search frontmatter...'
      : activeTab === 'collection'
        ? 'Search collections...'
        : 'Search files...'
  )

  let emptyMessage = $derived(
    activeTab === 'data'
      ? dataLoading
        ? 'Loading frontmatter...'
        : !currentCollection
          ? 'No collection selected'
          : dataError
            ? dataError
            : query.trim()
              ? 'No frontmatter matches found'
              : 'No frontmatter found'
      : activeTab === 'collection'
        ? 'No collections found'
        : searchLoading
          ? 'Searching...'
          : 'No files found'
  )

  async function runCliSearch(searchQuery: string, generation: number): Promise<void> {
    if (!currentCollection || !searchQuery.trim()) {
      searchResults = []
      searchLoading = false
      return
    }

    searchLoading = true

    try {
      let result
      try {
        result = await window.api.search(currentCollection.path, searchQuery, {
          mode: 'hybrid',
          limit: 20,
          path: currentScopePath ?? undefined
        })
      } catch {
        result = await window.api.search(currentCollection.path, searchQuery, {
          mode: 'lexical',
          limit: 20,
          path: currentScopePath ?? undefined
        })
      }

      if (generation !== searchGeneration) return

      // Deduplicate by file path
      const seen = new Set<string>()
      const deduped: QuickOpenResult[] = []
      for (const r of result.results) {
        if (isPathInShard(r.file.path, currentScopePath) && !seen.has(r.file.path)) {
          seen.add(r.file.path)
          const label = pathRelativeToShard(r.file.path, currentScopePath)
          deduped.push({
            key: `document:${r.file.path}`,
            kind: 'document',
            path: r.file.path,
            label,
            detail: null,
            icon: 'description',
            state: null,
            badge: null,
            matchIndices: findMatchIndices(label, searchQuery)
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
    } else if (e.key === 'Tab') {
      trapFocus(e)
    } else if (e.key === 'ArrowDown') {
      if ((e.target as HTMLElement | null)?.closest('[role="tab"]')) return
      if (displayResults.length === 0) return
      e.preventDefault()
      selectedIndex = Math.min(selectedIndex + 1, displayResults.length - 1)
    } else if (e.key === 'ArrowUp') {
      if ((e.target as HTMLElement | null)?.closest('[role="tab"]')) return
      if (displayResults.length === 0) return
      e.preventDefault()
      selectedIndex = Math.max(selectedIndex - 1, 0)
    } else if (e.key === 'Enter') {
      if ((e.target as HTMLElement | null)?.closest('[role="tab"]')) return
      e.preventDefault()
      if (displayResults[selectedIndex]) {
        void handleSelect(displayResults[selectedIndex])
      }
    }
  }

  async function handleSelect(result: QuickOpenResult): Promise<void> {
    if (result.kind === 'collection' && result.collection) {
      const collection = result.collection
      const needsSwitch = collection.id !== currentCollection?.id
      handleClose()
      if (!needsSwitch) return
      try {
        await setActiveCollection(collection.id)
        await Promise.all([loadFileTree(), loadAssetTree()])
      } catch (error) {
        console.error('Quick Open collection switch failed:', error)
      }
      return
    }

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
    activeTab = 'documents'
    dataRows = []
    dataLoading = false
    dataError = null
    dataLoadedKey = null
    dataGeneration++
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
  }

  function trapFocus(event: KeyboardEvent): void {
    if (!modalEl) return
    const focusable = Array.from(
      modalEl.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    )
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  function setTab(tab: QuickOpenTab, focusSearch = false): void {
    if (activeTab === tab) {
      if (focusSearch) requestAnimationFrame(() => inputEl?.focus())
      return
    }
    activeTab = tab
    selectedIndex = 0
    searchResults = []
    searchGeneration++
    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }
    if (focusSearch) requestAnimationFrame(() => inputEl?.focus())
  }

  function handleTabKeydown(event: KeyboardEvent, index: number): void {
    let nextIndex = index
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % tabs.length
    else if (event.key === 'ArrowLeft') nextIndex = (index - 1 + tabs.length) % tabs.length
    else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = tabs.length - 1
    else return

    event.preventDefault()
    setTab(tabs[nextIndex].id)
    requestAnimationFrame(() => {
      modalEl?.querySelector<HTMLButtonElement>(`#quick-open-${tabs[nextIndex].id}-tab`)?.focus()
    })
  }

  async function loadFrontmatterRows(
    collection: Collection,
    scope: string | null,
    key: string
  ): Promise<void> {
    const generation = ++dataGeneration
    dataLoading = true
    dataError = null
    try {
      const output = await window.api.collection(collection.path, scope ?? '', {
        recursive: true,
        limit: 0
      })
      if (generation !== dataGeneration || dataLoadedKey !== key) return
      dataRows = output.rows.filter(
        (row) => row.state !== 'deleted' && isPathInShard(row.path, scope)
      )
    } catch (error) {
      if (generation !== dataGeneration || dataLoadedKey !== key) return
      dataRows = []
      dataError = error instanceof Error ? error.message : 'Unable to load frontmatter.'
    } finally {
      if (generation === dataGeneration && dataLoadedKey === key) dataLoading = false
    }
  }

  function retryFrontmatter(): void {
    dataLoadedKey = null
    dataError = null
  }

  // Focus the search field on open and restore the previous focus on close.
  $effect(() => {
    if (currentOpen && !wasOpen) {
      wasOpen = true
      returnFocusEl = document.activeElement as HTMLElement | null
      requestAnimationFrame(() => {
        inputEl?.focus()
      })
    } else if (!currentOpen && wasOpen) {
      wasOpen = false
      const target = returnFocusEl
      returnFocusEl = null
      requestAnimationFrame(() => target?.focus())
    }
  })

  // Load Data lazily from the collection API. That contract exposes raw
  // frontmatter and respects the active Shard scope.
  $effect(() => {
    const collection = currentCollection
    const scope = currentScopePath
    if (!currentOpen || activeTab !== 'data' || !collection) return
    const key = `${collection.id}\n${scope ?? ''}`
    if (dataLoadedKey === key) return
    dataLoadedKey = key
    void loadFrontmatterRows(collection, scope, key)
  })

  // Debounced CLI search on query change
  $effect(() => {
    const q = query
    const tab = activeTab
    const open = currentOpen
    void currentCollection?.id
    void currentScopePath

    if (debounceTimer) {
      clearTimeout(debounceTimer)
      debounceTimer = null
    }

    selectedIndex = 0

    if (!open || tab !== 'documents' || !q.trim()) {
      searchResults = []
      searchLoading = false
      searchGeneration++
      return
    }

    // Start CLI search after debounce (fuzzy results show instantly)
    searchLoading = true
    const generation = ++searchGeneration
    debounceTimer = setTimeout(() => {
      debounceTimer = null
      void runCliSearch(q, generation)
    }, 200)
  })

  $effect(() => {
    const length = displayResults.length
    if (length === 0) selectedIndex = 0
    else if (selectedIndex >= length) selectedIndex = length - 1
  })

  $effect(() => {
    void selectedIndex
    void displayResults.length
    requestAnimationFrame(() => {
      resultsEl
        ?.querySelector<HTMLElement>(`[data-result-index="${selectedIndex}"]`)
        ?.scrollIntoView({ block: 'nearest' })
    })
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
    <div
      bind:this={modalEl}
      class="modal-content"
      role="dialog"
      aria-modal="true"
      aria-label="Quick Open"
    >
      <div class="search-box">
        <span class="material-symbols-outlined search-icon">search</span>
        <input
          bind:this={inputEl}
          bind:value={query}
          type="text"
          class="search-input"
          {placeholder}
          aria-label={placeholder}
          autocomplete="off"
          spellcheck="false"
        />
        {#if query}
          <button
            class="clear-btn"
            onclick={() => {
              query = ''
            }}
            aria-label="Clear search"
          >
            <span class="material-symbols-outlined">close</span>
          </button>
        {/if}
        {#if (activeTab === 'documents' && searchLoading) || (activeTab === 'data' && dataLoading)}
          <span class="material-symbols-outlined loading-icon" aria-hidden="true">
            progress_activity
          </span>
        {/if}
      </div>

      <div class="tabs" role="tablist" aria-label="Quick Open category">
        {#each tabs as tab, index (tab.id)}
          <button
            id="quick-open-{tab.id}-tab"
            class:active={activeTab === tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            aria-controls="quick-open-results"
            tabindex={activeTab === tab.id ? 0 : -1}
            onclick={() => setTab(tab.id, true)}
            onkeydown={(event) => handleTabKeydown(event, index)}
          >
            {tab.label}
          </button>
        {/each}
      </div>

      <div
        bind:this={resultsEl}
        id="quick-open-results"
        class="results-container"
        role="tabpanel"
        aria-labelledby="quick-open-{activeTab}-tab"
        aria-live="polite"
      >
        {#if displayResults.length === 0}
          <div class="no-results">
            <span class="material-symbols-outlined">
              {activeTab === 'data'
                ? 'database_off'
                : activeTab === 'collection'
                  ? 'folder_off'
                  : 'description'}
            </span>
            <p>{emptyMessage}</p>
            {#if activeTab === 'data' && dataError}
              <button class="retry-btn" onclick={retryFrontmatter}>Retry</button>
            {/if}
          </div>
        {:else}
          <div
            class="results-list"
            role="listbox"
            aria-label={`${tabs.find((tab) => tab.id === activeTab)?.label} results`}
          >
            {#each displayResults as result, index (result.key)}
              <button
                class="result-item"
                class:selected={index === selectedIndex}
                role="option"
                aria-selected={index === selectedIndex}
                aria-label={`${result.label}${result.detail ? ` — ${result.detail}` : ''}${result.badge ? ` — ${result.badge}` : ''}`}
                data-result-index={index}
                onclick={() => void handleSelect(result)}
                onmouseenter={() => {
                  selectedIndex = index
                }}
              >
                <span class="material-symbols-outlined file-icon">{result.icon}</span>
                <span class="result-copy">
                  <span class="file-path">
                    <!-- eslint-disable-next-line svelte/no-at-html-tags -->
                    {@html highlightMatches(result.label, result.matchIndices)}
                  </span>
                  {#if result.detail}
                    <span class="result-detail">{result.detail}</span>
                  {/if}
                </span>
                {#if result.state}
                  <span class="file-state state-{result.state}">{result.state}</span>
                {/if}
                {#if result.badge}
                  <span class="result-badge">{result.badge}</span>
                {/if}
              </button>
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
    transition:
      background 0.15s ease,
      color 0.15s ease;
  }

  .clear-btn:hover {
    background: var(--color-border, #27272a);
    color: var(--color-text, #e4e4e7);
  }

  .clear-btn .material-symbols-outlined {
    font-size: 18px;
  }

  .loading-icon {
    color: var(--color-primary, #00e5ff);
    font-size: 18px;
    animation: quick-open-spin 0.9s linear infinite;
  }

  @keyframes quick-open-spin {
    to {
      transform: rotate(360deg);
    }
  }

  .tabs {
    display: flex;
    gap: 4px;
    padding: 8px 12px 0;
    border-bottom: 1px solid var(--color-border, #27272a);
  }

  .tabs button {
    position: relative;
    padding: 8px 12px 9px;
    border: 0;
    background: transparent;
    color: var(--color-text-dim, #71717a);
    font: inherit;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition:
      color 0.15s ease,
      background 0.15s ease;
  }

  .tabs button:hover,
  .tabs button:focus-visible {
    border-radius: 5px 5px 0 0;
    background: rgba(255, 255, 255, 0.04);
    color: var(--color-text, #e4e4e7);
    outline: none;
  }

  .tabs button.active {
    color: var(--color-primary, #00e5ff);
  }

  .tabs button.active::after {
    position: absolute;
    right: 8px;
    bottom: -1px;
    left: 8px;
    height: 2px;
    border-radius: 2px 2px 0 0;
    background: var(--color-primary, #00e5ff);
    content: '';
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

  .retry-btn {
    margin-top: 14px;
    padding: 6px 12px;
    border: 1px solid var(--color-border, #27272a);
    border-radius: 5px;
    background: transparent;
    color: var(--color-text, #e4e4e7);
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }

  .retry-btn:hover,
  .retry-btn:focus-visible {
    border-color: var(--color-primary, #00e5ff);
    color: var(--color-primary, #00e5ff);
    outline: none;
  }

  .results-list {
    display: flex;
    flex-direction: column;
  }

  .result-item {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 10px 20px;
    border: 0;
    border-bottom: 1px solid rgba(39, 39, 42, 0.3);
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition: background 0.1s ease;
  }

  .result-item:last-child {
    border-bottom: none;
  }

  .result-item:hover,
  .result-item.selected,
  .result-item:focus-visible {
    background: var(--color-border, #27272a);
    outline: none;
  }

  .result-item.selected {
    background: var(--color-primary-dim, rgba(0, 229, 255, 0.1));
  }

  .file-icon {
    font-size: 18px;
    color: var(--color-text-dim, #71717a);
    flex-shrink: 0;
  }

  .result-copy {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
    gap: 3px;
  }

  .file-path {
    font-size: 13px;
    font-family: 'JetBrains Mono', monospace;
    color: var(--color-text, #e4e4e7);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .result-detail {
    overflow: hidden;
    color: var(--color-text-dim, #71717a);
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    line-height: 1.35;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file-path :global(mark) {
    background: transparent;
    color: var(--color-primary, #00e5ff);
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

  .result-badge {
    flex-shrink: 0;
    padding: 2px 6px;
    border-radius: 3px;
    background: var(--color-primary-dim, rgba(0, 229, 255, 0.15));
    color: var(--color-primary, #00e5ff);
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
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
    color: var(--color-primary, #00e5ff);
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
    border: 1px solid var(--overlay-active, rgba(255, 255, 255, 0.1));
    border-radius: 4px;
    color: var(--color-text, #e4e4e7);
  }

  @media (prefers-reduced-motion: reduce) {
    .clear-btn,
    .tabs button,
    .result-item {
      transition: none;
    }

    .loading-icon {
      animation: none;
    }
  }
</style>
