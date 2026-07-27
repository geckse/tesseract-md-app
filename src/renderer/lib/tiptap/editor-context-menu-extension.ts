import { Extension } from '@tiptap/core'
import { NodeSelection, Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

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
              const target = event.target as HTMLElement | null
              const mediaElement = target?.closest('img, video, audio')
              if (mediaElement && view.dom.contains(mediaElement)) {
                try {
                  const position = view.posAtDOM(mediaElement, 0)
                  const mediaPosition =
                    view.state.doc.nodeAt(position)?.type.name === 'image' ||
                    view.state.doc.nodeAt(position)?.type.name === 'mediaEmbed'
                      ? position
                      : position - 1
                  const node = view.state.doc.nodeAt(mediaPosition)
                  if (node?.type.name === 'image' || node?.type.name === 'mediaEmbed') {
                    view.dispatch(
                      view.state.tr.setSelection(
                        NodeSelection.create(view.state.doc, mediaPosition)
                      )
                    )
                  }
                } catch {
                  // Fall back to the current selection if DOM position mapping fails.
                }
              }

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
