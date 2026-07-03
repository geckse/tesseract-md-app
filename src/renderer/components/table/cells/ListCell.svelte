<script lang="ts">
  import { valueToString } from '../../../stores/table.svelte'
  import { type CellProps, isEmptyValue, autofocus } from './types'

  let { value, editing, oncommit, oncancel }: CellProps = $props()

  const items = $derived(Array.isArray(value) ? value.map((x) => valueToString(x)) : [])

  let tags = $state<string[]>([])
  let pending = $state('')

  $effect(() => {
    if (editing) {
      tags = Array.isArray(value) ? value.map((x) => valueToString(x)) : []
      pending = ''
    }
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
        <span class="chip">
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
        <span class="chip">{item}</span>
      {/each}
    </div>
  {/if}
</div>

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

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 1px 8px;
    border-radius: var(--radius-full, 9999px);
    border: 1px solid var(--color-primary-glow);
    background: transparent;
    color: var(--color-primary);
    font-size: var(--text-xs, 0.625rem);
    font-family: var(--font-mono, 'JetBrains Mono', ui-monospace, monospace);
    white-space: nowrap;
    transition: border-color var(--transition-fast, 150ms ease);
  }

  .chip:hover {
    border-color: var(--color-primary);
  }

  .chip-remove {
    background: none;
    border: none;
    color: var(--color-primary);
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
