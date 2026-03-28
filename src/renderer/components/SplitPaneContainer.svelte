<script lang="ts">
  import { workspace } from '../stores/workspace.svelte'
  import TabPane from './TabPane.svelte'

  // ── Container ref for pixel-based ratio calculations ──────────────

  let containerEl: HTMLDivElement | undefined = $state(undefined)

  // ── Drag state for resize handle ──────────────────────────────────

  let isDragging = $state(false)
  let startX = $state(0)
  let startRatio = $state(0)

  // ── Derived state from workspace ──────────────────────────────────

  const splitEnabled = $derived(workspace.splitEnabled)
  const paneOrder = $derived(workspace.paneOrder)
  const splitRatio = $derived(workspace.splitRatio)

  /** Minimum pane width in pixels. */
  const MIN_PANE_WIDTH = 300

  /** Width of the resize handle in pixels. */
  const HANDLE_WIDTH = 4

  // ── Left pane width as a percentage string ────────────────────────

  const leftPaneStyle = $derived(
    splitEnabled
      ? `flex: 0 0 calc(${splitRatio * 100}% - ${HANDLE_WIDTH / 2}px); min-width: ${MIN_PANE_WIDTH}px;`
      : 'flex: 1;'
  )

  // ── Resize handle drag behavior (follows ResizeHandle.svelte pattern) ──

  function handleMouseDown(e: MouseEvent) {
    isDragging = true
    startX = e.clientX
    startRatio = workspace.splitRatio

    e.preventDefault()

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  function handleMouseMove(e: MouseEvent) {
    if (!isDragging || !containerEl) return

    const containerWidth = containerEl.offsetWidth
    const availableWidth = containerWidth - HANDLE_WIDTH

    // Clamp so neither pane goes below MIN_PANE_WIDTH
    const minRatio = MIN_PANE_WIDTH / availableWidth
    const maxRatio = 1 - minRatio

    const deltaX = e.clientX - startX
    const deltaRatio = deltaX / availableWidth
    const newRatio = Math.max(minRatio, Math.min(maxRatio, startRatio + deltaRatio))

    workspace.splitRatio = newRatio
  }

  function handleMouseUp() {
    if (!isDragging) return

    isDragging = false

    document.removeEventListener('mousemove', handleMouseMove)
    document.removeEventListener('mouseup', handleMouseUp)

    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }

  // ── Focus handling ────────────────────────────────────────────────

  function handlePaneFocus(paneId: string) {
    workspace.setActivePane(paneId)
  }

  // ── Cleanup on unmount ────────────────────────────────────────────

  $effect(() => {
    return () => {
      if (isDragging) {
        document.removeEventListener('mousemove', handleMouseMove)
        document.removeEventListener('mouseup', handleMouseUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }
  })
</script>

<div
  class="split-pane-container"
  class:split={splitEnabled}
  bind:this={containerEl}
>
  <!-- Primary (left) pane — always rendered -->
  {#if paneOrder[0]}
    <div class="pane-wrapper" style={leftPaneStyle}>
      <TabPane paneId={paneOrder[0]} onfocus={handlePaneFocus} />
    </div>
  {/if}

  <!-- Resize handle + secondary (right) pane — only when split is enabled -->
  {#if splitEnabled && paneOrder[1]}
    <div
      class="split-resize-handle"
      class:dragging={isDragging}
      onmousedown={handleMouseDown}
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize split panes"
      tabindex="-1"
    ></div>

    <div class="pane-wrapper pane-secondary" style="flex: 1; min-width: {MIN_PANE_WIDTH}px;">
      <TabPane paneId={paneOrder[1]} onfocus={handlePaneFocus} />
    </div>
  {/if}
</div>

<style>
  .split-pane-container {
    display: flex;
    flex-direction: row;
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .pane-wrapper {
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  /* ── Resize handle ───────────────────────────────────────────────── */

  .split-resize-handle {
    flex: 0 0 4px;
    cursor: col-resize;
    background: var(--color-border, #27272a);
    position: relative;
    z-index: var(--z-base, 10);
    transition: background var(--transition-fast, 150ms ease);
  }

  .split-resize-handle::before {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    left: -2px;
    right: -2px;
    z-index: -1;
  }

  .split-resize-handle:hover {
    background: var(--color-primary, #00E5FF);
  }

  .split-resize-handle.dragging {
    background: var(--color-primary, #00E5FF);
  }

  @media (prefers-reduced-motion: reduce) {
    .split-resize-handle {
      transition: none;
    }
  }
</style>
