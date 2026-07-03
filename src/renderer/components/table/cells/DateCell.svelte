<script lang="ts">
  import DatePicker from '../../wysiwyg/DatePicker.svelte'
  import { valueToString } from '../../../stores/table.svelte'
  import { type CellProps, isEmptyValue } from './types'

  let { value, editing, oncommit, oncancel }: CellProps = $props()

  let cellEl: HTMLDivElement | null = $state(null)

  const raw = $derived(valueToString(value))
  /** The picker needs a YYYY-MM-DD seed; anything else starts at today. */
  const isoValue = $derived(/^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '')

  const display = $derived.by(() => {
    if (isoValue === '') return raw
    const d = new Date(isoValue + 'T00:00:00')
    if (isNaN(d.getTime())) return raw
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
  })
</script>

<div class="dc" bind:this={cellEl}>
  {#if isEmptyValue(value)}
    <span class="empty">—</span>
  {:else}
    <span class="material-symbols-outlined date-icon" aria-hidden="true">calendar_today</span>
    <span class="date-text" title={raw}>{display}</span>
  {/if}

  {#if editing && cellEl}
    <DatePicker
      value={isoValue}
      anchorEl={cellEl}
      onSelect={(date) => oncommit(date)}
      onClose={oncancel}
    />
  {/if}
</div>

<style>
  .dc {
    display: flex;
    align-items: center;
    gap: var(--space-1, 4px);
    width: 100%;
    height: 100%;
    min-width: 0;
  }

  .date-icon {
    font-size: 13px;
    color: var(--color-text-faint);
    flex-shrink: 0;
  }

  .date-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .empty {
    color: var(--color-text-faint);
  }
</style>
