<script lang="ts">
  import { tableStore } from '../../stores/table.svelte'
  import { autofocus } from './cells/types'

  interface Props {
    tabId: string
    /** 'row' = full-width row after the last table row; 'empty' = centered empty-state CTA. */
    variant?: 'row' | 'empty'
  }
  let { tabId, variant = 'row' }: Props = $props()

  let adding = $state(false)
  let name = $state('')
  let error = $state<string | null>(null)
  let submitting = $state(false)

  async function commit(): Promise<void> {
    // Guard re-entry: a second Enter mid-flight would race the exclusive
    // create into a confusing "file exists" error.
    if (submitting) return
    submitting = true
    try {
      const result = await tableStore.addRow(tabId, name)
      if (result.ok) {
        adding = false
        name = ''
        error = null
      } else {
        error = result.error ?? 'Could not create file'
      }
    } finally {
      submitting = false
    }
  }

  function onInputKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault()
      void commit()
    } else if (e.key === 'Escape') {
      adding = false
      name = ''
      error = null
    }
  }

  function onInputBlur(): void {
    if (!name.trim() && !submitting) {
      adding = false
      error = null
    }
  }

  // The grid-level keydown in TableView treats Enter as "open the selected
  // row's document" and only ignores keys from form fields — stop it here so
  // keyboard-activating this button doesn't also open a row.
  function onButtonKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter') e.stopPropagation()
  }
</script>

{#if adding}
  <div class="add-row {variant}" class:busy={submitting}>
    <span class="inner">
      <input
        class="add-input"
        class:has-error={!!error}
        type="text"
        placeholder="new-file.md"
        bind:value={name}
        use:autofocus
        aria-label="New file name"
        onkeydown={onInputKeydown}
        onblur={onInputBlur}
      />
      {#if error}<span class="add-error" role="alert" title={error}>{error}</span>{/if}
    </span>
  </div>
{:else}
  <button class="add-row {variant}" onclick={() => (adding = true)} onkeydown={onButtonKeydown}>
    <span class="inner">
      <span class="material-symbols-outlined" aria-hidden="true">add</span>
      Add row
    </span>
  </button>
{/if}

<style>
  .add-row {
    color: var(--color-text-dim);
    font-size: var(--text-sm, 0.75rem);
  }

  .add-row .material-symbols-outlined {
    font-size: 16px;
  }

  .add-row.busy {
    opacity: 0.6;
  }

  /* ── End-of-table row variant ───────────────────────────────── */
  .add-row.row {
    display: flex;
    align-items: center;
    width: 100%;
    height: 36px;
    padding: 0;
    border: none;
    border-bottom: 1px solid var(--color-border);
    background: var(--color-bg);
    text-align: left;
  }

  button.add-row.row {
    cursor: pointer;
    transition:
      background var(--transition-fast, 150ms ease),
      color var(--transition-fast, 150ms ease);
  }

  button.add-row.row:hover {
    background: color-mix(in srgb, #ffffff 4%, var(--color-bg));
    color: var(--color-primary);
  }

  button.add-row.row:focus-visible {
    outline: 1px solid var(--color-primary);
    outline-offset: -1px;
    box-shadow: none;
  }

  /* Pinned-left like the Title column so the label/input stay visible when
     the table is scrolled horizontally. */
  .add-row.row .inner {
    position: sticky;
    left: 0;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 0 var(--space-2, 8px);
  }

  /* ── Empty-state CTA variant ────────────────────────────────── */
  .add-row.empty {
    display: inline-flex;
    align-items: center;
    margin-top: var(--space-2, 8px);
  }

  button.add-row.empty {
    gap: 4px;
    padding: 4px 12px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm, 4px);
    background: var(--color-surface);
    color: var(--color-primary);
    cursor: pointer;
    transition:
      background var(--transition-fast, 150ms ease),
      border-color var(--transition-fast, 150ms ease);
  }

  button.add-row.empty:hover {
    background: var(--color-primary-dim);
    border-color: var(--color-border-hover);
  }

  .add-row.empty .inner {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  /* ── Inline filename input (mirrors the toolbar's) ──────────── */
  .add-input {
    background: var(--color-surface-elevated);
    border: 1px solid var(--color-primary);
    border-radius: var(--radius-sm, 4px);
    padding: 3px 8px;
    font-size: var(--text-sm, 0.75rem);
    color: var(--color-text);
    width: 200px;
  }

  .add-input:focus {
    outline: none;
    box-shadow: 0 0 0 2px var(--color-primary-dim);
  }

  .add-input.has-error {
    border-color: var(--color-error);
  }

  .add-error {
    color: var(--color-error);
    font-size: var(--text-xs, 0.625rem);
    max-width: 320px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  @media (prefers-reduced-motion: reduce) {
    button.add-row.row,
    button.add-row.empty {
      transition: none;
    }
  }
</style>
