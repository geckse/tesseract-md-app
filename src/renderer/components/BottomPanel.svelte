<script lang="ts">
  import { terminalStore } from '../stores/terminal.svelte'
  import Terminal from './Terminal.svelte'
  import TerminalTabBar from './TerminalTabBar.svelte'

  const open = $derived(terminalStore.panel.open)
  const height = $derived(terminalStore.panel.height)
  const tabs = $derived(terminalStore.panelTerminals)
  const activeId = $derived(terminalStore.panel.activeId)

  let isDragging = $state(false)
  let dragStartY = $state(0)
  let dragStartHeight = $state(0)

  function handleResizeDown(e: MouseEvent): void {
    isDragging = true
    dragStartY = e.clientY
    dragStartHeight = height
    e.preventDefault()

    document.addEventListener('mousemove', handleResizeMove)
    document.addEventListener('mouseup', handleResizeUp)
    document.body.style.cursor = 'row-resize'
    document.body.style.userSelect = 'none'
  }

  function handleResizeMove(e: MouseEvent): void {
    if (!isDragging) return
    const delta = dragStartY - e.clientY
    terminalStore.setPanelHeight(dragStartHeight + delta)
  }

  function handleResizeUp(): void {
    if (!isDragging) return
    isDragging = false
    document.removeEventListener('mousemove', handleResizeMove)
    document.removeEventListener('mouseup', handleResizeUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }

  function handleDoubleClick(): void {
    // Snap to default height
    terminalStore.setPanelHeight(300)
  }
</script>

{#if open}
  <section
    class="bottom-panel"
    style:height="{height}px"
    aria-label="Embedded terminal panel"
  >
    <div
      class="resize-handle"
      class:dragging={isDragging}
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize terminal panel"
      onmousedown={handleResizeDown}
      ondblclick={handleDoubleClick}
    ></div>

    <TerminalTabBar />

    <div class="terminal-host-area">
      {#each tabs as t (t.id)}
        <div class="terminal-frame" class:visible={t.id === activeId}>
          <Terminal terminalId={t.id} />
        </div>
      {/each}
      {#if tabs.length === 0}
        <div class="empty-state">
          <p>No terminals are running.</p>
          <button
            type="button"
            class="create-btn"
            onclick={() => terminalStore.createTerminal({ location: 'panel' })}
          >
            New terminal
          </button>
        </div>
      {/if}
    </div>
  </section>
{/if}

<style>
  .bottom-panel {
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    background: var(--color-surface-dark, #0c0c0d);
    border-top: 1px solid var(--color-border, #27272a);
    position: relative;
    min-height: 120px;
    overflow: hidden;
  }

  .resize-handle {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 4px;
    cursor: row-resize;
    z-index: 10;
    background: transparent;
    transition: background 150ms ease;
  }

  .resize-handle:hover,
  .resize-handle.dragging {
    background: var(--color-primary, #60a5fa);
    opacity: 0.4;
  }

  .terminal-host-area {
    flex: 1;
    min-height: 0;
    position: relative;
  }

  .terminal-frame {
    position: absolute;
    inset: 0;
    display: none;
  }

  .terminal-frame.visible {
    display: block;
  }

  .empty-state {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    color: var(--color-text-dim, #71717a);
    font-size: 13px;
  }

  .empty-state p {
    margin: 0;
  }

  .create-btn {
    padding: 6px 14px;
    background: var(--color-primary, #60a5fa);
    color: var(--color-surface-dark, #0c0c0d);
    border: none;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
  }

  .create-btn:hover {
    filter: brightness(1.1);
  }
</style>
