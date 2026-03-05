import { Node } from '@tiptap/core'
import type {
  JSONContent,
  MarkdownToken,
  MarkdownParseHelpers,
  MarkdownParseResult,
  MarkdownTokenizer,
  MarkdownLexerConfiguration,
} from '@tiptap/core'

/**
 * Parse a wikilink raw string like `[[target]]`, `[[target#anchor]]`,
 * `[[target|display]]`, or `[[target#anchor|display]]`.
 */
export function parseWikilinkText(raw: string): {
  target: string
  anchor: string | null
  display: string | null
} {
  // Strip [[ and ]]
  const inner = raw.slice(2, -2)
  let target: string
  let anchor: string | null = null
  let display: string | null = null

  const pipeIdx = inner.indexOf('|')
  if (pipeIdx !== -1) {
    display = inner.slice(pipeIdx + 1)
    const before = inner.slice(0, pipeIdx)
    const hashIdx = before.indexOf('#')
    if (hashIdx !== -1) {
      target = before.slice(0, hashIdx)
      anchor = before.slice(hashIdx + 1)
    } else {
      target = before
    }
  } else {
    const hashIdx = inner.indexOf('#')
    if (hashIdx !== -1) {
      target = inner.slice(0, hashIdx)
      anchor = inner.slice(hashIdx + 1)
    } else {
      target = inner
    }
  }

  return { target, anchor: anchor || null, display: display || null }
}

/**
 * Serialize wikilink attributes back to markdown string.
 */
export function serializeWikilink(attrs: {
  target: string
  anchor: string | null
  display: string | null
}): string {
  let result = attrs.target
  if (attrs.anchor) {
    result += `#${attrs.anchor}`
  }
  if (attrs.display) {
    result += `|${attrs.display}`
  }
  return `[[${result}]]`
}

/**
 * TipTap v3 Node extension for wikilinks ([[target]], [[target#anchor]], [[target|display]]).
 */
export const Wikilink = Node.create({
  name: 'wikilink',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      target: { default: '' },
      anchor: { default: null },
      display: { default: null },
    }
  },

  // Markdown tokenizer: teach marked.js to recognize [[...]] syntax
  markdownTokenizer: {
    name: 'wikilink',
    level: 'inline',
    start: '[[',
    tokenize(
      src: string,
      _tokens: MarkdownToken[],
      _lexer: MarkdownLexerConfiguration
    ): MarkdownToken | undefined {
      const match = src.match(/^\[\[([^\]]+)\]\]/)
      if (!match) return undefined
      const raw = match[0]
      const parsed = parseWikilinkText(raw)
      return {
        type: 'wikilink',
        raw,
        text: raw,
        target: parsed.target,
        anchor: parsed.anchor,
        display: parsed.display,
      }
    },
  } satisfies MarkdownTokenizer,

  parseMarkdown(
    token: MarkdownToken,
    helpers: MarkdownParseHelpers
  ): MarkdownParseResult {
    return helpers.createNode('wikilink', {
      target: token.target ?? '',
      anchor: token.anchor ?? null,
      display: token.display ?? null,
    })
  },

  renderMarkdown(node: JSONContent): string {
    const attrs = node.attrs ?? {}
    return serializeWikilink({
      target: attrs.target ?? '',
      anchor: attrs.anchor ?? null,
      display: attrs.display ?? null,
    })
  },

  // ProseMirror DOM serialization for clipboard
  renderHTML({ node }) {
    const target = node.attrs.target as string
    const anchor = node.attrs.anchor as string | null
    const display = node.attrs.display as string | null
    const label = display || (anchor ? `${target}#${anchor}` : target)

    return [
      'span',
      {
        class: 'wikilink',
        'data-wikilink-target': target,
        ...(anchor ? { 'data-wikilink-anchor': anchor } : {}),
        ...(display ? { 'data-wikilink-display': display } : {}),
        style: 'color: #00bcd4; cursor: pointer;',
      },
      label,
    ]
  },

  parseHTML() {
    return [
      {
        tag: 'span.wikilink[data-wikilink-target]',
        getAttrs(el) {
          const dom = el as HTMLElement
          return {
            target: dom.getAttribute('data-wikilink-target') ?? '',
            anchor: dom.getAttribute('data-wikilink-anchor') ?? null,
            display: dom.getAttribute('data-wikilink-display') ?? null,
          }
        },
      },
    ]
  },
})
