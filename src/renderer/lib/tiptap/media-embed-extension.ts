import { Node } from '@tiptap/core'
import type {
  JSONContent,
  MarkdownLexerConfiguration,
  MarkdownParseHelpers,
  MarkdownParseResult,
  MarkdownToken,
  MarkdownTokenizer
} from '@tiptap/core'
import { serializeMediaEmbed, type MediaKind } from '../media-embed'

function decodeHtmlAttribute(value: string): string {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&')
}

function readAttribute(attributes: string, name: string): string {
  const match = attributes.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'))
  return match ? decodeHtmlAttribute(match[2]) : ''
}

export const MediaEmbedExtension = Node.create({
  name: 'mediaEmbed',
  group: 'block',
  atom: true,
  draggable: true,
  selectable: true,

  addAttributes() {
    return {
      kind: { default: 'video' },
      src: { default: '' },
      alt: { default: '' }
    }
  },

  markdownTokenizer: {
    name: 'mediaEmbed',
    level: 'block',
    start: '<',
    tokenize(
      src: string,
      _tokens: MarkdownToken[],
      _lexer: MarkdownLexerConfiguration
    ): MarkdownToken | undefined {
      const match = src.match(/^<(video|audio)\b([^>]*)>\s*<\/\1>\s*(?:\n|$)/i)
      if (!match) return undefined
      const mediaSrc = readAttribute(match[2], 'src')
      if (!mediaSrc) return undefined

      return {
        type: 'mediaEmbed',
        raw: match[0],
        kind: match[1].toLowerCase(),
        src: mediaSrc,
        alt: readAttribute(match[2], 'title')
      }
    }
  } satisfies MarkdownTokenizer,

  parseMarkdown(token: MarkdownToken, helpers: MarkdownParseHelpers): MarkdownParseResult {
    return helpers.createNode('mediaEmbed', {
      kind: token.kind ?? 'video',
      src: token.src ?? '',
      alt: token.alt ?? ''
    })
  },

  renderMarkdown(node: JSONContent): string {
    return `${serializeMediaEmbed({
      kind: (node.attrs?.kind as MediaKind) ?? 'video',
      src: (node.attrs?.src as string) ?? '',
      alt: (node.attrs?.alt as string) ?? ''
    })}\n`
  },

  renderHTML({ node }) {
    const kind = node.attrs.kind === 'audio' ? 'audio' : 'video'
    return [
      kind,
      {
        class: 'media-embed',
        controls: '',
        src: node.attrs.src as string,
        ...(node.attrs.alt ? { title: node.attrs.alt as string } : {})
      }
    ]
  },

  parseHTML() {
    return [
      {
        tag: 'video[src]',
        getAttrs: (element) => ({
          kind: 'video',
          src: (element as HTMLElement).getAttribute('src') ?? '',
          alt: (element as HTMLElement).getAttribute('title') ?? ''
        })
      },
      {
        tag: 'audio[src]',
        getAttrs: (element) => ({
          kind: 'audio',
          src: (element as HTMLElement).getAttribute('src') ?? '',
          alt: (element as HTMLElement).getAttribute('title') ?? ''
        })
      }
    ]
  }
})
