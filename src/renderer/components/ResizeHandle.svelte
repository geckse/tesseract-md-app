<script lang="ts">
  interface ResizeHandleProps {
    /** Position of handle: 'left' or 'right' edge of panel */
    position?: 'left' | 'right'
    /** Minimum width in pixels */
    minWidth?: number
    /** Maximum width in pixels */
    maxWidth?: number
    /** Current width in pixels */
    width: number
    /** Callback fired when width changes during drag */
    onresize?: (width: number) => void
  }

  let {
    position = 'left',
    minWidth = 180,
    maxWidth = 500,
    width,
    onresize
  }: ResizeHandleProps = $props()

  let isDragging = $state(false)
  let startX = $state(0)
  let startWidth = $state(0)

  function handleMouseDown(e: MouseEvent) {
    isDragging = true
    startX = e.clientX
    startWidth = width

    // Prevent text selection during drag
    e.preventDefault()

    // Add global listeners
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    // Change cursor globally during drag
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  function handleMouseMove(e: MouseEvent) {
    if (!isDragging) return

    // Calculate new width based on drag direction
    // position='right' (left sidebar): drag right → increase width
    // position='left' (right panel): drag left → increase width
    const delta = position === 'right' ? e.clientX - startX : startX - e.clientX
    const newWidth = Math.max(minWidth, Math.min(maxWidth, startWidth + delta))

    onresize?.(newWidth)
  }

  function handleMouseUp() {
    if (!isDragging) return

    isDragging = false

    // Remove global listeners
    document.removeEventListener('mousemove', handleMouseMove)
    document.removeEventListener('mouseup', handleMouseUp)

    // Restore cursor
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }

  function handleKeyDown(e: KeyboardEvent) {
    let nextWidth = width
    if (e.key === 'ArrowLeft') nextWidth -= 10
    else if (e.key === 'ArrowRight') nextWidth += 10
    else if (e.key === 'Home') nextWidth = minWidth
    else if (e.key === 'End') nextWidth = maxWidth
    else return

    e.preventDefault()
    onresize?.(Math.max(minWidth, Math.min(maxWidth, nextWidth)))
  }

  // Cleanup on unmount
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
  class="resize-handle"
  class:left={position === 'left'}
  class:right={position === 'right'}
  class:dragging={isDragging}
  onmousedown={handleMouseDown}
  onkeydown={handleKeyDown}
  role="slider"
  aria-orientation="horizontal"
  aria-label="Panel width"
  aria-valuemin={minWidth}
  aria-valuemax={maxWidth}
  aria-valuenow={Math.round(width)}
  aria-valuetext={`${Math.round(width)} pixels`}
  tabindex="0"
></div>

<style>
  .resize-handle {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 4px;
    border: 0;
    padding: 0;
    background: transparent;
    cursor: col-resize;
    z-index: var(--z-base, 10);
    transition: background var(--transition-fast, 150ms ease);
  }

  .resize-handle.left {
    left: 0;
  }

  .resize-handle.right {
    right: 0;
  }

  .resize-handle::before {
    content: '';
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background: transparent;
    transition: background var(--transition-fast, 150ms ease);
  }

  .resize-handle.left::before {
    left: 0;
  }

  .resize-handle.right::before {
    right: 0;
  }

  .resize-handle:hover::before,
  .resize-handle:focus-visible::before,
  .resize-handle.dragging::before {
    background: var(--color-primary, #00e5ff);
  }

  .resize-handle:focus-visible {
    outline: 1px solid var(--color-primary, #00e5ff);
    outline-offset: -1px;
  }

  .resize-handle:hover {
    background: var(--color-primary-dim, rgba(0, 229, 255, 0.05));
  }

  .resize-handle.dragging {
    background: var(--color-primary-dim, rgba(0, 229, 255, 0.1));
  }

  @media (prefers-reduced-motion: reduce) {
    .resize-handle,
    .resize-handle::before {
      transition: none;
    }
  }
</style>
