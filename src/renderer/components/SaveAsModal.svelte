<script lang="ts">
  import { get } from 'svelte/store'
  import { workspace } from '../stores/workspace.svelte'
  import type { DocumentTab } from '../stores/workspace.svelte'
  import { activeCollection } from '../stores/collections'
  import { unifiedTree, insertFileNode } from '../stores/files'
  import { syncFileStoresFromTab } from '../stores/files'
  import { requestSave } from '../stores/editor'
  import { loadProperties } from '../stores/properties'
  import type { UnifiedTreeNode } from '../types/cli'

  interface SaveAsModalProps {
    tabId: string
    onclose: () => void
    onsaved?: (filePath: string) => void
  }

  let {
    tabId,
    onclose,
    onsaved,
  }: SaveAsModalProps = $props()

  let filename = $state('')
  let selectedDir = $state('')
  let error = $state<string | null>(null)
  let saving = $state(false)
  let inputEl: HTMLInputElement | undefined = $state(undefined)

  // Extract the tab to get the default filename
  const tab = $derived(workspace.tabs[tabId] as DocumentTab | undefined)

  // Initialize filename from tab title (strip .md for the input)
  $effect(() => {
    if (tab && !filename) {
      const name = tab.title.replace(/\.md$/, '')
      filename = name
    }
  })

  // Focus input on mount
  $effect(() => {
    if (inputEl) {
      inputEl.focus()
      inputEl.select()
    }
  })

  // Extract directory paths from the unified tree
  let currentTree: UnifiedTreeNode | null = $state(null)
  unifiedTree.subscribe((v) => (currentTree = v))

  const directories = $derived.by(() => {
    const dirs: string[] = [''] // Root (collection root)
    if (!currentTree) return dirs

    function walk(nodes: UnifiedTreeNode[]) {
      for (const node of nodes) {
        if (node.is_dir) {
          dirs.push(node.path)
          if (node.children) walk(node.children)
        }
      }
    }
    walk(currentTree.children)
    return dirs.sort()
  })

  async function handleSave() {
    if (!tab || !filename.trim()) return
    const collection = get(activeCollection)
    if (!collection) return

    error = null
    saving = true

    // Auto-append .md if no extension
    let finalFilename = filename.trim()
    if (!finalFilename.includes('.')) {
      finalFilename = finalFilename + '.md'
    }

    const relativePath = selectedDir ? `${selectedDir}/${finalFilename}` : finalFilename
    const absolutePath = `${collection.path}/${relativePath}`

    try {
      // Get content from the tab
      const content = tab.content ?? ''

      // Create the file on disk
      await window.api.createFile(absolutePath, content)

      // Finalize the tab — update its path and clear untitled flag
      workspace.finalizeUntitledTab(tabId, relativePath)

      // Update savedContent to mark as clean
      const updatedTab = workspace.tabs[tabId]
      if (updatedTab && updatedTab.kind === 'document') {
        updatedTab.savedContent = content
        updatedTab.isDirty = false
      }

      // Insert into tree locally — no full reload needed
      insertFileNode(relativePath, 'new')

      syncFileStoresFromTab()

      // Trigger a normal editor save so the editor pool entry updates its
      // lastSavedContent and sets the grace period — prevents the "file
      // changed on disk" conflict banner from appearing.
      requestSave()

      // Reload properties panel (document info, backlinks) for the new path
      loadProperties(relativePath)

      onsaved?.(relativePath)
      onclose()
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      saving = false
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSave()
    } else if (e.key === 'Escape') {
      onclose()
    }
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      onclose()
    }
  }

  /** Display label for a directory path. */
  function dirLabel(dirPath: string): string {
    if (!dirPath) return '/ (collection root)'
    return '/' + dirPath
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="modal-overlay" onclick={handleBackdropClick}>
  <div
    class="modal"
    role="dialog"
    aria-modal="true"
    aria-label="Save new file"
    onkeydown={handleKeydown}
  >
    <div class="modal-header">
      <h3>Save New File</h3>
    </div>

    <div class="modal-body">
      <label class="field">
        <span class="field-label">Filename</span>
        <input
          bind:this={inputEl}
          bind:value={filename}
          type="text"
          class="field-input"
          placeholder="my-document"
          spellcheck="false"
          autocomplete="off"
        />
        <span class="field-hint">.md will be added automatically if no extension</span>
      </label>

      <label class="field">
        <span class="field-label">Directory</span>
        <select bind:value={selectedDir} class="field-select">
          {#each directories as dir}
            <option value={dir}>{dirLabel(dir)}</option>
          {/each}
        </select>
      </label>

      {#if error}
        <div class="error-message">{error}</div>
      {/if}
    </div>

    <div class="modal-footer">
      <button class="btn btn-secondary" onclick={onclose} disabled={saving}>Cancel</button>
      <button
        class="btn btn-primary"
        onclick={handleSave}
        disabled={saving || !filename.trim()}
      >
        {saving ? 'Saving...' : 'Save'}
      </button>
    </div>
  </div>
</div>

<style>
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
  }

  .modal {
    background: var(--color-surface, #161617);
    border: 1px solid var(--color-border, #27272a);
    border-radius: 12px;
    width: 400px;
    max-width: 90vw;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
    overflow: hidden;
  }

  .modal-header {
    padding: 16px 20px 12px;
    border-bottom: 1px solid var(--color-border, #27272a);
  }

  .modal-header h3 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--color-text-main, #e4e4e7);
  }

  .modal-body {
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .field-label {
    font-size: 12px;
    font-weight: 500;
    color: var(--color-text-dim, #71717a);
  }

  .field-input,
  .field-select {
    padding: 8px 10px;
    border-radius: 6px;
    border: 1px solid var(--color-border, #27272a);
    background: var(--color-surface-dark, #0a0a0a);
    color: var(--color-text-main, #e4e4e7);
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: 13px;
    outline: none;
    transition: border-color var(--transition-fast, 150ms ease);
  }

  .field-input:focus,
  .field-select:focus {
    border-color: var(--color-primary, #00E5FF);
  }

  .field-select {
    cursor: pointer;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2371717a' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 10px center;
    padding-right: 28px;
  }

  .field-hint {
    font-size: 11px;
    color: var(--color-text-dim, #71717a);
    opacity: 0.7;
  }

  .error-message {
    font-size: 12px;
    color: var(--color-error, #ef4444);
    padding: 8px 10px;
    background: color-mix(in srgb, var(--color-error, #ef4444) 10%, transparent);
    border-radius: 6px;
    border: 1px solid color-mix(in srgb, var(--color-error, #ef4444) 25%, transparent);
  }

  .modal-footer {
    padding: 12px 20px 16px;
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    border-top: 1px solid var(--color-border, #27272a);
  }

  .btn {
    padding: 7px 16px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    border: 1px solid transparent;
    font-family: inherit;
    transition: all var(--transition-fast, 150ms ease);
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-secondary {
    background: var(--color-surface-dark, #0a0a0a);
    color: var(--color-text-dim, #71717a);
    border-color: var(--color-border, #27272a);
  }

  .btn-secondary:hover:not(:disabled) {
    color: var(--color-text-main, #e4e4e7);
    border-color: var(--color-text-dim, #71717a);
  }

  .btn-primary {
    background: var(--color-primary, #00E5FF);
    color: #000;
    border-color: var(--color-primary, #00E5FF);
  }

  .btn-primary:hover:not(:disabled) {
    filter: brightness(1.1);
  }

  @media (prefers-reduced-motion: reduce) {
    .field-input,
    .field-select,
    .btn {
      transition: none;
    }
  }
</style>
