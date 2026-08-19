import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render } from '@testing-library/svelte'
import MediaBubbleMenu from '@renderer/components/wysiwyg/MediaBubbleMenu.svelte'
import { createWysiwygEditor } from '@renderer/lib/tiptap/editor-factory'
import { getSelectedMedia, shouldShowMediaBubbleMenu } from '@renderer/lib/tiptap/media-selection'

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
    wysiwyg.editor.view.focus()

    const onopenintab = vi.fn()
    const onopenexternal = vi.fn()
    const { getByRole, getByTitle } = render(MediaBubbleMenu, {
      props: {
        editor: wysiwyg.editor,
        onedit: vi.fn(),
        onopenintab,
        onopenexternal
      }
    })

    const openInTab = getByTitle('Open media in tab')
    const openExternal = getByTitle('Open media externally')
    const toolbar = getByRole('toolbar', { name: 'Media options' })
    await fireEvent.click(openInTab)
    expect(toolbar.isConnected).toBe(false)
    wysiwyg.editor.view.dispatch(wysiwyg.editor.state.tr.setMeta('mediaBubbleMenu', 'show'))
    await fireEvent.click(openExternal)

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

  it('dismisses the visible menu with Escape', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const wysiwyg = createWysiwygEditor(host, '![Diagram](diagram.png)')
    const editor = wysiwyg.editor
    editor.commands.setNodeSelection(0)
    editor.view.focus()

    const { getByRole } = render(MediaBubbleMenu, {
      props: {
        editor,
        onedit: vi.fn(),
        onopenintab: vi.fn(),
        onopenexternal: vi.fn()
      }
    })
    const toolbar = getByRole('toolbar', { name: 'Media options' })
    expect(toolbar.style.visibility).toBe('visible')

    await fireEvent.keyDown(window, { key: 'Escape' })

    expect(toolbar.isConnected).toBe(false)
    wysiwyg.destroy()
    host.remove()
  })

  it('only identifies an actual media node selection', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const wysiwyg = createWysiwygEditor(host, 'Before\n\n![Diagram](diagram.png)\n\nAfter')
    const editor = wysiwyg.editor
    const imagePosition = 8

    editor.commands.setTextSelection({ from: 1, to: 4 })
    expect(getSelectedMedia(editor)).toBeNull()

    editor.commands.setNodeSelection(imagePosition)
    expect(getSelectedMedia(editor)).toEqual({
      kind: 'image',
      src: 'diagram.png',
      alt: 'Diagram'
    })

    wysiwyg.destroy()
    host.remove()
  })

  it('requires the editor or menu to have focus before showing', () => {
    const host = document.createElement('div')
    const menu = document.createElement('div')
    const menuButton = document.createElement('button')
    menu.appendChild(menuButton)
    document.body.append(host, menu)
    const wysiwyg = createWysiwygEditor(host, '![Diagram](diagram.png)')
    const editor = wysiwyg.editor
    editor.commands.setNodeSelection(0)

    expect(
      shouldShowMediaBubbleMenu({ editor, element: menu, view: editor.view, state: editor.state })
    ).toBe(false)

    editor.view.focus()
    expect(
      shouldShowMediaBubbleMenu({ editor, element: menu, view: editor.view, state: editor.state })
    ).toBe(true)

    menuButton.focus()
    expect(
      shouldShowMediaBubbleMenu({ editor, element: menu, view: editor.view, state: editor.state })
    ).toBe(true)

    wysiwyg.destroy()
    host.remove()
    menu.remove()
  })
})
