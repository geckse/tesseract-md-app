import { afterEach, describe, expect, it, vi } from 'vitest'
import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TableKit } from '@tiptap/extension-table'
import Image from '@tiptap/extension-image'
import { NodeSelection } from '@tiptap/pm/state'
import { EditorContextMenuExtension } from '@renderer/lib/tiptap/editor-context-menu-extension'
import { TableUIExtension } from '@renderer/lib/tiptap/table-ui-extension'
import { Wikilink } from '@renderer/lib/tiptap/wikilink-extension'

const editors: Editor[] = []
const hosts: HTMLElement[] = []

function createEditor(content: string): Editor {
  const host = document.createElement('div')
  document.body.append(host)
  hosts.push(host)

  const editor = new Editor({
    element: host,
    content,
    extensions: [
      StarterKit.configure({ link: { openOnClick: false } }),
      TableKit,
      TableUIExtension,
      EditorContextMenuExtension,
      Wikilink,
      Image
    ]
  })
  editors.push(editor)
  return editor
}

function rightClick(element: Element): MouseEvent {
  const event = new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: 40,
    clientY: 30
  })
  element.dispatchEvent(event)
  return event
}

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy()
  for (const host of hosts.splice(0)) host.remove()
  document.querySelectorAll('.table-context-menu').forEach((menu) => menu.remove())
})

describe('EditorContextMenuExtension', () => {
  it('selects a regular link before opening its context menu', () => {
    const editor = createEditor('<p>Before <a href="https://example.com">Example</a> after</p>')
    editor.commands.setTextSelection(1)
    const menuEvent = vi.fn()
    editor.view.dom.addEventListener('editor-contextmenu', menuEvent)

    const event = rightClick(editor.view.dom.querySelector('a')!)

    expect(event.defaultPrevented).toBe(true)
    expect(menuEvent).toHaveBeenCalledOnce()
    expect(editor.isActive('link')).toBe(true)
    expect(editor.getAttributes('link').href).toBe('https://example.com')
    expect(editor.state.selection.empty).toBe(false)
  })

  it('node-selects a wikilink before opening its context menu', () => {
    const editor = createEditor(
      '<p>Before <span class="wikilink" data-wikilink-target="notes/roadmap">Roadmap</span> after</p>'
    )
    editor.commands.setTextSelection(1)
    const menuEvent = vi.fn()
    editor.view.dom.addEventListener('editor-contextmenu', menuEvent)

    rightClick(editor.view.dom.querySelector('.wikilink')!)

    expect(menuEvent).toHaveBeenCalledOnce()
    expect(editor.state.selection).toBeInstanceOf(NodeSelection)
    expect(editor.isActive('wikilink')).toBe(true)
    expect(editor.getAttributes('wikilink').target).toBe('notes/roadmap')
  })

  it('uses the link menu instead of the table-cell menu for links inside tables', () => {
    const editor = createEditor(`
      <table>
        <tbody>
          <tr><td><p><a href="https://example.com/cell">Cell link</a></p></td></tr>
        </tbody>
      </table>
    `)
    editor.commands.setTextSelection(1)
    const menuEvent = vi.fn()
    editor.view.dom.addEventListener('editor-contextmenu', menuEvent)

    rightClick(editor.view.dom.querySelector('a')!)

    expect(menuEvent).toHaveBeenCalledOnce()
    expect(editor.isActive('link')).toBe(true)
    expect(editor.getAttributes('link').href).toBe('https://example.com/cell')
    expect(document.querySelector('.table-context-menu')).toBeNull()
  })

  it('clears a stale image selection when coordinate mapping fails on ordinary content', () => {
    const editor = createEditor('<p>Before</p><img src="diagram.png"><p>After</p>')
    editor.commands.setNodeSelection(8)
    expect(editor.isActive('image')).toBe(true)
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue(null)

    rightClick(editor.view.dom.querySelectorAll('p')[1])

    expect(editor.state.selection).not.toBeInstanceOf(NodeSelection)
    expect(editor.isActive('image')).toBe(false)
  })
})
