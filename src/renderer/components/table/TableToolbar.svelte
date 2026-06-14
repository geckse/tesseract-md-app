<script lang="ts">
  import { activeCollection } from '../../stores/collections'
  import { workspace, type TableTab } from '../../stores/workspace.svelte'
  import { tableStore } from '../../stores/table.svelte'
  import { tableViewsStore } from '../../stores/table-views.svelte'
  import type { TableColumnLayout } from '../../../preload/api'
  import IconButton from '../ui/IconButton.svelte'

  interface Props {
    tabId: string
    onsaveview: () => void
  }
  let { tabId, onsaveview }: Props = $props()

  let columnsOpen = $state(false)
  let addingRow = $state(false)
  let newRowName = $state('')
  let addError = $state<string | null>(null)

  const tab = $derived(
    (() => {
      const t = workspace.tabs[tabId]
      return t && t.kind === 'table' ? (t as TableTab) : null
    })()
  )
  const config = $derived(tableStore.mergedConfig(tabId))
  const allColumns = $derived(tableStore.state(tabId).data?.columns ?? [])
  const rowCount = $derived(tableStore.rowCount(tabId))
  const savedViews = $derived(
    $activeCollection ? tableViewsStore.getViews($activeCollection.id, tab?.folderPath ?? '') : []
  )

  const breadcrumb = $derived(
    (() => {
      const fp = tab?.folderPath ?? ''
      return fp === '' || fp === '.' ? 'Root' : fp
    })()
  )

  function toggleRecursive(e: Event): void {
    workspace.setTableRecursive(tabId, (e.currentTarget as HTMLInputElement).checked)
  }

  function changeView(e: Event): void {
    const v = (e.currentTarget as HTMLSelectElement).value
    workspace.setTableActiveView(tabId, v === '' ? null : v)
  }

  function changeGroupBy(e: Event): void {
    const v = (e.currentTarget as HTMLSelectElement).value
    workspace.setTableEphemeral(tabId, { groupBy: v === '' ? null : v })
  }

  function isHidden(name: string): boolean {
    return config.columns.find((c) => c.name === name)?.hidden ?? false
  }

  function toggleColumnVisible(name: string): void {
    const layout: TableColumnLayout[] = config.columns.slice()
    const idx = layout.findIndex((c) => c.name === name)
    if (idx >= 0) {
      layout[idx] = { ...layout[idx], hidden: !layout[idx].hidden }
    } else {
      layout.push({
        name,
        hidden: true,
        width: tableStore.columnWidth(tabId, name),
        order: layout.length
      })
    }
    workspace.setTableEphemeral(tabId, { columns: layout })
  }

  async function commitAddRow(): Promise<void> {
    const result = await tableStore.addRow(tabId, newRowName)
    if (result.ok) {
      addingRow = false
      newRowName = ''
      addError = null
    } else {
      addError = result.error ?? 'Could not create file'
    }
  }

  function onAddKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault()
      void commitAddRow()
    } else if (e.key === 'Escape') {
      addingRow = false
      newRowName = ''
      addError = null
    }
  }
</script>

