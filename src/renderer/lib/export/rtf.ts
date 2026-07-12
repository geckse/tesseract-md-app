/**
 * Markdown → RTF conversion for File > Export > RTF.
 *
 * Hand-rolled RTF 1.x subset built from the marked lexer token stream —
 * no extra dependencies. Fidelity limits (documented in the phase-43 PRD):
 * no real RTF tables (tab-separated rows), links flattened to `text (url)`
 * (no \field hyperlinks), images become `[image: alt]` placeholders, and
 * nested ordered lists restart literal numbering.
 */

import { marked, type Token, type Tokens } from 'marked'
import { stripFrontmatter } from '../markdown-structure'

/** Half-point font sizes for H1–H6 (body text is \fs24 = 12pt). */
const HEADING_SIZES = [48, 40, 34, 30, 28, 26]

/** Undo marked's HTML entity escaping before RTF-escaping. */
function unescapeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

/** Escape text for RTF: control characters, braces, and non-ASCII. */
export function escapeRtf(text: string): string {
  let out = ''
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0
    if (char === '\\' || char === '{' || char === '}') {
      out += '\\' + char
    } else if (char === '\n') {
      out += '\\line '
    } else if (char === '\t') {
      out += '\\tab '
    } else if (code > 127) {
      // RTF \u takes a signed 16-bit value; supplementary-plane chars are
      // emitted as their surrogate pair (standard RTF practice).
      if (code > 0xffff) {
        const high = 0xd800 + ((code - 0x10000) >> 10)
        const low = 0xdc00 + ((code - 0x10000) & 0x3ff)
        out += `\\u${high - 0x10000}?\\u${low - 0x10000}?`
      } else {
        out += `\\u${code > 0x7fff ? code - 0x10000 : code}?`
      }
    } else {
      out += char
    }
  }
  return out
}

function inlineTokensToRtf(tokens: Token[] | undefined): string {
  if (!tokens) return ''
  let out = ''
  for (const token of tokens) {
    switch (token.type) {
      case 'text': {
        const t = token as Tokens.Text
        out +=
          t.tokens && t.tokens.length > 0
            ? inlineTokensToRtf(t.tokens)
            : escapeRtf(unescapeEntities(t.text))
        break
      }
      case 'escape':
        out += escapeRtf((token as Tokens.Escape).text)
        break
      case 'strong':
        out += `{\\b ${inlineTokensToRtf((token as Tokens.Strong).tokens)}}`
        break
      case 'em':
        out += `{\\i ${inlineTokensToRtf((token as Tokens.Em).tokens)}}`
        break
      case 'del':
        out += `{\\strike ${inlineTokensToRtf((token as Tokens.Del).tokens)}}`
        break
      case 'codespan':
        out += `{\\f1 ${escapeRtf(unescapeEntities((token as Tokens.Codespan).text))}}`
        break
      case 'link': {
        const link = token as Tokens.Link
        const text = inlineTokensToRtf(link.tokens)
        const plain = unescapeEntities(link.text)
        out +=
          link.href === plain || link.href.startsWith('#')
            ? text
            : `${text} (${escapeRtf(link.href)})`
        break
      }
      case 'image': {
        const img = token as Tokens.Image
        out += img.text ? `{\\i [image: ${escapeRtf(img.text)}]}` : ''
        break
      }
      case 'br':
        out += '\\line '
        break
      case 'html':
        break
      default:
        if ('text' in token && typeof (token as { text?: unknown }).text === 'string') {
          out += escapeRtf(unescapeEntities((token as { text: string }).text))
        }
    }
  }
  return out
}

function listToRtf(list: Tokens.List, depth: number): string {
  const paragraphs: string[] = []
  const indent = 400 + depth * 400
  let index = typeof list.start === 'number' && list.start > 0 ? list.start : 1
  for (const item of list.items) {
    const marker = list.ordered ? `${index}.` : '\\bullet'
    const task = item.task ? (item.checked ? '[x] ' : '[ ] ') : ''
    const inlineParts: string[] = []
    const nestedParts: string[] = []
    for (const child of item.tokens) {
      if (child.type === 'list') {
        nestedParts.push(listToRtf(child as Tokens.List, depth + 1))
      } else if (child.type === 'text' || child.type === 'paragraph') {
        inlineParts.push(inlineTokensToRtf((child as Tokens.Text).tokens ?? [child]))
      } else {
        nestedParts.push(blockTokensToRtf([child]))
      }
    }
    paragraphs.push(
      `{\\pard\\li${indent}\\sa60 ${marker}\\tab ${task}${inlineParts.join(' ')}\\par}`
    )
    paragraphs.push(...nestedParts.filter(Boolean))
    index++
  }
  return paragraphs.join('\n')
}

function blockTokensToRtf(tokens: Token[]): string {
  const blocks: string[] = []
  for (const token of tokens) {
    switch (token.type) {
      case 'heading': {
        const heading = token as Tokens.Heading
        const size = HEADING_SIZES[Math.min(heading.depth, 6) - 1]
        blocks.push(
          `{\\pard\\sb240\\sa120\\b\\fs${size} ${inlineTokensToRtf(heading.tokens)}\\par}`
        )
        break
      }
      case 'paragraph':
        blocks.push(`{\\pard\\sa180 ${inlineTokensToRtf((token as Tokens.Paragraph).tokens)}\\par}`)
        break
      case 'list':
        blocks.push(listToRtf(token as Tokens.List, 0))
        break
      case 'code': {
        const code = escapeRtf((token as Tokens.Code).text)
        blocks.push(`{\\pard\\sa180\\f1\\fs20 ${code}\\par}`)
        break
      }
      case 'blockquote': {
        const inner = blockTokensToRtf((token as Tokens.Blockquote).tokens)
        // Re-indent every quoted paragraph
        blocks.push(inner.replace(/\{\\pard/g, '{\\pard\\li720'))
        break
      }
      case 'table': {
        const table = token as Tokens.Table
        const headerCells = table.header.map((c) => inlineTokensToRtf(c.tokens)).join('\\tab ')
        blocks.push(`{\\pard\\sa60\\b ${headerCells}\\par}`)
        for (const row of table.rows) {
          const cells = row.map((c) => inlineTokensToRtf(c.tokens)).join('\\tab ')
          blocks.push(`{\\pard\\sa60 ${cells}\\par}`)
        }
        break
      }
      case 'hr':
        blocks.push('{\\pard\\sa180\\qc \\emdash\\emdash\\emdash\\par}')
        break
      case 'space':
      case 'html':
        break
      default:
        if ('tokens' in token && Array.isArray((token as { tokens?: Token[] }).tokens)) {
          blocks.push(
            `{\\pard\\sa180 ${inlineTokensToRtf((token as { tokens: Token[] }).tokens)}\\par}`
          )
        }
    }
  }
  return blocks.join('\n')
}

/** Convert markdown (with optional frontmatter) to an RTF document. */
export function markdownToRtf(markdown: string): string {
  const body = stripFrontmatter(markdown)
  const tokens = marked.lexer(body)
  const content = blockTokensToRtf(tokens)
  return (
    '{\\rtf1\\ansi\\deff0\n' +
    '{\\fonttbl{\\f0 Helvetica;}{\\f1 Courier New;}}\n' +
    '\\fs24\n' +
    content +
    '\n}'
  )
}
