import type { Editor } from '@tiptap/core'
import { NodeSelection, type EditorState, type Selection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import type { MediaEmbed } from '../media-embed'

const MEDIA_NODE_TYPES = new Set(['image', 'mediaEmbed'])

/** True only when the selection itself is one media node. */
export function isMediaNodeSelection(selection: Selection): selection is NodeSelection {
  return selection instanceof NodeSelection && MEDIA_NODE_TYPES.has(selection.node.type.name)
}

/** Return the selected media without treating a nearby/range selection as media. */
export function getSelectedMedia(editor: Editor): MediaEmbed | null {
  const { selection } = editor.state
  if (!isMediaNodeSelection(selection)) return null

  const attrs = selection.node.attrs
  if (selection.node.type.name === 'image') {
    return { kind: 'image', src: attrs.src ?? '', alt: attrs.alt ?? '' }
  }

  return {
    kind: attrs.kind === 'audio' ? 'audio' : 'video',
    src: attrs.src ?? '',
    alt: attrs.alt ?? ''
  }
}

interface MediaBubbleMenuVisibility {
  editor: Editor
  element: HTMLElement
  view: EditorView
  state: EditorState
}

/**
 * BubbleMenu replaces TipTap's default predicate when a custom one is supplied,
 * so its focus/editability checks need to be retained here explicitly.
 */
export function shouldShowMediaBubbleMenu({
  editor,
  element,
  view,
  state
}: MediaBubbleMenuVisibility): boolean {
  const menuHasFocus = element.contains(document.activeElement)
  return (
    editor.isEditable && (view.hasFocus() || menuHasFocus) && isMediaNodeSelection(state.selection)
  )
}
