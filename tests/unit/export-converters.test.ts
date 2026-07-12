import { describe, it, expect } from 'vitest'
import {
  buildStandaloneHtml,
  escapeHtml,
  rewriteRelativeImageSrcs,
  replaceMermaidPlaceholders,
  toFileUrl
} from '@renderer/lib/export/html'
import { markdownToPlainText } from '@renderer/lib/export/text'
import { markdownToRtf, escapeRtf } from '@renderer/lib/export/rtf'

describe('buildStandaloneHtml', () => {
  it('produces a full document with escaped title', () => {
    const html = buildStandaloneHtml('My <Doc> & Notes', '# Hello\n')
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('<title>My &lt;Doc&gt; &amp; Notes</title>')
    expect(html).toContain('<h1>Hello</h1>')
    expect(html).toContain('<style>')
  })

  it('strips frontmatter (via renderMarkdown)', () => {
    const html = buildStandaloneHtml('t', '---\ntitle: X\n---\n\n# Body\n')
    expect(html).not.toContain('title: X')
    expect(html).toContain('<h1>Body</h1>')
  })

  it('rewrites relative image srcs to file:// URLs when a root is given', () => {
    const html = buildStandaloneHtml('t', '![alt](assets/pic.png)\n', {
      collectionRoot: '/vault/my notes'
    })
    expect(html).toContain('src="file:///vault/my%20notes/assets/pic.png"')
  })

  it('replaces mermaid placeholders with a <pre> of the source', () => {
    const html = buildStandaloneHtml('t', '```mermaid\ngraph TD\n  A --> B\n```\n')
    expect(html).not.toContain('mermaid-preview')
    expect(html).toContain('<pre class="mermaid-source">')
    expect(html).toContain('graph TD')
  })
})

describe('html helpers', () => {
  it('escapeHtml escapes the four specials', () => {
    expect(escapeHtml('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;')
  })

  it('toFileUrl handles windows drive paths and spaces', () => {
    expect(toFileUrl('C:\\Users\\me\\file.png')).toBe('file:///C%3A/Users/me/file.png')
    expect(toFileUrl('/a b/c.png')).toBe('file:///a%20b/c.png')
  })

  it('rewriteRelativeImageSrcs leaves absolute/data/http srcs alone', () => {
    const html =
      '<img src="https://x/y.png"><img src="data:image/png;base64,x"><img src="/abs.png"><img src="rel.png">'
    const out = rewriteRelativeImageSrcs(html, '/root')
    expect(out).toContain('src="https://x/y.png"')
    expect(out).toContain('src="data:image/png;base64,x"')
    expect(out).toContain('src="/abs.png"')
    expect(out).toContain('src="file:///root/rel.png"')
  })

  it('replaceMermaidPlaceholders decodes the stored source', () => {
    const encoded = encodeURIComponent('graph LR\n  X --> Y & <Z>')
    const html = `<div class="mermaid-preview" data-mermaid-code="${encoded}"><div>Loading…</div></div>`
    const out = replaceMermaidPlaceholders(html)
    expect(out).toContain('X --&gt; Y &amp; &lt;Z&gt;')
    expect(out).not.toContain('mermaid-preview')
  })
})

describe('markdownToPlainText', () => {
  it('flattens headings, emphasis, and links', () => {
    const text = markdownToPlainText(
      '# Title\n\nSome **bold** and *italic* text with a [link](https://example.com).\n'
    )
    expect(text).toContain('Title')
    expect(text).toContain('Some bold and italic text with a link (https://example.com).')
    expect(text).not.toContain('**')
  })

  it('renders lists with bullets and numbers', () => {
    const text = markdownToPlainText('- one\n- two\n\n1. first\n2. second\n')
    expect(text).toContain('• one')
    expect(text).toContain('• two')
    expect(text).toContain('1. first')
    expect(text).toContain('2. second')
  })

  it('keeps code blocks verbatim and tables as tab-separated rows', () => {
    const text = markdownToPlainText(
      '```\nconst x = 1\n```\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n'
    )
    expect(text).toContain('const x = 1')
    expect(text).toContain('A\tB')
    expect(text).toContain('1\t2')
  })

  it('strips frontmatter and drops anchor link targets', () => {
    const text = markdownToPlainText('---\nk: v\n---\n\nSee [Setup](#setup).\n')
    expect(text).not.toContain('k: v')
    expect(text).toContain('See Setup.')
  })

  it('quotes blockquotes', () => {
    expect(markdownToPlainText('> quoted line\n')).toContain('> quoted line')
  })
})

describe('markdownToRtf', () => {
  it('produces a balanced RTF document with font table', () => {
    const rtf = markdownToRtf('# Title\n\nBody with **bold** and *italic*.\n')
    expect(rtf.startsWith('{\\rtf1\\ansi')).toBe(true)
    expect(rtf).toContain('\\fonttbl')
    const opens = (rtf.match(/(?<!\\)\{/g) ?? []).length
    const closes = (rtf.match(/(?<!\\)\}/g) ?? []).length
    expect(opens).toBe(closes)
  })

  it('sizes headings and styles inline marks', () => {
    const rtf = markdownToRtf('# H1\n\n## H2\n\n**b** *i* ~~s~~ `c`\n')
    expect(rtf).toContain('\\fs48 H1')
    expect(rtf).toContain('\\fs40 H2')
    expect(rtf).toContain('{\\b b}')
    expect(rtf).toContain('{\\i i}')
    expect(rtf).toContain('{\\strike s}')
    expect(rtf).toContain('{\\f1 c}')
  })

  it('escapes RTF specials and non-ASCII', () => {
    expect(escapeRtf('a{b}c\\d')).toBe('a\\{b\\}c\\\\d')
    expect(escapeRtf('ü')).toBe('\\u252?')
    expect(escapeRtf('€')).toBe('\\u8364?')
    // Astral plane → surrogate pair (U+1F600 = D83D DE00), both signed-negative
    expect(escapeRtf('😀')).toBe('\\u-10179?\\u-8704?')
  })

  it('renders lists with bullets and literal numbering', () => {
    const rtf = markdownToRtf('- one\n- two\n\n1. first\n2. second\n')
    expect(rtf).toContain('\\bullet\\tab one')
    expect(rtf).toContain('1.\\tab first')
    expect(rtf).toContain('2.\\tab second')
  })

  it('flattens links to text (url) and balanced braces survive weird input', () => {
    const rtf = markdownToRtf('[site](https://ex.com) and {braces} in text\n')
    expect(rtf).toContain('site (https://ex.com)')
    const opens = (rtf.match(/(?<!\\)\{/g) ?? []).length
    const closes = (rtf.match(/(?<!\\)\}/g) ?? []).length
    expect(opens).toBe(closes)
  })
})
