/**
 * Markdown → plain text conversion for File > Export > Plain Text.
 * Walks the marked lexer token stream (no HTML round-trip) so output is
 * deterministic and unit-testable.
 */

import { marked, type Token, type Tokens } from 'marked'
import { stripFrontmatter } from '../markdown-structure'

/** Undo the HTML entity escaping marked applies to some token text. */
function unescapeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

/** Flatten inline tokens to readable text. */
export function inlineTokensToText(tokens: Token[] | undefined): string {
  if (!tokens) return ''
  let out = ''
  for (const token of tokens) {
    switch (token.type) {
      case 'text': {
        const t = token as Tokens.Text
        out +=
          t.tokens && t.tokens.length > 0 ? inlineTokensToText(t.tokens) : unescapeEntities(t.text)
        break
      }
      case 'escape':
        out += (token as Tokens.Escape).text
        break
      case 'strong':
      case 'em':
      case 'del':
        out += inlineTokensToText((token as Tokens.Strong).tokens)
        break
      case 'codespan':
        out += unescapeEntities((token as Tokens.Codespan).text)
        break
      case 'link': {
        const link = token as Tokens.Link
        const text = inlineTokensToText(link.tokens)
        // Anchors and self-links add no information in plain text
        out += link.href === text || link.href.startsWith('#') ? text : `${text} (${link.href})`
        break
      }
      case 'image': {
        const img = token as Tokens.Image
        out += img.text ? `[${img.text}]` : ''
        break
      }
      case 'br':
        out += '\n'
        break
      case 'html':
        // Inline HTML: drop tags, keep nothing (raw tags aren't readable text)
        break
      default:
        if ('text' in token && typeof (token as { text?: unknown }).text === 'string') {
          out += unescapeEntities((token as { text: string }).text)
        }
    }
  }
  return out
}

function listToText(list: Tokens.List, indent: string): string {
  const lines: string[] = []
  let index = typeof list.start === 'number' && list.start > 0 ? list.start : 1
  for (const item of list.items) {
    const marker = list.ordered ? `${index}. ` : '• '
    const task = item.task ? (item.checked ? '[x] ' : '[ ] ') : ''
    // Split the item's block tokens: inline-ish content vs nested lists
    const inlineParts: string[] = []
    const nestedParts: string[] = []
    for (const child of item.tokens) {
      if (child.type === 'list') {
        nestedParts.push(listToText(child as Tokens.List, indent + '  '))
      } else if (child.type === 'text' || child.type === 'paragraph') {
        inlineParts.push(inlineTokensToText((child as Tokens.Text).tokens ?? [child]))
      } else {
        inlineParts.push(blockTokensToText([child], indent + '  ').trimEnd())
      }
    }
    lines.push(`${indent}${marker}${task}${inlineParts.join(' ').trim()}`)
    for (const nested of nestedParts) {
      if (nested) lines.push(nested)
    }
    index++
  }
  return lines.join('\n')
}

function blockTokensToText(tokens: Token[], indent = ''): string {
  const blocks: string[] = []
  for (const token of tokens) {
    switch (token.type) {
      case 'heading':
        blocks.push(indent + inlineTokensToText((token as Tokens.Heading).tokens))
        break
      case 'paragraph':
        blocks.push(indent + inlineTokensToText((token as Tokens.Paragraph).tokens))
        break
      case 'list':
        blocks.push(listToText(token as Tokens.List, indent))
        break
      case 'code':
        blocks.push(
          (token as Tokens.Code).text
            .split('\n')
            .map((l) => indent + l)
            .join('\n')
        )
        break
      case 'blockquote': {
        const inner = blockTokensToText((token as Tokens.Blockquote).tokens, indent)
        blocks.push(
          inner
            .split('\n')
            .map((l) => (l.trim() === '' ? l : `> ${l}`))
            .join('\n')
        )
        break
      }
      case 'table': {
        const table = token as Tokens.Table
        const rows = [
          table.header.map((c) => inlineTokensToText(c.tokens)).join('\t'),
          ...table.rows.map((row) => row.map((c) => inlineTokensToText(c.tokens)).join('\t'))
        ]
        blocks.push(rows.map((r) => indent + r).join('\n'))
        break
      }
      case 'hr':
        blocks.push(indent + '---')
        break
      case 'space':
      case 'html':
        break
      default:
        if ('tokens' in token && Array.isArray((token as { tokens?: Token[] }).tokens)) {
          blocks.push(indent + inlineTokensToText((token as { tokens: Token[] }).tokens))
        } else if ('text' in token && typeof (token as { text?: unknown }).text === 'string') {
          blocks.push(indent + unescapeEntities((token as { text: string }).text))
        }
    }
  }
  return blocks.filter((b) => b.trim() !== '').join('\n\n')
}

/** Convert markdown (with optional frontmatter) to readable plain text. */
export function markdownToPlainText(markdown: string): string {
  const body = stripFrontmatter(markdown)
  const tokens = marked.lexer(body)
  return blockTokensToText(tokens) + '\n'
}
