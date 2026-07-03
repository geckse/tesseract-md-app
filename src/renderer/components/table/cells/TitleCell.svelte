<script lang="ts">
  import type { CollectionRow } from '../../../types/cli'

  interface Props {
    row: CollectionRow
    onopen: () => void
    ondelete: () => void
  }
  let { row, onopen, ondelete }: Props = $props()

  const deleted = $derived(row.state === 'deleted')

  function openDoc(e: MouseEvent): void {
    e.stopPropagation()
    onopen()
  }

  function del(e: MouseEvent): void {
    e.stopPropagation()
    ondelete()
  }
</script>

<div class="tc">
  {#if row.state === 'new'}
    <span class="state-badge state-new" title="On disk, not yet indexed">new</span>
  {:else if row.state === 'modified'}
    <span class="state-badge state-modified" title="Modified since last index">●</span>
  {:else if row.state === 'deleted'}
    <span class="state-badge state-deleted" title="File no longer on disk">gone</span>
  {/if}
  <span
    class="title-text"
    class:dim={row.title_source === 'filename'}
    class:deleted
    title={row.title}
  >
    {row.title}
  </span>
  <span class="tc-actions">
    <button class="tc-action" title="Open document" onclick={openDoc} aria-label="Open document">
      <span class="material-symbols-outlined">open_in_new</span>
    </button>
    {#if !deleted}
      <button
        class="tc-action tc-delete"
        title="Delete file"
        onclick={del}
        aria-label="Delete file"
      >
        <span class="material-symbols-outlined">delete</span>
      </button>
    {/if}
  </span>
</div>

<style>
  .tc {
    display: flex;
    align-items: center;
    gap: var(--space-1, 4px);
    width: 100%;
    height: 100%;
    min-width: 0;
  }

  .title-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    font-weight: var(--weight-medium, 500);
  }

  .title-text.dim {
    color: var(--color-text-dim);
    font-style: italic;
    font-weight: var(--weight-regular, 400);
  }

  .title-text.deleted {
    text-decoration: line-through;
    color: var(--color-text-faint);
  }

  .tc-actions {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    opacity: 0;
    transition: opacity var(--transition-fast, 150ms ease);
  }

  .tc:hover .tc-actions,
  .tc-actions:focus-within {
    opacity: 1;
  }

  .tc-action {
    display: inline-flex;
    align-items: center;
    background: transparent;
    border: none;
    border-radius: var(--radius-sm, 4px);
    color: var(--color-text-dim);
    cursor: pointer;
    padding: 2px;
    transition:
      color var(--transition-fast, 150ms ease),
      background var(--transition-fast, 150ms ease);
  }

  .tc-action:hover {
    color: var(--color-primary);
    background: var(--overlay-hover);
  }

  .tc-action:focus-visible {
    outline: 1px solid var(--color-primary);
    outline-offset: 1px;
  }

  .tc-delete:hover {
    color: var(--color-error);
  }

  .tc-action .material-symbols-outlined {
    font-size: 15px;
  }

  .state-badge {
    font-size: var(--text-xs, 0.625rem);
    font-weight: var(--weight-semibold, 600);
    border-radius: var(--radius-full, 9999px);
    padding: 0 6px;
    flex-shrink: 0;
    line-height: 1.6;
  }

  .state-new {
    color: var(--color-info);
    background: color-mix(in srgb, var(--color-info) 12%, transparent);
  }

  .state-modified {
    color: var(--color-warning);
  }

  .state-deleted {
    color: var(--color-error);
    background: color-mix(in srgb, var(--color-error) 12%, transparent);
  }

  @media (prefers-reduced-motion: reduce) {
    .tc-actions,
    .tc-action {
      transition: none;
    }
  }
</style>
