<script lang="ts">
  import { get } from 'svelte/store';
  import { workspace } from '../stores/workspace.svelte';
  import type { TabState } from '../stores/workspace.svelte';
  import { editorMode, requestSave, requestDiscard } from '../stores/editor';
  import { isDirty } from '../stores/editor';
  import { fileContent } from '../stores/files';
  import { graphLevel, setGraphLevel } from '../stores/graph';
  import { renderMarkdown } from '../lib/markdown-render';

  interface ModeBarProps {
    paneId: string
  }

  let { paneId }: ModeBarProps = $props()

  // ── Reactive state from workspace ─────────────────────────────────

  const pane = $derived(workspace.panes[paneId])
  const activeTab: TabState | undefined = $derived(
    pane?.activeTabId ? workspace.tabs[pane.activeTabId] : undefined
  )
  const tabKind = $derived(activeTab?.kind ?? null)

  // ── Copy dropdown state ───────────────────────────────────────────

  let copyDropdownOpen = $state(false)
  let copyFeedback = $state<string | null>(null)

  function closeCopyDropdown() {
    copyDropdownOpen = false
  }

  function handleCopyDropdownClickOutside(e: MouseEvent) {
    const target = e.target as HTMLElement
    if (!target.closest('.copy-dropdown-wrapper')) {
      closeCopyDropdown()
    }
  }

  async function copyAsMarkdown() {
    const content = get(fileContent)
    if (!content) return
    await navigator.clipboard.writeText(content)
    copyFeedback = 'Copied as Markdown'
    closeCopyDropdown()
    setTimeout(() => (copyFeedback = null), 1500)
  }

  async function copyAsHtml() {
    const content = get(fileContent)
    if (!content) return
    const html = renderMarkdown(content)
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([html], { type: 'text/plain' }),
      }),
    ])
    copyFeedback = 'Copied as HTML'
    closeCopyDropdown()
    setTimeout(() => (copyFeedback = null), 1500)
  }

  // Register and cleanup click-outside listener
  $effect(() => {
    document.addEventListener('click', handleCopyDropdownClickOutside)
    return () => {
      document.removeEventListener('click', handleCopyDropdownClickOutside)
    }
  })

  // ── Discard confirmation ──────────────────────────────────────────
  function handleDiscardClick() {
    if (window.confirm('Discard unsaved changes? This cannot be undone.')) {
      requestDiscard()
    }
  }
</script>

