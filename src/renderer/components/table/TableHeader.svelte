<script lang="ts">
  import { workspace } from '../../stores/workspace.svelte'
  import { tableStore } from '../../stores/table.svelte'
  import { propertyOps } from '../../stores/property-ops.svelte'
  import { detectedTypeForField } from '../../lib/property-types'
  import { cliFeatures } from '../../lib/cli-features.svelte'
  import PopoverMenu, { type PopoverMenuItem } from '../ui/PopoverMenu.svelte'
  import TypePickerDropdown from '../wysiwyg/TypePickerDropdown.svelte'
  import PropertySettingsPopover from '../PropertySettingsPopover.svelte'
  import { TITLE_COLUMN } from '../../stores/table-views.svelte'
  import type { CollectionColumn } from '../../types/cli'
  import type { TableSort } from '../../../preload/api'
  import {
    computedFieldIcon,
    isComputedFieldType,
    isLookupRollupFieldType
  } from '../../lib/computed-fields'

  interface Props {
    tabId: string
    columns: CollectionColumn[]
    titleWidth: number
    oneditformula?: (column: CollectionColumn) => void
    oneditlookuprollup?: (column: CollectionColumn) => void
  }
  let {
    tabId,
    columns,
    titleWidth,
    oneditformula = () => {},
    oneditlookuprollup = () => {}
  }: Props = $props()

  const sort = $derived<TableSort | undefined>(tableStore.mergedConfig(tabId).sort[0])

  // ── Phase 41: per-column property menu (change type / rename / settings) ──
  const folderPath = $derived.by(() => {
    const tab = workspace.tabs[tabId]
    return tab && tab.kind === 'table' ? tab.folderPath : ''
  })

  let menuColumn = $state<CollectionColumn | null>(null)
  let menuAnchor = $state<HTMLElement | null>(null)
  let showTypePicker = $state(false)
  let showSettings = $state(false)

  const columnMenuItems = $derived.by<PopoverMenuItem[]>(() => {
    if (!menuColumn) return []
    const sorting: PopoverMenuItem[] = [
      { id: 'sort-asc', label: 'Sort ascending', icon: 'arrow_upward' },
      { id: 'sort-desc', label: 'Sort descending', icon: 'arrow_downward' },
      {
        id: 'sort-clear',
        label: 'Clear sort',
        icon: 'unfold_more',
        disabled: sortDir(menuColumn.name) === null
      }
    ]
    if (isComputedFieldType(menuColumn.field_type)) {
      const lookupRollup = isLookupRollupFieldType(menuColumn.field_type)
      return [
        ...sorting,
        {
          id: lookupRollup ? 'edit-lookup-rollup' : 'edit-formula',
          label: `Edit ${menuColumn.field_type.toLowerCase()}…`,
          icon: computedFieldIcon(menuColumn.field_type),
          disabled: lookupRollup && !cliFeatures.supportsLookupRollup,
          separatorBefore: true
        },
        {
          id: 'drop',
          label: 'Drop column…',
          icon: 'delete',
          disabled: lookupRollup && !cliFeatures.supportsLookupRollup,
          danger: true,
          separatorBefore: true
        }
      ]
    }
    return [
      ...sorting,
      { id: 'change-type', label: 'Change type…', icon: 'swap_horiz', separatorBefore: true },
      { id: 'rename', label: 'Rename property…', icon: 'drive_file_rename_outline' },
      { id: 'settings', label: 'Property settings…', icon: 'tune' },
      {
        id: 'drop',
        label: 'Drop column…',
        icon: 'delete',
        danger: true,
        separatorBefore: true
      }
    ]
  })

  function openColumnMenu(e: MouseEvent, col: CollectionColumn): void {
    e.stopPropagation()
    showTypePicker = false
    showSettings = false
    menuColumn = col
    menuAnchor = e.currentTarget as HTMLElement
  }

  function closeColumnMenu(): void {
    menuColumn = null
    menuAnchor = null
  }

  function handleColumnMenuSelect(id: string): void {
    const col = menuColumn
    if (!col) return
    if (id === 'sort-asc') {
      workspace.setTableEphemeral(tabId, { sort: [{ columnName: col.name, direction: 'asc' }] })
    } else if (id === 'sort-desc') {
      workspace.setTableEphemeral(tabId, { sort: [{ columnName: col.name, direction: 'desc' }] })
    } else if (id === 'sort-clear') {
      workspace.setTableEphemeral(tabId, { sort: [] })
    } else if (id === 'edit-formula') {
      oneditformula(col)
    } else if (id === 'edit-lookup-rollup') {
      oneditlookuprollup(col)
    } else if (id === 'drop') {
      propertyOps.openDrop({ kind: 'table', tabId, folderPath }, col.name)
    } else if (id === 'change-type') {
      showTypePicker = true
      return // keep menuColumn/anchor for the picker
    } else if (id === 'rename') {
      propertyOps.openRename({ kind: 'table', tabId, folderPath }, col.name)
    } else if (id === 'settings') {
      showSettings = true
      return // keep menuColumn/anchor for the popover
    }
    closeColumnMenu()
  }

  function handleTypeSelect(type: string): void {
    const col = menuColumn
    showTypePicker = false
    closeColumnMenu()
    if (!col) return
    const current = detectedTypeForField(col.field_type, col.allowed_values)
    if (type !== current) {
      propertyOps.openConvert(
        { kind: 'table', tabId, folderPath },
        col.name,
        type as typeof current,
        current
      )
    }
  }

  /** Material Symbols icon per FieldType (mirrors PropertyRow's type icons). */
  const TYPE_ICONS: Record<string, string> = {
    String: 'notes',
    Number: 'tag',
    Boolean: 'check_box',
    Date: 'calendar_today',
    List: 'sell',
    Mixed: 'data_object',
    Json: 'data_object',
    Relation: 'account_tree',
    File: 'attach_file',
    Formula: 'function',
    Lookup: 'manage_search',
    Rollup: 'functions'
  }

  function sortDir(name: string): 'asc' | 'desc' | null {
    return sort && sort.columnName === name ? sort.direction : null
  }

  function ariaSort(name: string): 'ascending' | 'descending' | 'none' {
    const d = sortDir(name)
    return d === 'asc' ? 'ascending' : d === 'desc' ? 'descending' : 'none'
  }

  /** Distinct current values exposed in Property Settings for Tags color choices. */
  function colorValuesFor(column: CollectionColumn): string[] {
    if (column.allowed_values?.length) return column.allowed_values
    if (column.field_type !== 'List') return []

    const seen = new Set<string>()
    for (const row of tableStore.state(tabId).data?.rows ?? []) {
      const raw = row.frontmatter?.[column.name]
      if (!Array.isArray(raw)) continue
      for (const value of raw) {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
          const text = String(value).trim()
          if (text) seen.add(text)
        }
      }
    }
    return [...seen].slice(0, 100)
  }

  /** Cycle a column's sort: none → asc → desc → none. */
  function cycleSort(name: string): void {
    const current = sortDir(name)
    let next: TableSort[]
    if (current === null) next = [{ columnName: name, direction: 'asc' }]
    else if (current === 'asc') next = [{ columnName: name, direction: 'desc' }]
    else next = []
    workspace.setTableEphemeral(tabId, { sort: next })
  }

  function sortIcon(name: string): string {
    const d = sortDir(name)
    return d === 'asc' ? 'arrow_upward' : d === 'desc' ? 'arrow_downward' : 'unfold_more'
  }

  // ── Column resize (drag the right edge) ──────────────────────────────
  let resizing: { name: string; startX: number; startWidth: number } | null = null

  function onResizeMove(e: PointerEvent): void {
    if (!resizing) return
    tableStore.setColumnWidth(
      tabId,
      resizing.name,
      resizing.startWidth + (e.clientX - resizing.startX)
    )
  }

  function endResize(): void {
    resizing = null
    document.body.style.cursor = ''
    window.removeEventListener('pointermove', onResizeMove)
  }

  function startResize(e: PointerEvent, name: string): void {
    e.preventDefault()
    e.stopPropagation()
    resizing = { name, startX: e.clientX, startWidth: tableStore.columnWidth(tabId, name) }
    document.body.style.cursor = 'col-resize'
    window.addEventListener('pointermove', onResizeMove)
    window.addEventListener('pointerup', endResize, { once: true })
  }
