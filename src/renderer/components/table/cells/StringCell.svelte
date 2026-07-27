<script lang="ts">
  import { untrack } from 'svelte'
  import type { PropertyValueColorSelection } from '../../../../shared/value-colors'
  import {
    automaticValueColorSlot,
    valueColorSelectionColor,
    valueColorSelectionStyle
  } from '../../../lib/value-colors'
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
  import PopoverMenu, { type PopoverMenuItem } from '../../ui/PopoverMenu.svelte'
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

  const selectMode = $derived((column.allowed_values?.length ?? 0) > 0)
  const text = $derived(valueToString(value))

  let draft = $state('')
  let cellEl: HTMLDivElement | null = $state(null)
  let colorPicker: { anchorEl: HTMLElement; value: string } | null = $state(null)

  $effect(() => {
    void loadPropertyValueColors(collectionId, scope)
  })

  function automaticSlot(option: string): number {
    return automaticValueColorSlot(column.name, option, column.allowed_values)
  }

  function effectiveSelection(option: string): PropertyValueColorSelection {
    return (
      valueColorOverride(
        $propertyValueColorOverrides,
        collectionId,
        scope,
        column.name,
        option
      ) ?? { palette: 'accent', slot: automaticSlot(option) }
    )
  }

  function chipStyle(option: string): string {
    return valueColorSelectionStyle(
      $valueColorPalette,
      $neutralValueColorPalette,
      effectiveSelection(option),
      $resolvedTheme
    )
  }

  function optionColor(option: string): string {
    return valueColorSelectionColor(
      $valueColorPalette,
      $neutralValueColorPalette,
      effectiveSelection(option)
    )
  }

  function openColorPicker(event: MouseEvent | KeyboardEvent, option: string): void {
    if (!collectionId || !option) return
    event.preventDefault()
    event.stopPropagation()
    colorPicker = { anchorEl: event.currentTarget as HTMLElement, value: option }
  }

  // Seed the draft only when edit mode OPENS (false → true, `value` untracked)
  // so a background refetch can't clobber in-progress typing.
  let wasEditing = false
  $effect(() => {
    const isEditing = editing
    if (isEditing && !wasEditing) untrack(() => (draft = valueToString(value)))
    wasEditing = isEditing
  })

  const CLEAR_ID = '__clear__'

  const selectItems = $derived.by<PopoverMenuItem[]>(() => {
    const allowed = column.allowed_values ?? []
    const items: PopoverMenuItem[] = allowed.map((v) => ({
      id: v,
      label: v,
      color: optionColor(v),
      checked: v === text && !isEmptyValue(value)
    }))
    // Keep an off-list current value selectable so re-picking it is a no-op, not a loss.
    if (!isEmptyValue(value) && !allowed.includes(text)) {
      items.unshift({
        id: text,
        label: text,
        color: optionColor(text),
        checked: true
      })
    }
    items.push({ id: CLEAR_ID, label: 'Clear', icon: 'backspace', separatorBefore: true })
    return items
  })

  function commitDraft(): void {
    const d = draft.trim()
    oncommit(d === '' ? null : d)
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault()
      commitDraft()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      oncancel()
    }
  }
</script>

<div class="sc" bind:this={cellEl}>
  {#if editing && selectMode}
    <!-- Display stays visible under the popover while picking -->
    {#if isEmptyValue(value)}
      <span class="empty">—</span>
    {:else}
      <span class="select-chip" style={chipStyle(text)}>{text}</span>
    {/if}
    {#if cellEl}
      <PopoverMenu
        anchorEl={cellEl}
        items={selectItems}
        ariaLabel="Select {column.name}"
        onselect={(id) => oncommit(id === CLEAR_ID ? null : id)}
        ondismiss={oncancel}
      />
    {/if}
  {:else if editing}
    <input
      class="cell-input"
      type="text"
      bind:value={draft}
      use:autofocus
      onkeydown={onKeydown}
      onblur={commitDraft}
    />
  {:else if isEmptyValue(value)}
    <span class="empty">—</span>
  {:else if selectMode}
    <span
      class="select-chip"
      style={chipStyle(text)}
      title="{text} · Right-click to choose color"
      role="button"
      tabindex="-1"
      oncontextmenu={(event) => openColorPicker(event, text)}
      onkeydown={(event) => {
        if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
          openColorPicker(event, text)
        }
      }}
    >
      {text}
    </span>
  {:else}
    <span class="text" title={text}>{text}</span>
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
  .sc {
    display: flex;
    align-items: center;
    width: 100%;
    height: 100%;
    min-width: 0;
  }

  .text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .empty {
    color: var(--color-text-faint);
  }

  .select-chip {
    display: inline-block;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    background: color-mix(in srgb, var(--value-color-base) 14%, transparent);
    border: 1px solid color-mix(in srgb, var(--value-color) 42%, transparent);
    border-radius: var(--radius-full, 9999px);
    color: var(--value-color);
    padding: 1px 8px;
    font-size: var(--text-xs, 0.625rem);
    line-height: 1.6;
    cursor: context-menu;
    transition:
      background var(--transition-fast, 150ms ease),
      border-color var(--transition-fast, 150ms ease);
  }

  .select-chip:hover {
    background: color-mix(in srgb, var(--value-color-base) 20%, transparent);
    border-color: color-mix(in srgb, var(--value-color) 68%, transparent);
  }

  .cell-input {
    width: 100%;
    background: transparent;
    border: none;
    color: var(--color-text);
    font-size: var(--text-base, 0.875rem);
    padding: 0;
    box-sizing: border-box;
  }

  .cell-input:focus {
    outline: none;
  }

  @media (prefers-reduced-motion: reduce) {
    .select-chip {
      transition: none;
    }
  }
</style>
