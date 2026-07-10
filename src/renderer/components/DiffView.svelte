<script lang="ts">
  import { onDestroy } from 'svelte'
  import { EditorView } from '@codemirror/view'
  import { EditorState } from '@codemirror/state'
  import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
  import { unifiedMergeView, MergeView } from '@codemirror/merge'
  import { editorTheme } from '../lib/editor-theme'
  import { focusTrap } from '../lib/focus-trap'
  import { diffView, closeDiffView, type DiffViewRequest } from '../stores/conflict'
  import { resolveConflictTakeDisk, resolveConflictKeepMine, resolveConflictMerge } from '../stores/file-sync'

  let request: DiffViewRequest | null = $state(null)
  const unsubDiffView = diffView.subscribe((v) => (request = v))

  /** 'unified' (default — reads better for prose), 'split' side-by-side, or the composed 'merged' preview. */
  let mode: 'unified' | 'split' | 'merged' = $state('unified')

  let canMerge = $derived(request?.merged != null && request.showActions)

  let diffHost: HTMLDivElement | undefined = $state(undefined)
  let unifiedView: EditorView | null = null
  let splitView: MergeView | null = null

  function baseExtensions() {
    return [
      markdown({ base: markdownLanguage }),
      editorTheme(),
      EditorState.readOnly.of(true),
      EditorView.editable.of(false),
      EditorView.lineWrapping
    ]
  }

  function destroyViews() {
    unifiedView?.destroy()
    unifiedView = null
    splitView?.destroy()
    splitView = null
  }

  // (Re)build the diff whenever the request or display mode changes
  $effect(() => {
    const req = request
    const host = diffHost
    const currentMode = mode
    destroyViews()
    if (!req || !host) return

    if (currentMode === 'merged' && req.merged != null) {
      // Read-only preview of the composed document (both changes combined)
      unifiedView = new EditorView({
        state: EditorState.create({ doc: req.merged, extensions: baseExtensions() }),
        parent: host
      })
    } else if (currentMode === 'split') {
      splitView = new MergeView({
        a: { doc: req.original, extensions: baseExtensions() },
        b: { doc: req.modified, extensions: baseExtensions() },
        parent: host
      })
    } else {
      unifiedView = new EditorView({
        state: EditorState.create({
          doc: req.modified,
          extensions: [
            ...baseExtensions(),
            unifiedMergeView({ original: req.original, mergeControls: false })
          ]
        }),
        parent: host
      })
    }
  })

  onDestroy(() => {
    destroyViews()
    unsubDiffView()
  })

  function handleTakeDisk() {
    if (!request) return
    resolveConflictTakeDisk(request.filePath)
      .then(() => closeDiffView())
      .catch(() => {})
  }

  function handleKeepMine() {
    if (!request) return
    resolveConflictKeepMine(request.filePath)
    closeDiffView()
  }

  function handleMerge() {
    if (!request) return
    resolveConflictMerge(request.filePath)
      .then((ok) => {
        if (ok) closeDiffView()
      })
      .catch(() => {})
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation()
      closeDiffView()
    }
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) closeDiffView()
  }
</script>

