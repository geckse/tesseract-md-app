<script lang="ts">
  import { workspace, BOTTOM_PANE_ID, DEFAULT_BOTTOM_PANE_HEIGHT } from '../stores/workspace.svelte'
  import { terminalStore } from '../stores/terminal.svelte'
  import { isTabOrPathDrag, openDroppedPath } from '../lib/drop-payload'
  import TabPane from './TabPane.svelte'

  const open = $derived(workspace.bottomPaneOpen)
  const height = $derived(workspace.bottomPaneHeight)

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
    workspace.setBottomPaneHeight(dragStartHeight + delta)
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
    workspace.setBottomPaneHeight(DEFAULT_BOTTOM_PANE_HEIGHT)
  }

  // ── Drop target: move tabs / open files into the bottom pane ────────

  let dragOver = $state(false)

  function handleDragOver(e: DragEvent): void {
    if (!isTabOrPathDrag(e.dataTransfer)) return
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
    dragOver = true
  }

  function handleDragLeave(e: DragEvent): void {
    // Only clear when leaving the panel entirely, not entering a child
    if (e.currentTarget instanceof HTMLElement && e.relatedTarget instanceof Node) {
      if (e.currentTarget.contains(e.relatedTarget)) return
    }
    dragOver = false
  }

  function handleDrop(e: DragEvent): void {
    dragOver = false
    const dt = e.dataTransfer
    if (!dt) return

    const openedTabId = openDroppedPath(dt, BOTTOM_PANE_ID)
    if (openedTabId) {
      e.preventDefault()
      return
    }

    const tabId = dt.getData('text/plain')
    if (tabId && workspace.tabs[tabId]) {
      e.preventDefault()
      // The tab bar handles precise drops itself; this is the panel-body path.
      workspace.moveTabToBottomPane(tabId)
    }
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <section
    class="bottom-panel"
    class:drag-over={dragOver}
    style:height="{height}px"
    aria-label="Bottom panel"
    ondragover={handleDragOver}
    ondragleave={handleDragLeave}
    ondrop={handleDrop}
  >
    <div
      class="resize-handle"
      class:dragging={isDragging}
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize bottom panel"
      onmousedown={handleResizeDown}
      ondblclick={handleDoubleClick}
    ></div>

    <TabPane paneId={BOTTOM_PANE_ID}>
      {#snippet trailingActions()}
        <button
          type="button"
          class="panel-action"
          title="New terminal"
          aria-label="New terminal"
          onclick={() => void terminalStore.createTerminal()}
        >
          <span class="material-symbols-outlined">terminal</span>
        </button>
        <button
          type="button"
          class="panel-action"
          title="Kill all terminals"
          aria-label="Kill all terminals"
          onclick={() => terminalStore.killAllInBottomPane()}
        >
          <span class="material-symbols-outlined">delete_sweep</span>
        </button>
        <button
          type="button"
          class="panel-action"
          title="Hide panel"
          aria-label="Hide bottom panel"
          onclick={() => workspace.setBottomPaneOpen(false)}
        >
          <span class="material-symbols-outlined">expand_more</span>
        </button>
      {/snippet}
    </TabPane>
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

  .bottom-panel.drag-over {
    box-shadow: inset 0 0 0 2px var(--color-primary, #00e5ff);
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

  @media (prefers-reduced-motion: reduce) {
    .resize-handle {
      transition: none;
    }
  }

  .panel-action {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    padding: 0;
    background: transparent;
    border: none;
    border-radius: var(--radius-sm, 4px);
    color: var(--color-text-dim, #71717a);
    cursor: pointer;
    transition:
      background 150ms ease,
      color 150ms ease;
  }

  .panel-action:hover {
    background: var(--overlay-hover, rgba(255, 255, 255, 0.06));
    color: var(--color-text, #e4e4e7);
  }

  .panel-action:active {
    background: var(--overlay-active, rgba(255, 255, 255, 0.1));
  }

  .panel-action .material-symbols-outlined {
    font-size: 16px;
  }

  @media (prefers-reduced-motion: reduce) {
    .panel-action {
      transition: none;
    }
  }
</style>
