import { Mark, markInputRule, markPasteRule, mergeAttributes } from '@tiptap/core'
import type {
  JSONContent,
  MarkdownToken,
  MarkdownParseHelpers,
  MarkdownParseResult,
  MarkdownRendererHelpers,
  MarkdownTokenizer,
  MarkdownLexerConfiguration
} from '@tiptap/core'
import { PROPERTY_VALUE_ACCENT_COLOR_COUNT } from '../../../shared/value-colors'

export interface HighlightAttributes {
  /** Accent palette slot (0-based) or null for the default primary marker. */
  color?: number | null
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    highlight: {
      /** Set a highlight mark */
      setHighlight: (attributes?: HighlightAttributes) => ReturnType
      /** Toggle a highlight mark */
      toggleHighlight: (attributes?: HighlightAttributes) => ReturnType
      /** Remove a highlight mark */
      unsetHighlight: () => ReturnType
    }
  }
}

/**
 * Matches `==highlighted==` or `=={N}highlighted==` at the start of a string,
 * where `{N}` is an optional accent-palette color slot. The inner text must
 * not start or end with whitespace and must not contain a `==` sequence.
 *
 * Raw `<mark>` HTML is deliberately NOT used for colored highlights: marked
 * v17 splits paragraphs at inline HTML tags on the block level and re-joins
 * the pieces with newlines, corrupting the round-trip.
 */
export const highlightTokenRegex = /^==(?:\{(\d+)\})?(?!\s)((?:[^=\n]|=(?!=))+?)(?<!\s)==(?!=)/

export const inputRegex = /(?:^|\s)(==(?!\s+==)((?:[^=]+))==(?!\s+==))$/
export const pasteRegex = /(?:^|\s)(==(?!\s+==)((?:[^=]+))==(?!\s+==))/g

/** Parse and validate a palette slot; anything invalid becomes null (default). */
export function normalizeHighlightColor(raw: unknown): number | null {
  const slot = typeof raw === 'string' ? Number.parseInt(raw, 10) : raw
  if (typeof slot !== 'number' || !Number.isInteger(slot)) return null
  if (slot < 0 || slot >= PROPERTY_VALUE_ACCENT_COLOR_COUNT) return null
  return slot
}

/**
 * TipTap v3 Mark extension for marker-style text highlighting.
 *
 * Uses the Obsidian-compatible `==text==` markdown syntax and renders as a
 * `<mark>` element (styled in wysiwyg-theme.css). Colored highlights carry an
 * accent-palette slot and serialize as `=={N}text==`; the slot resolves to a
 * CSS variable kept in sync by apply-accent-color.ts, so highlight colors
 * follow the appearance's accent like Select field chips.
 */
export const Highlight = Mark.create({
  name: 'highlight',

  addOptions() {
    return {
      HTMLAttributes: {}
    }
  },

  addAttributes() {
    return {
      color: {
        default: null,
        parseHTML: (element: HTMLElement) =>
          normalizeHighlightColor(element.getAttribute('data-color')),
        renderHTML: (attributes: HighlightAttributes) => {
          const slot = normalizeHighlightColor(attributes.color)
          if (slot === null) return {}
          return {
            'data-color': String(slot),
            style: `--highlight-slot-color: var(--highlight-color-${slot})`
          }
        }
      }
    }
  },

  parseHTML() {
    return [{ tag: 'mark' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['mark', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0]
  },

  // Markdown tokenizer: teach marked.js to recognize ==...== and <mark> syntax
  markdownTokenizer: {
    name: 'highlight',
    level: 'inline',
    start: '==',
    tokenize(
      src: string,
      _tokens: MarkdownToken[],
      lexer: MarkdownLexerConfiguration
    ): MarkdownToken | undefined {
      const match = highlightTokenRegex.exec(src)
      if (!match) return undefined
      return {
        type: 'highlight',
        raw: match[0],
        text: match[2],
        color: normalizeHighlightColor(match[1] ?? null),
        tokens: lexer.inlineTokens(match[2])
      }
    }
  } satisfies MarkdownTokenizer,

  parseMarkdown(token: MarkdownToken, helpers: MarkdownParseHelpers): MarkdownParseResult {
    return helpers.applyMark('highlight', helpers.parseInline(token.tokens ?? []), {
      color: token.color ?? null
    })
  },

  renderMarkdown(node: JSONContent, helpers: MarkdownRendererHelpers): string {
    const slot = normalizeHighlightColor(node.attrs?.color)
    const content = helpers.renderChildren(node)
    if (slot === null) return `==${content}==`
    return `=={${slot}}${content}==`
  },

  addCommands() {
    return {
      setHighlight:
        (attributes?: HighlightAttributes) =>
        ({ commands }) => {
          return commands.setMark(this.name, attributes)
        },
      toggleHighlight:
        (attributes?: HighlightAttributes) =>
        ({ commands }) => {
          return commands.toggleMark(this.name, attributes)
        },
      unsetHighlight:
        () =>
        ({ commands }) => {
          return commands.unsetMark(this.name)
        }
    }
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-h': () => this.editor.commands.toggleHighlight()
    }
  },

  addInputRules() {
    return [
      markInputRule({
        find: inputRegex,
        type: this.type
      })
    ]
  },

  addPasteRules() {
    return [
      markPasteRule({
        find: pasteRegex,
        type: this.type
      })
    ]
  }
})
