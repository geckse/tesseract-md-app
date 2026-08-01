<script lang="ts">
  import { untrack } from 'svelte'
  import { stringifyExactJson } from '../../../../shared/exact-number'
  import type { JsonValue } from '../../../types/cli'
  import JsonSyntax from '../../ui/JsonSyntax.svelte'
  import { type CellProps, isEmptyValue, autofocus } from './types'

  let { column, value, editing, oncommit, oncancel }: CellProps = $props()

  function formatValue(): string {
    if (value === undefined) return ''
    return stringifyExactJson(value)
  }

  const text = $derived(formatValue())
  let draft = $state('')
  let invalid = $state(false)
  let wasEditing = false

  $effect(() => {
    const isEditing = editing
    if (isEditing && !wasEditing) {
      untrack(() => {
        draft = text
        invalid = false
      })
    }
    wasEditing = isEditing
  })

  function commitDraft(): void {
    const trimmed = draft.trim()
    if (trimmed === '') {
      invalid = false
      oncommit(null)
      return
    }
    try {
      oncommit(JSON.parse(trimmed) as JsonValue)
      invalid = false
    } catch {
      invalid = true
    }
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter') {
      event.preventDefault()
      commitDraft()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      invalid = false
      oncancel()
    }
  }
</script>

<div class="json-cell">
  {#if editing}
    <input
      class="cell-input"
      class:invalid
      bind:value={draft}
      aria-label="{column.name} JSON value"
      aria-invalid={invalid}
      spellcheck="false"
      use:autofocus
      onkeydown={onKeydown}
      onblur={commitDraft}
    />
  {:else if isEmptyValue(value)}
    <span class="empty">—</span>
  {:else}
    <span class="text" title={text}><JsonSyntax {text} /></span>
  {/if}
</div>

<style>
  .json-cell {
    display: flex;
    align-items: center;
    width: 100%;
    height: 100%;
    min-width: 0;
  }

  .text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono, 'JetBrains Mono', ui-monospace, monospace);
    font-size: var(--text-xs, 0.625rem);
  }

  .empty {
    color: var(--color-text-faint);
  }

  .cell-input {
    box-sizing: border-box;
    width: 100%;
    padding: 0;
    border: none;
    background: transparent;
    color: var(--color-text);
    font-family: var(--font-mono, 'JetBrains Mono', ui-monospace, monospace);
    font-size: var(--text-xs, 0.625rem);
  }

  .cell-input.invalid {
    text-decoration: wavy underline;
    text-decoration-color: var(--color-error, #ef4444);
  }

  .cell-input:focus {
    outline: none;
  }
</style>
