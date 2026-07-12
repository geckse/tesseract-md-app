/**
 * Markdown → EPUB 3 conversion for File > Export > EPUB.
 *
 * Single-chapter EPUB built from the marked lexer token stream: XHTML is
 * emitted directly (not via the HTML preview pipeline) so the content
 * document is well-formed XML as the EPUB spec requires. Headings carry
 * GitHub-style slug ids (same `slugify` + duplicate suffixes as Insert TOC,
 * so in-document `#anchor` links keep working) and feed the nav document.
 *
 * Fidelity limits (phase-43 PRD): images become `[image: alt]` placeholders
 * (EPUB disallows remote images and there is no asset embedding), links to
 * files outside the book flatten to `text (target)`, and raw HTML is
 * dropped (same policy as the RTF/plain-text exporters).
 */

import { marked, type Token, type Tokens } from 'marked'
import { slugify, stripFrontmatter } from '../markdown-structure'
import { inlineTokensToText } from './text'
import { buildZip } from './zip'

export const EPUB_MIMETYPE = 'application/epub+zip'

export interface EpubOptions {
  /** dc:identifier — pass a fresh `urn:uuid:` per export. */
  identifier?: string
  /** dcterms:modified — ISO timestamp; milliseconds are stripped. */
  modified?: string
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Undo marked's HTML entity escaping before XML-escaping. */
function unescapeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

/** Hrefs that are valid inside an EPUB content document. */
function isPortableHref(href: string): boolean {
  return (
    href.startsWith('#') ||
    href.startsWith('http://') ||
    href.startsWith('https://') ||
    href.startsWith('mailto:')
  )
}

function inlineTokensToXhtml(tokens: Token[] | undefined): string {
  if (!tokens) return ''
  let out = ''
  for (const token of tokens) {
    switch (token.type) {
      case 'text': {
        const t = token as Tokens.Text
        out +=
          t.tokens && t.tokens.length > 0
            ? inlineTokensToXhtml(t.tokens)
            : escapeXml(unescapeEntities(t.text))
        break
      }
      case 'escape':
        out += escapeXml((token as Tokens.Escape).text)
        break
      case 'strong':
        out += `<strong>${inlineTokensToXhtml((token as Tokens.Strong).tokens)}</strong>`
        break
      case 'em':
        out += `<em>${inlineTokensToXhtml((token as Tokens.Em).tokens)}</em>`
        break
      case 'del':
        out += `<del>${inlineTokensToXhtml((token as Tokens.Del).tokens)}</del>`
        break
      case 'codespan':
        out += `<code>${escapeXml(unescapeEntities((token as Tokens.Codespan).text))}</code>`
        break
      case 'link': {
        const link = token as Tokens.Link
        const inner = inlineTokensToXhtml(link.tokens)
        // Relative links point outside the book — flatten like the RTF export
        out += isPortableHref(link.href)
          ? `<a href="${escapeXml(link.href)}">${inner}</a>`
          : `${inner} (${escapeXml(link.href)})`
        break
      }
      case 'image': {
        const img = token as Tokens.Image
        if (img.text) out += `<em>[image: ${escapeXml(img.text)}]</em>`
        break
      }
      case 'br':
        out += '<br/>'
        break
      case 'html':
        break
      default:
        if ('text' in token && typeof (token as { text?: unknown }).text === 'string') {
          out += escapeXml(unescapeEntities((token as { text: string }).text))
        }
    }
  }
  return out
}

interface NavEntry {
  text: string
  level: number
  slug: string
}

interface EpubContext {
  nav: NavEntry[]
  /** Duplicate-slug counters — same `-1`, `-2` suffix rule as assignSlugs. */
  slugCounts: Map<string, number>
}

function headingSlug(text: string, ctx: EpubContext): string {
  const base = slugify(text)
  const count = ctx.slugCounts.get(base) ?? 0
  ctx.slugCounts.set(base, count + 1)
  return count === 0 ? base : `${base}-${count}`
}

function listToXhtml(list: Tokens.List, ctx: EpubContext): string {
  const start =
    list.ordered && typeof list.start === 'number' && list.start > 1 ? ` start="${list.start}"` : ''
  const tag = list.ordered ? 'ol' : 'ul'
  const items = list.items
    .map((item) => {
      const task = item.task ? (item.checked ? '☑ ' : '☐ ') : ''
      const inlineParts: string[] = []
      const nestedParts: string[] = []
      for (const child of item.tokens) {
        if (child.type === 'list') {
          nestedParts.push(listToXhtml(child as Tokens.List, ctx))
        } else if (child.type === 'text' || child.type === 'paragraph') {
          inlineParts.push(inlineTokensToXhtml((child as Tokens.Text).tokens ?? [child]))
        } else {
          nestedParts.push(blockTokensToXhtml([child], ctx))
        }
      }
      return `<li>${escapeXml(task)}${inlineParts.join(' ')}${nestedParts.join('')}</li>`
    })
    .join('')
  return `<${tag}${start}>${items}</${tag}>`
}

function tableToXhtml(table: Tokens.Table): string {
  const alignStyle = (col: number): string => {
    const align = table.align[col]
    return align === 'center' || align === 'right' ? ` style="text-align:${align}"` : ''
  }
  const header =
    '<thead><tr>' +
    table.header
      .map((c, i) => `<th${alignStyle(i)}>${inlineTokensToXhtml(c.tokens)}</th>`)
      .join('') +
    '</tr></thead>'
  const body =
    '<tbody>' +
    table.rows
      .map(
        (row) =>
          '<tr>' +
          row.map((c, i) => `<td${alignStyle(i)}>${inlineTokensToXhtml(c.tokens)}</td>`).join('') +
          '</tr>'
      )
      .join('') +
    '</tbody>'
  return `<table>${header}${body}</table>`
}

function blockTokensToXhtml(tokens: Token[], ctx: EpubContext): string {
  const blocks: string[] = []
  for (const token of tokens) {
    switch (token.type) {
      case 'heading': {
        const heading = token as Tokens.Heading
        const level = Math.min(heading.depth, 6)
        const text = inlineTokensToText(heading.tokens)
        const slug = headingSlug(text, ctx)
        ctx.nav.push({ text, level, slug })
        blocks.push(
          `<h${level} id="${escapeXml(slug)}">${inlineTokensToXhtml(heading.tokens)}</h${level}>`
        )
        break
      }
      case 'paragraph':
        blocks.push(`<p>${inlineTokensToXhtml((token as Tokens.Paragraph).tokens)}</p>`)
        break
      case 'list':
        blocks.push(listToXhtml(token as Tokens.List, ctx))
        break
      case 'code': {
        const code = token as Tokens.Code
        const lang = code.lang ? ` class="language-${escapeXml(code.lang)}"` : ''
        blocks.push(`<pre><code${lang}>${escapeXml(code.text)}</code></pre>`)
        break
      }
      case 'blockquote':
        blocks.push(
          `<blockquote>${blockTokensToXhtml((token as Tokens.Blockquote).tokens, ctx)}</blockquote>`
        )
        break
      case 'table':
        blocks.push(tableToXhtml(token as Tokens.Table))
        break
      case 'hr':
        blocks.push('<hr/>')
        break
      case 'space':
      case 'html':
        break
      default:
        if ('tokens' in token && Array.isArray((token as { tokens?: Token[] }).tokens)) {
          blocks.push(`<p>${inlineTokensToXhtml((token as { tokens: Token[] }).tokens)}</p>`)
        }
    }
  }
  return blocks.join('\n')
}

function xhtmlShell(title: string, bodyContent: string, isNav: boolean): string {
  const epubNs = isNav ? ' xmlns:epub="http://www.idpf.org/2007/ops"' : ''
  return (
    '<?xml version="1.0" encoding="utf-8"?>\n<!DOCTYPE html>\n' +
    `<html xmlns="http://www.w3.org/1999/xhtml"${epubNs}>\n<head>\n` +
    `<title>${escapeXml(title)}</title>\n` +
    '<link rel="stylesheet" type="text/css" href="style.css"/>\n' +
    `</head>\n<body>\n${bodyContent}\n</body>\n</html>\n`
  )
}

/** Build the nested `<ol>` of the EPUB nav from the collected headings. */
export function buildNavList(entries: NavEntry[], fallbackTitle: string): string {
  if (entries.length === 0) {
    return `<ol><li><a href="content.xhtml">${escapeXml(fallbackTitle)}</a></li></ol>`
  }
  const minLevel = Math.min(...entries.map((e) => e.level))
  let out = '<ol>'
  let prevDepth = 0
  entries.forEach((entry, index) => {
    let depth = entry.level - minLevel
    if (depth > prevDepth + 1) depth = prevDepth + 1 // clamp skipped levels
    if (index === 0) {
      depth = 0
    } else if (depth > prevDepth) {
      out += '<ol>'
    } else if (depth === prevDepth) {
      out += '</li>'
    } else {
      out += '</li>' + '</ol></li>'.repeat(prevDepth - depth)
    }
    out += `<li><a href="content.xhtml#${escapeXml(entry.slug)}">${escapeXml(entry.text)}</a>`
    prevDepth = depth
  })
  out += '</li>' + '</ol></li>'.repeat(prevDepth) + '</ol>'
  return out
}

const EPUB_CSS = `body { font-family: Georgia, serif; line-height: 1.5; }
h1, h2, h3, h4, h5, h6 { font-family: Helvetica, Arial, sans-serif; line-height: 1.25; }
code, pre { font-family: "Courier New", monospace; font-size: 0.9em; }
pre { background: #f2f2f2; padding: 0.6em; white-space: pre-wrap; }
code { background: #f2f2f2; }
blockquote { margin-left: 1em; padding-left: 0.8em; border-left: 3px solid #cccccc; color: #555555; }
table { border-collapse: collapse; }
th, td { border: 1px solid #999999; padding: 0.25em 0.5em; text-align: left; }
hr { border: 0; border-bottom: 1px solid #999999; }
`

const CONTAINER_XML =
  '<?xml version="1.0" encoding="utf-8"?>\n' +
  '<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">' +
  '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>' +
  '</container>'

function packageOpf(title: string, identifier: string, modified: string): string {
  return (
    '<?xml version="1.0" encoding="utf-8"?>\n' +
    '<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="pub-id">' +
    '<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">' +
    `<dc:identifier id="pub-id">${escapeXml(identifier)}</dc:identifier>` +
    `<dc:title>${escapeXml(title)}</dc:title>` +
    '<dc:language>en</dc:language>' +
    `<meta property="dcterms:modified">${escapeXml(modified)}</meta>` +
    '</metadata>' +
    '<manifest>' +
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>' +
    '<item id="doc" href="content.xhtml" media-type="application/xhtml+xml"/>' +
    '<item id="css" href="style.css" media-type="text/css"/>' +
    '</manifest>' +
    '<spine><itemref idref="doc"/></spine>' +
    '</package>'
  )
}

/** Convert markdown (with optional frontmatter) to a single-chapter .epub. */
export function markdownToEpub(markdown: string, title: string, options?: EpubOptions): Uint8Array {
  const body = stripFrontmatter(markdown)
  const tokens = marked.lexer(body)
  const ctx: EpubContext = { nav: [], slugCounts: new Map() }
  const content = blockTokensToXhtml(tokens, ctx)

  const identifier = options?.identifier ?? 'urn:tesseract:export'
  // dcterms:modified must be CCYY-MM-DDThh:mm:ssZ — strip fractional seconds
  const modified = (options?.modified ?? '1970-01-01T00:00:00Z').replace(/\.\d+Z$/, 'Z')

  const navBody =
    `<nav epub:type="toc" id="toc">\n<h1>${escapeXml(title)}</h1>\n` +
    buildNavList(ctx.nav, title) +
    '\n</nav>'

  // The EPUB OCF spec requires `mimetype` first and uncompressed (all
  // entries are STORED here, so ordering is the only constraint).
  return buildZip([
    { name: 'mimetype', data: EPUB_MIMETYPE },
    { name: 'META-INF/container.xml', data: CONTAINER_XML },
    { name: 'OEBPS/content.opf', data: packageOpf(title, identifier, modified) },
    { name: 'OEBPS/nav.xhtml', data: xhtmlShell(title, navBody, true) },
    { name: 'OEBPS/content.xhtml', data: xhtmlShell(title, content, false) },
    { name: 'OEBPS/style.css', data: EPUB_CSS }
  ])
}
