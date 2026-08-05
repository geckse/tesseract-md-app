import { describe, it, expect } from 'vitest'
import { renderMarkdown } from '@renderer/lib/markdown-render'

describe('renderMarkdown mermaid support', () => {
  it('converts mermaid code blocks to placeholder divs', () => {
    const md = '# Hello\n\n```mermaid\ngraph TD\n    A --> B\n```\n\nSome text'
    const html = renderMarkdown(md)
    expect(html).toContain('class="mermaid-preview"')
    expect(html).toContain('data-mermaid-code=')
    // Should NOT contain <pre><code> for mermaid blocks
    expect(html).not.toContain('class="language-mermaid"')
  })

  it('preserves encoded mermaid code in data attribute', () => {
    const code = 'graph TD\n    A --> B'
    const md = `\`\`\`mermaid\n${code}\n\`\`\``
    const html = renderMarkdown(md)
    const encoded = encodeURIComponent(code)
    expect(html).toContain(`data-mermaid-code="${encoded}"`)
  })

  it('still renders regular code blocks normally', () => {
    const md = '```javascript\nconsole.log("hi")\n```'
    const html = renderMarkdown(md)
    expect(html).not.toContain('mermaid-preview')
    expect(html).toContain('<code')
  })

  it('shows loading text in placeholder', () => {
    const md = '```mermaid\ngraph LR\n    X --> Y\n```'
    const html = renderMarkdown(md)
    expect(html).toContain('Loading diagram')
  })
})

describe('renderMarkdown wikilink support', () => {
  it('renders wikilinks as resolvable, hoverable local-link spans', () => {
    const html = renderMarkdown('See [[notes/roadmap#Next steps|the roadmap]].')

    expect(html).toContain('class="wikilink"')
    expect(html).toContain('data-wikilink-target="notes/roadmap"')
    expect(html).toContain('data-wikilink-anchor="Next steps"')
    expect(html).toContain('>the roadmap</span>')
  })

  it('escapes untrusted wikilink targets and labels', () => {
    const html = renderMarkdown('[[notes/"bad|<b>unsafe</b>]]')

    expect(html).not.toContain('<b>unsafe</b>')
    expect(html).toContain('&lt;b&gt;unsafe&lt;/b&gt;')
    expect(html).toContain('data-wikilink-target="notes/&quot;bad"')
  })
})

describe('renderMarkdown highlight support', () => {
  it('renders ==text== as a mark element', () => {
    const html = renderMarkdown('This is ==important== text')
    expect(html).toContain('<mark>important</mark>')
  })

  it('renders nested formatting inside a highlight', () => {
    const html = renderMarkdown('==with **bold** inside==')
    expect(html).toContain('<mark>with <strong>bold</strong> inside</mark>')
  })

  it('leaves unmatched delimiters as plain text', () => {
    const html = renderMarkdown('a == b compares values')
    expect(html).not.toContain('<mark>')
  })
})

describe('renderMarkdown colored highlight support', () => {
  it('renders =={N}text== with the slot variable style', () => {
    const html = renderMarkdown('A =={5}colored== highlight')
    expect(html).toContain(
      '<mark data-color="5" style="--highlight-slot-color: var(--highlight-color-5)">colored</mark>'
    )
  })

  it('renders uncolored highlights without color styling', () => {
    const html = renderMarkdown('A ==plain== highlight')
    expect(html).toContain('<mark>plain</mark>')
  })

  it('parses nested markdown inside a colored highlight', () => {
    const html = renderMarkdown('=={2}with **bold**==')
    expect(html).toContain('<strong>bold</strong>')
  })
})
