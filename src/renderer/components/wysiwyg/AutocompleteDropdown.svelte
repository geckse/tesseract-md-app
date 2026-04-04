<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { computePosition, flip, shift, offset } from '@floating-ui/dom'

  interface Props {
    suggestions: string[]
    onSelect: (value: string) => void
    anchorEl: HTMLElement
    secondaryLabels?: Map<string, string>
    onDismiss: () => void
  }

  let { suggestions, onSelect, anchorEl, secondaryLabels, onDismiss }: Props = $props()

  let menuEl: HTMLDivElement | undefined = $state(undefined)
  let selectedIndex = $state(0)

  function handleKeyDown(e: KeyboardEvent) {
    if (suggestions.length === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      e.stopPropagation()
      selectedIndex = (selectedIndex + 1) % suggestions.length
      scrollSelectedIntoView()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      e.stopPropagation()
      selectedIndex = (selectedIndex - 1 + suggestions.length) % suggestions.length
      scrollSelectedIntoView()
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      e.stopPropagation()
      if (suggestions[selectedIndex] !== undefined) {
        onSelect(suggestions[selectedIndex])
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onDismiss()
    }
  }

  function scrollSelectedIntoView() {
    if (!menuEl) return
    const item = menuEl.querySelector('.autocomplete-item.selected')
    if (item) {
      item.scrollIntoView({ block: 'nearest' })
    }
  }

  function positionMenu() {
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
  })

  onDestroy(() => {
    document.removeEventListener('keydown', handleKeyDown, true)
  })

  // Re-position when anchorEl changes
  $effect(() => {
    void anchorEl
    positionMenu()
  })

  // Reset selection when suggestions change
  $effect(() => {
    void suggestions
    selectedIndex = 0
  })
</script>

{#if suggestions.length > 0}
  <div class="autocomplete-dropdown" bind:this={menuEl} role="listbox" aria-label="Autocomplete suggestions">
    {#each suggestions as suggestion, index}
      <button
        class="autocomplete-item"
        class:selected={index === selectedIndex}
        role="option"
        aria-selected={index === selectedIndex}
        onmousedown={(e) => {
          e.preventDefault()
          onSelect(suggestion)
        }}
        onmouseenter={() => {
          selectedIndex = index
        }}
      >
        <span class="autocomplete-label">{suggestion}</span>
        {#if secondaryLabels?.has(suggestion)}
          <span class="autocomplete-secondary">{secondaryLabels.get(suggestion)}</span>
        {/if}
      </button>
    {/each}
  </div>
{/if}

<style>
  .autocomplete-dropdown {
    position: fixed;
    z-index: var(--z-overlay, 40);
    min-width: 180px;
    max-height: calc(6 * 36px);
    overflow-y: auto;
    background: var(--color-surface, #161617);
    border: 1px solid var(--color-border, #27272a);
    border-radius: var(--radius-md, 6px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    padding: var(--space-1, 4px);
  }

  .autocomplete-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
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

  .autocomplete-item:hover,
  .autocomplete-item.selected {
    background: var(--color-border, #27272a);
  }

  .autocomplete-label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .autocomplete-secondary {
    color: var(--color-text-secondary, #a1a1aa);
    font-size: var(--text-xs, 11px);
    flex-shrink: 0;
  }

  @media (prefers-reduced-motion: reduce) {
    .autocomplete-item {
      transition: none;
    }
  }
</style>
