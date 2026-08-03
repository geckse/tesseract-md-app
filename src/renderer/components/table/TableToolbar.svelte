<script lang="ts">
  import { activeCollection } from '../../stores/collections'
  import { workspace, type TableTab } from '../../stores/workspace.svelte'
  import { tableStore } from '../../stores/table.svelte'
  import { tableHistory } from '../../stores/table-history.svelte'
  import { tableViewsStore } from '../../stores/table-views.svelte'
  import { getShortcutDisplay } from '../../lib/shortcuts'
  import IconButton from '../ui/IconButton.svelte'
  import PopoverMenu, { type PopoverMenuItem } from '../ui/PopoverMenu.svelte'

  interface Props {
    tabId: string
    onsaveview: () => void
    onaddcolumn?: () => void
  }
  let { tabId, onsaveview, onaddcolumn = () => {} }: Props = $props()

  type MenuId = 'view' | 'group' | 'columns'
  let openMenu = $state<MenuId | null>(null)
  let viewBtnEl: HTMLButtonElement | null = $state(null)
  let groupBtnEl: HTMLButtonElement | null = $state(null)
  let columnsBtnEl: HTMLButtonElement | null = $state(null)
  let columnsMenuAnchor: HTMLElement | null = $state(null)

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
  const canUndo = $derived(tableHistory.canUndo(tabId))
  const canRedo = $derived(tableHistory.canRedo(tabId))
  const historyNotice = $derived(tableHistory.noticeFor(tabId))
  const savedViews = $derived(
    $activeCollection ? tableViewsStore.getViews($activeCollection.id, tab?.folderPath ?? '') : []
  )

  const crumbs = $derived.by(() => {
    const fp = tab?.folderPath ?? ''
    if (fp === '' || fp === '.') return ['Root']
    return fp.split('/').filter(Boolean)
  })
  const fullPath = $derived(crumbs.join('/'))

  const activeViewName = $derived(
    savedViews.find((v) => v.id === tab?.activeViewId)?.name ?? 'All fields'
  )

  const NONE_ID = '__none__'

  const groupItems = $derived.by<PopoverMenuItem[]>(() => [
    { id: NONE_ID, label: 'No grouping', checked: !config.groupBy },
    ...allColumns.map((c) => ({
      id: c.name,
      label: c.name,
      checked: config.groupBy === c.name
    }))
  ])

  const hiddenColumnCount = $derived(allColumns.filter((column) => isHidden(column.name)).length)
  const layoutError = $derived(tableStore.columnLayoutError(tabId))

  const SHOW_ALL_COLUMNS_ID = '__show_all_columns__'
  const CUSTOMIZE_FIELDS_ID = '__customize_fields__'
  const SAVE_VIEW_ID = '__save_view__'

  const viewItems = $derived.by<PopoverMenuItem[]>(() => [
    { id: NONE_ID, label: 'All fields (default)', checked: !tab?.activeViewId },
    ...savedViews.map((v) => ({
      id: v.id,
      label: v.name,
      icon: v.isDefault ? 'star' : undefined,
      checked: tab?.activeViewId === v.id
    })),
    {
      id: CUSTOMIZE_FIELDS_ID,
      label:
        hiddenColumnCount === 0
          ? 'Customize fields…'
          : `Customize fields… (${hiddenColumnCount} hidden)`,
      icon: 'view_column',
      separatorBefore: true
    },
    { id: SAVE_VIEW_ID, label: 'Save current as new view…', icon: 'bookmark_add' }
  ])

  const columnItems = $derived.by<PopoverMenuItem[]>(() => [
    ...allColumns.map((c) => ({
      id: c.name,
      label: c.name,
      checked: !isHidden(c.name)
    })),
    {
      id: SHOW_ALL_COLUMNS_ID,
      label:
        hiddenColumnCount === 0
          ? 'All fields are visible'
          : `Show all fields (${hiddenColumnCount} hidden)`,
      icon: 'visibility',
      disabled: hiddenColumnCount === 0,
      separatorBefore: allColumns.length > 0
    }
  ])

  function toggleMenu(id: MenuId): void {
    openMenu = openMenu === id ? null : id
  }

  function toggleRecursive(): void {
    workspace.setTableRecursive(tabId, !(tab?.recursive ?? false))
  }

  function selectView(id: string): void {
    if (id === CUSTOMIZE_FIELDS_ID) {
      columnsMenuAnchor = viewBtnEl
      openMenu = 'columns'
      return
    }
    if (id === SAVE_VIEW_ID) {
      openMenu = null
      onsaveview()
      return
    }
    workspace.setTableActiveView(tabId, id === NONE_ID ? null : id)
    openMenu = null
  }

  function selectGroupBy(id: string): void {
    workspace.setTableEphemeral(tabId, { groupBy: id === NONE_ID ? null : id })
  }

  function isHidden(name: string): boolean {
    return config.columns.find((c) => c.name === name)?.hidden ?? false
  }

  function toggleColumnVisible(name: string): void {
    if (name === SHOW_ALL_COLUMNS_ID) {
      tableStore.showAllColumns(tabId)
      return
    }
    tableStore.toggleColumnHidden(tabId, name)
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
    <span class="crumbs" title={fullPath}>
      <span class="material-symbols-outlined crumb-icon">folder</span>
      {#each crumbs as crumb, i}
        {#if i > 0}
          <span class="material-symbols-outlined crumb-sep" aria-hidden="true">chevron_right</span>
        {/if}
        <span class="crumb" class:last={i === crumbs.length - 1}>{crumb}</span>
      {/each}
    </span>

    <span class="divider" aria-hidden="true"></span>

    <button
      class="ghost-btn"
      class:on={tab?.recursive ?? false}
      aria-pressed={tab?.recursive ?? false}
      title="Include files in nested subfolders"
      onclick={toggleRecursive}
    >
      <span class="material-symbols-outlined">account_tree</span>
      Recursive
    </button>

    <button
      class="ghost-btn"
      bind:this={viewBtnEl}
      aria-haspopup="menu"
      aria-expanded={openMenu === 'view'}
      title="Saved view"
      onclick={() => toggleMenu('view')}
    >
      <span class="material-symbols-outlined">bookmark</span>
      <span class="ghost-label">{activeViewName}</span>
      <span class="material-symbols-outlined caret">arrow_drop_down</span>
    </button>
    {#if openMenu === 'view' && viewBtnEl}
      <PopoverMenu
        anchorEl={viewBtnEl}
        items={viewItems}
        ariaLabel="Saved view"
        onselect={selectView}
        ondismiss={() => {
          if (openMenu === 'view') openMenu = null
        }}
      />
    {/if}

    <button
      class="ghost-btn"
      class:on={!!config.groupBy}
      bind:this={groupBtnEl}
      aria-haspopup="menu"
      aria-expanded={openMenu === 'group'}
      title="Group rows by a field"
      onclick={() => toggleMenu('group')}
    >
      <span class="material-symbols-outlined">layers</span>
      <span class="ghost-label">{config.groupBy ? `Group: ${config.groupBy}` : 'Group'}</span>
      <span class="material-symbols-outlined caret">arrow_drop_down</span>
    </button>
    {#if openMenu === 'group' && groupBtnEl}
      <PopoverMenu
        anchorEl={groupBtnEl}
        items={groupItems}
        ariaLabel="Group by"
        emptyLabel="No fields yet"
        onselect={selectGroupBy}
        ondismiss={() => (openMenu = null)}
      />
    {/if}

    <button
      class="ghost-btn"
      bind:this={columnsBtnEl}
      aria-haspopup="menu"
      aria-expanded={openMenu === 'columns'}
      title="Show or hide columns"
      onclick={() => {
        columnsMenuAnchor = columnsBtnEl
        toggleMenu('columns')
      }}
    >
      <span class="material-symbols-outlined">view_column</span>
      Columns
      {#if hiddenColumnCount > 0}
        <span class="hidden-count" aria-label="{hiddenColumnCount} hidden fields"
          >{hiddenColumnCount} hidden</span
        >
      {/if}
      <span class="material-symbols-outlined caret">arrow_drop_down</span>
    </button>
    {#if openMenu === 'columns' && (columnsMenuAnchor ?? columnsBtnEl)}
      <PopoverMenu
        anchorEl={(columnsMenuAnchor ?? columnsBtnEl)!}
        items={columnItems}
        ariaLabel="Columns"
        emptyLabel="No fields yet"
        closeOnSelect={false}
        onselect={toggleColumnVisible}
        ondismiss={() => {
          openMenu = null
          columnsMenuAnchor = null
        }}
      />
    {/if}
  </div>

  <div class="right">
    {#if layoutError}
      <button
        class="layout-error"
        title={layoutError}
        onclick={() => tableStore.retryColumnLayoutSave(tabId)}
      >
        Layout not saved · Retry
      </button>
    {/if}
    {#if historyNotice}
      <span class="history-notice" role="status" aria-live="polite">{historyNotice.message}</span>
    {/if}
    <IconButton
      icon="undo"
      title={`Undo (${getShortcutDisplay('z', true)})`}
      size="sm"
      disabled={!canUndo}
      onclick={() => void tableStore.undo(tabId)}
    />
    <IconButton
      icon="redo"
      title={`Redo (${getShortcutDisplay('z', true, true)})`}
      size="sm"
      disabled={!canRedo}
      onclick={() => void tableStore.redo(tabId)}
    />
    <span class="divider"></span>
    <button class="ghost-btn" onclick={onaddcolumn}>
      <span class="material-symbols-outlined" aria-hidden="true">view_column</span>
      Add column
    </button>
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
      <button class="ghost-btn accent" onclick={() => (addingRow = true)}>
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
    gap: var(--space-2, 8px);
    padding: var(--space-2, 8px) var(--space-3, 12px);
    border-bottom: 1px solid var(--color-border);
    background: var(--color-surface);
    flex-wrap: wrap;
  }

  .left,
  .right {
    display: flex;
    align-items: center;
    gap: var(--space-2, 8px);
    min-width: 0;
  }

  /* ── Breadcrumb ─────────────────────────────────────────────── */
  .crumbs {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
    max-width: 280px;
    overflow: hidden;
    white-space: nowrap;
  }

  .crumb-icon {
    font-size: 16px;
    color: var(--color-text-dim);
    margin-right: 2px;
    flex-shrink: 0;
  }

  .crumb {
    color: var(--color-text-dim);
    font-size: var(--text-sm, 0.75rem);
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .crumb.last {
    color: var(--color-text);
    font-weight: var(--weight-medium, 500);
  }

  .crumb-sep {
    font-size: 14px;
    color: var(--color-text-faint);
    flex-shrink: 0;
  }

  .divider {
    width: 1px;
    height: 16px;
    background: var(--color-border);
    margin: 0 6px;
    flex-shrink: 0;
  }

  /* ── Ghost buttons ──────────────────────────────────────────── */
  .ghost-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 10px;
    background: transparent;
    border: none;
    border-radius: var(--radius-sm, 4px);
    color: var(--color-text-dim);
    font-size: var(--text-sm, 0.75rem);
    cursor: pointer;
    white-space: nowrap;
    transition:
      background var(--transition-fast, 150ms ease),
      color var(--transition-fast, 150ms ease);
  }

  .ghost-btn:hover {
    background: var(--overlay-hover);
    color: var(--color-text);
  }

  .ghost-btn:active {
    background: var(--overlay-active);
  }

  .ghost-btn:focus-visible {
    outline: 1px solid var(--color-primary);
    outline-offset: -1px;
  }

  .ghost-btn .material-symbols-outlined {
    font-size: 16px;
  }

  .ghost-btn .caret {
    font-size: 18px;
    margin: 0 -4px 0 -2px;
    color: var(--color-text-faint);
  }

  .ghost-btn.on {
    color: var(--color-primary);
    background: var(--color-primary-dim);
  }

  .hidden-count {
    padding: 1px 5px;
    border-radius: var(--radius-full, 9999px);
    background: var(--color-primary-dim);
    color: var(--color-primary);
    font-size: var(--text-xs, 0.625rem);
  }

  .ghost-btn.accent {
    color: var(--color-primary);
  }

  .ghost-btn.accent:hover {
    background: var(--color-primary-dim);
  }

  .ghost-label {
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* ── Right side ─────────────────────────────────────────────── */
  .history-notice {
    font-size: var(--text-xs, 0.625rem);
    color: var(--color-text-dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 260px;
    animation: notice-in 150ms ease-out;
  }

  .layout-error {
    border: 0;
    padding: 3px 6px;
    background: transparent;
    color: var(--color-error);
    font-size: var(--text-xs, 0.625rem);
    cursor: pointer;
  }

  .layout-error:hover,
  .layout-error:focus-visible {
    text-decoration: underline;
  }

  .layout-error:focus-visible {
    outline: 1px solid var(--color-error);
    outline-offset: 2px;
  }

  @keyframes notice-in {
    from {
      opacity: 0;
      transform: translateX(4px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  .row-count {
    font-size: var(--text-xs, 0.625rem);
    color: var(--color-text-dim);
    font-family: var(--font-mono, 'JetBrains Mono', ui-monospace, monospace);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-full, 9999px);
    padding: 3px 10px;
    white-space: nowrap;
  }

  .add-row-form {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .add-input {
    background: var(--color-surface-elevated);
    border: 1px solid var(--color-primary);
    border-radius: var(--radius-sm, 4px);
    padding: 3px 8px;
    font-size: var(--text-sm, 0.75rem);
    color: var(--color-text);
    width: 160px;
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
    font-weight: var(--weight-bold, 700);
  }

  @media (prefers-reduced-motion: reduce) {
    .ghost-btn {
      transition: none;
    }
    .history-notice {
      animation: none;
    }
  }
</style>
