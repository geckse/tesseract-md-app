import { describe, it, expect } from 'vitest'
import {
  parseHeadings,
  stripFrontmatter,
  slugify,
  assignSlugs,
  buildTocMarkdown,
  computeFixedHeadingLevels,
  fixHeadingHierarchyInText,
  shiftHeadingInLine,
  toggleInlineMark,
  setHeadingLevelInText,
  toggleBulletListInText,
  toggleOrderedListInText,
  toggleTaskListInText,
  toggleBlockquoteInText,
  buildTableMarkdown
} from '@renderer/lib/markdown-structure'

describe('stripFrontmatter', () => {
  it('strips a leading frontmatter block', () => {
    expect(stripFrontmatter('---\ntitle: X\n---\n# Hi\n')).toBe('# Hi\n')
  })

  it('returns content unchanged without frontmatter', () => {
    expect(stripFrontmatter('# Hi\n\n---\n')).toBe('# Hi\n\n---\n')
  })

  it('returns content unchanged when the fence never closes', () => {
    expect(stripFrontmatter('---\ntitle: X\n# Hi')).toBe('---\ntitle: X\n# Hi')
  })
})

describe('parseHeadings', () => {
  it('parses ATX headings with 1-indexed line numbers', () => {
    const headings = parseHeadings('# Title\n\ntext\n\n## Section\n\n### Sub\n')
    expect(headings).toEqual([
      { level: 1, text: 'Title', line: 1 },
      { level: 2, text: 'Section', line: 5 },
      { level: 3, text: 'Sub', line: 7 }
    ])
  })

  it('skips a leading frontmatter block', () => {
    const headings = parseHeadings('---\ntitle: Test\n---\n\n# Real\n')
    expect(headings).toEqual([{ level: 1, text: 'Real', line: 5 }])
  })

  it('skips headings inside fenced code blocks', () => {
    const headings = parseHeadings('# Real\n\n```\n# Fake\n```\n\n## After\n')
    expect(headings).toEqual([
      { level: 1, text: 'Real', line: 1 },
      { level: 2, text: 'After', line: 7 }
    ])
  })

  it('does not treat hashes without a space as headings', () => {
    expect(parseHeadings('#nope\n# Yes\n')).toEqual([{ level: 1, text: 'Yes', line: 2 }])
  })

  it('does not treat a mid-document --- (horizontal rule) as frontmatter', () => {
    const headings = parseHeadings('intro\n\n---\n\n# After HR\n')
    expect(headings).toEqual([{ level: 1, text: 'After HR', line: 5 }])
  })

  it('does not match setext headings (documented limitation)', () => {
    expect(parseHeadings('Title\n=====\n')).toEqual([])
  })
})

describe('slugify / assignSlugs', () => {
  it('builds GitHub-style slugs', () => {
    expect(slugify('Hello World!')).toBe('hello-world')
    expect(slugify("What's New?  ")).toBe('whats-new')
    expect(slugify('Über Ärger')).toBe('über-ärger')
  })

  it('suffixes duplicate slugs in document order', () => {
    const slugs = assignSlugs([
      { level: 2, text: 'Setup', line: 1 },
      { level: 2, text: 'Setup', line: 5 },
      { level: 2, text: 'Setup', line: 9 }
    ]).map((s) => s.slug)
    expect(slugs).toEqual(['setup', 'setup-1', 'setup-2'])
  })
})

describe('buildTocMarkdown', () => {
  it('builds a nested bullet list relative to the shallowest heading', () => {
    const toc = buildTocMarkdown([
      { level: 2, text: 'One', line: 1 },
      { level: 3, text: 'Deep', line: 3 },
      { level: 2, text: 'Two', line: 5 }
    ])
    expect(toc).toBe('- [One](#one)\n  - [Deep](#deep)\n- [Two](#two)')
  })

  it('returns empty string for no headings', () => {
    expect(buildTocMarkdown([])).toBe('')
  })
})

describe('computeFixedHeadingLevels', () => {
  it('caps skipped level jumps to +1', () => {
    expect(computeFixedHeadingLevels([1, 3, 2, 5])).toEqual([1, 2, 2, 3])
  })

  it('keeps the first heading level even when deep', () => {
    expect(computeFixedHeadingLevels([3, 4, 6])).toEqual([3, 4, 5])
  })

  it('leaves monotone documents unchanged', () => {
    expect(computeFixedHeadingLevels([1, 2, 3, 2, 1])).toEqual([1, 2, 3, 2, 1])
  })

  it('handles empty input', () => {
    expect(computeFixedHeadingLevels([])).toEqual([])
  })
})

