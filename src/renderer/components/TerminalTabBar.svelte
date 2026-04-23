<script lang="ts">
  import { terminalStore } from '../stores/terminal.svelte'

  const tabs = $derived(terminalStore.panelTerminals)
  const activeId = $derived(terminalStore.panel.activeId)

  async function handleNew(): Promise<void> {
    await terminalStore.createTerminal({ location: 'panel' })
  }

  async function handleClose(id: string, ev: MouseEvent): Promise<void> {
    ev.stopPropagation()
    await terminalStore.disposeTerminal(id)
  }

  function handleSwitch(id: string): void {
    terminalStore.setActivePanelTerminal(id)
  }

  function handleMoveToTab(id: string, ev: MouseEvent): void {
    ev.stopPropagation()
    terminalStore.moveToTab(id)
  }

  function handleCloseAll(): void {
    for (const t of tabs) {
      void terminalStore.disposeTerminal(t.id)
    }
  }

  function handleHide(): void {
    terminalStore.closePanel()
  }
</script>

<div class="terminal-tabbar" role="tablist" aria-label="Terminal sessions">
  <div class="tab-list">
    {#each tabs as t (t.id)}
      <button
        type="button"
        class="tab-item"
        class:active={t.id === activeId}
        class:exited={t.status === 'exited'}
        role="tab"
        aria-selected={t.id === activeId}
        title={`${t.shell}\ncwd: ${t.cwd}`}
        onclick={() => handleSwitch(t.id)}
      >
        <span class="material-symbols-outlined tab-icon">terminal</span>
        <span class="tab-label">{t.title}</span>
        <button
          type="button"
          class="tab-close"
          aria-label="Close terminal"
          onclick={(e) => handleClose(t.id, e)}
        >
          <span class="material-symbols-outlined">close</span>
        </button>
      </button>
    {/each}
  </div>

  <div class="tab-controls">
    <button type="button" class="control" title="New terminal" aria-label="New terminal" onclick={handleNew}>
      <span class="material-symbols-outlined">add</span>
    </button>
    {#if activeId}
      <button
        type="button"
        class="control"
        title="Move to editor area"
        aria-label="Move to editor area"
        onclick={(e) => handleMoveToTab(activeId, e)}
      >
        <span class="material-symbols-outlined">open_in_new</span>
      </button>
    {/if}
    <button
      type="button"
      class="control"
      title="Kill all terminals"
      aria-label="Kill all terminals"
      onclick={handleCloseAll}
      disabled={tabs.length === 0}
    >
      <span class="material-symbols-outlined">delete_sweep</span>
    </button>
    <button type="button" class="control" title="Hide panel" aria-label="Hide panel" onclick={handleHide}>
      <span class="material-symbols-outlined">expand_more</span>
    </button>
  </div>
</div>

<style>
  .terminal-tabbar {
    display: flex;
    align-items: stretch;
    justify-content: space-between;
    height: 32px;
    min-height: 32px;
    background: var(--color-surface, #161617);
    border-bottom: 1px solid var(--color-border, #27272a);
    padding: 0 4px;
    user-select: none;
  }

  .tab-list {
    display: flex;
    align-items: stretch;
    gap: 2px;
    overflow-x: auto;
    scrollbar-width: thin;
    flex: 1;
    min-width: 0;
  }

  .tab-item {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 10px;
    background: transparent;
    border: none;
    color: var(--color-text-dim, #71717a);
    font-family: inherit;
    font-size: 12px;
    cursor: pointer;
    border-top: 1px solid transparent;
    position: relative;
    min-width: 80px;
    max-width: 220px;
    white-space: nowrap;
  }

  .tab-item:hover {
    background: var(--overlay-hover, rgba(255, 255, 255, 0.06));
    color: var(--color-text, #e4e4e7);
  }

  .tab-item.active {
    background: var(--color-surface-dark, #0c0c0d);
    color: var(--color-text, #e4e4e7);
    border-top-color: var(--color-primary, #60a5fa);
  }

  .tab-item.exited .tab-label {
    text-decoration: line-through;
    opacity: 0.6;
  }

  .tab-icon {
    font-size: 14px !important;
    color: var(--color-text-dim, #71717a);
  }

  .tab-item.active .tab-icon {
    color: var(--color-primary, #60a5fa);
  }

  .tab-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tab-close {
    margin-left: 4px;
    padding: 2px;
    background: transparent;
    border: none;
    color: inherit;
    border-radius: 3px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    opacity: 0.6;
  }

  .tab-close:hover {
    opacity: 1;
    background: var(--overlay-active, rgba(255, 255, 255, 0.1));
  }

  .tab-close .material-symbols-outlined {
    font-size: 14px !important;
  }

  .tab-controls {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 0 4px;
    border-left: 1px solid var(--color-border, #27272a);
  }

  .control {
    width: 26px;
    height: 26px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    color: var(--color-text-dim, #71717a);
    border-radius: 4px;
    cursor: pointer;
  }

  .control:hover:not(:disabled) {
    background: var(--overlay-hover, rgba(255, 255, 255, 0.06));
    color: var(--color-text, #e4e4e7);
  }

  .control:disabled {
    opacity: 0.3;
    cursor: default;
  }

  .control .material-symbols-outlined {
    font-size: 16px !important;
  }
</style>
