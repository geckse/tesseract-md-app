<script lang="ts">
  import { valueToString } from '../../../stores/table.svelte'
  import { type CellProps, isEmptyValue, autofocus } from './types'

  let { value, editing, oncommit, oncancel }: CellProps = $props()

  let draft = $state('')

  $effect(() => {
    if (editing) draft = valueToString(value)
  })

  function commitDraft(): void {
    const d = draft.trim()
    if (d === '') {
      oncommit(null)
      return
    }
    const n = Number(d)
    if (!Number.isFinite(n)) {
      oncancel() // reject non-numeric
      return
    }
    oncommit(n)
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

<div class="nc">
  {#if editing}
    <!-- text + inputmode keeps the draft a string so non-numeric input can be
         rejected on commit (a number input silently blanks invalid text) -->
    <input
      class="cell-input"
      type="text"
      inputmode="decimal"
      bind:value={draft}
      use:autofocus
      onkeydown={onKeydown}
      onblur={commitDraft}
    />
  {:else if isEmptyValue(value)}
    <span class="empty">—</span>
  {:else}
    <span class="num" title={valueToString(value)}>{valueToString(value)}</span>
  {/if}
</div>

<style>
  .nc {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    width: 100%;
    height: 100%;
    min-width: 0;
  }

  .num {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  .empty {
    color: var(--color-text-faint);
  }

  .cell-input {
    width: 100%;
    background: transparent;
    border: none;
    color: var(--color-text);
    font-size: var(--text-base, 0.875rem);
    padding: 0;
    text-align: right;
    font-variant-numeric: tabular-nums;
    box-sizing: border-box;
  }

  .cell-input:focus {
    outline: none;
  }
</style>
