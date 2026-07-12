import { get } from 'svelte/store'
import { activeCollection } from '../stores/collections'
import { editorMode } from '../stores/editor'

/**
 * Open a new untitled note in a popped-out window (Cmd+N).
 *
 * The popup starts with empty content and no file on disk. The first save
 * (Cmd+S or the Save button) opens the Save As dialog where the user picks
 * a filename and target folder.
 *
 * @returns false when no collection is active (nothing to create a note in).
 */
export function openNewNotePopup(): boolean {
  const collection = get(activeCollection)
  if (!collection) return false

  void window.api.openPopup({
    kind: 'document',
    filePath: 'Untitled.md',
    isUntitled: true,
    editorMode: get(editorMode),
    collectionId: collection.id,
    collectionPath: collection.path
  })
  return true
}
