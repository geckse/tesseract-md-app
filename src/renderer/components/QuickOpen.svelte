<script lang="ts">
  import { quickOpenModalOpen, closeQuickOpen } from '../stores/quickopen'
  import { flatFileList, selectFile } from '../stores/files'
  import { fuzzyFilter } from '../lib/fuzzy-match'
  import type { FileTreeNode } from '../types/cli'

  let currentOpen = $state(false)
  let currentFiles: FileTreeNode[] = $state([])
  let query = $state('')
  let selectedIndex = $state(0)
  let inputEl: HTMLInputElement | undefined = $state(undefined)

  quickOpenModalOpen.subscribe((v) => (currentOpen = v))
  flatFileList.subscribe((v) => (currentFiles = v))

  let filteredFiles = $derived.by(() => {
    if (!query.trim()) {
      return currentFiles.slice(0, 50).map(item => ({ item, match: { score: 0, indices: [] } }))
    }
    return fuzzyFilter(query, currentFiles, (f) => f.path).slice(0, 50)
  })

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
      selectedIndex = Math.min(selectedIndex + 1, filteredFiles.length - 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      selectedIndex = Math.max(selectedIndex - 1, 0)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (filteredFiles[selectedIndex]) {
        handleSelect(filteredFiles[selectedIndex].item)
      }
    }
  }

  function handleSelect(file: FileTreeNode) {
    selectFile(file.path)
    handleClose()
  }

  function handleClose() {
    closeQuickOpen()
    query = ''
    selectedIndex = 0
  }

  // Focus input when modal opens
  $effect(() => {
    if (currentOpen && inputEl) {
      requestAnimationFrame(() => {
        inputEl?.focus()
      })
    }
  })

  // Reset selected index when query changes
  $effect(() => {
    query // track query changes
    selectedIndex = 0
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
        {#if filteredFiles.length === 0}
          <div class="no-results">
            <span class="material-symbols-outlined">folder_off</span>
            <p>No files found</p>
          </div>
        {:else}
          <div class="results-list">
            {#each filteredFiles as { item, match }, index}
              <!-- svelte-ignore a11y_click_events_have_key_events -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="result-item"
                class:selected={index === selectedIndex}
                onclick={() => handleSelect(item)}
                onmouseenter={() => { selectedIndex = index }}
              >
                <span class="material-symbols-outlined file-icon">description</span>
                <span class="file-path">
                  {@html highlightMatches(item.path, match.indices)}
                </span>
                {#if item.state}
                  <span class="file-state state-{item.state}">{item.state}</span>
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
    background: rgba(0, 229, 255, 0.1);
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
    background: rgba(0, 229, 255, 0.15);
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
