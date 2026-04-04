import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { editorContextMenuState } from './editor-context-menu-state.svelte'

/**
 * TipTap extension that intercepts the contextmenu DOM event at the
 * ProseMirror level and surfaces it via reactive state.
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
            contextmenu(_view: EditorView, event: MouseEvent) {
              event.preventDefault()
              editorContextMenuState.x = event.clientX
              editorContextMenuState.y = event.clientY
              editorContextMenuState.open = true
              return true
            },
          },
        },
      }),
    ]
  },
})
