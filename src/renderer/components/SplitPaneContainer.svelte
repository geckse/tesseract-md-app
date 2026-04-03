<script lang="ts">
  import { workspace } from '../stores/workspace.svelte'
  import { syncFileStoresFromTab } from '../stores/files'
  import { tabBarDropReceived } from './TabBar.svelte'
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

  // ── Drag-to-split state & handlers ──────────────────────────────

  /** Which side of the container the drop overlay is showing on. */
  let dragOverSide: 'left' | 'right' | null = $state(null)

  function handleContainerDragOver(e: DragEvent) {
    if (!e.dataTransfer?.types.includes('text/plain') && !e.dataTransfer?.types.includes('application/x-mdvdb-path')) return
    if (!containerEl) return

    // Don't show split overlay when cursor is over the tab bar area
    const target = e.target as HTMLElement | null
    if (target?.closest('.tab-scroll-area, .tab-bar')) {
      dragOverSide = null
      return
    }

    const rect = containerEl.getBoundingClientRect()
    const relativeX = e.clientX - rect.left
    const containerWidth = rect.width
    const edgeThreshold = Math.max(80, containerWidth * 0.2)

    if (splitEnabled) {
      // When already split, detect which pane the cursor is over
      const dividerX = containerWidth * splitRatio
      if (relativeX < dividerX) {
        dragOverSide = 'left'
      } else {
        dragOverSide = 'right'
      }
    } else {
      // When not split, only activate at the edges
      if (relativeX >= containerWidth - edgeThreshold) {
        dragOverSide = 'right'
      } else if (relativeX <= edgeThreshold) {
        dragOverSide = 'left'
      } else {
        dragOverSide = null
        return
      }
    }

    e.preventDefault()
    e.dataTransfer.dropEffect = e.dataTransfer.types.includes('application/x-mdvdb-path') ? 'link' : 'move'
  }

  function handleContainerDrop(e: DragEvent) {
    const side = dragOverSide
    dragOverSide = null

    // If a TabBar already handled this drop, bail
    if (tabBarDropReceived.value) return
    if (!side) return

    // Check if this is a file tree drop (has a file path)
    const filePath = e.dataTransfer?.getData('application/x-mdvdb-path')
    if (filePath) {
      e.preventDefault()
      tabBarDropReceived.value = true

      // Enable split if needed, then open the file in the target pane
      if (!workspace.splitEnabled) {
        workspace.toggleSplit()
      }
      const targetPaneId = side === 'left' ? workspace.paneOrder[0] : workspace.paneOrder[1]
      if (targetPaneId) {
        workspace.openTab(filePath, targetPaneId)
        workspace.activePaneId = targetPaneId
        syncFileStoresFromTab()
      }
      return
    }

    // Otherwise treat as a tab drag (text/plain = tab ID)
    const draggedTabId = e.dataTransfer?.getData('text/plain')
    if (!draggedTabId) return

    // Validate it's a local document tab
    const tab = workspace.tabs[draggedTabId]
    if (!tab || tab.kind !== 'document') return

    e.preventDefault()

    // Signal that an internal drop occurred (prevents cross-window detach)
    tabBarDropReceived.value = true

    workspace.splitAndMoveTab(draggedTabId, side)
    syncFileStoresFromTab()
  }

  function handleContainerDragLeave(e: DragEvent) {
    // Only reset if leaving the container entirely
    const related = e.relatedTarget as HTMLElement | null
    if (related && containerEl?.contains(related)) return
    dragOverSide = null
  }
</script>

<div
  class="split-pane-container"
  class:split={splitEnabled}
  bind:this={containerEl}
  ondragover={handleContainerDragOver}
  ondrop={handleContainerDrop}
  ondragleave={handleContainerDragLeave}
>
  <!-- Primary (left) pane — always rendered -->
  {#if paneOrder[0]}
    <div class="pane-wrapper" style={leftPaneStyle}>
      <TabPane paneId={paneOrder[0]} onfocus={handlePaneFocus} />
    </div>
  {/if}

  <!-- Resize handle + secondary (right) pane — only when split is enabled -->
  {#if splitEnabled && paneOrder[1]}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
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

  <!-- Drop-to-split overlay -->
  {#if dragOverSide}
    <div
      class="split-drop-overlay"
      class:drop-left={dragOverSide === 'left'}
      class:drop-right={dragOverSide === 'right'}
    >
      <div class="split-drop-indicator">
        <span class="material-symbols-outlined">vertical_split</span>
        <span class="split-drop-label">Drop to open here</span>
      </div>
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
    position: relative;
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

  /* ── Drop-to-split overlay ──────────────────────────────────────── */

  .split-drop-overlay {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    background: color-mix(in srgb, var(--color-primary, #00E5FF) 6%, transparent);
    border: 1px dashed color-mix(in srgb, var(--color-primary, #00E5FF) 40%, transparent);
    z-index: var(--z-overlay, 40);
    pointer-events: none;
    opacity: 1;
    transition: opacity 150ms ease;
  }

  .split-drop-overlay.drop-right {
    right: 0;
    left: auto;
    border-left: 2px solid var(--color-primary, #00E5FF);
  }

  .split-drop-overlay.drop-left {
    left: 0;
    right: auto;
    border-right: 2px solid var(--color-primary, #00E5FF);
  }

  .split-drop-indicator {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    color: var(--color-primary, #00E5FF);
    opacity: 0.7;
    user-select: none;
  }

  .split-drop-indicator .material-symbols-outlined {
    font-size: 32px;
  }

  .split-drop-label {
    font-size: 12px;
    font-weight: 500;
    font-family: var(--font-sans, 'Space Grotesk', sans-serif);
  }

  @media (prefers-reduced-motion: reduce) {
    .split-resize-handle,
    .split-drop-overlay {
      transition: none;
    }
  }
</style>
