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
