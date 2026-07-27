<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { computePosition, flip, shift, offset } from '@floating-ui/dom'
  import { propertyOps } from '../stores/property-ops.svelte'
  import { cliFeatures } from '../lib/cli-features.svelte'
  import { focusTrap } from '../lib/focus-trap'
  import type { PropertyValueColorSelection } from '../../shared/value-colors'
  import {
    automaticValueColorSlot,
    valueColorSelectionColor,
    valueColorSelectionStyle
  } from '../lib/value-colors'
  import { resolvedTheme } from '../stores/theme'
  import {
    loadPropertyValueColors,
    neutralValueColorPalette,
    propertyValueColorOverrides,
    valueColorOverride,
    valueColorPalette
  } from '../stores/value-colors'
  import Button from './ui/Button.svelte'
  import ValueColorPicker from './table/ValueColorPicker.svelte'

  interface Props {
    anchorEl: HTMLElement
    /** Overlay scope key (folder path, no trailing slash) or null for the global section. */
    scope: string | null
    fieldKey: string
    /** Current annotations to prefill (from the schema field / table column). */
    description?: string | null
    required?: boolean
    allowedValues?: string[] | null
    /** Collection context used to read/write synced value-color annotations. */
    collectionId?: string | null
    /** Existing Tags values (Select values come from allowedValues). */
    colorValues?: string[]
    /** Show value-color controls even when the field currently has no values. */
    valueColorsEnabled?: boolean
    /** Phase 42: whether the field is a relation (shows the target-folder input). */
    isRelation?: boolean
    /** Phase 42: current overlay-declared target folder to prefill. */
    relationTarget?: string | null
    onclose: () => void
  }

  let {
    anchorEl,
    scope,
    fieldKey,
    description: initialDescription = null,
    required: initialRequired = false,
    allowedValues: initialAllowed = null,
    collectionId = null,
    colorValues: initialColorValues = [],
    valueColorsEnabled = false,
    isRelation = false,
    relationTarget: initialTarget = null,
    onclose
  }: Props = $props()

  // Deliberate initial-value capture: the popover edits a snapshot of the
  // annotations and writes back on Save; live prop updates must not clobber
  // in-progress edits.
  // svelte-ignore state_referenced_locally
  let description = $state(initialDescription ?? '')
  // svelte-ignore state_referenced_locally
  let required = $state(initialRequired)
  // svelte-ignore state_referenced_locally
  let values = $state<string[]>(initialAllowed ? [...initialAllowed] : [])
  // svelte-ignore state_referenced_locally
  let targetFolder = $state(initialTarget ?? '')
  let newValue = $state('')
  let saving = $state(false)
  let error = $state<string | null>(null)
  let colorPicker: { anchorEl: HTMLElement; value: string } | null = $state(null)

  const showTargetField = $derived(isRelation && cliFeatures.supportsRelations)
  const colorOptions = $derived.by(() => {
    const source = initialAllowed !== null || values.length > 0 ? values : initialColorValues
    return [...new Set(source.map((value) => value.trim()).filter(Boolean))]
  })
  const showValueColors = $derived(valueColorsEnabled || colorOptions.length > 0)

  let popEl = $state<HTMLDivElement | undefined>(undefined)

  $effect(() => {
    void loadPropertyValueColors(collectionId, scope)
  })

  function automaticColorSlot(value: string): number {
    const allowed = initialAllowed !== null || values.length > 0 ? values : null
    return automaticValueColorSlot(fieldKey, value, allowed)
  }

  function effectiveColorSelection(value: string): PropertyValueColorSelection {
    return (
      valueColorOverride($propertyValueColorOverrides, collectionId, scope, fieldKey, value) ?? {
        palette: 'accent',
        slot: automaticColorSlot(value)
      }
    )
  }

  function colorStyle(value: string): string {
    return valueColorSelectionStyle(
      $valueColorPalette,
      $neutralValueColorPalette,
      effectiveColorSelection(value),
      $resolvedTheme
    )
  }

  function swatchColor(value: string): string {
    return valueColorSelectionColor(
      $valueColorPalette,
      $neutralValueColorPalette,
      effectiveColorSelection(value)
    )
  }

  function openColorPicker(event: MouseEvent, value: string): void {
    if (!collectionId) return
    event.preventDefault()
    event.stopPropagation()
    colorPicker = { anchorEl: event.currentTarget as HTMLElement, value }
  }

  function addValue(): void {
    const trimmed = newValue.trim()
    if (trimmed && !values.includes(trimmed)) values.push(trimmed)
    newValue = ''
  }

  function removeValue(index: number): void {
    values = values.filter((_, i) => i !== index)
  }

  async function save(): Promise<void> {
    saving = true
    error = null
    try {
      const patch: Parameters<typeof propertyOps.applyOverlayFieldPatch>[2] = {
        description: description.trim() === '' ? null : description.trim(),
        required: required ? true : null,
        allowedValues: values.length > 0 ? values : null
      }
      if (showTargetField) {
        // Folder-key grammar: relative path, NO trailing slash (normalized here;
        // the overlay writer rejects trailing slashes outright).
        const t = targetFolder.trim().replace(/\/+$/, '')
        patch.target = t === '' ? null : t
      }
      await propertyOps.applyOverlayFieldPatch(scope, fieldKey, patch)
      onclose()
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      saving = false
    }
  }

  function positionPopover(): void {
    if (!popEl || !anchorEl) return
    computePosition(anchorEl, popEl, {
      placement: 'bottom-start',
      middleware: [offset(4), flip(), shift({ padding: 8 })]
    }).then(({ x, y }) => {
      if (popEl) {
        popEl.style.left = `${x}px`
        popEl.style.top = `${y}px`
      }
    })
  }

  function handleKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      if (colorPicker) colorPicker = null
      else onclose()
    }
  }

  function handlePointerDown(e: PointerEvent): void {
    const target = e.target as Node | null
    if (!target) return
    if (popEl?.contains(target)) return
    if (anchorEl?.contains(target)) return
    onclose()
  }

  onMount(() => {
    positionPopover()
    document.addEventListener('keydown', handleKeyDown, true)
    document.addEventListener('pointerdown', handlePointerDown, true)
  })
  onDestroy(() => {
    document.removeEventListener('keydown', handleKeyDown, true)
    document.removeEventListener('pointerdown', handlePointerDown, true)
  })
  $effect(() => {
    void anchorEl
    positionPopover()
  })
