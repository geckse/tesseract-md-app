<script module lang="ts">
  export interface PopoverMenuItem {
    id: string
    label: string
    icon?: string
    /** Renders a check mark when true; use for single-select and multi-check menus. */
    checked?: boolean
    disabled?: boolean
    danger?: boolean
    /** Renders a separator line above this item. */
    separatorBefore?: boolean
  }
</script>

<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { computePosition, flip, shift, offset } from '@floating-ui/dom'

  interface Props {
    anchorEl: HTMLElement
    items: PopoverMenuItem[]
    onselect: (id: string) => void
    ondismiss: () => void
    /** Dismiss the menu after an item is selected (default true). Set false for multi-check menus. */
    closeOnSelect?: boolean
    ariaLabel?: string
    /** Message shown when there are no items. */
    emptyLabel?: string
  }

  let {
    anchorEl,
    items,
    onselect,
    ondismiss,
    closeOnSelect = true,
    ariaLabel = 'Menu',
    emptyLabel = 'No options'
  }: Props = $props()

  let menuEl: HTMLDivElement | undefined = $state(undefined)
  let activeIndex = $state(-1)

  function enabledIndices(): number[] {
    return items.map((item, i) => (item.disabled ? -1 : i)).filter((i) => i >= 0)
  }

  function move(delta: 1 | -1): void {
    const enabled = enabledIndices()
    if (enabled.length === 0) return
    const pos = enabled.indexOf(activeIndex)
    if (pos === -1) {
      activeIndex = delta === 1 ? enabled[0] : enabled[enabled.length - 1]
    } else {
      activeIndex = enabled[(pos + delta + enabled.length) % enabled.length]
    }
  }

  function select(index: number): void {
    const item = items[index]
    if (!item || item.disabled) return
    onselect(item.id)
    if (closeOnSelect) ondismiss()
  }

  function handleKeyDown(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      e.stopPropagation()
      move(1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      e.stopPropagation()
      move(-1)
    } else if (e.key === 'Home') {
      e.preventDefault()
      e.stopPropagation()
      activeIndex = enabledIndices()[0] ?? -1
    } else if (e.key === 'End') {
      e.preventDefault()
      e.stopPropagation()
      const enabled = enabledIndices()
      activeIndex = enabled[enabled.length - 1] ?? -1
    } else if (e.key === 'Enter' || e.key === ' ') {
      if (activeIndex >= 0) {
        e.preventDefault()
        e.stopPropagation()
        select(activeIndex)
      }
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault()
      e.stopPropagation()
      ondismiss()
    }
  }

  function handlePointerDown(e: PointerEvent): void {
    const target = e.target as Node | null
    if (!target) return
    if (menuEl?.contains(target)) return
    if (anchorEl?.contains(target)) return
    ondismiss()
  }

  function positionMenu(): void {
    if (!menuEl || !anchorEl) return
    computePosition(anchorEl, menuEl, {
      placement: 'bottom-start',
      middleware: [offset(4), flip(), shift({ padding: 8 })]
    }).then(({ x, y }) => {
      if (menuEl) {
        menuEl.style.left = `${x}px`
        menuEl.style.top = `${y}px`
      }
    })
  }

  onMount(() => {
    positionMenu()
    document.addEventListener('keydown', handleKeyDown, true)
    document.addEventListener('pointerdown', handlePointerDown, true)
  })
  onDestroy(() => {
    document.removeEventListener('keydown', handleKeyDown, true)
    document.removeEventListener('pointerdown', handlePointerDown, true)
  })
  $effect(() => {
    void anchorEl
    void items.length
    positionMenu()
  })
</script>

<div class="pm" bind:this={menuEl} role="menu" aria-label={ariaLabel}>
  {#if items.length === 0}
    <div class="pm-empty">{emptyLabel}</div>
  {/if}
  {#each items as item, i (item.id)}
    {#if item.separatorBefore}
      <div class="pm-separator" role="separator"></div>
    {/if}
    <button
      class="pm-item"
      class:active={i === activeIndex}
      class:danger={item.danger}
      role={item.checked !== undefined ? 'menuitemcheckbox' : 'menuitem'}
      aria-checked={item.checked !== undefined ? item.checked : undefined}
      disabled={item.disabled}
      onmousedown={(e) => {
        // preventDefault keeps focus where it is (cell editors commit on blur)
        e.preventDefault()
        select(i)
      }}
      onmouseenter={() => {
        if (!item.disabled) activeIndex = i
      }}
    >
      {#if item.icon}
        <span class="material-symbols-outlined pm-icon">{item.icon}</span>
      {/if}
      <span class="pm-label">{item.label}</span>
      {#if item.checked}
        <span class="material-symbols-outlined pm-check">check</span>
      {/if}
    </button>
  {/each}
</div>

<style>
  .pm {
    position: fixed;
    z-index: var(--z-overlay, 40);
    min-width: 180px;
    max-width: 320px;
    max-height: 320px;
    overflow-y: auto;
    background: var(--color-surface-elevated);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md, 6px);
    box-shadow: var(--shadow-popover, 0 8px 24px rgba(0, 0, 0, 0.45));
    padding: var(--space-1, 4px);
    transform-origin: top left;
    animation: pm-enter 120ms ease-out;
    scrollbar-width: thin;
    scrollbar-color: var(--scrollbar-thumb) var(--scrollbar-track, transparent);
  }

  .pm::-webkit-scrollbar {
    width: var(--scrollbar-width, 6px);
  }

  .pm::-webkit-scrollbar-thumb {
    background: var(--scrollbar-thumb);
    border-radius: var(--radius-full, 9999px);
  }

  .pm::-webkit-scrollbar-thumb:hover {
    background: var(--scrollbar-thumb-hover, rgba(255, 255, 255, 0.2));
  }

  @keyframes pm-enter {
    from {
      opacity: 0;
      transform: scale(0.98);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  .pm-item {
    display: flex;
    align-items: center;
    gap: var(--space-2, 8px);
    width: 100%;
    padding: 6px 8px;
    background: transparent;
    border: none;
    border-radius: var(--radius-sm, 4px);
    color: var(--color-text);
    font-size: var(--text-sm, 0.75rem);
    cursor: pointer;
    text-align: left;
    transition: background var(--transition-fast, 150ms ease);
  }

  .pm-item.active {
    background: var(--overlay-hover);
  }

  .pm-item:disabled {
    color: var(--color-text-faint);
    cursor: default;
  }

  .pm-item.danger {
    color: var(--color-error);
  }

  .pm-icon {
    font-size: 16px;
    color: var(--color-text-dim);
  }

  .pm-item.active .pm-icon {
    color: var(--color-primary);
  }

  .pm-item.danger .pm-icon {
    color: var(--color-error);
  }

  .pm-label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pm-check {
    font-size: 16px;
    color: var(--color-primary);
  }

  .pm-separator {
    height: 1px;
    margin: var(--space-1, 4px) 0;
    background: var(--color-border);
  }

  .pm-empty {
    padding: 6px 8px;
    color: var(--color-text-dim);
    font-size: var(--text-sm, 0.75rem);
  }

  @media (prefers-reduced-motion: reduce) {
    .pm {
      animation: none;
    }
    .pm-item {
      transition: none;
    }
  }
</style>
