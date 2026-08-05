import { describe, it, expect } from 'vitest'
import {
  highlightTokenRegex,
  normalizeHighlightColor
} from '@renderer/lib/tiptap/highlight-extension'
import { createWysiwygEditor } from '@renderer/lib/tiptap/editor-factory'

describe('highlightTokenRegex', () => {
  it('matches simple highlight', () => {
    const match = highlightTokenRegex.exec('==important==')
    expect(match?.[0]).toBe('==important==')
    expect(match?.[1]).toBeUndefined()
    expect(match?.[2]).toBe('important')
  })

  it('matches a colored highlight with slot prefix', () => {
    const match = highlightTokenRegex.exec('=={5}important==')
    expect(match?.[0]).toBe('=={5}important==')
    expect(match?.[1]).toBe('5')
    expect(match?.[2]).toBe('important')
  })

  it('matches multi-word highlight', () => {
    const match = highlightTokenRegex.exec('==a whole section of text== and more')
    expect(match?.[0]).toBe('==a whole section of text==')
    expect(match?.[2]).toBe('a whole section of text')
  })

  it('does not match without closing delimiter', () => {
    expect(highlightTokenRegex.exec('==unclosed')).toBeNull()
  })

  it('does not match when inner text starts with whitespace', () => {
    expect(highlightTokenRegex.exec('== not a highlight==')).toBeNull()
  })

  it('does not match when inner text ends with whitespace', () => {
    expect(highlightTokenRegex.exec('==not a highlight ==')).toBeNull()
  })

  it('does not match empty highlight', () => {
    expect(highlightTokenRegex.exec('====')).toBeNull()
  })

  it('allows a single = inside the highlight', () => {
    const match = highlightTokenRegex.exec('==a = b==')
    expect(match?.[2]).toBe('a = b')
  })
})

describe('normalizeHighlightColor', () => {
  it('accepts valid accent slots as number or string', () => {
    expect(normalizeHighlightColor(0)).toBe(0)
    expect(normalizeHighlightColor(23)).toBe(23)
    expect(normalizeHighlightColor('7')).toBe(7)
  })

  it('rejects out-of-range, fractional, and non-numeric values', () => {
    expect(normalizeHighlightColor(-1)).toBeNull()
    expect(normalizeHighlightColor(24)).toBeNull()
    expect(normalizeHighlightColor(3.5)).toBeNull()
    expect(normalizeHighlightColor('abc')).toBeNull()
    expect(normalizeHighlightColor(null)).toBeNull()
    expect(normalizeHighlightColor(undefined)).toBeNull()
  })
})

describe('Highlight in the WYSIWYG editor', () => {
  function makeEditor(markdown: string) {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const wysiwyg = createWysiwygEditor(host, markdown)
    return { host, wysiwyg }
  }

  it('parses ==text== markdown into a <mark> element', () => {
    const { host, wysiwyg } = makeEditor('This is ==highlighted== text')
    const mark = host.querySelector('mark')
    expect(mark).not.toBeNull()
    expect(mark?.textContent).toBe('highlighted')
    wysiwyg.destroy()
  })

  it('serializes the highlight mark back to ==text== markdown', () => {
    const { wysiwyg } = makeEditor('This is ==highlighted== text')
    expect(wysiwyg.getMarkdown()).toContain('==highlighted==')
    wysiwyg.destroy()
  })

  it('supports nested formatting inside a highlight', () => {
    const { host, wysiwyg } = makeEditor('==with **bold** inside==')
    // Each text run renders with its own <mark> wrapper
    const marks = Array.from(host.querySelectorAll('mark'))
    expect(marks.map((m) => m.textContent).join('')).toBe('with bold inside')
    expect(host.querySelector('strong')?.textContent).toBe('bold')
    expect(wysiwyg.getMarkdown()).toContain('==with **bold** inside==')
    wysiwyg.destroy()
  })

  it('toggleHighlight applies and removes the mark on a selection', () => {
    const { host, wysiwyg } = makeEditor('plain text')
    const { editor } = wysiwyg

    editor.commands.setTextSelection({ from: 1, to: 6 })
    editor.commands.toggleHighlight()
    expect(editor.isActive('highlight')).toBe(true)
    expect(host.querySelector('mark')?.textContent).toBe('plain')
    expect(wysiwyg.getMarkdown()).toContain('==plain==')

    editor.commands.toggleHighlight()
    expect(editor.isActive('highlight')).toBe(false)
    expect(host.querySelector('mark')).toBeNull()
    wysiwyg.destroy()
  })

  it('round-trips a document with highlights unchanged', () => {
    const input = 'Before ==marked section== after'
    const { wysiwyg } = makeEditor(input)
    expect(wysiwyg.getMarkdown()).toBe(input)
    wysiwyg.destroy()
  })

  it('parses =={N}text== markdown into a colored highlight', () => {
    const { host, wysiwyg } = makeEditor('A =={3}colored== highlight')
    const mark = host.querySelector('mark')
    expect(mark?.textContent).toBe('colored')
    expect(mark?.getAttribute('data-color')).toBe('3')
    expect(mark?.getAttribute('style')).toContain('var(--highlight-color-3)')
    // Cursor inside the highlight exposes the color attribute
    wysiwyg.editor.commands.setTextSelection(5)
    expect(wysiwyg.editor.getAttributes('highlight').color).toBe(3)
    wysiwyg.destroy()
  })

  it('round-trips a colored highlight unchanged', () => {
    const input = 'A =={3}colored== highlight'
    const { wysiwyg } = makeEditor(input)
    expect(wysiwyg.getMarkdown()).toBe(input)
    wysiwyg.destroy()
  })

  it('treats an invalid color slot as the default highlight', () => {
    const { host, wysiwyg } = makeEditor('=={99}too big==')
    const mark = host.querySelector('mark')
    expect(mark).not.toBeNull()
    expect(mark?.getAttribute('data-color')).toBeNull()
    expect(wysiwyg.getMarkdown()).toBe('==too big==')
    wysiwyg.destroy()
  })

  it('setHighlight with a color slot serializes as =={N}text==', () => {
    const { host, wysiwyg } = makeEditor('color me')
    const { editor } = wysiwyg

    editor.commands.setTextSelection({ from: 1, to: 6 })
    editor.commands.setHighlight({ color: 5 })
    expect(host.querySelector('mark')?.getAttribute('data-color')).toBe('5')
    expect(wysiwyg.getMarkdown()).toContain('=={5}color==')

    // Recoloring an existing highlight replaces the slot
    editor.commands.setHighlight({ color: 11 })
    expect(wysiwyg.getMarkdown()).toContain('=={11}color==')

    // Clearing the color falls back to == syntax
    editor.commands.setHighlight({ color: null })
    expect(wysiwyg.getMarkdown()).toContain('==color==')
    wysiwyg.destroy()
  })

  it('supports nested formatting inside a colored highlight', () => {
    const input = '=={2}with **bold** inside=='
    const { host, wysiwyg } = makeEditor(input)
    expect(host.querySelector('strong')?.textContent).toBe('bold')
    expect(wysiwyg.getMarkdown()).toBe(input)
    wysiwyg.destroy()
  })
})