</script>

<div class="header-row" role="row">
  <button
    class="header-cell title-cell sortable"
    role="columnheader"
    aria-sort={ariaSort(TITLE_COLUMN)}
    title="Sort by Title"
    style="width: {titleWidth}px; min-width: {titleWidth}px;"
    onclick={() => cycleSort(TITLE_COLUMN)}
  >
    <span class="material-symbols-outlined type-icon" aria-hidden="true">title</span>
    <span class="header-label">Title</span>
    <span
      class="material-symbols-outlined sort-icon"
      class:active={sortDir(TITLE_COLUMN) !== null}
      aria-hidden="true"
    >
      {sortIcon(TITLE_COLUMN)}
    </span>
  </button>

  {#each columns as col (col.name)}
    <div
      class="header-col"
      style="width: {tableStore.columnWidth(tabId, col.name)}px; min-width: {tableStore.columnWidth(
        tabId,
        col.name
      )}px;"
    >
      <button
        class="header-cell sortable"
        class:unscoped={!col.in_schema}
        role="columnheader"
        aria-sort={ariaSort(col.name)}
        title={col.in_schema
          ? `${col.name} (${col.field_type === 'Formula' || col.field_type === 'Rollup' ? `${col.field_type} → ${col.result_type ?? 'Json'}` : col.field_type})`
          : `${col.name} (ad-hoc)`}
        onclick={() => cycleSort(col.name)}
      >
        <span class="material-symbols-outlined type-icon" aria-hidden="true">
          {TYPE_ICONS[col.field_type] ?? 'data_object'}
        </span>
        <span class="header-label">{col.name}</span>
        <span class="material-symbols-outlined sort-icon" class:active={sortDir(col.name) !== null}>
          {sortIcon(col.name)}
        </span>
      </button>
      <button
        class="col-menu-btn"
        class:open={menuColumn?.name === col.name}
        title="Column options"
        aria-label="Column options for {col.name}"
        aria-haspopup="menu"
        aria-expanded={menuColumn?.name === col.name}
        onclick={(e) => openColumnMenu(e, col)}
      >
        <span class="material-symbols-outlined">more_vert</span>
      </button>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="resize-handle"
        title="Drag to resize column"
        onpointerdown={(e) => startResize(e, col.name)}
      ></div>
    </div>
  {/each}
