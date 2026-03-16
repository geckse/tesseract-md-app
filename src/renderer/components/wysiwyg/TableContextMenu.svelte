<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { computePosition, flip, shift, offset } from '@floating-ui/dom'
  import type { Editor } from '@tiptap/core'
  import type { CellInfo } from '../../lib/tiptap/table-ui-extension'

  interface MenuItem {
    label: string
    icon: string
    action: () => void
    disabled: boolean
    checked?: boolean
  }

  interface Props {
    cellInfo: CellInfo
    editor: Editor
    clientX: number
    clientY: number
    onClose: () => void
  }

  let { cellInfo, editor, clientX, clientY, onClose }: Props = $props()

  let menuEl: HTMLDivElement | undefined = $state(undefined)
  let selectedIndex = $state(0)

  // --- Table operation helpers ---

  function insertRow(above: boolean) {
    if (above) {
      editor.chain().focus().addRowBefore().run()
    } else {
      editor.chain().focus().addRowAfter().run()
    }
    onClose()
  }

  function deleteRow() {
    editor.chain().focus().deleteRow().run()
    onClose()
  }

  function moveRow(direction: -1 | 1) {
    const { state, view } = editor
    const table = state.doc.nodeAt(cellInfo.tablePos)
    if (!table) return

    const srcRow = cellInfo.row
    const dstRow = srcRow + direction
    if (dstRow < 0 || dstRow >= cellInfo.totalRows) return

    // Build new rows array with swapped order
    const rows: typeof table.content.content = []
    table.forEach((row) => rows.push(row))

    const tmp = rows[srcRow]
    rows[srcRow] = rows[dstRow]
    rows[dstRow] = tmp

    const newTable = table.type.create(table.attrs, rows)
    const tr = state.tr.replaceWith(cellInfo.tablePos, cellInfo.tablePos + table.nodeSize, newTable)
    view.dispatch(tr)
    onClose()
  }

  function insertColumn(left: boolean) {
    if (left) {
      editor.chain().focus().addColumnBefore().run()
    } else {
      editor.chain().focus().addColumnAfter().run()
    }
    onClose()
  }

  function deleteColumn() {
    editor.chain().focus().deleteColumn().run()
    onClose()
  }

  function moveColumn(direction: -1 | 1) {
    const { state, view } = editor
    const table = state.doc.nodeAt(cellInfo.tablePos)
    if (!table) return

    const srcCol = cellInfo.col
    const dstCol = srcCol + direction
    if (dstCol < 0 || dstCol >= cellInfo.totalCols) return

    // Reconstruct entire table with columns reordered
    const newRows: typeof table.content.content = []
    table.forEach((row) => {
      const cells: typeof row.content.content = []
      row.forEach((cell) => cells.push(cell))

      const tmp = cells[srcCol]
      cells[srcCol] = cells[dstCol]
      cells[dstCol] = tmp

      newRows.push(row.type.create(row.attrs, cells))
    })

    const newTable = table.type.create(table.attrs, newRows)
    const tr = state.tr.replaceWith(cellInfo.tablePos, cellInfo.tablePos + table.nodeSize, newTable)
    view.dispatch(tr)
    onClose()
  }

  function toggleHeaderRow() {
    editor.chain().focus().toggleHeaderRow().run()
    onClose()
  }

  function deleteTable() {
    editor.chain().focus().deleteTable().run()
    onClose()
  }

  // --- Menu items with groups ---

  interface MenuGroup {
    label: string
    items: MenuItem[]
  }

  const groups: MenuGroup[] = $derived([
    {
      label: 'Row',
      items: [
        { label: 'Insert row above', icon: 'arrow_upward', action: () => insertRow(true), disabled: false },
        { label: 'Insert row below', icon: 'arrow_downward', action: () => insertRow(false), disabled: false },
        { label: 'Move row up', icon: 'move_up', action: () => moveRow(-1), disabled: cellInfo.row <= 0 },
        { label: 'Move row down', icon: 'move_down', action: () => moveRow(1), disabled: cellInfo.row >= cellInfo.totalRows - 1 },
        { label: 'Delete row', icon: 'delete', action: () => deleteRow(), disabled: cellInfo.totalRows <= 1 },
      ],
    },
    {
      label: 'Column',
      items: [
        { label: 'Insert column left', icon: 'arrow_back', action: () => insertColumn(true), disabled: false },
        { label: 'Insert column right', icon: 'arrow_forward', action: () => insertColumn(false), disabled: false },
        { label: 'Move column left', icon: 'chevron_left', action: () => moveColumn(-1), disabled: cellInfo.col <= 0 },
        { label: 'Move column right', icon: 'chevron_right', action: () => moveColumn(1), disabled: cellInfo.col >= cellInfo.totalCols - 1 },
        { label: 'Delete column', icon: 'delete', action: () => deleteColumn(), disabled: cellInfo.totalCols <= 1 },
      ],
    },
    {
      label: 'Table',
      items: [
        { label: 'Header row', icon: 'table_rows', action: () => toggleHeaderRow(), disabled: false, checked: cellInfo.isHeader && cellInfo.row === 0 },
        { label: 'Delete table', icon: 'delete_forever', action: () => deleteTable(), disabled: false },
      ],
    },
  ])

  // Flat list for keyboard navigation
  const allItems: MenuItem[] = $derived(groups.flatMap((g) => g.items))

  function handleKeyDown(event: Event) {
    const e = event as KeyboardEvent
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      e.stopPropagation()
      selectedIndex = (selectedIndex + 1) % allItems.length
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      e.stopPropagation()
      selectedIndex = (selectedIndex - 1 + allItems.length) % allItems.length
    } else if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      const item = allItems[selectedIndex]
      if (item && !item.disabled) {
        item.action()
      }
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
    }
  }

  function positionMenu() {
    if (!menuEl) return

    const virtualEl = {
      getBoundingClientRect: () => ({
        x: clientX,
        y: clientY,
        width: 0,
        height: 0,
        top: clientY,
        left: clientX,
        right: clientX,
        bottom: clientY,
        toJSON() { return this },
      }),
    }

    computePosition(virtualEl as Element, menuEl, {
      placement: 'bottom-start',
      middleware: [offset(4), flip(), shift({ padding: 8 })],
    }).then(({ x, y }) => {
      if (menuEl) {
        menuEl.style.left = `${x}px`
        menuEl.style.top = `${y}px`
      }
    })
  }

  onMount(() => {
    positionMenu()
    const parent = menuEl?.parentElement
    if (parent) {
      parent.addEventListener('keydown', handleKeyDown)
    }
  })

  onDestroy(() => {
    const parent = menuEl?.parentElement
    if (parent) {
      parent.removeEventListener('keydown', handleKeyDown)
    }
  })

  // Track flat index across groups for rendering
  function getFlatIndex(groupIdx: number, itemIdx: number): number {
    let idx = 0
    for (let g = 0; g < groupIdx; g++) {
      idx += groups[g].items.length
    }
    return idx + itemIdx
  }
