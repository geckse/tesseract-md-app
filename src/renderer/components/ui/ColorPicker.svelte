<script lang="ts">
  import {
    PRESET_COLORS,
    isLuminanceAcceptable,
    adjustToMinLuminance,
  } from '../../lib/color-utils'

  interface ColorPickerProps {
    value: string | null
    defaultColor?: string
    onchange: (hex: string | null) => void
    showReset?: boolean
    showInheritedHint?: boolean
  }

  let {
    value,
    defaultColor = '#00E5FF',
    onchange,
    showReset = false,
    showInheritedHint = false,
  }: ColorPickerProps = $props()

  let open = $state(false)
  let hexInput = $state('')
  let pickerRef: HTMLDivElement | undefined = $state()

  let displayColor = $derived(value ?? defaultColor)
  let luminanceOk = $derived(isLuminanceAcceptable(displayColor))
  let isPreset = $derived(PRESET_COLORS.some((p) => p.hex.toLowerCase() === displayColor.toLowerCase()))

  function togglePicker() {
    open = !open
    if (open) {
      hexInput = displayColor
    }
  }

  function selectColor(hex: string) {
    onchange(hex)
    hexInput = hex
  }

  function handleHexInput(e: Event) {
    const val = (e.target as HTMLInputElement).value
    hexInput = val
    if (/^#[0-9a-fA-F]{6}$/.test(val)) {
      onchange(val)
    }
  }

  function handleNativePickerChange(e: Event) {
    const hex = (e.target as HTMLInputElement).value
    onchange(hex)
    hexInput = hex
  }

  function handleAutoAdjust() {
    const adjusted = adjustToMinLuminance(displayColor)
    onchange(adjusted)
    hexInput = adjusted
  }

  function handleReset() {
    onchange(null)
    hexInput = defaultColor
  }

  function handleClickOutside(e: MouseEvent) {
    if (pickerRef && !pickerRef.contains(e.target as Node)) {
      open = false
    }
  }

  $effect(() => {
    if (open) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  })
</script>