{#if tabKind === 'document'}
  <!-- Document tab: Editor/Raw toggle + Copy dropdown + Save button -->
  <div class="mode-toggle-bar">
    <div class="mode-toggle-spacer"></div>
    <div class="mode-toggle" role="tablist" aria-label="Editor mode">
      <button
        class="mode-tab"
        class:active={$editorMode === 'wysiwyg'}
        role="tab"
        aria-selected={$editorMode === 'wysiwyg'}
        onclick={() => editorMode.set('wysiwyg')}
      >
        Editor
      </button>
      <button
        class="mode-tab"
        class:active={$editorMode === 'editor'}
        role="tab"
        aria-selected={$editorMode === 'editor'}
        onclick={() => editorMode.set('editor')}
      >
        Raw
      </button>
    </div>
    <div class="mode-toggle-spacer">
      <div class="copy-dropdown-wrapper">
        <button
          class="copy-split-button"
          onclick={copyAsMarkdown}
          title="Copy as Markdown"
        >
          {#if copyFeedback}
            <span class="material-symbols-outlined copy-icon">check</span>
            <span class="copy-label">{copyFeedback}</span>
          {:else}
            <span class="material-symbols-outlined copy-icon">content_copy</span>
            <span class="copy-label">Copy</span>
          {/if}
        </button>
        <button
          class="copy-chevron-button"
          onclick={(e) => { e.stopPropagation(); copyDropdownOpen = !copyDropdownOpen; }}
          aria-haspopup="true"
          aria-expanded={copyDropdownOpen}
          title="Copy options"
        >
          <span class="material-symbols-outlined copy-chevron-icon">expand_more</span>
        </button>
        {#if copyDropdownOpen}
          <div class="copy-dropdown-menu" role="menu">
            <button class="copy-dropdown-item" role="menuitem" onclick={copyAsMarkdown}>
              <span class="material-symbols-outlined copy-menu-icon">markdown</span>
              Copy as Markdown
            </button>
            <button class="copy-dropdown-item" role="menuitem" onclick={copyAsHtml}>
              <span class="material-symbols-outlined copy-menu-icon">code</span>
              Copy as HTML
            </button>
          </div>
        {/if}
      </div>
      {#if $isDirty}
        <button class="discard-button" onclick={handleDiscardClick} title="Discard changes">
          <span class="material-symbols-outlined discard-icon">undo</span>
        </button>
        <button class="save-button" onclick={() => requestSave()}>
          <span>Save</span>
          <kbd class="save-kbd"><span class="kbd-symbol">⌘</span>S</kbd>
        </button>
      {/if}
    </div>
  </div>
{:else if tabKind === 'graph'}
  <!-- Graph tab: Document/Chunk level switcher -->
  <div class="mode-toggle-bar">
    <div class="mode-toggle-spacer"></div>
    <div class="mode-toggle" role="tablist" aria-label="Graph level">
      <button
        class="mode-tab"
        class:active={$graphLevel === 'document'}
        role="tab"
        aria-selected={$graphLevel === 'document'}
        onclick={() => setGraphLevel('document')}
      >
        Document
      </button>
      <button
        class="mode-tab"
        class:active={$graphLevel === 'chunk'}
        role="tab"
        aria-selected={$graphLevel === 'chunk'}
        onclick={() => setGraphLevel('chunk')}
      >
        Chunk
      </button>
    </div>
    <div class="mode-toggle-spacer"></div>
  </div>
{/if}

<style>
  .mode-toggle-bar {
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 6px 12px;
    flex-shrink: 0;
    border-bottom: 1px solid var(--color-border, #27272a);
    background: var(--color-bg, #0f0f10);
  }

  .mode-toggle-spacer {
    flex: 1;
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 8px;
  }

  .mode-toggle {
    display: flex;
    background: var(--color-surface-dark, #0a0a0a);
    border: 1px solid var(--color-border, #27272a);
    border-radius: 6px;
    padding: 2px;
    gap: 2px;
  }

  .mode-tab {
    padding: 3px 12px;
    font-size: 11px;
    font-weight: 600;
    font-family: inherit;
    color: var(--color-text-dim, #71717a);
    background: transparent;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    transition: all var(--transition-fast, 150ms ease);
    letter-spacing: 0.02em;
  }

  .mode-tab:hover {
    color: var(--color-text, #e4e4e7);
  }

  .mode-tab.active {
    background: var(--color-surface, #161617);
    color: var(--color-primary, #00E5FF);
  }

  /* ── Save button ──────────────────────────────── */

  .save-button {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    background: var(--color-primary, #00E5FF);
    color: var(--color-surface-darker, #0a0a0a);
    border: none;
    border-radius: 4px;
    font-weight: 700;
    font-size: 11px;
    cursor: pointer;
    transition: background 0.15s;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    font-family: inherit;
  }

  .save-button:hover {
    background: var(--color-primary-dark, #00B8CC);
  }

  .save-kbd {
    display: inline-flex;
    height: 16px;
    align-items: center;
    gap: 1px;
    border-radius: 3px;
    background: rgba(0, 0, 0, 0.15);
    padding: 0 4px;
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: 9px;
    font-weight: 600;
    color: var(--color-surface-darker, #0a0a0a);
    border: none;
  }

  /* ── Discard button ────────────────────────── */

  .discard-button {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 4px 6px;
    background: transparent;
    color: var(--color-text-dim, #71717a);
    border: 1px solid var(--color-border, #27272a);
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .discard-button:hover {
    color: var(--color-error, #ef4444);
    border-color: var(--color-error, #ef4444);
    background: rgba(239, 68, 68, 0.08);
  }

  .discard-icon {
    font-size: 16px;
  }

  /* ── Copy dropdown ─────────────────────────── */

  .copy-dropdown-wrapper {
    position: relative;
    display: flex;
    align-items: center;
  }

  .copy-split-button {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    background: transparent;
    color: var(--color-text-dim, #71717a);
    border: 1px solid var(--color-border, #27272a);
    border-right: none;
    border-radius: 4px 0 0 4px;
    font-size: 11px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: all var(--transition-fast, 150ms ease);
    letter-spacing: 0.02em;
  }

  .copy-split-button:hover {
    color: var(--color-text, #e4e4e7);
    background: var(--color-surface, #161617);
  }

  .copy-icon {
    font-size: 14px;
  }

  .copy-label {
    white-space: nowrap;
  }

  .copy-chevron-button {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 4px 2px;
    background: transparent;
    color: var(--color-text-dim, #71717a);
    border: 1px solid var(--color-border, #27272a);
    border-radius: 0 4px 4px 0;
    cursor: pointer;
    transition: all var(--transition-fast, 150ms ease);
  }

  .copy-chevron-button:hover {
    color: var(--color-text, #e4e4e7);
    background: var(--color-surface, #161617);
  }

  .copy-chevron-icon {
    font-size: 16px;
  }

  .copy-dropdown-menu {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 4px;
    min-width: 170px;
    background: var(--color-surface, #161617);
    border: 1px solid var(--color-border, #27272a);
    border-radius: 6px;
    padding: 4px;
    z-index: 100;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  }

  .copy-dropdown-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 8px;
    background: transparent;
    color: var(--color-text-dim, #71717a);
    border: none;
    border-radius: 4px;
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
    transition: all var(--transition-fast, 150ms ease);
    text-align: left;
  }

  .copy-dropdown-item:hover {
    color: var(--color-text, #e4e4e7);
    background: var(--color-surface-dark, #0a0a0a);
  }

  .copy-menu-icon {
    font-size: 16px;
  }

  @media (prefers-reduced-motion: reduce) {
    .mode-tab,
    .copy-split-button,
    .copy-chevron-button,
    .copy-dropdown-item {
      transition: none;
    }
  }
</style>
