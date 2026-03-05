import { Extension } from '@tiptap/core'
import { isValidUrl } from './url-validation'
import Suggestion from '@tiptap/suggestion'
import type { SuggestionOptions, SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion'
import type { Editor, Range } from '@tiptap/core'
import { mount, unmount } from 'svelte'
import SlashCommandMenu from '../../components/wysiwyg/SlashCommandMenu.svelte'

export interface SlashCommandItem {
  label: string
  icon: string
  command: (editor: Editor, range: Range) => void
}

export const slashCommandItems: SlashCommandItem[] = [
  {
    label: 'Heading 1',
    icon: 'format_h1',
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).setHeading({ level: 1 }).run()
    },
  },
  {
    label: 'Heading 2',
    icon: 'format_h2',
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run()
    },
  },
  {
    label: 'Heading 3',
    icon: 'format_h3',
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run()
    },
  },
  {
    label: 'Bullet List',
    icon: 'format_list_bulleted',
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleBulletList().run()
    },
  },
  {
    label: 'Numbered List',
    icon: 'format_list_numbered',
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleOrderedList().run()
    },
  },
  {
    label: 'Todo List',
    icon: 'check_box',
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleTaskList().run()
    },
  },
  {
    label: 'Code Block',
    icon: 'code_blocks',
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleCodeBlock().run()
    },
  },
  {
    label: 'Table',
    icon: 'table',
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
    },
  },
  {
    label: 'Blockquote',
    icon: 'format_quote',
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleBlockquote().run()
    },
  },
  {
    label: 'Horizontal Rule',
    icon: 'horizontal_rule',
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).setHorizontalRule().run()
    },
  },
  {
    label: 'Image',
    icon: 'image',
    command: (editor, range) => {
      const url = window.prompt('Enter image URL:')
      if (url) {
        if (!isValidUrl(url)) {
          window.alert('Invalid URL. Only http://, https://, mailto:, and relative paths are allowed.')
          return
        }
        editor.chain().focus().deleteRange(range).setImage({ src: url }).run()
      }
    },
  },
]

function filterItems(query: string): SlashCommandItem[] {
  return slashCommandItems.filter((item) =>
    item.label.toLowerCase().includes(query.toLowerCase())
  )
}

export const SlashCommandExtension = Extension.create({
  name: 'slashCommand',

  addOptions() {
    return {
      suggestion: {
        char: '/',
        allowSpaces: false,
        startOfLine: false,
        items: ({ query }: { query: string }) => filterItems(query),
        render: () => {
          let component: Record<string, unknown> | null = null
          let popup: HTMLDivElement | null = null

          return {
            onStart: (props: SuggestionProps<SlashCommandItem>) => {
              popup = document.createElement('div')
              popup.classList.add('slash-command-popup')
              document.body.appendChild(popup)

              component = mount(SlashCommandMenu, {
                target: popup,
                props: {
                  items: props.items ?? [],
                  command: props.command,
                  clientRect: props.clientRect ?? null,
                },
              })
            },

            onUpdate: (props: SuggestionProps<SlashCommandItem>) => {
              if (component) {
                // Svelte 5: update props via $set-like pattern
                // We unmount and remount with new props
                if (popup) {
                  unmount(component)
                  component = mount(SlashCommandMenu, {
                    target: popup,
                    props: {
                      items: props.items ?? [],
                      command: props.command,
                      clientRect: props.clientRect ?? null,
                    },
                  })
                }
              }
            },

            onKeyDown: (props: SuggestionKeyDownProps) => {
              if (props.event.key === 'Escape') {
                if (popup) {
                  popup.dispatchEvent(new CustomEvent('slash-dismiss'))
                }
                return true
              }

              if (props.event.key === 'ArrowDown' || props.event.key === 'ArrowUp' || props.event.key === 'Enter') {
                if (popup) {
                  popup.dispatchEvent(new KeyboardEvent('keydown', {
                    key: props.event.key,
                    bubbles: true,
                  }))
                }
                return true
              }

              return false
            },

            onExit: () => {
              if (component) {
                unmount(component)
                component = null
              }
              if (popup) {
                popup.remove()
                popup = null
              }
            },
          }
        },
      } satisfies Partial<SuggestionOptions<SlashCommandItem>>,
    }
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ]
  },
})