</script>

<div
  class="psp"
  bind:this={popEl}
  role="dialog"
  aria-label="Property settings for {fieldKey}"
  use:focusTrap
>
  <h3 class="psp-title">
    <span class="mono">{fieldKey}</span> settings
    {#if scope}
      <span class="psp-scope mono">{scope}</span>
    {/if}
  </h3>

  <label class="psp-field">
    <span class="psp-label">Description</span>
    <!-- svelte-ignore a11y_autofocus -->
    <input
      class="psp-input"
      type="text"
      placeholder="What this property means"
      autofocus
      bind:value={description}
    />
  </label>

  <label class="psp-check">
    <input type="checkbox" bind:checked={required} />
    <span>Required</span>
  </label>

  {#if showTargetField}
    <label class="psp-field">
      <span class="psp-label">Target folder</span>
      <input
        class="psp-input mono"
        type="text"
        placeholder="e.g. clients"
        bind:value={targetFolder}
      />
    </label>
  {/if}

  <div class="psp-field">
    <span class="psp-label">Allowed values</span>
    <div class="psp-chips">
      {#each values as v, i (v)}
        <span class="psp-chip">
          {v}
          <button
            class="psp-chip-remove"
            onclick={() => removeValue(i)}
            aria-label="Remove allowed value {v}"
          >
            &times;
          </button>
        </span>
      {/each}
      <input
        class="psp-chip-input"
        type="text"
        placeholder="+ value"
        aria-label="Add allowed value"
        bind:value={newValue}
        onkeydown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            addValue()
          }
        }}
        onblur={addValue}
      />
    </div>
  </div>

  {#if showValueColors}
    <div class="psp-field">
      <span class="psp-label">Value colors</span>
      {#if colorOptions.length > 0}
        <div class="psp-color-list">
          {#each colorOptions as option (option)}
            <div class="psp-color-row">
              <button
                class="psp-color-button"
                style="--swatch: {swatchColor(option)}"
                aria-label="Choose color for {option}"
                title="Choose color for {option}"
                onclick={(event) => openColorPicker(event, option)}
              ></button>
              <span class="psp-color-value" style={colorStyle(option)}>{option}</span>
            </div>
          {/each}
        </div>
      {:else}
        <span class="psp-hint">Add an allowed value or use a tag to configure its color.</span>
      {/if}
    </div>
  {/if}

  {#if error}
    <p class="psp-error" role="alert">{error}</p>
  {/if}

  <div class="psp-actions">
    <Button variant="secondary" size="sm" onclick={onclose}>Cancel</Button>
    <Button size="sm" disabled={saving} onclick={() => void save()}>
      {saving ? 'Saving…' : 'Save'}
    </Button>
  </div>

  {#if colorPicker && collectionId}
    <ValueColorPicker
      anchorEl={colorPicker.anchorEl}
      {collectionId}
      {scope}
      field={fieldKey}
      value={colorPicker.value}
      automaticSlot={automaticColorSlot(colorPicker.value)}
      onclose={() => (colorPicker = null)}
    />
  {/if}
</div>

<style>
  .psp {
    position: fixed;
    z-index: var(--z-overlay, 40);
    width: 280px;
    background: var(--color-surface, #161617);
    border: 1px solid var(--color-border, #27272a);
    border-radius: var(--radius-md, 6px);
    box-shadow: var(--shadow-popover, 0 8px 24px rgba(0, 0, 0, 0.45));
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .mono {
    font-family: var(--font-mono, 'JetBrains Mono'), monospace;
  }

  .psp-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--color-text, #e4e4e7);
    margin: 0;
    display: flex;
    align-items: baseline;
    gap: 6px;
  }

  .psp-scope {
    font-size: 10px;
    font-weight: 400;
    color: var(--color-text-faint, #52525b);
  }

  .psp-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .psp-label {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-text-dim, #71717a);
  }

  .psp-input {
    background: transparent;
    border: 1px solid var(--color-border, #27272a);
    border-radius: 4px;
    color: var(--color-text, #e4e4e7);
    font-size: 12px;
    padding: 4px 8px;
    outline: none;
    transition: border-color 150ms ease;
  }
  .psp-input:focus {
    border-color: var(--color-primary, #00e5ff);
  }

  .psp-check {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--color-text, #e4e4e7);
    cursor: pointer;
  }
  .psp-check input {
    accent-color: var(--color-primary, #00e5ff);
  }

  .psp-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
  }

  .psp-chip {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 2px 8px;
    border-radius: 9999px;
    border: 1px solid var(--color-primary-glow, rgba(0, 229, 255, 0.25));
    color: var(--color-primary, #00e5ff);
    font-size: 10px;
    font-family: var(--font-mono, 'JetBrains Mono'), monospace;
  }

  .psp-chip-remove {
    background: none;
    border: none;
    color: var(--color-primary, #00e5ff);
    cursor: pointer;
    padding: 0;
    font-size: 12px;
    line-height: 1;
    opacity: 0.5;
    transition: opacity 150ms ease;
  }
  .psp-chip-remove:hover {
    opacity: 1;
  }

  .psp-chip-input {
    background: transparent;
    border: none;
    color: var(--color-text, #e4e4e7);
    font-size: 10px;
    font-family: var(--font-mono, 'JetBrains Mono'), monospace;
    padding: 2px 4px;
    width: 56px;
    outline: none;
  }

  .psp-color-list {
    display: flex;
    flex-direction: column;
    gap: 3px;
    max-height: 132px;
    overflow-y: auto;
    padding: 2px 1px;
    scrollbar-width: thin;
  }

  .psp-color-row {
    display: flex;
    align-items: center;
    gap: 7px;
    min-width: 0;
    min-height: 24px;
  }

  .psp-color-button {
    width: 18px;
    height: 18px;
    flex: none;
    padding: 0;
    border: 2px solid var(--color-surface, #161617);
    border-radius: 9999px;
    background: var(--swatch);
    box-shadow: 0 0 0 1px color-mix(in srgb, var(--swatch) 70%, var(--color-border));
    cursor: pointer;
    transition:
      transform 150ms ease,
      box-shadow 150ms ease;
  }

  .psp-color-button:hover,
  .psp-color-button:focus-visible {
    transform: scale(1.12);
    box-shadow:
      0 0 0 2px var(--color-primary),
      0 0 0 3px var(--color-surface);
    outline: none;
  }

  .psp-color-value {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 1px 7px;
    border: 1px solid color-mix(in srgb, var(--value-color) 42%, transparent);
    border-radius: 9999px;
    background: color-mix(in srgb, var(--value-color-base) 14%, transparent);
    color: var(--value-color);
    font-size: 10px;
    font-family: var(--font-mono, 'JetBrains Mono'), monospace;
  }

  .psp-hint {
    color: var(--color-text-faint, #52525b);
    font-size: 10px;
    line-height: 1.4;
  }

  .psp-error {
    font-size: 11px;
    color: var(--color-error, #ef4444);
    margin: 0;
  }

  .psp-actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
  }

  @media (prefers-reduced-motion: reduce) {
    .psp-input,
    .psp-chip-remove,
    .psp-color-button {
      transition: none;
    }
  }
</style>
