import { Node } from '@tiptap/core'
import type {
  JSONContent,
  MarkdownToken,
  MarkdownParseHelpers,
  MarkdownParseResult,
  MarkdownTokenizer,
  MarkdownLexerConfiguration
} from '@tiptap/core'
import { mount, unmount } from 'svelte'
import MermaidNodeView from '../../components/wysiwyg/MermaidNodeView.svelte'

/**
 * Serialize mermaid block node to markdown fenced code block.
 */
export function serializeMermaidBlock(code: string): string {
  return `\`\`\`mermaid\n${code}\n\`\`\`\n`
}

/**
 * TipTap Node extension for mermaid diagram blocks.
 *
 * In the WYSIWYG editor, mermaid blocks render as SVG diagrams by default
 * with an edit button that toggles to an editable code view.
 * Markdown round-trip: ```mermaid\n...\n``` ↔ mermaidBlock node.
 */
export const MermaidBlockExtension = Node.create({
  name: 'mermaidBlock',
  group: 'block',
  atom: true,
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      code: { default: '' }
    }
  },

  markdownTokenizer: {
    name: 'mermaidBlock',
    level: 'block',
    start: '```mermaid',
    tokenize(
      src: string,
      _tokens: MarkdownToken[],
      _lexer: MarkdownLexerConfiguration
    ): MarkdownToken | undefined {
      const match = src.match(/^```mermaid\n([\s\S]*?)```/)
      if (!match) return undefined
      return {
        type: 'mermaidBlock',
        raw: match[0],
        text: match[1].trimEnd()
      }
    }
  } satisfies MarkdownTokenizer,

  parseMarkdown(token: MarkdownToken, helpers: MarkdownParseHelpers): MarkdownParseResult {
    return helpers.createNode('mermaidBlock', { code: token.text ?? '' })
  },

  renderMarkdown(node: JSONContent): string {
    const code = (node.attrs?.code as string) ?? ''
    return serializeMermaidBlock(code)
  },

  renderHTML({ node }) {
    return [
      'div',
      { class: 'mermaid-block', 'data-mermaid-code': node.attrs.code as string },
      node.attrs.code as string
    ]
  },

  parseHTML() {
    return [
      {
        tag: 'div.mermaid-block[data-mermaid-code]',
        getAttrs(el) {
          const dom = el as HTMLElement
          return { code: dom.getAttribute('data-mermaid-code') ?? '' }
        }
      }
    ]
  },

  addNodeView() {
    return ({ node, getPos, editor }) => {
      const dom = document.createElement('div')
      dom.classList.add('mermaid-node-view')

      let component: Record<string, unknown> | null = null
      let currentNode = node

      const updateAttrs = (attrs: Record<string, unknown>) => {
        if (typeof getPos === 'function') {
          const pos = getPos()
          if (pos != null) {
            // Don't call .focus() — it would steal focus from the textarea
            editor.view.dispatch(
              editor.view.state.tr.setNodeMarkup(pos, undefined, {
                ...currentNode.attrs,
                ...attrs
              })
            )
          }
        }
      }

      component = mount(MermaidNodeView, {
        target: dom,
        props: {
          code: (node.attrs.code as string) ?? '',
          updateAttributes: updateAttrs,
          selected: false,
          editable: editor.isEditable
        }
      })

      return {
        dom,
        ignoreMutation: () => true,
        stopEvent: (event: Event) => {
          // Let the NodeView handle all events inside it (keyboard, mouse, focus)
          // so ProseMirror doesn't interfere with the textarea or toolbar buttons
          const target = event.target as HTMLElement | null
          if (target?.closest('.mermaid-code-editor')) return true
          if (target?.closest('.mermaid-toolbar-btn')) return true
          return false
        },
        update(updatedNode) {
          if (updatedNode.type.name !== 'mermaidBlock') return false
          currentNode = updatedNode
          // Re-mount with updated props (Svelte 5 requires remount for prop updates)
          if (component) {
            unmount(component)
          }
          component = mount(MermaidNodeView, {
            target: dom,
            props: {
              code: (updatedNode.attrs.code as string) ?? '',
              updateAttributes: updateAttrs,
              selected: false,
              editable: editor.isEditable
            }
          })
          return true
        },
        selectNode() {
          dom.classList.add('selected')
        },
        deselectNode() {
          dom.classList.remove('selected')
        },
        destroy() {
          if (component) {
            unmount(component)
            component = null
          }
        }
      }
    }
  }
})
