<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { computePosition, flip, shift, offset } from '@floating-ui/dom'
  import type { SlashCommandItem } from '../../lib/tiptap/slash-command-extension'

  interface Props {
    items: SlashCommandItem[]
    command: (item: SlashCommandItem) => void
    clientRect: (() => DOMRect | null) | null
  }

  let { items, command, clientRect }: Props = $props()

  let menuEl: HTMLDivElement | undefined = $state(undefined)
  let selectedIndex = $state(0)

  function handleKeyDown(event: Event) {
    const e = event as KeyboardEvent
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      selectedIndex = (selectedIndex + 1) % items.length
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      selectedIndex = (selectedIndex - 1 + items.length) % items.length
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      if (items[selectedIndex]) {
        command(items[selectedIndex])
      }
    }
  }

  function handleDismiss() {
    // Handled by suggestion plugin onExit
  }

  function positionMenu() {
    if (!menuEl || !clientRect) return
    const rect = clientRect()
    if (!rect) return

    // Create a virtual element for floating-ui
    const virtualEl = {
      getBoundingClientRect: () => rect
    }

    computePosition(virtualEl as Element, menuEl, {
      placement: 'bottom-start',
      middleware: [offset(8), flip(), shift({ padding: 8 })]
    }).then(({ x, y }) => {
      if (menuEl) {
        menuEl.style.left = `${x}px`
        menuEl.style.top = `${y}px`
      }
    })
  }

  onMount(() => {
    positionMenu()
    // Listen for keyboard events dispatched from the extension
    const parent = menuEl?.parentElement
    if (parent) {
      parent.addEventListener('keydown', handleKeyDown)
      parent.addEventListener('slash-dismiss', handleDismiss)
    }
  })

  onDestroy(() => {
    const parent = menuEl?.parentElement
    if (parent) {
      parent.removeEventListener('keydown', handleKeyDown)
      parent.removeEventListener('slash-dismiss', handleDismiss)
    }
  })

  // Re-position when clientRect changes
  $effect(() => {
    void clientRect
    positionMenu()
  })

  // Reset selection when items change
  $effect(() => {
    void items
    selectedIndex = 0
  })

  function selectItem(index: number) {
    if (items[index]) {
      command(items[index])
    }
  }
</script>

<div class="slash-command-menu" bind:this={menuEl} role="listbox" aria-label="Slash commands">
  {#if items.length === 0}
    <div class="slash-empty">No results</div>
  {:else}
    {#each items as item, index}
      <button
        class="slash-item"
        class:selected={index === selectedIndex}
        role="option"
        aria-selected={index === selectedIndex}
        onmousedown={(e) => {
          e.preventDefault()
          selectItem(index)
        }}
        onmouseenter={() => {
          selectedIndex = index
        }}
      >
        <span class="slash-icon material-symbols-outlined">{item.icon}</span>
        <span class="slash-label">{item.label}</span>
      </button>
    {/each}
  {/if}
</div>

<style>
  .slash-command-menu {
    position: fixed;
    z-index: var(--z-overlay, 40);
    min-width: 200px;
    max-height: 320px;
    overflow-y: auto;
    background: var(--color-surface, #161617);
    border: 1px solid var(--color-border, #27272a);
    border-radius: var(--radius-md, 6px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    padding: var(--space-1, 4px);
  }

  .slash-item {
    display: flex;
    align-items: center;
    gap: var(--space-2, 8px);
    width: 100%;
    padding: var(--space-2, 8px) var(--space-3, 12px);
    border: none;
    border-radius: var(--radius-sm, 4px);
    background: transparent;
    color: var(--color-text, #e4e4e7);
    font-size: var(--text-sm, 13px);
    cursor: pointer;
    text-align: left;
    transition: background-color var(--transition-fast, 150ms ease);
  }

  .slash-item:hover,
  .slash-item.selected {
    background: var(--color-border, #27272a);
  }

  .slash-icon {
    font-size: 18px;
    color: var(--color-text-secondary, #a1a1aa);
    width: 20px;
    text-align: center;
  }

  .slash-label {
    flex: 1;
  }

  .slash-empty {
    padding: var(--space-2, 8px) var(--space-3, 12px);
    color: var(--color-text-secondary, #a1a1aa);
    font-size: var(--text-sm, 13px);
  }

  @media (prefers-reduced-motion: reduce) {
    .slash-item {
      transition: none;
    }
  }
</style>
