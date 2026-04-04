import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

const blockDragPluginKey = new PluginKey('blockDragHandles')

// Unique MIME type so we can identify our own drags
export const BLOCK_DRAG_MIME = 'application/x-mdvdb-block-drag'

/**
 * Block drag handles that float in the left gutter.
 *
 * Uses a single absolutely-positioned overlay that follows the hovered block.
 * Drag-and-drop is handled entirely by us (not ProseMirror's internal drag)
 * because the handle lives outside PM's contenteditable.
 */
export const BlockDragExtension = Extension.create({
  name: 'blockDragHandles',

  addProseMirrorPlugins() {
    let wrapper: HTMLDivElement | null = null
    let currentBlockPos: number | null = null
    let currentBlockDom: Element | null = null
    // Source block info captured at dragstart, used at drop
    let dragSourcePos: number | null = null
    let dragSourceNodeSize: number | null = null
    // Prevents wrapper repositioning during an active block drag
    let isDraggingBlock = false

    function createWrapper(view: EditorView): HTMLDivElement {
      const el = document.createElement('div')
      el.classList.add('block-handle-wrapper')
      el.contentEditable = 'false'

      // Keep handles visible when hovering them
      el.addEventListener('mouseenter', () => {
        el.style.opacity = '1'
      })
      el.addEventListener('mouseleave', () => {
        el.style.opacity = '0'
      })

      // Drag grip
      const grip = document.createElement('button')
      grip.classList.add('block-handle-grip')
      grip.setAttribute('aria-label', 'Drag to reorder block')
      grip.setAttribute('draggable', 'true')
      grip.innerHTML = '<span class="material-symbols-outlined">drag_indicator</span>'

      grip.addEventListener('dragstart', (e) => {
        if (!e.dataTransfer || currentBlockPos == null) return
        const node = view.state.doc.nodeAt(currentBlockPos)
        if (!node) return

        isDraggingBlock = true

        // Remember source position for the drop handler
        dragSourcePos = currentBlockPos
        dragSourceNodeSize = node.nodeSize

        // Tag with our custom MIME so we can identify it on drop
        e.dataTransfer.setData(BLOCK_DRAG_MIME, String(currentBlockPos))
        e.dataTransfer.effectAllowed = 'move'

        // Use the actual block element as drag image, anchored at the mouse position
        if (currentBlockDom) {
          const blockRect = currentBlockDom.getBoundingClientRect()
          e.dataTransfer.setDragImage(
            currentBlockDom,
            e.clientX - blockRect.left,
            e.clientY - blockRect.top,
          )
        }
      })

      grip.addEventListener('dragend', () => {
        isDraggingBlock = false
        dragSourcePos = null
        dragSourceNodeSize = null
      })

      // Plus button
      const plus = document.createElement('button')
      plus.classList.add('block-handle-plus')
      plus.setAttribute('aria-label', 'Add block')
      plus.innerHTML = '<span class="material-symbols-outlined">add</span>'

      plus.addEventListener('mousedown', (e) => {
        e.preventDefault()
        e.stopPropagation()
        if (currentBlockPos == null) return

        try {
          const node = view.state.doc.nodeAt(currentBlockPos)
          if (!node) return
          const insertPos = currentBlockPos + node.nodeSize
          const paragraph = view.state.schema.nodes.paragraph
          const tr = view.state.tr.insert(
            insertPos,
            paragraph.create(null, view.state.schema.text('/'))
          )
          tr.setSelection(TextSelection.near(tr.doc.resolve(insertPos + 2)))
          view.dispatch(tr)
          view.focus()
        } catch {
          // ignore
        }
      })

      el.appendChild(grip)
      el.appendChild(plus)
      return el
    }

    /** Find the top-level block node at a mouse Y position */
    function findBlockAtY(view: EditorView, y: number): { pos: number; dom: Element } | null {
      const { doc } = view.state
      let result: { pos: number; dom: Element } | null = null

      doc.forEach((node, offset) => {
        if (result) return
        if (!node.isBlock) return
        try {
          const dom = view.nodeDOM(offset)
          if (!(dom instanceof Element)) return
          const rect = dom.getBoundingClientRect()
          if (y >= rect.top && y <= rect.bottom) {
            result = { pos: offset, dom }
          }
        } catch {
          // ignore
        }
      })

      return result
    }

    function showHandles(view: EditorView, blockDom: Element, pos: number): void {
      if (!wrapper) return
      currentBlockPos = pos
      currentBlockDom = blockDom

      const parent = view.dom.parentElement
      if (!parent) return

      const parentRect = parent.getBoundingClientRect()
      const blockRect = blockDom.getBoundingClientRect()
      const scrollTop = parent.scrollTop

      // Vertically center with the first line of the block
      const lineHeight = parseFloat(getComputedStyle(blockDom).lineHeight) || 25.5
      const handleHeight = 24
      const topOffset = (lineHeight - handleHeight) / 2

      const top = blockRect.top - parentRect.top + scrollTop + topOffset
      // Position handles just to the left of the text content
      const wrapperWidth = wrapper.offsetWidth || 49
      const left = blockRect.left - parentRect.left - wrapperWidth - 4
      wrapper.style.top = `${top}px`
      wrapper.style.left = `${Math.max(4, left)}px`
      wrapper.style.opacity = '1'
    }

    function hideHandles(): void {
      if (!wrapper) return
      wrapper.style.opacity = '0'
      currentBlockPos = null
      currentBlockDom = null
    }

    return [
      new Plugin({
        key: blockDragPluginKey,
        view(editorView) {
          wrapper = createWrapper(editorView)
          editorView.dom.parentElement?.appendChild(wrapper)

          return {
            destroy() {
              wrapper?.remove()
              wrapper = null
            },
          }
        },
        props: {
          handleDOMEvents: {
            mousemove(view, event) {
              // Don't reposition handles while dragging a block — moving the
              // grip element mid-drag cancels the drag in Chromium.
              if (isDraggingBlock) return false
              const block = findBlockAtY(view, event.clientY)
              if (block) {
                showHandles(view, block.dom, block.pos)
              } else {
                hideHandles()
              }
              return false
            },
            mouseleave() {
              if (isDraggingBlock) return false
              setTimeout(() => {
                if (wrapper && !wrapper.matches(':hover')) {
                  hideHandles()
                }
              }, 100)
              return false
            },
            dragover(view, event) {
              if (!event.dataTransfer) return false
              // Accept our block drags and file tree drops
              if (event.dataTransfer.types.includes(BLOCK_DRAG_MIME)) {
                event.preventDefault()
                event.stopPropagation()
                event.dataTransfer.dropEffect = 'move'
                return true
              }
              if (event.dataTransfer.types.includes('application/x-mdvdb-path')) {
                event.preventDefault()
                event.dataTransfer.dropEffect = 'link'
                return true
              }
              return false
            },
            drop(view, event) {
              if (!event.dataTransfer) return false

              // Handle file tree drops — insert wikilink, prevent PM from inserting text/plain
              const mdvdbPath = event.dataTransfer.getData('application/x-mdvdb-path')
              if (mdvdbPath) {
                event.preventDefault()
                const coords = { left: event.clientX, top: event.clientY }
                const dropPos = view.posAtCoords(coords)
                if (!dropPos) return true

                const filename = mdvdbPath.replace(/^.*\//, '').replace(/\.[^.]+$/, '')
                const wikilinkType = view.state.schema.nodes.wikilink
                if (wikilinkType) {
                  const node = wikilinkType.create({ target: filename, anchor: null, display: null })
                  const tr = view.state.tr.insert(dropPos.pos, node)
                  view.dispatch(tr)
                }
                return true
              }

              // Handle block drags
              if (!event.dataTransfer.types.includes(BLOCK_DRAG_MIME)) return false
              if (dragSourcePos == null || dragSourceNodeSize == null) return false

              event.preventDefault()
              event.stopPropagation()

              // Find drop position from mouse coordinates
              const dropCoords = view.posAtCoords({ left: event.clientX, top: event.clientY })
              if (!dropCoords) return true

              const sourcePos = dragSourcePos
              const sourceSize = dragSourceNodeSize
              dragSourcePos = null
              dragSourceNodeSize = null

              const sourceNode = view.state.doc.nodeAt(sourcePos)
              if (!sourceNode) return true

              // Resolve drop to a top-level block boundary
              const $drop = view.state.doc.resolve(dropCoords.pos)
              let insertBefore: number
              if ($drop.depth === 0) {
                // Between blocks at top level
                insertBefore = dropCoords.pos
              } else {
                // Inside a block — find the block boundary
                const blockStart = $drop.before(1)
                const blockEnd = $drop.after(1)
                const blockMid = (blockStart + blockEnd) / 2
                // Drop before or after the target block depending on mouse position
                insertBefore = dropCoords.pos < blockMid ? blockStart : blockEnd
              }

              // Don't move if dropping in the same position
              const sourceEnd = sourcePos + sourceSize
              if (insertBefore >= sourcePos && insertBefore <= sourceEnd) return true

              // Build the transaction: delete source, insert at adjusted position
              const tr = view.state.tr

              if (insertBefore > sourcePos) {
                // Moving down: insert first (positions after source are stable), then delete
                const adjustedInsert = insertBefore
                tr.insert(adjustedInsert, sourceNode)
                tr.delete(sourcePos, sourceEnd)
              } else {
                // Moving up: delete first, then insert at the (now-correct) position
                tr.delete(sourcePos, sourceEnd)
                tr.insert(insertBefore, sourceNode)
              }

              view.dispatch(tr)
              view.focus()
              return true
            },
          },
        },
      }),
    ]
  },
})
