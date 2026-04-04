import { Editor, Extension, getMarkRange } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'
import { mount, unmount } from 'svelte'
import LinkBubble from '../../components/wysiwyg/LinkBubble.svelte'
import { navigateLink } from '../link-navigation'

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
          onNavigate: () => {
            closeBubble()
            navigateLink(url)
          },
          onEdit: () => {
            closeBubble()
            // Select the link text so the modal can wrap it
            editor.chain().focus().setTextSelection({ from, to }).run()
            view.dom.dispatchEvent(new CustomEvent('open-link-modal', {
              bubbles: true,
              detail: { initialQuery: url },
            }))
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

              // Don't show if the context menu is open
              if (document.querySelector('.context-menu')) {
                closeBubble()
                return
              }

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

              // Use TipTap's getMarkRange for accurate link extent
              const markRange = getMarkRange($pos, linkMark, link.attrs)
              const linkStart = markRange?.from ?? from
              const linkEnd = markRange?.to ?? from

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

/** Open the link modal by dispatching a custom event on the editor DOM. */
function showLinkPrompt(editor: InstanceType<typeof Editor>) {
  editor.view.dom.dispatchEvent(new CustomEvent('open-link-modal', { bubbles: true }))
}
