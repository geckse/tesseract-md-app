<script lang="ts">
  import { conflicts, type ConflictInfo } from '../stores/conflict'
  import {
    externalUpdateNotice,
    openConflictDiff,
    openExternalUpdateDiff,
    resolveConflictTakeDisk,
    resolveConflictKeepMine,
    resolveConflictMerge,
    keepDeletedFileInEditor,
    closeDeletedFileTabs
  } from '../stores/file-sync'

  interface Props {
    /** Relative path of the file this editor pane is showing. */
    filePath: string | null
  }
  let { filePath }: Props = $props()

  let allConflicts: Record<string, ConflictInfo> = $state({})
  conflicts.subscribe((v) => (allConflicts = v))

  /** Active (non-muted) conflict for this pane's file. */
  let conflict = $derived.by(() => {
    if (!filePath) return null
    const c = allConflicts[filePath]
    if (!c || c.dismissedDiskContent !== undefined) return null
    return c
  })

  // ── Transient "updated from disk" toast (clean-tab live apply) ────────
  const TOAST_MS = 2500

  let notice: { filePath: string; previous: string; at: number } | null = $state(null)
  let toastTimer: ReturnType<typeof setTimeout> | null = null

  externalUpdateNotice.subscribe((v) => {
    notice = v
    if (toastTimer) clearTimeout(toastTimer)
    if (v) {
      toastTimer = setTimeout(() => {
        notice = null
        toastTimer = null
      }, TOAST_MS)
    }
  })

  let showToast = $derived(
    notice !== null && filePath !== null && notice.filePath === filePath && !conflict
  )

  function handleViewDiff() {
    if (filePath) openConflictDiff(filePath).catch(() => {})
  }

  function handleTakeDisk() {
    if (filePath) resolveConflictTakeDisk(filePath).catch(() => {})
  }

  function handleKeepMine() {
    if (filePath) resolveConflictKeepMine(filePath)
  }

  function handleMerge() {
    if (filePath) resolveConflictMerge(filePath).catch(() => {})
  }

  function handleKeepDeleted() {
    if (filePath) keepDeletedFileInEditor(filePath)
  }

  function handleCloseDeleted() {
    if (filePath) closeDeletedFileTabs(filePath)
  }

  function handleShowChanges() {
    if (filePath) openExternalUpdateDiff(filePath)
  }
</script>

{#if conflict}
  <div class="conflict-notification" role="alert" aria-live="assertive">
    <span class="material-symbols-outlined conflict-icon">warning</span>
    <div class="conflict-content">
      {#if conflict.kind === 'deleted'}
        <p class="conflict-title">File deleted on disk</p>
        <p class="conflict-message">
          This file was deleted by another program. Keep it in the editor (saving will recreate it) or close the tab.
        </p>
      {:else}
        <p class="conflict-title">File changed on disk</p>
        <p class="conflict-message">
          This file has been modified by another program while you have unsaved changes.{#if conflict.mergeClean}
            Both sets of changes can be combined.{/if}
        </p>
      {/if}
    </div>
    <div class="conflict-actions">
      {#if conflict.kind === 'deleted'}
        <button class="conflict-btn conflict-btn-secondary" onclick={handleCloseDeleted} aria-label="Close tab">
          Close Tab
        </button>
        <button class="conflict-btn conflict-btn-primary" onclick={handleKeepDeleted} aria-label="Keep file in editor">
          Keep in Editor
        </button>
      {:else}
        <button class="conflict-btn conflict-btn-secondary" onclick={handleViewDiff} aria-label="View differences">
          View Diff
        </button>
        <button class="conflict-btn conflict-btn-secondary" onclick={handleKeepMine} aria-label="Keep my changes">
          Keep Mine
        </button>
        <button
          class="conflict-btn {conflict.mergeClean ? 'conflict-btn-secondary' : 'conflict-btn-primary'}"
          onclick={handleTakeDisk}
          aria-label="Take the disk version"
        >
          Take Disk
        </button>
        {#if conflict.mergeClean}
          <button class="conflict-btn conflict-btn-primary" onclick={handleMerge} aria-label="Merge both changes">
            Merge
          </button>
        {/if}
      {/if}
    </div>
  </div>
{:else if showToast}
  <div class="update-toast" role="status" aria-live="polite">
    <span class="material-symbols-outlined toast-icon">sync</span>
    <span class="toast-text">Updated from disk</span>
    <button class="toast-link" onclick={handleShowChanges} aria-label="Show changes">
      Show changes
    </button>
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

  @media (prefers-reduced-motion: reduce) {
    .conflict-btn {
      transition: none;
    }
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

  .update-toast {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 16px;
    background: color-mix(in srgb, var(--color-primary, #00e5ff) 8%, transparent);
    border-bottom: 1px solid color-mix(in srgb, var(--color-primary, #00e5ff) 15%, transparent);
    color: var(--color-text-dim, #71717a);
    font-size: 12px;
  }

  .toast-icon {
    font-size: 16px;
    color: var(--color-primary, #00e5ff);
  }

  .toast-text {
    flex: 1;
  }

  .toast-link {
    background: none;
    border: none;
    padding: 0;
    font-size: 12px;
    color: var(--color-primary, #00e5ff);
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .toast-link:hover {
    opacity: 0.8;
  }

  .toast-link:focus {
    outline: 2px solid var(--color-primary, #00e5ff);
    outline-offset: 2px;
    border-radius: 2px;
  }
</style>
