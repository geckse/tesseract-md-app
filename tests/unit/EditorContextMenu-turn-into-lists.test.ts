import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/svelte'
import EditorContextMenu from '@renderer/components/wysiwyg/EditorContextMenu.svelte'
import { createWysiwygEditor, type WysiwygEditor } from '@renderer/lib/tiptap/editor-factory'

// jsdom lacks layout APIs that ProseMirror's scroll-into-view needs after focus()
Object.defineProperty(globalThis.window, 'scrollBy', {
  configurable: true,
  value: vi.fn()
})
Object.defineProperty(globalThis.Range.prototype, 'getClientRects', {
  configurable: true,
  value: () => [new DOMRect(0, 0, 1, 1)] as unknown as DOMRectList
})
Object.defineProperty(globalThis.Element.prototype, 'getClientRects', {
  configurable: true,
  value: () => [new DOMRect(0, 0, 1, 1)] as unknown as DOMRectList
})

function setup(markdown: string): {
  wysiwyg: WysiwygEditor
  host: HTMLElement
  cleanup: () => void
} {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const wysiwyg = createWysiwygEditor(host, markdown, { onUpdate: () => {} })
  wysiwyg.editor.chain().focus().setTextSelection(2).run()
  render(EditorContextMenu, {
    props: { editor: wysiwyg.editor, x: 20, y: 20, onclose: vi.fn() }
  })
  return {
    wysiwyg,
    host,
    cleanup: () => {
      wysiwyg.destroy()
      host.remove()
    }
  }
}

describe('EditorContextMenu turn-into list conversions', () => {
  it('offers Todo List and converts a bullet list into a task list', async () => {
    const { wysiwyg, cleanup } = setup('- alpha\n- beta')
    expect(wysiwyg.editor.isActive('bulletList')).toBe(true)

    await fireEvent.click(screen.getByRole('menuitem', { name: 'checklist Todo List' }))

    expect(wysiwyg.editor.isActive('taskList')).toBe(true)
    expect(wysiwyg.editor.isActive('bulletList')).toBe(false)
    cleanup()
  })

  it('converts an ordered list into a task list', async () => {
    const { wysiwyg, cleanup } = setup('1. alpha\n2. beta')
    expect(wysiwyg.editor.isActive('orderedList')).toBe(true)

    await fireEvent.click(screen.getByRole('menuitem', { name: 'checklist Todo List' }))

    expect(wysiwyg.editor.isActive('taskList')).toBe(true)
    expect(wysiwyg.editor.isActive('orderedList')).toBe(false)
    cleanup()
  })

  it('converts a task list back into a bullet list', async () => {
    const { wysiwyg, cleanup } = setup('- [ ] alpha\n- [x] beta')
    expect(wysiwyg.editor.isActive('taskList')).toBe(true)

    await fireEvent.click(
      screen.getByRole('menuitem', { name: 'format_list_bulleted Bullet List' })
    )

    expect(wysiwyg.editor.isActive('bulletList')).toBe(true)
    expect(wysiwyg.editor.isActive('taskList')).toBe(false)
    cleanup()
  })

  it('converts a task list into a numbered list', async () => {
    const { wysiwyg, cleanup } = setup('- [ ] alpha\n- [x] beta')
    expect(wysiwyg.editor.isActive('taskList')).toBe(true)

    await fireEvent.click(
      screen.getByRole('menuitem', { name: 'format_list_numbered Numbered List' })
    )

    expect(wysiwyg.editor.isActive('orderedList')).toBe(true)
    expect(wysiwyg.editor.isActive('taskList')).toBe(false)
    cleanup()
  })

  it('marks Todo List as active when the cursor is inside a task list', () => {
    const { cleanup } = setup('- [ ] alpha')

    const item = screen.getByRole('menuitem', { name: 'checklist Todo List' })
    expect(item.classList.contains('active')).toBe(true)
    cleanup()
  })
})
