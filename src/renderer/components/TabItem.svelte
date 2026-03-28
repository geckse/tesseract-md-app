<script lang="ts">
  import type { TabState } from '../stores/workspace.svelte'

  interface TabItemProps {
    tab: TabState
    isActive?: boolean
    draggable?: boolean
    onactivate?: (tabId: string) => void
    onclose?: (tabId: string) => void
    onmiddleclick?: (tabId: string) => void
  }

  let {
    tab,
    isActive = false,
    draggable = true,
    onactivate,
    onclose,
    onmiddleclick,
  }: TabItemProps = $props()

  const isGraph = $derived(tab.kind === 'graph')
  const isDirty = $derived(tab.kind === 'document' && tab.isDirty)
  const icon = $derived(isGraph ? 'hub' : 'description')
  const canClose = $derived(!isGraph)
  const canDrag = $derived(draggable && !isGraph)

  let isDragging = $state(false)

  function handleClick(e: MouseEvent) {
    if (e.button === 0) {
      onactivate?.(tab.id)
    }
  }

  function handleAuxClick(e: MouseEvent) {
    if (e.button === 1 && canClose) {
      e.preventDefault()
      onmiddleclick?.(tab.id)
    }
  }

  function handleCloseClick(e: MouseEvent) {
    e.stopPropagation()
    onclose?.(tab.id)
  }

  function handleDragStart(e: DragEvent) {
    if (!canDrag) {
      e.preventDefault()
      return
    }
    isDragging = true
    e.dataTransfer?.setData('text/plain', tab.id)
    e.dataTransfer!.effectAllowed = 'move'
  }

  function handleDragEnd() {
    isDragging = false
  }
</script>

<button
  class="tab-item"
  class:active={isActive}
  class:graph={isGraph}
  class:dragging={isDragging}
  onclick={handleClick}
  onauxclick={handleAuxClick}
  draggable={canDrag}
  ondragstart={handleDragStart}
  ondragend={handleDragEnd}
  title={tab.title}
  role="tab"
  aria-selected={isActive}
>
  <span class="material-symbols-outlined tab-icon">{icon}</span>

  <span class="tab-title">{tab.title}</span>

  {#if isDirty}
    <span class="dirty-indicator" aria-label="Unsaved changes"></span>
  {/if}

  {#if canClose}
    <span
      class="close-btn"
      role="button"
      tabindex="-1"
      aria-label="Close tab"
      onclick={handleCloseClick}
    >
      <span class="material-symbols-outlined close-icon">close</span>
    </span>
  {/if}
</button>

<style>
  .tab-item {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 100%;
    padding: 0 12px;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--color-text-dim, #71717a);
    font-family: var(--font-display, 'Space Grotesk', system-ui, sans-serif);
    font-size: var(--text-sm, 12px);
    font-weight: var(--weight-medium, 500);
    white-space: nowrap;
    cursor: pointer;
    transition:
      color var(--transition-fast, 150ms ease),
      background var(--transition-fast, 150ms ease),
      border-color var(--transition-fast, 150ms ease);
    user-select: none;
    flex-shrink: 0;
  }

  .tab-item:hover {
    color: var(--color-text, #e4e4e7);
    background: var(--color-surface, #161617);
  }

  .tab-item.active {
    color: var(--color-text-white, #fff);
    border-bottom-color: var(--color-primary, #00E5FF);
  }

  .tab-item.graph {
    cursor: pointer;
  }

  .tab-item.dragging {
    opacity: 0.4;
  }

  /* --- Icon --- */

  .tab-icon {
    font-size: 16px;
    flex-shrink: 0;
  }

  .tab-item.active .tab-icon {
    color: var(--color-primary, #00E5FF);
  }

  /* --- Title --- */

  .tab-title {
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* --- Dirty Indicator --- */

  .dirty-indicator {
    width: 6px;
    height: 6px;
    border-radius: var(--radius-full, 9999px);
    background: var(--color-primary, #00E5FF);
    flex-shrink: 0;
  }

  /* --- Close Button --- */

  .close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    border-radius: var(--radius-sm, 4px);
    color: var(--color-text-dim, #71717a);
    opacity: 0;
    cursor: pointer;
    transition:
      opacity var(--transition-fast, 150ms ease),
      color var(--transition-fast, 150ms ease),
      background var(--transition-fast, 150ms ease);
    flex-shrink: 0;
  }

  .tab-item:hover .close-btn {
    opacity: 1;
  }

  .close-btn:hover {
    color: var(--color-text, #e4e4e7);
    background: var(--color-border, #27272a);
  }

  .close-icon {
    font-size: 14px;
  }
</style>
