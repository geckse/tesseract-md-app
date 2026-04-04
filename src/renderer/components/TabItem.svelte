<script lang="ts">
  import { workspace } from '../stores/workspace.svelte'
  import type { TabState } from '../stores/workspace.svelte'
  import { syncFileStoresFromTab } from '../stores/files'
  import { tabBarDropReceived } from './TabBar.svelte'

  interface TabItemProps {
    tab: TabState
    isActive?: boolean
    paneFocused?: boolean
    draggable?: boolean
    onactivate?: (tabId: string) => void
    onclose?: (tabId: string) => void
    onmiddleclick?: (tabId: string) => void
    oncontextmenu?: (tabId: string, event: MouseEvent) => void
  }

  let {
    tab,
    isActive = false,
    paneFocused = true,
    draggable = true,
    onactivate,
    onclose,
    onmiddleclick,
    oncontextmenu: oncontextmenuprop,
  }: TabItemProps = $props()

  const isGraph = $derived(tab.kind === 'graph')
  const isAsset = $derived(tab.kind === 'asset')
  const isDirty = $derived(tab.kind === 'document' && tab.isDirty)
  const icon = $derived(
    isGraph ? 'hub' :
    isAsset && tab.kind === 'asset' ? (
      tab.mimeCategory === 'image' ? 'image' :
      tab.mimeCategory === 'pdf' ? 'picture_as_pdf' :
      tab.mimeCategory === 'video' ? 'videocam' :
      tab.mimeCategory === 'audio' ? 'audiotrack' : 'attach_file'
    ) : 'description'
  )
  const canClose = $derived(!isGraph)
  const canDrag = $derived(draggable)

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

  function handleContextMenu(e: MouseEvent) {
    e.preventDefault()
    oncontextmenuprop?.(tab.id, e)
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
    // Reset the cross-window drop flag at drag start
    tabBarDropReceived.value = false
    e.dataTransfer?.setData('text/plain', tab.id)
    e.dataTransfer!.effectAllowed = 'move'
  }

  /**
   * On dragend, check if the drop was handled internally (within any TabBar
   * in this window). If not, the tab was dragged outside the window —
   * detach it to spawn a new window at the drop position.
   *
   * We use a shared `tabBarDropReceived` flag rather than screen coordinates
   * because the browser's dragend event fires regardless of where the drop
   * lands, but the drop event only fires within valid drop targets in our
   * window. If no internal drop was received, the tab left the window.
   */
  function handleDragEnd(e: DragEvent) {
    isDragging = false

    // If the drop was handled internally (reorder within a TabBar), nothing to do
    if (tabBarDropReceived.value) {
      tabBarDropReceived.value = false
      return
    }

    // The tab was dragged outside the window — check if outside viewport bounds
    // using client coordinates (0,0 to viewport width/height)
    const { clientX, clientY } = e
    const isOutsideWindow =
      clientX <= 0 ||
      clientY <= 0 ||
      clientX >= window.innerWidth ||
      clientY >= window.innerHeight

    if (isOutsideWindow && tab.kind === 'document') {
      // Detach this tab to a new window
      workspace.detachTab(tab.id).then(() => {
        syncFileStoresFromTab()
      })
    }
  }
</script>

<button
  class="tab-item"
  class:active={isActive && paneFocused}
  class:active-dimmed={isActive && !paneFocused}
  class:graph={isGraph}
  class:dragging={isDragging}
  onclick={handleClick}
  onauxclick={handleAuxClick}
  oncontextmenu={handleContextMenu}
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
    <!-- svelte-ignore a11y_click_events_have_key_events -->
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

  .tab-item.active-dimmed {
    color: var(--color-text, #e4e4e7);
    border-bottom-color: var(--color-primary-glow, rgba(0, 229, 255, 0.3));
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

  .tab-item.active-dimmed .tab-icon {
    color: var(--color-primary-glow, rgba(0, 229, 255, 0.4));
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
