import { describe, expect, it } from 'vitest'
import {
  clipboardImageExtension,
  imageMarkdownReference,
  imageRelativePath,
  markdownFileDirectory,
  nearestHeadingBeforeOffset,
  nextAvailableImageStem,
  normalizeImageDirectory,
  suggestImageStem,
  validateImageDirectory,
  validateImageStem
} from '@renderer/lib/clipboard-image'

describe('clipboard image helpers', () => {
  it('preserves supported clipboard MIME extensions', () => {
    expect(clipboardImageExtension('image/png')).toBe('png')
    expect(clipboardImageExtension('image/jpeg')).toBe('jpg')
    expect(clipboardImageExtension('image/svg+xml')).toBe('svg')
    expect(clipboardImageExtension('image/tiff')).toBeNull()
  })

  it('uses the nearest heading before the cursor and ignores later headings', () => {
    const markdown = '# Document\n\nintro\n\n## Current Section\n\ncursor\n\n## Later Section\n'
    const cursor = markdown.indexOf('cursor') + 3

    expect(nearestHeadingBeforeOffset(markdown, cursor)).toBe('Current Section')
  })

  it('ignores headings in frontmatter and fenced code', () => {
    const markdown = '---\n# not a heading\n---\n# Real\n```\n## fake\n```\ntext\n'
    expect(nearestHeadingBeforeOffset(markdown, markdown.length)).toBe('Real')
  })

  it('combines document and section names without duplicating the title', () => {
    expect(suggestImageStem('notes/Project Plan.md', 'Architecture')).toBe(
      'project-plan-architecture'
    )
    expect(suggestImageStem('notes/Project Plan.md', 'Project Plan')).toBe('project-plan')
    expect(suggestImageStem('notes/Project Plan.md', 'Project Plan Architecture')).toBe(
      'project-plan-architecture'
    )
    expect(suggestImageStem('notes/Project Plan.md', null)).toBe('project-plan')
  })

  it('numbers collisions only within the selected directory', () => {
    const existing = [
      'notes/project-plan-section.png',
      'notes/project-plan-section-1.png',
      'elsewhere/project-plan-section-2.png'
    ]
    expect(nextAvailableImageStem('project-plan-section', 'png', 'notes', existing)).toBe(
      'project-plan-section-2'
    )
    expect(nextAvailableImageStem('project-plan-section', 'png', 'assets', existing)).toBe(
      'project-plan-section'
    )
  })

  it('normalizes folders and builds relative Markdown references safely', () => {
    expect(normalizeImageDirectory(' notes\\screenshots/ ')).toBe('notes/screenshots')
    expect(markdownFileDirectory('docs/guides/start.md')).toBe('docs/guides')
    expect(imageRelativePath('docs/images', 'diagram one', 'png')).toBe(
      'docs/images/diagram one.png'
    )
    expect(
      imageMarkdownReference(
        'docs/guides/start.md',
        'docs/images/diagram one.png',
        'diagram one.png'
      )
    ).toBe('![diagram one.png](<../images/diagram one.png>)')
  })

  it('rejects unsafe folders and filenames', () => {
    expect(validateImageDirectory('../outside')).toMatch(/cannot contain/i)
    expect(validateImageDirectory('/absolute')).toMatch(/inside the collection/i)
    expect(validateImageDirectory('.markdownvdb/assets')).toMatch(/internal folder/i)
    expect(validateImageDirectory('notes/screenshots')).toBeNull()

    expect(validateImageStem('../image', 'png')).toMatch(/path separators/i)
    expect(validateImageStem('image.png', 'png')).toMatch(/added automatically/i)
    expect(validateImageStem('CON', 'png')).toMatch(/unsupported/i)
    expect(validateImageStem('diagram', 'png')).toBeNull()
  })
})
