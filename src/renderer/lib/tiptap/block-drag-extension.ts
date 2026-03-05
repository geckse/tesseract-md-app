import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, NodeSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorView } from '@tiptap/pm/view'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { mount, unmount } from 'svelte'
import BlockToolbar from '../../components/wysiwyg/BlockToolbar.svelte'

const blockDragPluginKey = new PluginKey('blockDragHandles')

/** Block types eligible for drag handles (top-level nodes) */
function isTopLevelBlock(node: ProseMirrorNode): boolean {
  return node.isBlock && !node.isTextblock ? true : node.isTextblock
}

interface BlockHandleState {
  activePos: number | null
}

function createHandleWidget(pos: number, view: EditorView): HTMLElement {
  const wrapper = document.createElement('div')
  wrapper.classList.add('block-handle-wrapper')
  wrapper.contentEditable = 'false'

  // Drag grip handle
  const grip = document.createElement('button')
  grip.classList.add('block-handle-grip')
  grip.setAttribute('aria-label', 'Drag to reorder block')
  grip.setAttribute('draggable', 'true')
  grip.innerHTML = '⠿'

  grip.addEventListener('mousedown', (e) => {
    e.preventDefault()
    // Select the node for dragging
    const tr = view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos))
    view.dispatch(tr)
  })

  grip.addEventListener('dragstart', (e) => {
    // ProseMirror handles drag when node is selected
    const tr = view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos))
    view.dispatch(tr)
    // Let ProseMirror's built-in drag handling take over
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move'
    }
  })

  // Plus button for block type conversion
  const plus = document.createElement('button')
  plus.classList.add('block-handle-plus')
  plus.setAttribute('aria-label', 'Change block type')
  plus.innerHTML = '+'

  let toolbarPopup: HTMLElement | null = null
  let toolbarComponent: Record<string, unknown> | null = null

  function closeToolbar(): void {
    if (toolbarComponent) {
      unmount(toolbarComponent)
      toolbarComponent = null
    }
    if (toolbarPopup) {
      toolbarPopup.remove()
      toolbarPopup = null
    }
  }

  plus.addEventListener('click', (e) => {
    e.preventDefault()
    e.stopPropagation()

    if (toolbarPopup) {
      closeToolbar()
      return
    }

    toolbarPopup = document.createElement('div')
    toolbarPopup.classList.add('block-toolbar-popup')
    document.body.appendChild(toolbarPopup)

    const rect = plus.getBoundingClientRect()

    toolbarComponent = mount(BlockToolbar, {
      target: toolbarPopup,
      props: {
        editor: view,
        pos,
        anchorRect: rect,
        onClose: closeToolbar,
      },
    })

    // Close on outside click (delayed to avoid immediate close)
    setTimeout(() => {
      const handler = (ev: MouseEvent) => {
        if (toolbarPopup && !toolbarPopup.contains(ev.target as Node)) {
          closeToolbar()
          document.removeEventListener('click', handler)
        }
      }
      document.addEventListener('click', handler)
    }, 0)
  })

  wrapper.appendChild(grip)
  wrapper.appendChild(plus)
  return wrapper
}

export const BlockDragExtension = Extension.create({
  name: 'blockDragHandles',

  addProseMirrorPlugins() {
    const editor = this.editor

    return [
      new Plugin({
        key: blockDragPluginKey,
        state: {
          init(): BlockHandleState {
            return { activePos: null }
          },
          apply(_tr, value): BlockHandleState {
            return value
          },
        },
        props: {
          decorations(state) {
            const { doc } = state
            const decorations: Decoration[] = []

            doc.forEach((node, offset) => {
              if (isTopLevelBlock(node)) {
                const widget = Decoration.widget(offset, (view) => createHandleWidget(offset, view), {
                  side: -1,
                  key: `block-handle-${offset}`,
                })
                decorations.push(widget)
              }
            })

            return DecorationSet.create(doc, decorations)
          },
          handleDOMEvents: {
            drop(view, event) {
              // Let ProseMirror handle the drop for node reordering
              return false
            },
          },
        },
      }),
    ]
  },
})
