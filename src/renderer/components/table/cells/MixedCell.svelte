<script lang="ts">
  import { valueToString } from '../../../stores/table.svelte'
  import { type CellProps, isEmptyValue, autofocus } from './types'

  let { value, editing, oncommit, oncancel }: CellProps = $props()

  const text = $derived(valueToString(value))

  let draft = $state('')

  $effect(() => {
    if (editing) draft = valueToString(value)
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

<div class="mc">
  {#if editing}
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
  {:else}
    <span class="text" title={text}>{text}</span>
  {/if}
</div>

<style>
  .mc {
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
    font-family: var(--font-mono, 'JetBrains Mono', ui-monospace, monospace);
    font-size: var(--text-xs, 0.625rem);
    color: var(--color-text-muted);
  }

  .empty {
    color: var(--color-text-faint);
  }

  .cell-input {
    width: 100%;
    background: transparent;
    border: none;
    color: var(--color-text);
    font-family: var(--font-mono, 'JetBrains Mono', ui-monospace, monospace);
    font-size: var(--text-xs, 0.625rem);
    padding: 0;
    box-sizing: border-box;
  }

  .cell-input:focus {
    outline: none;
  }
</style>