</div>

{#if menuColumn && menuAnchor && !showTypePicker && !showSettings}
  <PopoverMenu
    anchorEl={menuAnchor}
    items={columnMenuItems}
    ariaLabel="Column options for {menuColumn.name}"
    onselect={handleColumnMenuSelect}
    ondismiss={() => {
      // 'change-type'/'settings' hand the anchor to a follow-up popover; the
      // menu's own dismiss must not tear it down in that case.
      if (!showTypePicker && !showSettings) closeColumnMenu()
    }}
  />
{/if}

{#if menuColumn && menuAnchor && showTypePicker}
  <TypePickerDropdown
    anchorEl={menuAnchor}
    currentType={detectedTypeForField(menuColumn.field_type, menuColumn.allowed_values)}
    excludeTypes={cliFeatures.supportsFileFields ? [] : ['file']}
    onSelect={handleTypeSelect}
    onDismiss={() => {
      showTypePicker = false
      closeColumnMenu()
    }}
  />
{/if}

{#if menuColumn && menuAnchor && showSettings}
  <PropertySettingsPopover
    anchorEl={menuAnchor}
    scope={folderPath === '' ? null : folderPath}
    fieldKey={menuColumn.name}
    description={menuColumn.description}
    required={menuColumn.required}
    allowedValues={menuColumn.allowed_values}
    collectionId={tableStore.collectionIdFor(tabId) ?? null}
    colorValues={colorValuesFor(menuColumn)}
    valueColorsEnabled={menuColumn.field_type === 'List' ||
      (menuColumn.allowed_values?.length ?? 0) > 0}
    isRelation={menuColumn.field_type === 'Relation'}
    relationTarget={menuColumn.relation_target}
    onclose={() => {
      showSettings = false
      closeColumnMenu()
    }}
  />
{/if}

<style>
  .header-row {
    display: flex;
    position: sticky;
    top: 0;
    z-index: var(--z-base, 10);
    background: var(--color-surface);
    border-bottom: 1px solid var(--color-border);
  }

  .header-cell {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 0 var(--space-2, 8px);
    height: 32px;
    box-sizing: border-box;
    border-right: 1px solid var(--color-border);
    font-size: var(--text-sm, 0.75rem);
    font-weight: var(--weight-medium, 500);
    letter-spacing: 0.02em;
    color: var(--color-text-dim);
    overflow: hidden;
  }

  /* Pinned-left Title header: sticky on both axes. Literal z-index — Chromium
     computes `z-index: calc(...)` to auto, which lets sibling columns paint over. */
  .header-cell.title-cell {
    position: sticky;
    left: 0;
    z-index: 2;
    background: var(--color-surface);
  }

  /* The shared hover color is translucent. Keep the pinned cell opaque while
     hovered so horizontally scrolled column labels cannot bleed through it. */
  .header-cell.title-cell:hover {
    background: var(--color-surface-elevated);
  }

  :global(.table-inner.scrolled-x) .title-cell {
    box-shadow: var(--shadow-sticky-col, 2px 0 8px rgba(0, 0, 0, 0.35));
    clip-path: inset(0 -12px 0 0);
  }

  .type-icon {
    font-size: 14px;
    color: var(--color-text-faint);
    flex-shrink: 0;
  }

  .header-col {
    position: relative;
    box-sizing: border-box;
  }

  .col-menu-btn {
    position: absolute;
    top: 50%;
    right: 8px;
    transform: translateY(-50%);
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--color-surface);
    border: none;
    border-radius: var(--radius-sm, 4px);
    color: var(--color-text-dim);
    cursor: pointer;
    padding: 2px;
    opacity: 0;
    z-index: 1;
    transition: opacity var(--transition-fast, 150ms ease);
  }
  .header-col:hover .col-menu-btn,
  .col-menu-btn:focus-visible,
  .col-menu-btn.open {
    opacity: 1;
  }
  .col-menu-btn:hover {
    color: var(--color-primary);
  }
  .col-menu-btn .material-symbols-outlined {
    font-size: 14px;
  }

  .resize-handle {
    position: absolute;
    top: 0;
    right: -4px;
    width: 8px;
    height: 100%;
    cursor: col-resize;
    z-index: 1;
  }

  .resize-handle::after {
    content: '';
    position: absolute;
    top: 0;
    right: 3px;
    width: 2px;
    height: 100%;
    background: transparent;
    transition: background var(--transition-fast, 150ms ease);
  }

  .resize-handle:hover::after {
    background: var(--color-primary);
    opacity: 0.6;
  }

  .sortable {
    width: 100%;
    background: transparent;
    border-top: none;
    border-left: none;
    border-bottom: none;
    cursor: pointer;
    text-align: left;
    white-space: nowrap;
    transition: background var(--transition-fast, 150ms ease);
  }

  .sortable:hover {
    background: var(--overlay-hover);
  }

  .sortable:focus-visible {
    outline: 1px solid var(--color-primary);
    outline-offset: -1px;
  }

  .unscoped .header-label {
    font-style: italic;
  }

  .header-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sort-icon {
    font-size: 14px;
    color: var(--color-text-faint);
    margin-left: auto;
    opacity: 0;
    transition: opacity var(--transition-fast, 150ms ease);
  }

  .sortable:hover .sort-icon,
  .sortable:focus-visible .sort-icon {
    opacity: 1;
  }

  .sort-icon.active {
    opacity: 1;
    color: var(--color-primary);
  }

  @media (prefers-reduced-motion: reduce) {
    .sortable,
    .sort-icon,
    .col-menu-btn,
    .resize-handle::after {
      transition: none;
    }
  }
</style>
