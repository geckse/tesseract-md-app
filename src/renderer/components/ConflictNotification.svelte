<script lang="ts">
  import { conflictFilePath, dismissConflict } from '../stores/conflict'
  import { selectedFilePath } from '../stores/files'
  import { activeCollection } from '../stores/collections'
  import { fileContent } from '../stores/files'

  let currentConflictPath: string | null = $state(null)
  let currentSelectedPath: string | null = $state(null)
  let currentCollection: import('../../preload/api').Collection | null = $state(null)

  conflictFilePath.subscribe((v) => (currentConflictPath = v))
  selectedFilePath.subscribe((v) => (currentSelectedPath = v))
  activeCollection.subscribe((v) => (currentCollection = v))

  // Only show notification if the conflict is for the currently selected file
  let showNotification = $derived(
    currentConflictPath !== null &&
    currentSelectedPath !== null &&
    currentConflictPath === currentSelectedPath
  )

  async function handleReload() {
    if (!currentSelectedPath || !currentCollection) return

    // Reload the file content from disk
    const fullPath = `${currentCollection.path}/${currentSelectedPath}`
    try {
      const content = await window.api.readFile(fullPath)
      fileContent.set(content)
      dismissConflict()
    } catch (err) {
      console.error('Failed to reload file:', err)
    }
  }

  function handleKeepMine() {
    // Just dismiss the notification - keep the editor content as is
    dismissConflict()
  }
</script>

{#if showNotification}
  <div class="conflict-notification" role="alert" aria-live="assertive">
    <span class="material-symbols-outlined conflict-icon">warning</span>
    <div class="conflict-content">
      <p class="conflict-title">File changed on disk</p>
      <p class="conflict-message">
        This file has been modified by another program. Would you like to reload the file or keep your current changes?
      </p>
    </div>
    <div class="conflict-actions">
      <button class="conflict-btn conflict-btn-secondary" onclick={handleKeepMine} aria-label="Keep my changes">
        Keep Mine
      </button>
      <button class="conflict-btn conflict-btn-primary" onclick={handleReload} aria-label="Reload file from disk">
        Reload
      </button>
    </div>
  </div>
{/if}

<style>
  .conflict-notification {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 12px 16px;
    background: rgba(239, 68, 68, 0.1);
    border-bottom: 1px solid rgba(239, 68, 68, 0.2);
    color: #fca5a5;
  }

  .conflict-icon {
    font-size: 20px;
    flex-shrink: 0;
    margin-top: 2px;
    color: #ef4444;
  }

  .conflict-content {
    flex: 1;
    min-width: 0;
  }

  .conflict-title {
    font-size: 13px;
    font-weight: 600;
    margin: 0 0 4px 0;
    color: #ef4444;
  }

  .conflict-message {
    font-size: 12px;
    margin: 0;
    color: #fca5a5;
    line-height: 1.5;
  }

  .conflict-actions {
    display: flex;
    gap: 8px;
    flex-shrink: 0;
    margin-top: 2px;
  }

  .conflict-btn {
    padding: 6px 12px;
    font-size: 12px;
    font-weight: 500;
    border-radius: 4px;
    cursor: pointer;
    transition: all 150ms ease;
    border: 1px solid transparent;
    white-space: nowrap;
  }

  .conflict-btn-primary {
    background: #ef4444;
    color: var(--color-text-white, #ffffff);
    border-color: #ef4444;
  }

  .conflict-btn-primary:hover {
    background: #dc2626;
    border-color: #dc2626;
  }

  .conflict-btn-primary:focus {
    outline: 2px solid #ef4444;
    outline-offset: 2px;
  }

  .conflict-btn-secondary {
    background: transparent;
    color: #fca5a5;
    border-color: rgba(239, 68, 68, 0.3);
  }

  .conflict-btn-secondary:hover {
    background: rgba(239, 68, 68, 0.1);
    border-color: rgba(239, 68, 68, 0.4);
  }

  .conflict-btn-secondary:focus {
    outline: 2px solid #ef4444;
    outline-offset: 2px;
  }
</style>
