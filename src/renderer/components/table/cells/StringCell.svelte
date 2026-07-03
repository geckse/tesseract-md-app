<script lang="ts">
  import { valueToString } from '../../../stores/table.svelte'
  import PopoverMenu, { type PopoverMenuItem } from '../../ui/PopoverMenu.svelte'
  import { type CellProps, isEmptyValue, autofocus } from './types'

  let { column, value, editing, oncommit, oncancel }: CellProps = $props()

  const selectMode = $derived((column.allowed_values?.length ?? 0) > 0)
  const text = $derived(valueToString(value))

  let draft = $state('')
  let cellEl: HTMLDivElement | null = $state(null)

  $effect(() => {
    if (editing) draft = valueToString(value)
  })

  const CLEAR_ID = '__clear__'

  const selectItems = $derived.by<PopoverMenuItem[]>(() => {
    const allowed = column.allowed_values ?? []
    const items: PopoverMenuItem[] = allowed.map((v) => ({
      id: v,
      label: v,
      checked: v === text && !isEmptyValue(value)
    }))
    // Keep an off-list current value selectable so re-picking it is a no-op, not a loss.
    if (!isEmptyValue(value) && !allowed.includes(text)) {
      items.unshift({ id: text, label: text, checked: true })
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
      <span class="select-chip">{text}</span>
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
    <span class="select-chip" title={text}>{text}</span>
  {:else}
    <span class="text" title={text}>{text}</span>
  {/if}
</div>

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
    background: var(--color-surface-elevated);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-full, 9999px);
    padding: 1px 8px;
    font-size: var(--text-xs, 0.625rem);
    line-height: 1.6;
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
</style>
