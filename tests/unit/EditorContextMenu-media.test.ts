import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/svelte'
import EditorContextMenu from '@renderer/components/wysiwyg/EditorContextMenu.svelte'
import { createWysiwygEditor } from '@renderer/lib/tiptap/editor-factory'

describe('EditorContextMenu media actions', () => {
  it('offers source editing after an image is selected by right-click', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const wysiwyg = createWysiwygEditor(host, '![Diagram](diagram.png)')
    const image = host.querySelector('img')
    const onclose = vi.fn()
    const oneditmedia = vi.fn()
    const originalElementFromPoint = document.elementFromPoint
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: () => image
    })

    image?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    render(EditorContextMenu, {
      props: {
        editor: wysiwyg.editor,
        x: 20,
        y: 20,
        onclose,
        oneditmedia
      }
    })

    await fireEvent.click(screen.getByRole('menuitem', { name: /Change Media Source/ }))

    expect(onclose).toHaveBeenCalledOnce()
    expect(oneditmedia).toHaveBeenCalledWith({
      kind: 'image',
      src: 'diagram.png',
      alt: 'Diagram'
    })

    wysiwyg.destroy()
    host.remove()
    if (originalElementFromPoint) {
      Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        value: originalElementFromPoint
      })
    } else {
      delete (document as Document & { elementFromPoint?: unknown }).elementFromPoint
    }
  })
})