<div class="color-picker" bind:this={pickerRef}>
  <div class="picker-trigger">
    <button
      class="swatch-btn"
      style="background-color: {displayColor}"
      onclick={togglePicker}
      title="Choose accent color"
      aria-label="Choose accent color"
    ></button>
    <span class="swatch-label">{displayColor}</span>
    {#if showInheritedHint && value === null}
      <span class="inherited-hint">(inherited from global)</span>
    {/if}
  </div>

  {#if open}
    <div class="picker-popover" role="dialog" aria-label="Color picker">
      <div class="preset-grid">
        {#each PRESET_COLORS as preset}
          <button
            class="preset-swatch"
            class:active={displayColor.toLowerCase() === preset.hex.toLowerCase()}
            style="background-color: {preset.hex}"
            onclick={() => selectColor(preset.hex)}
            title={preset.name}
            aria-label={preset.name}
          ></button>
        {/each}
      </div>

      <div class="custom-section">
        <label class="custom-label">Custom</label>
        <div class="custom-row">
          <input
            type="color"
            class="native-picker"
            value={displayColor}
            oninput={handleNativePickerChange}
          />
          <input
            type="text"
            class="hex-input"
            value={hexInput}
            oninput={handleHexInput}
            placeholder="#000000"
            maxlength={7}
            spellcheck={false}
          />
        </div>
      </div>

      {#if !luminanceOk}
        <div class="luminance-warning">
          <span class="material-symbols-outlined warning-icon">warning</span>
          <span class="warning-text">This color may be hard to see</span>
          <button class="auto-adjust-btn" onclick={handleAutoAdjust}>
            Auto-adjust
          </button>
        </div>
      {/if}

      {#if showReset}
        <button class="reset-btn" onclick={handleReset}>
          <span class="material-symbols-outlined reset-icon">restart_alt</span>
          Reset to default
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .color-picker {
    position: relative;
  }

  .picker-trigger {
    display: flex;
    align-items: center;
    gap: var(--space-2, 8px);
  }

  .swatch-btn {
    width: 28px;
    height: 28px;
    border-radius: var(--radius-full, 9999px);
    border: 2px solid var(--color-border, #27272a);
    cursor: pointer;
    transition: border-color var(--transition-fast, 150ms ease);
    flex-shrink: 0;
  }

  .swatch-btn:hover {
    border-color: var(--color-border-hover, #3f3f46);
  }

  .swatch-label {
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: var(--text-xs, 10px);
    color: var(--color-text-dim, #71717a);
    text-transform: uppercase;
  }

  .inherited-hint {
    font-size: var(--text-xs, 10px);
    color: var(--color-text-dim, #71717a);
    font-style: italic;
  }

  .picker-popover {
    position: absolute;
    top: calc(100% + 8px);
    left: 0;
    z-index: var(--z-overlay, 40);
    background: var(--color-surface, #161617);
    border: 1px solid var(--color-border, #27272a);
    border-radius: var(--radius-lg, 8px);
    padding: var(--space-3, 12px);
    min-width: 240px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  }

  .preset-grid {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: var(--space-2, 8px);
    margin-bottom: var(--space-3, 12px);
  }

  .preset-swatch {
    width: 32px;
    height: 32px;
    border-radius: var(--radius-full, 9999px);
    border: 2px solid transparent;
    cursor: pointer;
    transition: all var(--transition-fast, 150ms ease);
    justify-self: center;
  }

  .preset-swatch:hover {
    transform: scale(1.15);
  }

  .preset-swatch.active {
    border-color: var(--color-text-white, #ffffff);
    box-shadow: 0 0 0 2px var(--color-surface, #161617), 0 0 0 4px var(--color-text-white, #ffffff);
  }

  .custom-section {
    border-top: 1px solid var(--color-border, #27272a);
    padding-top: var(--space-2, 8px);
    margin-bottom: var(--space-2, 8px);
  }

  .custom-label {
    font-size: var(--text-xs, 10px);
    color: var(--color-text-dim, #71717a);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    display: block;
    margin-bottom: var(--space-1, 4px);
  }

  .custom-row {
    display: flex;
    align-items: center;
    gap: var(--space-2, 8px);
  }

  .native-picker {
    width: 32px;
    height: 32px;
    border: none;
    border-radius: var(--radius-sm, 4px);
    cursor: pointer;
    background: none;
    padding: 0;
  }

  .native-picker::-webkit-color-swatch-wrapper {
    padding: 0;
  }

  .native-picker::-webkit-color-swatch {
    border: 2px solid var(--color-border, #27272a);
    border-radius: var(--radius-sm, 4px);
  }

  .hex-input {
    flex: 1;
    background: var(--color-surface-dark, #0a0a0a);
    border: 1px solid var(--color-border, #27272a);
    border-radius: var(--radius-sm, 4px);
    color: var(--color-text, #e4e4e7);
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: var(--text-sm, 12px);
    padding: 4px 8px;
    outline: none;
  }

  .hex-input:focus {
    border-color: var(--color-primary, #00E5FF);
  }

  .luminance-warning {
    display: flex;
    align-items: center;
    gap: var(--space-1, 4px);
    padding: var(--space-2, 8px);
    background: rgba(245, 158, 11, 0.1);
    border-radius: var(--radius-sm, 4px);
    margin-bottom: var(--space-2, 8px);
  }

  .warning-icon {
    font-size: 16px;
    color: var(--color-warning, #f59e0b);
  }

  .warning-text {
    font-size: var(--text-xs, 10px);
    color: var(--color-warning, #f59e0b);
    flex: 1;
  }

  .auto-adjust-btn {
    font-size: var(--text-xs, 10px);
    color: var(--color-text, #e4e4e7);
    background: var(--color-surface-dark, #0a0a0a);
    border: 1px solid var(--color-border, #27272a);
    border-radius: var(--radius-sm, 4px);
    padding: 2px 8px;
    cursor: pointer;
    white-space: nowrap;
  }

  .auto-adjust-btn:hover {
    border-color: var(--color-border-hover, #3f3f46);
  }

  .reset-btn {
    display: flex;
    align-items: center;
    gap: var(--space-1, 4px);
    font-size: var(--text-xs, 10px);
    color: var(--color-text-dim, #71717a);
    background: none;
    border: none;
    cursor: pointer;
    padding: var(--space-1, 4px) 0;
    width: 100%;
    border-top: 1px solid var(--color-border, #27272a);
    padding-top: var(--space-2, 8px);
  }

  .reset-btn:hover {
    color: var(--color-text, #e4e4e7);
  }

  .reset-icon {
    font-size: 14px;
  }

  @media (prefers-reduced-motion: reduce) {
    .preset-swatch:hover {
      transform: none;
    }
  }
</style>
