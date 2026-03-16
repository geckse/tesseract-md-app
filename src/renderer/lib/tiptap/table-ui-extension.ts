import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import type { ResolvedPos } from '@tiptap/pm/model'
import { mount, unmount } from 'svelte'

const tableUIPluginKey = new PluginKey('tableUI')

/**
 * Information about a resolved table cell at a given position.
 */
export interface CellInfo {
  /** ProseMirror position of the cell node */
  cellPos: number
  /** Zero-based row index */
  row: number
  /** Zero-based column index */
  col: number
  /** Total number of rows in the table */
  totalRows: number
  /** Total number of columns in the table */
  totalCols: number
  /** ProseMirror position of the table node */
  tablePos: number
  /** Whether the cell is a header cell (th) */
  isHeader: boolean
}

/**
 * Resolve cell info from a ProseMirror position inside a table.
 * Returns null if the position is not inside a table cell.
 */
export function resolveCellInfo($pos: ResolvedPos): CellInfo | null {
  // Walk up the depth to find a table cell (tableCell or tableHeader)
  let cellDepth = -1
  for (let d = $pos.depth; d >= 0; d--) {
    const node = $pos.node(d)
    if (node.type.name === 'tableCell' || node.type.name === 'tableHeader') {
      cellDepth = d
      break
    }
  }
  if (cellDepth < 0) return null

  // The row should be one level above the cell
  const rowDepth = cellDepth - 1
  if (rowDepth < 0) return null
  const rowNode = $pos.node(rowDepth)
  if (rowNode.type.name !== 'tableRow') return null

  // The table should be one level above the row
  const tableDepth = rowDepth - 1
  if (tableDepth < 0) return null
  const tableNode = $pos.node(tableDepth)
  if (tableNode.type.name !== 'table') return null

  const cellNode = $pos.node(cellDepth)
  const cellPos = $pos.before(cellDepth)
  const tablePos = $pos.before(tableDepth)

  // Use ProseMirror's index() to determine row and column
  const row = $pos.index(tableDepth)
  const col = $pos.index(rowDepth)

  const totalRows = tableNode.childCount
  const totalCols = tableNode.child(0).childCount

  return {
    cellPos,
    row,
    col,
    totalRows,
    totalCols,
    tablePos,
    isHeader: cellNode.type.name === 'tableHeader',
  }
}

/**
 * ProseMirror extension that provides table UI interactions:
 * - Right-click context menu on table cells
 * - Keyboard event forwarding to the context menu
 * - (Phase 2) Floating toolbar above focused tables
 */
