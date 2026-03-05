import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Placeholder } from '@tiptap/extensions'
import Typography from '@tiptap/extension-typography'
import { Markdown } from '@tiptap/markdown'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import { Wikilink } from './wikilink-extension'

export interface WysiwygEditorOptions {
  /** Callback fired on every content change */
  onUpdate?: (editor: Editor) => void
  /** Placeholder text shown when the editor is empty */
  placeholder?: string
  /** Whether the editor is editable */
  editable?: boolean
}

export interface WysiwygEditor {
  editor: Editor
  /** Get the current content as markdown */
  getMarkdown: () => string
  /** Replace the editor content with new markdown */
  setMarkdownContent: (markdown: string) => void
  /** Destroy the editor instance */
  destroy: () => void
}

/**
 * Create a configured TipTap WYSIWYG editor with markdown support.
 */
export function createWysiwygEditor(
  element: HTMLElement,
  content: string,
  options: WysiwygEditorOptions = {}
): WysiwygEditor {
  const editor = new Editor({
    element,
    content,
    editable: options.editable ?? true,
    extensions: [
      StarterKit.configure({
        codeBlock: false, // Replaced by CodeBlockLowlight later
      }),
      Placeholder.configure({
        placeholder: options.placeholder ?? 'Type / for commands...',
      }),
      Typography.configure({
        // Disable smart quotes and other auto-conversions to preserve round-trip fidelity
        openDoubleQuote: false,
        closeDoubleQuote: false,
        openSingleQuote: false,
        closeSingleQuote: false,
        emDash: false,
        enDash: false,
        ellipsis: false,
      }),
      Markdown.configure({
        transformPastedText: true,
        transformCopiedText: true,
      }),
      Image.configure({
        inline: false,
        allowBase64: true,
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { class: 'wysiwyg-link' },
      }),
      Wikilink,
    ],
    onUpdate: options.onUpdate ? ({ editor: e }) => options.onUpdate!(e) : undefined,
  })

  function getMarkdown(): string {
    const storage = editor.storage.markdown as { getMarkdown?: () => string } | undefined
    if (storage?.getMarkdown) {
      return storage.getMarkdown()
    }
    // Fallback: return text content
    return editor.getText()
  }

  function setMarkdownContent(md: string): void {
    editor.commands.setContent(md)
  }

  function destroy(): void {
    editor.destroy()
  }

  return {
    editor,
    getMarkdown,
    setMarkdownContent,
    destroy,
  }
}
