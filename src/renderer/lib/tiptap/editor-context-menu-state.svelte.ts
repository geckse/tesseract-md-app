/**
 * Reactive state bridge for the editor context menu.
 * The TipTap extension writes to this state; the EditorContextMenu component reads it.
 */

interface EditorContextMenuState {
  x: number
  y: number
  open: boolean
}

export const editorContextMenuState: EditorContextMenuState = $state({
  x: 0,
  y: 0,
  open: false,
})
