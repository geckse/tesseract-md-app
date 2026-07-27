<script lang="ts">
  import { untrack } from 'svelte'
  import type { PropertyValueColorSelection } from '../../../../shared/value-colors'
  import { automaticValueColorSlot, valueColorSelectionStyle } from '../../../lib/value-colors'
  import { resolvedTheme } from '../../../stores/theme'
  import { valueToString } from '../../../stores/table.svelte'
  import {
    loadPropertyValueColors,
    neutralValueColorPalette,
    propertyValueColorOverrides,
    valueColorOverride,
    valueColorPalette
  } from '../../../stores/value-colors'
  import ValueColorPicker from '../ValueColorPicker.svelte'
  import { type CellProps, isEmptyValue, autofocus } from './types'

  let {
    column,
    value,
    editing,
    oncommit,
    oncancel,
    collectionId,
    scope = null
  }: CellProps = $props()

  const items = $derived(Array.isArray(value) ? value.map((x) => valueToString(x)) : [])

  let tags = $state<string[]>([])
  let pending = $state('')
  let colorPicker: { anchorEl: HTMLElement; value: string } | null = $state(null)

  $effect(() => {
    void loadPropertyValueColors(collectionId, scope)
  })

  function automaticSlot(tag: string): number {
    return automaticValueColorSlot(column.name, tag, column.allowed_values)
  }

  function chipStyle(tag: string): string {
    const selection: PropertyValueColorSelection = valueColorOverride(
      $propertyValueColorOverrides,
      collectionId,
      scope,
      column.name,
      tag
    ) ?? { palette: 'accent', slot: automaticSlot(tag) }
    return valueColorSelectionStyle(
      $valueColorPalette,
      $neutralValueColorPalette,
      selection,
      $resolvedTheme
    )
  }

  function openColorPicker(event: MouseEvent | KeyboardEvent, tag: string): void {
    if (!collectionId || !tag) return
    event.preventDefault()
    event.stopPropagation()
    colorPicker = { anchorEl: event.currentTarget as HTMLElement, value: tag }
  }

  // Seed edit state only when edit mode OPENS (false → true). `value` is read
  // untracked and re-runs without a real transition are ignored: a background
  // refetch delivers a new array identity for the same tags, and reseeding then
  // would wipe staged chips + in-progress typing mid-edit.
  let wasEditing = false
  $effect(() => {
    const isEditing = editing
    if (isEditing && !wasEditing) {
      untrack(() => {
        tags = Array.isArray(value) ? value.map((x) => valueToString(x)) : []
        pending = ''
      })
    }
    wasEditing = isEditing
  })

  function addPending(): boolean {
    const t = pending.trim()
    if (t === '') return false
    if (!tags.includes(t)) tags = [...tags, t]
    pending = ''
    return true
  }

  function removeTag(index: number): void {
    tags = tags.filter((_, i) => i !== index)
  }

  function commitTags(): void {
    addPending()
    // Snapshot: `tags` is a $state proxy, which Electron IPC cannot structured-clone.
    oncommit(tags.length === 0 ? null : $state.snapshot(tags))
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault()
      // Enter adds the typed tag; Enter on an empty input commits.
      if (!addPending()) commitTags()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      oncancel()
    } else if (e.key === 'Backspace' && pending === '' && tags.length > 0) {
      e.preventDefault()
      removeTag(tags.length - 1)
    }
  }
</script>

<div class="lc">
  {#if editing}
    <div class="chips editing">
      {#each tags as tag, i (tag)}
        <span class="chip" style={chipStyle(tag)}>
          {tag}
          <button
            class="chip-remove"
            aria-label="Remove {tag}"
            tabindex="-1"
            onmousedown={(e) => {
              // keep focus in the input so blur doesn't commit mid-edit
              e.preventDefault()
              removeTag(i)
            }}
          >
            ×
          </button>
        </span>
      {/each}
      <input
        class="chip-input"
        type="text"
        placeholder="Add…"
        bind:value={pending}
        use:autofocus
        onkeydown={onKeydown}
        onblur={commitTags}
      />
    </div>
  {:else if isEmptyValue(value) || items.length === 0}
    <span class="empty">—</span>
  {:else}
    <div class="chips" title={items.join(', ')}>
      {#each items as item}
        <span
          class="chip"
          style={chipStyle(item)}
          title="{item} · Right-click to choose color"
          role="button"
          tabindex="-1"
          oncontextmenu={(event) => openColorPicker(event, item)}
          onkeydown={(event) => {
            if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
              openColorPicker(event, item)
            }
          }}
        >
          {item}
        </span>
      {/each}
    </div>
  {/if}
</div>

{#if colorPicker && collectionId}
  <ValueColorPicker
    anchorEl={colorPicker.anchorEl}
    {collectionId}
    {scope}
    field={column.name}
    value={colorPicker.value}
    automaticSlot={automaticSlot(colorPicker.value)}
    onclose={() => (colorPicker = null)}
  />
{/if}

<style>
  .lc {
    display: flex;
    align-items: center;
    width: 100%;
    height: 100%;
    min-width: 0;
  }

  .chips {
    display: flex;
    align-items: center;
    gap: 4px;
    overflow: hidden;
  }

  .chips.editing {
    flex-wrap: nowrap;
    width: 100%;
  }

  .chips.editing .chip {
    cursor: default;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 1px 8px;
    border-radius: var(--radius-full, 9999px);
    border: 1px solid color-mix(in srgb, var(--value-color) 42%, transparent);
    background: color-mix(in srgb, var(--value-color-base) 14%, transparent);
    color: var(--value-color);
    font-size: var(--text-xs, 0.625rem);
    font-family: var(--font-mono, 'JetBrains Mono', ui-monospace, monospace);
    white-space: nowrap;
    cursor: context-menu;
    transition:
      background var(--transition-fast, 150ms ease),
      border-color var(--transition-fast, 150ms ease);
  }

  .chip:hover {
    background: color-mix(in srgb, var(--value-color-base) 20%, transparent);
    border-color: color-mix(in srgb, var(--value-color) 68%, transparent);
  }

  .chip-remove {
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
    padding: 0;
    font-size: 12px;
    line-height: 1;
    opacity: 0.5;
    transition: opacity var(--transition-fast, 150ms ease);
  }

  .chip-remove:hover {
    opacity: 1;
  }

  .chip-input {
    flex: 1;
    min-width: 48px;
    background: transparent;
    border: none;
    color: var(--color-text);
    font-size: var(--text-xs, 0.625rem);
    font-family: var(--font-mono, 'JetBrains Mono', ui-monospace, monospace);
    padding: 2px 0;
  }

  .chip-input::placeholder {
    color: var(--color-text-faint);
  }

  .chip-input:focus {
    outline: none;
  }

  .empty {
    color: var(--color-text-faint);
  }

  @media (prefers-reduced-motion: reduce) {
    .chip,
    .chip-remove {
      transition: none;
    }
  }
</style>
