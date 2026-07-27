import { Extension } from '@tiptap/core'
import { NodeSelection, Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

const WIKILINK_NODE_TYPES = new Set(['wikilink'])
const MEDIA_NODE_TYPES = new Set(['image', 'mediaEmbed'])

function selectNodeAtElement(
  view: EditorView,
  element: Element,
  nodeTypes: ReadonlySet<string>
): boolean {
  try {
    const mappedPosition = view.posAtDOM(element, 0)
    for (const position of [mappedPosition, mappedPosition - 1]) {
      if (position < 0 || position > view.state.doc.content.size) continue
      const node = view.state.doc.nodeAt(position)
      if (!node || !nodeTypes.has(node.type.name)) continue
      view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, position)))
      return true
    }
  } catch {
    // Fall through to coordinate-based text selection.
  }
  return false
}

/**
 * Align the ProseMirror selection with the element under a context click.
 * Browsers do not reliably move the editor selection on right-click, while
 * TipTap's `isActive()` and context actions are selection-driven.
 */
export function selectContextTarget(view: EditorView, event: MouseEvent): void {
  const target = event.target instanceof Element ? event.target : null
  if (target && view.dom.contains(target)) {
    const wikilink = target.closest('.wikilink[data-wikilink-target]')
    if (
      wikilink &&
      view.dom.contains(wikilink) &&
      selectNodeAtElement(view, wikilink, WIKILINK_NODE_TYPES)
    ) {
      return
    }

    const media = target.closest('img, video, audio')
    if (media && view.dom.contains(media) && selectNodeAtElement(view, media, MEDIA_NODE_TYPES)) {
      return
    }

    const link = target.closest('a[href]')
    if (link && view.dom.contains(link)) {
      try {
        const start = view.posAtDOM(link, 0)
        const end = view.posAtDOM(link, link.childNodes.length)
        const from = Math.max(0, Math.min(start, end))
        const to = Math.min(view.state.doc.content.size, Math.max(start, end))
        if (from < to) {
          view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)))
          return
        }
      } catch {
        // Fall through to coordinate-based text selection.
      }
    }
  }

  const position = view.posAtCoords({ left: event.clientX, top: event.clientY })
  if (!position) return

  const { selection } = view.state
  // Preserve a range selection when the user right-clicks inside it.
  if (!selection.empty && position.pos >= selection.from && position.pos <= selection.to) return

  const resolvedPosition = view.state.doc.resolve(
    Math.max(0, Math.min(position.pos, view.state.doc.content.size))
  )
  view.dispatch(view.state.tr.setSelection(TextSelection.near(resolvedPosition)))
}

/**
 * TipTap extension that intercepts the contextmenu DOM event at the
 * ProseMirror level and surfaces it as a bubbling DOM event.
 *
 * This is necessary because ProseMirror's EditorView intercepts DOM events
 * before they bubble to parent elements, so addEventListener on a parent
 * container never fires for contextmenu.
 *
 * Priority is set lower than the table-ui-extension so table cells get
 * their own specialized context menu. This extension only fires when
 * the table extension passes (returns false).
 */
export const EditorContextMenuExtension = Extension.create({
  name: 'editorContextMenu',

  // Lower priority than default so table-ui-extension runs first
  priority: 90,

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('editorContextMenu'),
        props: {
          handleDOMEvents: {
            contextmenu(view: EditorView, event: MouseEvent) {
              event.preventDefault()
              selectContextTarget(view, event)

              view.dom.dispatchEvent(
                new CustomEvent('editor-contextmenu', {
                  bubbles: true,
                  detail: { x: event.clientX, y: event.clientY }
                })
              )
              return true
            }
          }
        }
      })
    ]
  }
})
