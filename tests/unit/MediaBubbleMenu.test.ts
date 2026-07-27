import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/svelte'
import MediaBubbleMenu from '@renderer/components/wysiwyg/MediaBubbleMenu.svelte'
import { createWysiwygEditor } from '@renderer/lib/tiptap/editor-factory'

describe('MediaBubbleMenu', () => {
  it('offers internal-tab and external opening for the selected media', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const wysiwyg = createWysiwygEditor(host, '![Diagram](diagram.png)')
    const image = host.querySelector('img')
    const originalElementFromPoint = document.elementFromPoint
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: () => image
    })
    image?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))

    const onopenintab = vi.fn()
    const onopenexternal = vi.fn()
    const { getByTitle } = render(MediaBubbleMenu, {
      props: {
        editor: wysiwyg.editor,
        onedit: vi.fn(),
        onopenintab,
        onopenexternal
      }
    })

    await fireEvent.click(getByTitle('Open media in tab'))
    await fireEvent.click(getByTitle('Open media externally'))

    const media = { kind: 'image', src: 'diagram.png', alt: 'Diagram' }
    expect(onopenintab).toHaveBeenCalledWith(media)
    expect(onopenexternal).toHaveBeenCalledWith(media)

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
