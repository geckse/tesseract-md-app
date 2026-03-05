import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Placeholder } from '@tiptap/extensions'
import Typography from '@tiptap/extension-typography'
import { Markdown } from '@tiptap/markdown'
import Image from '@tiptap/extension-image'
import { TableKit } from '@tiptap/extension-table'
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight'
import { TaskList, TaskItem } from '@tiptap/extension-list'
import { createLowlight, common as commonGrammars } from 'lowlight'
import { Wikilink } from './wikilink-extension'
import { SlashCommandExtension } from './slash-command-extension'
import { LinkAutocompleteExtension } from './link-autocomplete-extension'
import { BlockDragExtension } from './block-drag-extension'

const lowlight = createLowlight(commonGrammars)

export interface WysiwygEditorOptions {
  /** Callback fired on every content change */
  onUpdate?: (editor: Editor) => void
  /** Placeholder text shown when the editor is empty */
  placeholder?: string
  /** Whether the editor is editable */
  editable?: boolean
  /** Collection root path for link autocomplete IPC search */
  collectionPath?: string
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
    contentType: 'markdown',
    editable: options.editable ?? true,
    extensions: [
      StarterKit.configure({
        codeBlock: false, // Replaced by CodeBlockLowlight later
        link: {
          openOnClick: false,
          HTMLAttributes: { class: 'wysiwyg-link' },
        },
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
      TableKit,
      CodeBlockLowlight.configure({ lowlight }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Wikilink,
      SlashCommandExtension,
      LinkAutocompleteExtension.configure({
        collectionPath: options.collectionPath ?? '',
      }),
      BlockDragExtension,
    ],
    onUpdate: options.onUpdate ? ({ editor: e }) => options.onUpdate!(e) : undefined,
  })

  function getMarkdown(): string {
    // TipTap v3: @tiptap/markdown adds editor.getMarkdown() directly
    if (typeof (editor as any).getMarkdown === 'function') {
      return (editor as any).getMarkdown()
    }
    // Fallback: return text content — this strips all formatting!
    console.error('Warning: Markdown extension storage not available, falling back to plain text. Content formatting will be lost.')
    return editor.getText()
  }

  function setMarkdownContent(md: string): void {
    editor.commands.setContent(md, { contentType: 'markdown' })
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