<div class="toolbar">
  <div class="left">
    <span class="material-symbols-outlined breadcrumb-icon">folder</span>
    <span class="breadcrumb" title={breadcrumb}>{breadcrumb}</span>

    <label class="recursive">
      <input type="checkbox" checked={tab?.recursive ?? false} onchange={toggleRecursive} />
      Recursive
    </label>

    <select
      class="select"
      aria-label="Saved view"
      value={tab?.activeViewId ?? ''}
      onchange={changeView}
    >
      <option value="">All fields (default)</option>
      {#each savedViews as v (v.id)}
        <option value={v.id}>{v.name}{v.isDefault ? ' ★' : ''}</option>
      {/each}
    </select>

    <select
      class="select"
      aria-label="Group by"
      value={config.groupBy ?? ''}
      onchange={changeGroupBy}
    >
      <option value="">No grouping</option>
      {#each allColumns as c (c.name)}
        <option value={c.name}>Group: {c.name}</option>
      {/each}
    </select>

    <div class="columns-menu">
      <button
        class="menu-btn"
        aria-haspopup="true"
        aria-expanded={columnsOpen}
        onclick={() => (columnsOpen = !columnsOpen)}
      >
        <span class="material-symbols-outlined">view_column</span>
        Columns
      </button>
      {#if columnsOpen}
        <button
          class="menu-backdrop"
          aria-label="Close columns menu"
          onclick={() => (columnsOpen = false)}
        ></button>
        <div class="menu-popover" role="menu">
          {#if allColumns.length === 0}
            <div class="menu-empty">No fields yet</div>
          {:else}
            {#each allColumns as c (c.name)}
              <label class="menu-item">
                <input
                  type="checkbox"
                  checked={!isHidden(c.name)}
                  onchange={() => toggleColumnVisible(c.name)}
                />
                {c.name}
              </label>
            {/each}
          {/if}
        </div>
      {/if}
    </div>
  </div>

  <div class="right">
    {#if addingRow}
      <span class="add-row-form">
        <!-- svelte-ignore a11y_autofocus -->
        <input
          class="add-input"
          class:has-error={!!addError}
          type="text"
          placeholder="new-file.md"
          bind:value={newRowName}
          autofocus
          aria-label="New file name"
          onkeydown={onAddKeydown}
          onblur={() => {
            if (!newRowName.trim()) addingRow = false
          }}
        />
        {#if addError}<span class="add-error" title={addError}>!</span>{/if}
      </span>
    {:else}
      <button class="add-btn" onclick={() => (addingRow = true)}>
        <span class="material-symbols-outlined">add</span>
        Add row
      </button>
    {/if}
    <span class="row-count" aria-live="polite">{rowCount} {rowCount === 1 ? 'row' : 'rows'}</span>
    <IconButton icon="bookmark_add" title="Save view" size="sm" onclick={onsaveview} />
    <IconButton icon="refresh" title="Refresh" size="sm" onclick={() => tableStore.reload(tabId)} />
  </div>
</div>

<style>
  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--color-border);
    background: var(--color-surface);
    flex-wrap: wrap;
  }

  .left,
  .right {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .breadcrumb-icon {
    font-size: 18px;
    color: var(--color-text-dim);
  }

  .breadcrumb {
    font-weight: var(--weight-medium);
    color: var(--color-text);
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .recursive {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: var(--text-sm);
    color: var(--color-text-dim);
    cursor: pointer;
  }

  .select {
    background: var(--color-surface-elevated);
    color: var(--color-text);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    padding: 2px 6px;
    font-size: var(--text-sm);
    max-width: 180px;
  }

  .columns-menu {
    position: relative;
  }

  .menu-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    background: var(--color-surface-elevated);
    color: var(--color-text);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    padding: 3px 8px;
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .menu-btn .material-symbols-outlined {
    font-size: 16px;
  }

  .menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: var(--z-overlay);
    background: transparent;
    border: none;
    cursor: default;
  }

  .menu-popover {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: calc(var(--z-overlay) + 1);
    min-width: 180px;
    max-height: 320px;
    overflow: auto;
    background: var(--color-surface-elevated);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    padding: var(--space-1);
  }

  .menu-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 8px;
    font-size: var(--text-sm);
    color: var(--color-text);
    cursor: pointer;
    border-radius: var(--radius-sm);
  }

  .menu-item:hover {
    background: var(--color-surface);
  }

  .menu-empty {
    padding: 6px 8px;
    color: var(--color-text-dim);
    font-size: var(--text-sm);
  }

  .row-count {
    font-size: var(--text-sm);
    color: var(--color-text-dim);
    font-family: var(--font-mono);
  }

  .add-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    background: var(--color-surface-elevated);
    color: var(--color-text);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    padding: 3px 8px;
    font-size: var(--text-sm);
    cursor: pointer;
  }

  .add-btn:hover {
    border-color: var(--color-primary);
  }

  .add-btn .material-symbols-outlined {
    font-size: 16px;
  }

  .add-row-form {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .add-input {
    background: var(--color-surface-elevated);
    border: 1px solid var(--color-primary);
    border-radius: var(--radius-sm);
    padding: 3px 8px;
    font-size: var(--text-sm);
    color: var(--color-text);
    width: 160px;
  }

  .add-input.has-error {
    border-color: var(--color-error);
  }

  .add-error {
    color: var(--color-error);
    font-weight: var(--weight-bold);
  }
</style>