export const TableUIExtension = Extension.create({
  name: 'tableUI',

  addProseMirrorPlugins() {
    const editor = this.editor

    // Context menu state
    let popup: HTMLDivElement | null = null
    let component: Record<string, unknown> | null = null
    let outsideClickHandler: ((ev: MouseEvent) => void) | null = null

    // Toolbar state (separate from context menu)
    let toolbarPopup: HTMLDivElement | null = null
    let toolbarComponent: Record<string, unknown> | null = null
    let activeTablePos = -1

    function closeMenu() {
      if (component) {
        unmount(component)
        component = null
      }
      if (popup) {
        popup.remove()
        popup = null
      }
      if (outsideClickHandler) {
        document.removeEventListener('mousedown', outsideClickHandler)
        outsideClickHandler = null
      }
    }

    function closeToolbar() {
      if (toolbarComponent) {
        unmount(toolbarComponent)
        toolbarComponent = null
      }
      if (toolbarPopup) {
        toolbarPopup.remove()
        toolbarPopup = null
      }
      activeTablePos = -1
    }

    function showToolbar(view: EditorView, cellInfo: CellInfo, tableEl: Element) {
      closeToolbar()
      activeTablePos = cellInfo.tablePos

      toolbarPopup = document.createElement('div')
      toolbarPopup.classList.add('table-toolbar-popup')
      document.body.appendChild(toolbarPopup)

      // Dynamic import allows graceful failure if the component doesn't exist yet.
      import('../../components/wysiwyg/TableToolbar.svelte')
        .then((module) => {
          if (!toolbarPopup) return // closed before import resolved
          const TableToolbar = module.default

          toolbarComponent = mount(TableToolbar, {
            target: toolbarPopup!,
            props: {
              tableEl,
              cellInfo,
              editor,
              onClose: closeToolbar,
            },
          })
        })
        .catch(() => {
          // TableToolbar.svelte doesn't exist yet - clean up
          if (toolbarPopup && !toolbarPopup.hasChildNodes()) {
            toolbarPopup.remove()
            toolbarPopup = null
          }
        })
    }

    function showContextMenu(
      _view: EditorView,
      cellInfo: CellInfo,
      clientX: number,
      clientY: number
    ) {
      closeMenu()

      popup = document.createElement('div')
      popup.classList.add('table-context-menu-popup')
      document.body.appendChild(popup)

      // Mount the TableContextMenu Svelte component (created in a later subtask).
      // Dynamic import allows graceful failure if the component doesn't exist yet.
      import('../../components/wysiwyg/TableContextMenu.svelte')
        .then((module) => {
          if (!popup) return // closed before import resolved
          const TableContextMenu = module.default

          component = mount(TableContextMenu, {
            target: popup!,
            props: {
              cellInfo,
              editor,
              clientX,
              clientY,
              onClose: closeMenu,
            },
          })
        })
        .catch(() => {
          // TableContextMenu.svelte doesn't exist yet - clean up
          if (popup && !popup.hasChildNodes()) {
            popup.remove()
            popup = null
          }
        })

      // Close on outside click (setTimeout(0) to avoid self-dismiss)
      setTimeout(() => {
        outsideClickHandler = (ev: MouseEvent) => {
          if (popup && !popup.contains(ev.target as Node)) {
            closeMenu()
          }
        }
        document.addEventListener('mousedown', outsideClickHandler)
      }, 0)
    }

    return [
      new Plugin({
        key: tableUIPluginKey,
        view() {
          return {
            update(view: EditorView) {
              const { state } = view
              const { selection } = state
              const { from } = selection

              const $pos = state.doc.resolve(from)
              const cellInfo = resolveCellInfo($pos)

              if (!cellInfo) {
                closeToolbar()
                return
              }

              // Don't re-mount if same table
              if (cellInfo.tablePos === activeTablePos) return

              // Find the <table> DOM element via view.domAtPos()
              const domAtPos = view.domAtPos(cellInfo.tablePos + 1)
              const domNode = domAtPos.node
              const tableEl =
                domNode instanceof Element
                  ? domNode.closest('table') || domNode
                  : domNode.parentElement?.closest('table') || domNode.parentElement

              if (!tableEl) {
                closeToolbar()
                return
              }

              showToolbar(view, cellInfo, tableEl)
            },
            destroy() {
              closeMenu()
              closeToolbar()
            },
          }
        },
        props: {
          handleDOMEvents: {
            contextmenu(view: EditorView, event: MouseEvent) {
              // Resolve the position under the click
              const pos = view.posAtCoords({
                left: event.clientX,
                top: event.clientY,
              })
              if (!pos) return false

              const $pos = view.state.doc.resolve(pos.pos)
              const cellInfo = resolveCellInfo($pos)
              if (!cellInfo) return false

              // Prevent browser default context menu
              event.preventDefault()

              showContextMenu(view, cellInfo, event.clientX, event.clientY)
              return true
            },

            keydown(_view: EditorView, event: KeyboardEvent) {
              // Forward keyboard events to the context menu if open
              if (!popup) return false

              const { key } = event
              if (
                key === 'ArrowUp' ||
                key === 'ArrowDown' ||
                key === 'Enter' ||
                key === 'Escape'
              ) {
                // Dispatch a synthetic keyboard event to the popup container
                const syntheticEvent = new KeyboardEvent('keydown', {
                  key: event.key,
                  code: event.code,
                  bubbles: true,
                  cancelable: true,
                })
                popup.dispatchEvent(syntheticEvent)
                event.preventDefault()
                return true
              }

              return false
            },
          },
        },
      }),
    ]
  },
})
