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

marked.use({ extensions: [mermaidRenderer] })

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
