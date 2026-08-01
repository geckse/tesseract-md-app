<script lang="ts">
  import { valueToString } from '../../../stores/table.svelte'
  import type { JsonValue } from '../../../types/cli'
  import { stringifyExactJson } from '../../../../shared/exact-number'
  import JsonSyntax from '../../ui/JsonSyntax.svelte'
  import { type CellProps, isEmptyValue } from './types'

  let { column, value, computedError }: CellProps = $props()

  const resultType = $derived(column.result_type ?? 'Json')
  const raw = $derived(valueToString(value))

  function formatDate(source: string, withTime: boolean): string {
    const parsed = new Date(withTime ? source : `${source}T00:00:00`)
    if (Number.isNaN(parsed.getTime())) return source
    return withTime
      ? parsed.toLocaleString()
      : parsed.toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric'
        })
  }

  function jsonText(source: JsonValue | undefined): string {
    if (source === undefined) return ''
    return typeof source === 'string' ? source : stringifyExactJson(source)
  }
</script>

<div
  class="formula-cell"
  class:numeric={resultType === 'Number'}
  class:failed={!!computedError}
  title={computedError?.message ?? raw}
>
  <span class="fx" aria-hidden="true">ƒx</span>

  {#if computedError}
    <span class="material-symbols-outlined error-icon" aria-hidden="true">error</span>
    <span class="error-text" aria-label={`Formula error: ${computedError.message}`}>
      {computedError.code}
    </span>
  {:else if isEmptyValue(value)}
    <span class="empty">—</span>
  {:else if resultType === 'Boolean'}
    <span
      class="material-symbols-outlined bool"
      class:true={value === true}
      aria-label={value === true ? 'True' : 'False'}
    >
      {value === true ? 'check_box' : 'check_box_outline_blank'}
    </span>
  {:else if resultType === 'Date'}
    <span class="material-symbols-outlined value-icon" aria-hidden="true">calendar_today</span>
    <span class="text">{formatDate(raw, false)}</span>
  {:else if resultType === 'DateTime'}
    <span class="material-symbols-outlined value-icon" aria-hidden="true">schedule</span>
    <span class="text">{formatDate(raw, true)}</span>
  {:else if resultType === 'List' && Array.isArray(value)}
    <span class="list" aria-label={value.map((item) => valueToString(item)).join(', ')}>
      {#each value as item, index (`${index}:${valueToString(item)}`)}
        <span class="chip">{valueToString(item)}</span>
      {/each}
    </span>
  {:else}
    <span class:mono={resultType === 'Number' || resultType === 'Json'} class="text">
      {#if resultType === 'Json'}
        <JsonSyntax text={jsonText(value)} />
      {:else}
        {raw}
      {/if}
    </span>
  {/if}
</div>

<style>
  .formula-cell {
    display: flex;
    align-items: center;
    gap: var(--space-1, 4px);
    width: 100%;
    min-width: 0;
    color: var(--color-text);
  }

  .fx {
    flex-shrink: 0;
    color: var(--color-primary);
    font-family: var(--font-mono, 'JetBrains Mono', ui-monospace, monospace);
    font-size: 9px;
    opacity: 0.65;
  }

  .text,
  .error-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .mono,
  .numeric {
    font-family: var(--font-mono, 'JetBrains Mono', ui-monospace, monospace);
  }

  .empty {
    color: var(--color-text-faint);
  }

  .bool {
    font-size: 16px;
    color: var(--color-text-faint);
  }

  .bool.true {
    color: var(--color-primary);
  }

  .value-icon,
  .error-icon {
    flex-shrink: 0;
    font-size: 13px;
    color: var(--color-text-faint);
  }

  .failed,
  .error-icon,
  .error-text {
    color: var(--color-error);
  }

  .error-text {
    font-family: var(--font-mono, 'JetBrains Mono', ui-monospace, monospace);
    font-size: var(--text-xs, 0.625rem);
  }

  .list {
    display: flex;
    gap: 3px;
    min-width: 0;
    overflow: hidden;
  }

  .chip {
    flex-shrink: 0;
    max-width: 110px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 1px 5px;
    border-radius: 999px;
    background: var(--color-primary-dim);
    color: var(--color-text);
    font-size: var(--text-xs, 0.625rem);
  }
</style>
