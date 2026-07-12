/**
 * Markdown → standalone HTML document for File > Export > HTML (and the
 * PDF export, which prints this same document via a hidden window).
 *
 * Builds on the app's existing renderMarkdown (marked v15, frontmatter
 * stripped, sanitized). Styling is a neutral readable stylesheet — not the
 * app's dark tokens — so exports read well anywhere.
 */

import { renderMarkdown } from '../markdown-render'

/** Escape text for safe embedding in HTML. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Convert an absolute filesystem path to a file:// URL. */
export function toFileUrl(absPath: string): string {
  let normalized = absPath.replace(/\\/g, '/')
  if (!normalized.startsWith('/')) normalized = '/' + normalized // Windows drive paths
  return 'file://' + normalized.split('/').map(encodeURIComponent).join('/')
}

/**
 * Rewrite relative <img src> attributes to absolute file:// URLs under the
 * collection root, so exported HTML/PDF resolves vault images.
 */
export function rewriteRelativeImageSrcs(html: string, collectionRoot: string): string {
  return html.replace(/(<img\b[^>]*?\ssrc=")([^"]+)(")/gi, (match, pre, src, post) => {
    if (/^(https?:|file:|data:|blob:|\/)/i.test(src)) return match
    const decoded = decodeURI(src)
    return pre + toFileUrl(collectionRoot.replace(/\/$/, '') + '/' + decoded) + post
  })
}

/**
 * Replace mermaid placeholder divs (emitted by the app's marked extension)
 * with a plain <pre> of the diagram source — exports have no mermaid runtime.
 */
export function replaceMermaidPlaceholders(html: string): string {
  return html.replace(
    /<div class="mermaid-preview" data-mermaid-code="([^"]*)">[\s\S]*?<\/div>/g,
    (_match, encoded) => {
      let source = ''
      try {
        source = decodeURIComponent(encoded)
      } catch {
        source = encoded
      }
      return `<pre class="mermaid-source"><code>${escapeHtml(source)}</code></pre>`
    }
  )
}

const EXPORT_STYLESHEET = `
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    color: #1f2328;
    background: #ffffff;
    line-height: 1.6;
    max-width: 720px;
    margin: 0 auto;
    padding: 3rem 1.5rem 5rem;
  }
  h1, h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.6em 0 0.6em; }
  h1 { font-size: 2em; border-bottom: 1px solid #d1d9e0; padding-bottom: 0.3em; }
  h2 { font-size: 1.5em; border-bottom: 1px solid #d1d9e0; padding-bottom: 0.3em; }
  h1:first-child { margin-top: 0; }
  a { color: #0969da; }
  code, pre {
    font-family: ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace;
    font-size: 0.875em;
  }
  code { background: #f0f2f5; padding: 0.15em 0.35em; border-radius: 4px; }
  pre { background: #f6f8fa; padding: 1em; border-radius: 6px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  blockquote { margin: 1em 0; padding: 0 1em; color: #59636e; border-left: 4px solid #d1d9e0; }
  table { border-collapse: collapse; margin: 1em 0; display: block; overflow-x: auto; }
  th, td { border: 1px solid #d1d9e0; padding: 6px 13px; }
  th { background: #f6f8fa; }
  img { max-width: 100%; }
  hr { border: none; border-top: 1px solid #d1d9e0; margin: 2em 0; }
  ul, ol { padding-left: 2em; }
  li + li { margin-top: 0.25em; }
  @media print {
    body { max-width: none; padding: 0; }
    pre { white-space: pre-wrap; }
  }
`

/**
 * Build a complete standalone HTML document from markdown.
 * `collectionRoot` (when known) makes relative vault images resolve.
 */
export function buildStandaloneHtml(
  title: string,
  markdown: string,
  opts: { collectionRoot?: string } = {}
): string {
  let body = renderMarkdown(markdown)
  body = replaceMermaidPlaceholders(body)
  if (opts.collectionRoot) {
    body = rewriteRelativeImageSrcs(body, opts.collectionRoot)
  }
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8" />',
    '<meta name="viewport" content="width=device-width, initial-scale=1" />',
    `<title>${escapeHtml(title)}</title>`,
    `<style>${EXPORT_STYLESHEET}</style>`,
    '</head>',
    '<body>',
    body,
    '</body>',
    '</html>',
    ''
  ].join('\n')
}
