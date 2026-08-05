import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/svelte'
import EditorContextMenu from '@renderer/components/wysiwyg/EditorContextMenu.svelte'
import { createWysiwygEditor } from '@renderer/lib/tiptap/editor-factory'

function setup(markdown: string, cursorPos: number) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const wysiwyg = createWysiwygEditor(host, markdown)
  wysiwyg.editor.commands.setTextSelection(cursorPos)
  const onclose = vi.fn()
  render(EditorContextMenu, {
    props: { editor: wysiwyg.editor, x: 20, y: 20, onclose }
  })
  return { wysiwyg, onclose }
}

describe('EditorContextMenu highlight colors', () => {
  it('shows the color palette only when the cursor is on a highlight', () => {
    const { wysiwyg } = setup('plain text with no highlight', 3)
    expect(screen.queryByText('Highlight Color')).toBeNull()
    expect(screen.queryByRole('menuitem', { name: /Remove Highlight/ })).toBeNull()
    wysiwyg.destroy()
  })

  it('offers accent swatches plus a default swatch on highlighted text', () => {
    const { wysiwyg } = setup('some ==highlighted== text', 8)
    expect(screen.getByText('Highlight Color')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Default highlight color' })).toBeTruthy()
    // 24 accent swatches (neutral palette deliberately skipped)
    expect(screen.getByRole('button', { name: 'Highlight color 1' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Highlight color 24' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Highlight color 25' })).toBeNull()
    expect(screen.queryByText(/neutral/i)).toBeNull()
    wysiwyg.destroy()
  })

  it('recolors the whole highlight from a collapsed cursor', async () => {
    const { wysiwyg, onclose } = setup('some ==highlighted== text', 8)

    await fireEvent.click(screen.getByRole('button', { name: 'Highlight color 6' }))

    expect(onclose).toHaveBeenCalled()
    expect(wysiwyg.getMarkdown()).toContain('=={5}highlighted==')
    wysiwyg.destroy()
  })

  it('marks the active color slot as selected and resets to default', async () => {
    const { wysiwyg } = setup('a =={5}colored== bit', 5)

    const active = screen.getByRole('button', { name: 'Highlight color 6' })
    expect(active.getAttribute('aria-pressed')).toBe('true')

    await fireEvent.click(screen.getByRole('button', { name: 'Default highlight color' }))
    expect(wysiwyg.getMarkdown()).toContain('==colored==')
    wysiwyg.destroy()
  })

  it('removes the highlight entirely via Remove Highlight', async () => {
    const { wysiwyg, onclose } = setup('some ==highlighted== text', 8)

    await fireEvent.click(screen.getByRole('menuitem', { name: /Remove Highlight/ }))

    expect(onclose).toHaveBeenCalled()
    expect(wysiwyg.getMarkdown()).toBe('some highlighted text')
    wysiwyg.destroy()
  })
})
