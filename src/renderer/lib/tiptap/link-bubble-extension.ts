import { Editor, Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { mount, unmount } from 'svelte'
import LinkBubble from '../../components/wysiwyg/LinkBubble.svelte'

const linkBubblePluginKey = new PluginKey('linkBubble')

/**
 * Shows a floating bubble toolbar when the cursor is on a link.
 * Allows editing the URL/text, copying the URL, or removing the link.
 */
export const LinkBubbleExtension = Extension.create({
  name: 'linkBubble',

  // Add Cmd+K shortcut to create/edit links
  addKeyboardShortcuts() {
    return {
      'Mod-k': () => {
        const { editor } = this
        const { state } = editor
        const { selection } = state
        const { from, to, empty } = selection

        // If cursor is on an existing link, the bubble will show via the plugin
        // If text is selected, wrap it in a link
        if (!empty) {
          const linkMark = state.schema.marks.link
          if (!linkMark) return false

          // Check if selection already has a link
          const hasLink = state.doc.rangeHasMark(from, to, linkMark)
          if (hasLink) {
            // Remove the link
            editor.chain().focus().unsetLink().run()
          } else {
            // Prompt for URL and apply link
            showLinkPrompt(editor)
          }
          return true
        }

        // Empty selection on a link — the bubble handles it
        const linkMark = state.schema.marks.link
        if (linkMark) {
          const marks = state.doc.resolve(from).marks()
          const existingLink = marks.find((m) => m.type === linkMark)
          if (existingLink) {
            editor.chain().focus().unsetLink().run()
            return true
          }
        }

        return false
      },
    }
  },

  addProseMirrorPlugins() {
    const editor = this.editor
    let popup: HTMLDivElement | null = null
    let component: Record<string, unknown> | null = null
    let activeFrom = -1
    let activeTo = -1

    function closeBubble() {
      if (component) {
        unmount(component)
        component = null
      }
      if (popup) {
        popup.remove()
        popup = null
      }
      activeFrom = -1
      activeTo = -1
    }

    function showBubble(
      view: EditorView,
      url: string,
      text: string,
      from: number,
      to: number,
      anchorEl: Element
    ) {
      closeBubble()
      activeFrom = from
      activeTo = to

      popup = document.createElement('div')
      popup.classList.add('link-bubble-popup')
      document.body.appendChild(popup)

      component = mount(LinkBubble, {
        target: popup,
        props: {
          url,
          text,
          anchorEl,
          onUpdateLink: (newUrl: string, newText: string) => {
            editor
              .chain()
              .focus()
              .setTextSelection({ from, to })
              .setLink({ href: newUrl })
              .command(({ tr }) => {
                // Update the text content if changed
                if (newText !== text) {
                  tr.insertText(newText, from, to)
                }
                return true
              })
              .run()
            closeBubble()
          },
          onRemoveLink: () => {
            editor.chain().focus().setTextSelection({ from, to }).unsetLink().run()
            closeBubble()
          },
          onClose: closeBubble,
        },
      })

      // Close on outside click
      setTimeout(() => {
        const handler = (ev: MouseEvent) => {
          if (popup && !popup.contains(ev.target as Node)) {
            closeBubble()
            document.removeEventListener('mousedown', handler)
          }
        }
        document.addEventListener('mousedown', handler)
      }, 0)
    }

    return [
      new Plugin({
        key: linkBubblePluginKey,
        view() {
          return {
            update(view, prevState) {
              const { state } = view
              const { selection } = state
              const { from, empty } = selection

              // Only show for cursor (not range selection)
              if (!empty) {
                closeBubble()
                return
              }

              const linkMark = state.schema.marks.link
              if (!linkMark) return

              // Check if cursor is inside a link
              const $pos = state.doc.resolve(from)
              const marks = $pos.marks()
              const link = marks.find((m) => m.type === linkMark)

              if (!link) {
                closeBubble()
                return
              }

              // Walk forward and backward from cursor to find link extent
              const start = $pos.start()
              let linkStart = from
              let linkEnd = from

              // Walk backward
              for (let i = from - 1; i >= start; i--) {
                const m = state.doc.resolve(i).marks()
                if (m.some((mk) => mk.type === linkMark && mk.attrs.href === link.attrs.href)) {
                  linkStart = i
                } else {
                  break
                }
              }

              // Walk forward
              const end = $pos.end()
              for (let i = from; i <= end; i++) {
                const m = state.doc.resolve(i).marks()
                if (m.some((mk) => mk.type === linkMark && mk.attrs.href === link.attrs.href)) {
                  linkEnd = i + 1
                } else {
                  break
                }
              }

              // Don't re-show if same link range
              if (linkStart === activeFrom && linkEnd === activeTo) return

              // Get the DOM element for positioning
              const linkText = state.doc.textBetween(linkStart, linkEnd)
              const domAtPos = view.domAtPos(from)
              const anchorNode = domAtPos.node
              const anchorEl =
                anchorNode instanceof Element
                  ? anchorNode.closest('a') || anchorNode
                  : anchorNode.parentElement?.closest('a') || anchorNode.parentElement

              if (!anchorEl) {
                closeBubble()
                return
              }

              showBubble(view, link.attrs.href, linkText, linkStart, linkEnd, anchorEl)
            },
            destroy() {
              closeBubble()
            },
          }
        },
      }),
    ]
  },
})

/** Prompt for a URL and apply as link to the current selection */
function showLinkPrompt(editor: InstanceType<typeof Editor>) {
  // For now, use a simple prompt. Can be replaced with inline UI later.
  const url = window.prompt('Enter URL:')
  if (url) {
    editor.chain().focus().setLink({ href: url }).run()
  }
}
