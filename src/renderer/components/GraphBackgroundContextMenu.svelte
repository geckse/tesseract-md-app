<script lang="ts">
  import { onMount } from 'svelte'

  interface Props {
    x: number
    y: number
    labelsVisible: boolean
    busy?: boolean
    exporting?: boolean
    ondismiss: () => void
    onrecenter: () => void
    ontogglelabels: () => void
    onscreenshot: () => void
    onscreenshottransparent: () => void
  }

  let {
    x,
    y,
    labelsVisible,
    busy = false,
    exporting = false,
    ondismiss,
    onrecenter,
    ontogglelabels,
    onscreenshot,
    onscreenshottransparent
  }: Props = $props()

  let menuEl: HTMLDivElement | undefined = $state(undefined)
  let actionsDisabled = $derived(busy || exporting)

  function enabledItems(): HTMLButtonElement[] {
    if (!menuEl) return []
    return Array.from(
      menuEl.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')
    )
  }

  function focusRelativeItem(delta: 1 | -1): void {
    const items = enabledItems()
    if (items.length === 0) return
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement)
    const nextIndex =
      currentIndex === -1
        ? delta === 1
          ? 0
          : items.length - 1
        : (currentIndex + delta + items.length) % items.length
    items[nextIndex].focus()
  }

  function handleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      ondismiss()
      return
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      event.stopPropagation()
      focusRelativeItem(event.key === 'ArrowDown' ? 1 : -1)
      return
    }

    if (event.key === 'Home' || event.key === 'End') {
      const items = enabledItems()
      if (items.length === 0) return
      event.preventDefault()
      event.stopPropagation()
      items[event.key === 'Home' ? 0 : items.length - 1].focus()
    }
  }

  function dismissFromContextMenu(event: MouseEvent): void {
    event.preventDefault()
    ondismiss()
  }

  onMount(() => {
    const firstItem = enabledItems()[0]
    if (firstItem) firstItem.focus()
    else menuEl?.focus()
  })
</script>

<button
  type="button"
  class="context-menu-backdrop"
  aria-label="Dismiss graph background menu"
  onclick={ondismiss}
  oncontextmenu={dismissFromContextMenu}
></button>

<div
  class="context-menu"
  bind:this={menuEl}
  style="left: {x}px; top: {y}px"
  role="menu"
  aria-label="Graph background actions"
  aria-busy={actionsDisabled}
  tabindex="-1"
  onkeydown={handleKeyDown}
  oncontextmenu={(event) => event.preventDefault()}
>
  <button
    type="button"
    class="context-menu-item"
    role="menuitem"
    disabled={actionsDisabled}
    onclick={onrecenter}
  >
    <span class="material-symbols-outlined" aria-hidden="true">center_focus_strong</span>
    <span>Recenter graph</span>
  </button>
  <button
    type="button"
    class="context-menu-item"
    role="menuitem"
    disabled={actionsDisabled}
    onclick={ontogglelabels}
  >
    <span class="material-symbols-outlined" aria-hidden="true">label</span>
    <span>{labelsVisible ? 'Hide labels' : 'Show labels'}</span>
  </button>

  <div class="context-menu-separator" role="separator"></div>

  <button
    type="button"
    class="context-menu-item"
    role="menuitem"
    disabled={actionsDisabled}
    onclick={onscreenshot}
  >
    <span class="material-symbols-outlined" aria-hidden="true">photo_camera</span>
    <span>Screenshot</span>
  </button>
  <button
    type="button"
    class="context-menu-item"
    role="menuitem"
    disabled={actionsDisabled}
    onclick={onscreenshottransparent}
  >
    <span class="material-symbols-outlined" aria-hidden="true">background_replace</span>
    <span>Screenshot transparent background</span>
  </button>

  <span class="sr-only" role="status" aria-live="polite" aria-atomic="true">
    {exporting ? 'Exporting graph screenshot.' : ''}
  </span>
</div>

<style>
  .context-menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 49;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: default;
  }

  .context-menu {
    position: fixed;
    z-index: 50;
    min-width: 236px;
    max-width: min(320px, calc(100vw - 16px));
    padding: var(--space-1, 4px) 0;
    overflow: hidden;
    background: var(--color-surface-elevated, var(--color-surface, #161617));
    border: 1px solid var(--color-border, #27272a);
    border-radius: var(--radius-md, 6px);
    box-shadow: var(--shadow-popover, 0 8px 24px rgba(0, 0, 0, 0.5));
    animation: context-menu-enter 120ms ease-out;
  }

  .context-menu:focus-visible {
    outline: 2px solid var(--color-primary, #00e5ff);
    outline-offset: 2px;
  }

  .context-menu-item {
    display: flex;
    align-items: center;
    gap: var(--space-2, 8px);
    width: 100%;
    min-height: 32px;
    padding: 6px 12px;
    border: 0;
    background: transparent;
    color: var(--color-text, #e4e4e7);
    font-family: inherit;
    font-size: var(--text-sm, 12px);
    text-align: left;
    cursor: pointer;
    transition:
      color var(--transition-fast, 150ms ease),
      background var(--transition-fast, 150ms ease);
  }

  .context-menu-item:hover:not(:disabled),
  .context-menu-item:focus-visible {
    color: var(--color-primary, #00e5ff);
    background: var(--color-primary-dim, rgba(0, 229, 255, 0.08));
    outline: none;
  }

  .context-menu-item:disabled {
    cursor: default;
    opacity: 0.45;
  }

  .context-menu-item .material-symbols-outlined {
    flex: 0 0 auto;
    font-size: 16px;
  }

  .context-menu-separator {
    height: 1px;
    margin: var(--space-1, 4px) 0;
    background: var(--color-border, #27272a);
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  @keyframes context-menu-enter {
    from {
      opacity: 0;
      transform: scale(0.98);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .context-menu {
      animation: none;
    }

    .context-menu-item {
      transition: none;
    }
  }
</style>
