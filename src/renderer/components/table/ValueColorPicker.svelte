<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { computePosition, flip, offset, shift } from '@floating-ui/dom'
  import { paletteColor } from '../../lib/harmonic-palette'
  import type { PropertyValueColorSelection } from '../../../shared/value-colors'
  import {
    neutralValueColorPalette,
    propertyValueColorOverrides,
    setPropertyValueColor,
    valueColorOverride,
    valueColorPalette
  } from '../../stores/value-colors'

  interface Props {
    anchorEl: HTMLElement
    collectionId: string
    scope: string | null
    field: string
    value: string
    automaticSlot: number
    onclose: () => void
  }

  let { anchorEl, collectionId, scope, field, value, automaticSlot, onclose }: Props = $props()

  let pickerEl: HTMLDivElement | undefined = $state(undefined)
  let saving = $state(false)
  let error = $state<string | null>(null)

  const override = $derived(
    valueColorOverride($propertyValueColorOverrides, collectionId, scope, field, value)
  )

  function positionPicker(): void {
    if (!pickerEl || !anchorEl) return
    computePosition(anchorEl, pickerEl, {
      placement: 'bottom-start',
      middleware: [offset(6), flip(), shift({ padding: 8 })]
    }).then(({ x, y }) => {
      if (!pickerEl) return
      pickerEl.style.left = `${x}px`
      pickerEl.style.top = `${y}px`
    })
  }

  async function choose(selection: PropertyValueColorSelection | null): Promise<void> {
    if (saving) return
    saving = true
    error = null
    try {
      await setPropertyValueColor(collectionId, scope, field, value, selection)
      onclose()
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      saving = false
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return
    event.preventDefault()
    event.stopPropagation()
    onclose()
  }

  function handlePointerDown(event: PointerEvent): void {
    const target = event.target as Node | null
    if (!target || pickerEl?.contains(target) || anchorEl.contains(target)) return
    onclose()
  }

  onMount(() => {
    positionPicker()
    document.addEventListener('keydown', handleKeydown, true)
    document.addEventListener('pointerdown', handlePointerDown, true)
  })

  onDestroy(() => {
    document.removeEventListener('keydown', handleKeydown, true)
    document.removeEventListener('pointerdown', handlePointerDown, true)
  })

  $effect(() => {
    void anchorEl
    positionPicker()
  })
</script>

<div
  class="picker"
  bind:this={pickerEl}
  role="dialog"
  tabindex="-1"
  aria-label="Choose color for {value}"
  onpointerdown={(event) => event.stopPropagation()}
  oncontextmenu={(event) => event.preventDefault()}
>
  <div class="heading">
    <span class="eyebrow">Value color</span>
    <strong title={value}>{value}</strong>
  </div>

  <button
    class="automatic"
    class:selected={override === null}
    disabled={saving}
    aria-pressed={override === null}
    onclick={() => void choose(null)}
  >
    <span class="auto-preview" style="--swatch: {paletteColor($valueColorPalette, automaticSlot)}"
    ></span>
    <span>Automatic</span>
    {#if override === null}
      <span class="material-symbols-outlined check">check</span>
    {/if}
  </button>

  <span class="palette-label">Accent</span>
  <div class="palette" aria-label="Accent colors">
    {#each $valueColorPalette.colors as color, slot}
      <button
        class="swatch"
        class:selected={override?.palette === 'accent' && override.slot === slot}
        style="--swatch: {color}"
        aria-label="Accent color {slot + 1}"
        aria-pressed={override?.palette === 'accent' && override.slot === slot}
        disabled={saving}
        onclick={() => void choose({ palette: 'accent', slot })}
      >
        {#if override?.palette === 'accent' && override.slot === slot}
          <span class="material-symbols-outlined">check</span>
        {/if}
      </button>
    {/each}
  </div>

  <span class="palette-label">Neutral</span>
  <div class="palette neutral" aria-label="Neutral brightness colors">
    {#each $neutralValueColorPalette.colors as color, slot}
      <button
        class="swatch"
        class:selected={override?.palette === 'neutral' && override.slot === slot}
        style="--swatch: {color}"
        aria-label="Neutral color {slot + 1}"
        aria-pressed={override?.palette === 'neutral' && override.slot === slot}
        disabled={saving}
        onclick={() => void choose({ palette: 'neutral', slot })}
      >
        {#if override?.palette === 'neutral' && override.slot === slot}
          <span class="material-symbols-outlined">check</span>
        {/if}
      </button>
    {/each}
  </div>

  {#if error}
    <p class="error" role="alert">{error}</p>
  {:else}
    <p>Neutral colors use muted accent-tinted brightness steps.</p>
  {/if}
</div>

<style>
  .picker {
    position: fixed;
    z-index: var(--z-overlay, 40);
    width: 224px;
    box-sizing: border-box;
    padding: 10px;
    background: var(--color-surface-elevated);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg, 8px);
    box-shadow: var(--shadow-popover, 0 8px 24px rgba(0, 0, 0, 0.45));
    color: var(--color-text);
    animation: picker-enter 120ms ease-out;
  }

  .heading {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
    margin: 0 2px 8px;
  }

  .heading strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-sm, 0.75rem);
  }

  .eyebrow {
    color: var(--color-text-dim);
    font-size: var(--text-xs, 0.625rem);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .automatic {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    height: 30px;
    padding: 0 7px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm, 4px);
    background: transparent;
    color: var(--color-text);
    font: inherit;
    font-size: var(--text-sm, 0.75rem);
    cursor: pointer;
  }

  .automatic:hover,
  .automatic.selected {
    background: var(--overlay-hover);
  }

  .automatic.selected {
    border-color: color-mix(in srgb, var(--color-primary) 50%, transparent);
  }

  .auto-preview {
    width: 14px;
    height: 14px;
    flex: none;
    border-radius: var(--radius-full, 9999px);
    background: var(--swatch);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--swatch) 70%, var(--color-border));
  }

  .check {
    margin-left: auto;
    color: var(--color-primary);
    font-size: 16px;
  }

  .palette {
    display: grid;
    grid-template-columns: repeat(6, 1fr);
    gap: 7px;
    padding: 5px 4px 7px;
  }

  .palette.neutral {
    padding-bottom: 5px;
  }

  .palette-label {
    display: block;
    margin: 8px 4px 0;
    padding-top: 7px;
    border-top: 1px solid var(--color-border);
    color: var(--color-text-dim);
    font-size: var(--text-xs, 0.625rem);
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .swatch {
    display: grid;
    place-items: center;
    width: 25px;
    height: 25px;
    padding: 0;
    border: 2px solid transparent;
    border-radius: var(--radius-full, 9999px);
    background: var(--swatch);
    color: white;
    cursor: pointer;
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--swatch) 65%, var(--color-border));
    transition:
      transform var(--transition-fast, 150ms ease),
      box-shadow var(--transition-fast, 150ms ease);
  }

  .swatch:hover {
    transform: scale(1.12);
  }

  .swatch.selected {
    border-color: var(--color-surface-elevated);
    box-shadow:
      0 0 0 2px var(--color-primary),
      0 0 0 3px var(--color-surface-elevated);
  }

  .swatch .material-symbols-outlined {
    font-size: 15px;
    font-weight: 700;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.55);
  }

  button:disabled {
    cursor: wait;
    opacity: 0.65;
  }

  p {
    margin: 5px 3px 0;
    color: var(--color-text-faint);
    font-size: var(--text-xs, 0.625rem);
    line-height: 1.35;
  }

  p.error {
    color: var(--color-error);
  }

  @keyframes picker-enter {
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
    .picker {
      animation: none;
    }

    .swatch {
      transition: none;
    }
  }
</style>