</script>

<div class="table-context-menu" bind:this={menuEl} role="menu" aria-label="Table actions">
  {#each groups as group, groupIdx}
    {#if groupIdx > 0}
      <div class="menu-separator" role="separator"></div>
    {/if}
    <div class="menu-group-label">{group.label}</div>
    {#each group.items as item, itemIdx}
      {@const flatIdx = getFlatIndex(groupIdx, itemIdx)}
      <button
        class="menu-item"
        class:selected={flatIdx === selectedIndex}
        class:disabled={item.disabled}
        role="menuitem"
        aria-disabled={item.disabled}
        onmousedown={(e) => {
          e.preventDefault()
          if (!item.disabled) item.action()
        }}
        onmouseenter={() => {
          selectedIndex = flatIdx
        }}
      >
        <span class="menu-icon material-symbols-outlined">{item.icon}</span>
        <span class="menu-label">{item.label}</span>
        {#if item.checked !== undefined}
          <span class="menu-check material-symbols-outlined">{item.checked ? 'check' : ''}</span>
        {/if}
      </button>
    {/each}
  {/each}
</div>

<style>
  .table-context-menu {
    position: fixed;
    z-index: var(--z-overlay, 40);
    min-width: 200px;
    max-height: 400px;
    overflow-y: auto;
    background: var(--color-surface, #161617);
    border: 1px solid var(--color-border, #27272a);
    border-radius: var(--radius-md, 6px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    padding: var(--space-1, 4px);
  }

  .menu-group-label {
    padding: var(--space-1, 4px) var(--space-3, 12px);
    color: var(--color-text-secondary, #a1a1aa);
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    user-select: none;
  }

  .menu-separator {
    height: 1px;
    background: var(--color-border, #27272a);
    margin: var(--space-1, 4px) 0;
  }

  .menu-item {
    display: flex;
    align-items: center;
    gap: var(--space-2, 8px);
    width: 100%;
    padding: var(--space-2, 8px) var(--space-3, 12px);
    border: none;
    border-radius: var(--radius-sm, 4px);
    background: transparent;
    color: var(--color-text, #e4e4e7);
    font-size: var(--text-sm, 13px);
    cursor: pointer;
    text-align: left;
    transition: background-color var(--transition-fast, 150ms ease);
  }

  .menu-item:hover,
  .menu-item.selected {
    background: var(--color-border, #27272a);
  }

  .menu-item.disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .menu-item.disabled:hover,
  .menu-item.disabled.selected {
    background: transparent;
  }

  .menu-icon {
    font-size: 18px;
    color: var(--color-text-secondary, #a1a1aa);
    width: 20px;
    text-align: center;
  }

  .menu-label {
    flex: 1;
  }

  .menu-check {
    font-size: 16px;
    color: var(--color-text-secondary, #a1a1aa);
    width: 16px;
    text-align: center;
  }

  @media (prefers-reduced-motion: reduce) {
    .menu-item {
      transition: none;
    }
  }
</style>