describe('fixHeadingHierarchyInText', () => {
  it('rewrites only the skipping headings', () => {
    const input = '# A\n\n### Skipped\n\ntext\n'
    const result = fixHeadingHierarchyInText(input)
    expect(result.content).toBe('# A\n\n## Skipped\n\ntext\n')
    expect(result.changedLines).toBe(1)
  })

  it('is idempotent', () => {
    const once = fixHeadingHierarchyInText('# A\n#### B\n## C\n###### D\n')
    const twice = fixHeadingHierarchyInText(once.content)
    expect(twice.content).toBe(once.content)
    expect(twice.changedLines).toBe(0)
  })

  it('ignores headings in code fences', () => {
    const input = '# A\n```\n#### fake\n```\n'
    const result = fixHeadingHierarchyInText(input)
    expect(result.content).toBe(input)
    expect(result.changedLines).toBe(0)
  })
})

describe('shiftHeadingInLine', () => {
  it('promotes and demotes', () => {
    expect(shiftHeadingInLine('### Title', -1)).toBe('## Title')
    expect(shiftHeadingInLine('### Title', 1)).toBe('#### Title')
  })

  it('clamps at the boundaries (returns null when nothing changes)', () => {
    expect(shiftHeadingInLine('# Top', -1)).toBeNull()
    expect(shiftHeadingInLine('###### Bottom', 1)).toBeNull()
  })

  it('returns null for non-heading lines', () => {
    expect(shiftHeadingInLine('plain text', 1)).toBeNull()
    expect(shiftHeadingInLine('#nospace', 1)).toBeNull()
  })
})

describe('toggleInlineMark', () => {
  const doc = 'hello world'

  it('wraps a selection', () => {
    const result = toggleInlineMark(doc, 0, 5, '**')
    expect(result.changes).toEqual([
      { from: 0, to: 0, insert: '**' },
      { from: 5, to: 5, insert: '**' }
    ])
    expect(result.selection).toEqual({ anchor: 2, head: 7 })
  })

  it('unwraps when the markers are inside the selection', () => {
    const result = toggleInlineMark('**hello** world', 0, 9, '**')
    expect(result.changes).toEqual([{ from: 0, to: 9, insert: 'hello' }])
    expect(result.selection).toEqual({ anchor: 0, head: 5 })
  })

  it('unwraps when the markers surround the selection', () => {
    const result = toggleInlineMark('**hello** world', 2, 7, '**')
    expect(result.changes).toEqual([
      { from: 0, to: 2, insert: '' },
      { from: 7, to: 9, insert: '' }
    ])
    expect(result.selection).toEqual({ anchor: 0, head: 5 })
  })

  it('inserts a marker pair at an empty selection with the cursor inside', () => {
    const result = toggleInlineMark(doc, 5, 5, '*')
    expect(result.changes).toEqual([{ from: 5, to: 5, insert: '**' }])
    expect(result.selection).toEqual({ anchor: 6, head: 6 })
  })
})

describe('line-prefix helpers', () => {
  it('sets and clears heading levels', () => {
    expect(setHeadingLevelInText('one\ntwo', 2)).toBe('## one\n## two')
    expect(setHeadingLevelInText('### old', 1)).toBe('# old')
    expect(setHeadingLevelInText('## old', 0)).toBe('old')
  })

  it('toggles bullet lists', () => {
    expect(toggleBulletListInText('a\nb')).toBe('- a\n- b')
    expect(toggleBulletListInText('- a\n- b')).toBe('a\nb')
  })

  it('converts between list kinds instead of stacking prefixes', () => {
    expect(toggleBulletListInText('1. a\n2. b')).toBe('- a\n- b')
    expect(toggleOrderedListInText('- a\n- b')).toBe('1. a\n2. b')
  })

  it('numbers ordered lists sequentially, skipping blank lines', () => {
    expect(toggleOrderedListInText('a\n\nb')).toBe('1. a\n\n2. b')
  })

  it('toggles task lists', () => {
    expect(toggleTaskListInText('a')).toBe('- [ ] a')
    expect(toggleTaskListInText('- [x] a\n- [ ] b')).toBe('a\nb')
  })

  it('toggles blockquotes', () => {
    expect(toggleBlockquoteInText('a\nb')).toBe('> a\n> b')
    expect(toggleBlockquoteInText('> a\n> b')).toBe('a\nb')
  })

  it('builds a 3×3 table matching the slash-command default', () => {
    const table = buildTableMarkdown()
    const lines = table.split('\n')
    expect(lines).toHaveLength(4)
    expect(lines[0]).toBe('| Column 1 | Column 2 | Column 3 |')
    expect(lines[1]).toBe('| --- | --- | --- |')
  })
})
