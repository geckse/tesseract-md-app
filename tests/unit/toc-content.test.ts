import { describe, it, expect } from 'vitest'
import { buildTocTiptapJSON } from '@renderer/lib/tiptap/toc-content'

describe('buildTocTiptapJSON', () => {
  it('returns null for no headings', () => {
    expect(buildTocTiptapJSON([])).toBeNull()
  })

  it('builds a flat bulletList of linked items', () => {
    const toc = buildTocTiptapJSON([
      { level: 2, text: 'One', line: 1 },
      { level: 2, text: 'Two', line: 5 }
    ])!
    expect(toc.type).toBe('bulletList')
    expect(toc.content).toHaveLength(2)
    const first = toc.content![0]
    expect(first.type).toBe('listItem')
    const textNode = first.content![0].content![0]
    expect(textNode.text).toBe('One')
    expect(textNode.marks).toEqual([{ type: 'link', attrs: { href: '#one' } }])
  })

  it('nests deeper headings under the previous item', () => {
    const toc = buildTocTiptapJSON([
      { level: 1, text: 'Top', line: 1 },
      { level: 2, text: 'Child', line: 3 },
      { level: 1, text: 'Next', line: 5 }
    ])!
    expect(toc.content).toHaveLength(2)
    const top = toc.content![0]
    // listItem content: paragraph + nested bulletList
    expect(top.content).toHaveLength(2)
    expect(top.content![1].type).toBe('bulletList')
    expect(top.content![1].content![0].content![0].content![0].text).toBe('Child')
  })

  it('suffixes duplicate heading slugs', () => {
    const toc = buildTocTiptapJSON([
      { level: 1, text: 'Setup', line: 1 },
      { level: 1, text: 'Setup', line: 3 }
    ])!
    const hrefs = toc.content!.map(
      (item) => item.content![0].content![0].marks![0].attrs!.href as string
    )
    expect(hrefs).toEqual(['#setup', '#setup-1'])
  })
})
