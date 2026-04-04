<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { computePosition, flip, shift, offset } from '@floating-ui/dom'

  interface Props {
    anchorEl: HTMLElement
    onSelect: (type: string) => void
    onDismiss: () => void
  }

  let { anchorEl, onSelect, onDismiss }: Props = $props()

  const typeOptions = [
    { type: 'text', icon: 'notes', label: 'Text' },
    { type: 'number', icon: 'tag', label: 'Number' },
    { type: 'boolean', icon: 'check_box', label: 'Boolean' },
    { type: 'date', icon: 'calendar_today', label: 'Date' },
    { type: 'datetime', icon: 'event', label: 'Date & Time' },
    { type: 'url', icon: 'link', label: 'URL' },
    { type: 'email', icon: 'mail', label: 'Email' },
    { type: 'tags', icon: 'sell', label: 'Tags' },
    { type: 'select', icon: 'arrow_drop_down_circle', label: 'Select' },
    { type: 'complex', icon: 'data_object', label: 'JSON' },
  ] as const

  let menuEl: HTMLDivElement | undefined = $state(undefined)
  let selectedIndex = $state(0)

  function handleKeyDown(e: KeyboardEvent) {
    const len = typeOptions.length
    if (e.key === 'ArrowDown') {
      e.preventDefault(); e.stopPropagation()
      selectedIndex = (selectedIndex + 2) % len
    } else if (e.key === 'ArrowUp') {
      e.preventDefault(); e.stopPropagation()
      selectedIndex = (selectedIndex - 2 + len) % len
    } else if (e.key === 'ArrowRight') {
      e.preventDefault(); e.stopPropagation()
      selectedIndex = (selectedIndex + 1) % len
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault(); e.stopPropagation()
      selectedIndex = (selectedIndex - 1 + len) % len
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault(); e.stopPropagation()
      onSelect(typeOptions[selectedIndex].type)
    } else if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation()
      onDismiss()
    }
  }

  function positionMenu() {
    if (!menuEl || !anchorEl) return
    computePosition(anchorEl, menuEl, {
      placement: 'bottom-start',
      middleware: [offset(4), flip(), shift({ padding: 8 })]
    }).then(({ x, y }) => { if (menuEl) { menuEl.style.left = `${x}px`; menuEl.style.top = `${y}px` } })
  }

  onMount(() => { positionMenu(); document.addEventListener('keydown', handleKeyDown, true) })
  onDestroy(() => { document.removeEventListener('keydown', handleKeyDown, true) })
  $effect(() => { void anchorEl; positionMenu() })
</script>

<div class="tp" bind:this={menuEl} role="listbox" aria-label="Select property type">
  {#each typeOptions as opt, i}
    <button
      class="tp-option"
      class:selected={i === selectedIndex}
      role="option"
      aria-selected={i === selectedIndex}
      onmousedown={(e) => { e.preventDefault(); onSelect(opt.type) }}
      onmouseenter={() => { selectedIndex = i }}
    >
      <span class="material-symbols-outlined tp-icon">{opt.icon}</span>
      <span class="tp-label">{opt.label}</span>
    </button>
  {/each}
</div>

<style>
  .tp {
    position: fixed;
    z-index: var(--z-overlay, 40);
    background: var(--color-surface, #161617);
    border: 1px solid var(--color-border, #27272a);
    border-radius: var(--radius-md, 6px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    padding: var(--space-1, 4px);
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2px;
    min-width: 220px;
  }
  .tp-option {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: var(--color-text, #e4e4e7);
    font-size: 12px;
    cursor: pointer;
    text-align: left;
    transition: background 150ms ease;
  }
  .tp-option:hover, .tp-option.selected {
    background: var(--color-border, #27272a);
  }
  .tp-icon {
    font-size: 16px;
    color: var(--color-text-dim, #71717a);
    transition: color 150ms ease;
  }
  .tp-option:hover .tp-icon, .tp-option.selected .tp-icon {
    color: var(--color-primary, #00E5FF);
  }
  .tp-label { flex: 1; }
  @media (prefers-reduced-motion: reduce) {
    .tp-option, .tp-icon { transition: none; }
  }
</style>
