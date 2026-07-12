<script lang="ts">
  import type { RelationValue } from '../../../types/cli'
  import { workspace } from '../../../stores/workspace.svelte'
  import { formatRelationValue } from '../../../lib/relation-format'
  import RelationChip from '../../RelationChip.svelte'
  import RelationPicker from '../../RelationPicker.svelte'
  import { type CellProps, isEmptyValue } from './types'

  let {
    column,
    value,
    editing,
    readOnly,
    oncommit,
    oncancel,
    relations,
    root,
    collectionId
  }: CellProps = $props()

  let cellEl: HTMLDivElement | null = $state(null)

  const isArray = $derived(Array.isArray(value))
  /** The raw string values this cell displays (arrays keep source order + duplicates). */
  const rawValues = $derived.by<string[]>(() => {
    if (isEmptyValue(value)) return []
    if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string')
    return typeof value === 'string' ? [String(value)] : []
  })

  /**
   * Optimistic reconciliation (phase 42 §6.4): a chip renders from the
   * RelationValue whose `raw` equals the current frontmatter value; on
   * mismatch (fresh optimistic edit) the chip falls back to a NEUTRAL
   * client parse until the server confirms. Duplicates consume matching
   * RelationValues in order so `[a, a]` maps 1:1.
   */
  const chips = $derived.by<{ raw: string; relation: RelationValue | null }[]>(() => {
    const pool = [...(relations ?? [])]
    return rawValues.map((raw) => {
      const idx = pool.findIndex((r) => r.raw === raw)
      const relation = idx >= 0 ? pool.splice(idx, 1)[0] : null
      return { raw, relation }
    })
  })

  function navigate(path: string): void {
    workspace.openFile(path)
  }

  /** Paths already linked (excluded from the picker in multi-value add mode). */
  const linkedPaths = $derived(
    (relations ?? []).map((r) => r.path).filter((p): p is string => p !== null)
  )

  function commitSingle(path: string): void {
    oncommit(formatRelationValue(path))
  }

  function addToArray(path: string): void {
    const next = [...rawValues, formatRelationValue(path)]
    oncommit(next)
  }

  function removeAt(index: number): void {
    const next = rawValues.filter((_, i) => i !== index)
    oncommit(next.length === 0 ? null : next)
  }

  function clear(): void {
    oncommit(null)
  }
</script>

<div class="rc" bind:this={cellEl}>
  {#if rawValues.length === 0}
    <span class="empty">—</span>
  {:else}
    <div class="rc-chips" class:multi={isArray}>
      {#each chips as chip, i (i)}
        <RelationChip
          relation={chip.relation}
          raw={chip.raw}
          onnavigate={navigate}
          onremove={editing && isArray && !readOnly ? () => removeAt(i) : undefined}
        />
      {/each}
    </div>
  {/if}

  {#if editing && !readOnly && cellEl && root}
    <div class="rc-edit-actions">
      {#if rawValues.length > 0 && !isArray}
        <button class="rc-action" onclick={clear} tabindex="-1">Clear</button>
      {/if}
    </div>
    <RelationPicker
      anchorEl={cellEl}
      {root}
      {collectionId}
      targetFolder={column.relation_target}
      excludePaths={isArray ? linkedPaths : []}
      onpick={(path) => {
        if (isArray) addToArray(path)
        else commitSingle(path)
      }}
      ondismiss={oncancel}
    />
  {/if}
</div>

<style>
  .rc {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    height: 100%;
    min-width: 0;
  }

  .rc-chips {
    display: flex;
    align-items: center;
    gap: 4px;
    overflow: hidden;
  }

  .empty {
    color: var(--color-text-faint);
  }

  .rc-edit-actions {
    margin-left: auto;
    display: flex;
    gap: 4px;
  }

  .rc-action {
    background: none;
    border: none;
    color: var(--color-text-dim, #71717a);
    font-size: var(--text-xs, 0.625rem);
    cursor: pointer;
    padding: 0 2px;
  }

  .rc-action:hover {
    color: var(--color-text, #e4e4e7);
  }
</style>
