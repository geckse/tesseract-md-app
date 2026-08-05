import { marked, type TokenizerAndRendererExtension } from 'marked'
import type { JsonValue } from '../types/cli'

// Register mermaid extension: intercept ```mermaid code blocks and emit placeholder divs.
// Actual SVG rendering happens post-mount in MarkdownPreview.svelte via $effect.
const mermaidRenderer: TokenizerAndRendererExtension = {
  name: 'code',
  renderer(token) {
    // marked v15 passes a Token object; 'lang' is on the code token
    const t = token as { lang?: string; text?: string }
    if (t.lang === 'mermaid' && t.text != null) {
      const encoded = encodeURIComponent(t.text)
      return `<div class="mermaid-preview" data-mermaid-code="${encoded}"><div class="mermaid-loading">Loading diagram\u2026</div></div>`
    }
    return false // fall through to default renderer
  }
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      (
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;'
        }) as Record<string, string>
      )[character]
  )
}

const wikilinkRenderer: TokenizerAndRendererExtension = {
  name: 'wikilink',
  level: 'inline',
  start(src) {
    const index = src.indexOf('[[')
    return index >= 0 ? index : undefined
  },
  tokenizer(src) {
    const match = /^\[\[([^\]\r\n]+)\]\]/.exec(src)
    if (!match) return undefined

    const inner = match[1]
    const pipeIndex = inner.indexOf('|')
    const targetAndAnchor = pipeIndex >= 0 ? inner.slice(0, pipeIndex) : inner
    const display = pipeIndex >= 0 ? inner.slice(pipeIndex + 1) : null
    const hashIndex = targetAndAnchor.indexOf('#')
    const target = hashIndex >= 0 ? targetAndAnchor.slice(0, hashIndex) : targetAndAnchor
    const anchor = hashIndex >= 0 ? targetAndAnchor.slice(hashIndex + 1) : null
    if (!target) return undefined

    return {
      type: 'wikilink',
      raw: match[0],
      target,
      anchor,
      display
    }
  },
  renderer(token) {
    const wikilink = token as {
      target: string
      anchor: string | null
      display: string | null
    }
    const label =
      wikilink.display ||
      (wikilink.anchor ? `${wikilink.target}#${wikilink.anchor}` : wikilink.target)
    const anchorAttribute = wikilink.anchor
      ? ` data-wikilink-anchor="${escapeHtml(wikilink.anchor)}"`
      : ''
    return `<span class="wikilink" data-wikilink-target="${escapeHtml(wikilink.target)}"${anchorAttribute}>${escapeHtml(label)}</span>`
  }
}

const highlightRenderer: TokenizerAndRendererExtension = {
  name: 'highlight',
  level: 'inline',
  start(src) {
    const index = src.indexOf('==')
    return index >= 0 ? index : undefined
  },
  tokenizer(src) {
    const match = /^==(?:\{(\d+)\})?(?!\s)((?:[^=\n]|=(?!=))+?)(?<!\s)==(?!=)/.exec(src)
    if (!match) return undefined

    const token = {
      type: 'highlight',
      raw: match[0],
      text: match[2],
      color: match[1] != null ? Number.parseInt(match[1], 10) : null,
      tokens: []
    }
    this.lexer.inline(token.text, token.tokens)
    return token
  },
  renderer(token) {
    const inner = this.parser.parseInline(token.tokens ?? [])
    const slot = token.color as number | null
    if (slot === null || !Number.isInteger(slot)) return `<mark>${inner}</mark>`
    return `<mark data-color="${slot}" style="--highlight-slot-color: var(--highlight-color-${slot})">${inner}</mark>`
  }
}

marked.use({ extensions: [mermaidRenderer, wikilinkRenderer, highlightRenderer] })

/** Basic HTML sanitization to prevent XSS in Electron context. */
export function sanitizeHtml(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*["'][^"']*["']/gi, '')
    .replace(/\son\w+\s*=\s*[^\s>]*/gi, '')
    .replace(/javascript\s*:/gi, '')
    .replace(/<iframe\b[^>]*>.*?<\/iframe>/gi, '')
    .replace(/<object\b[^>]*>.*?<\/object>/gi, '')
    .replace(/<embed\b[^>]*\/?>/gi, '')
}

/** Strip frontmatter from markdown content, render to HTML, and sanitize. */
export function renderMarkdown(content: string): string {
  let body = content
  if (body.startsWith('---')) {
    const endIdx = body.indexOf('---', 3)
    if (endIdx !== -1) {
      body = body.slice(endIdx + 3).trimStart()
    }
  }
  try {
    const html = marked.parse(body, { async: false }) as string
    return sanitizeHtml(html)
  } catch {
    return '<p>Failed to render markdown.</p>'
  }
}

/** Format a JSON value for display. */
export function formatFrontmatterValue(value: JsonValue): string {
  if (value === null) return '—'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(formatFrontmatterValue).join(', ')
  return JSON.stringify(value)
}