{#if request}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="modal-overlay" onclick={handleBackdropClick}>
    <div
      class="modal diff-modal"
      role="dialog"
      aria-modal="true"
      aria-label="File differences"
      tabindex="-1"
      onkeydown={handleKeydown}
      use:focusTrap
    >
      <div class="modal-header">
        <div class="header-title">
          <h3>{request.filePath}</h3>
          <span class="header-labels">
            {request.originalLabel} → {request.modifiedLabel}
          </span>
        </div>
        <div class="mode-toggle" role="group" aria-label="Diff display mode">
          <button
            class="mode-btn"
            class:active={mode === 'unified'}
            onclick={() => (mode = 'unified')}
          >
            Unified
          </button>
          <button
            class="mode-btn"
            class:active={mode === 'split'}
            onclick={() => (mode = 'split')}
          >
            Side by side
          </button>
          {#if canMerge}
            <button
              class="mode-btn"
              class:active={mode === 'merged'}
              onclick={() => (mode = 'merged')}
            >
              Merged
            </button>
          {/if}
        </div>
      </div>

      <div class="diff-host" bind:this={diffHost}></div>

      <div class="modal-footer">
        <button class="btn btn-secondary" onclick={closeDiffView}>Close</button>
        {#if request.showActions}
          <button class="btn btn-secondary" onclick={handleKeepMine}>Keep Mine</button>
          <button class="btn {canMerge ? 'btn-secondary' : 'btn-primary'}" onclick={handleTakeDisk}>Take Disk</button>
          {#if canMerge}
            <button class="btn btn-primary" onclick={handleMerge}>Merge Both</button>
          {/if}
        {/if}
      </div>
    </div>
  </div>
{/if}

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

  .diff-modal {
    background: var(--color-surface, #161617);
    border: 1px solid var(--color-border, #27272a);
    border-radius: 8px;
    width: min(1100px, calc(100vw - 64px));
    height: min(720px, calc(100vh - 64px));
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 14px 20px;
    border-bottom: 1px solid var(--color-border, #27272a);
  }

  .header-title {
    min-width: 0;
    display: flex;
    align-items: baseline;
    gap: 12px;
  }

  .header-title h3 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--color-text-main, #e4e4e7);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .header-labels {
    font-size: 12px;
    color: var(--color-text-dim, #71717a);
    white-space: nowrap;
  }

  .mode-toggle {
    display: flex;
    gap: 0;
    flex-shrink: 0;
    border: 1px solid var(--color-border, #27272a);
    border-radius: 6px;
    overflow: hidden;
  }

  .mode-btn {
    background: transparent;
    border: none;
    padding: 5px 12px;
    font-size: 12px;
    color: var(--color-text-dim, #71717a);
    cursor: pointer;
    transition: background-color 150ms ease, color 150ms ease;
  }

  @media (prefers-reduced-motion: reduce) {
    .mode-btn {
      transition: none;
    }
  }

  .mode-btn.active {
    background: var(--color-surface-dark, #0a0a0a);
    color: var(--color-text-main, #e4e4e7);
  }

  .mode-btn:focus-visible {
    outline: 2px solid var(--color-primary, #00e5ff);
    outline-offset: -2px;
  }

  .diff-host {
    flex: 1;
    min-height: 0;
    overflow: auto;
    scrollbar-width: thin;
  }

  .diff-host :global(.cm-editor) {
    height: 100%;
  }

  .diff-host :global(.cm-mergeView) {
    height: 100%;
  }

  .diff-host :global(.cm-scroller) {
    overflow: auto;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 20px;
    border-top: 1px solid var(--color-border, #27272a);
  }

  .btn {
    padding: 6px 14px;
    font-size: 12.5px;
    font-weight: 500;
    border-radius: 5px;
    cursor: pointer;
    border: 1px solid transparent;
    transition: all 150ms ease;
  }

  @media (prefers-reduced-motion: reduce) {
    .btn {
      transition: none;
    }
  }

  .btn-primary {
    background: var(--color-primary, #00e5ff);
    color: var(--color-surface-dark, #0a0a0a);
    border-color: var(--color-primary, #00e5ff);
  }

  .btn-primary:hover {
    opacity: 0.85;
  }

  .btn-primary:focus-visible {
    outline: 2px solid var(--color-primary, #00e5ff);
    outline-offset: 2px;
  }

  .btn-secondary {
    background: transparent;
    color: var(--color-text-dim, #a1a1aa);
    border-color: var(--color-border, #27272a);
  }

  .btn-secondary:hover {
    background: var(--color-surface-dark, #0a0a0a);
    color: var(--color-text-main, #e4e4e7);
  }

  .btn-secondary:focus-visible {
    outline: 2px solid var(--color-primary, #00e5ff);
    outline-offset: 2px;
  }
</style>
