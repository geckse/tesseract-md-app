import { Extension } from '@tiptap/core'
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
    }
  },
  {
    label: 'Heading 2',
    icon: 'format_h2',
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).setHeading({ level: 2 }).run()
    }
  },
  {
    label: 'Heading 3',
    icon: 'format_h3',
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).setHeading({ level: 3 }).run()
    }
  },
  {
    label: 'Bullet List',
    icon: 'format_list_bulleted',
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleBulletList().run()
    }
  },
  {
    label: 'Numbered List',
    icon: 'format_list_numbered',
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleOrderedList().run()
    }
  },
  {
    label: 'Todo List',
    icon: 'check_box',
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleTaskList().run()
    }
  },
  {
    label: 'Code Block',
    icon: 'code_blocks',
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleCodeBlock().run()
    }
  },
  {
    label: 'Mermaid Diagram',
    icon: 'schema',
    command: (editor, range) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: 'mermaidBlock',
          attrs: {
            code: 'graph TD\n    A[Start] --> B{Decision}\n    B -->|Yes| C[Result 1]\n    B -->|No| D[Result 2]'
          }
        })
        .run()
    }
  },
  {
    label: 'Table',
    icon: 'table',
    command: (editor, range) => {
      // If cursor is inside a table, move after the table first to avoid nesting
      const { $from } = editor.state.selection
      let insideTable = false
      for (let d = $from.depth; d > 0; d--) {
        if ($from.node(d).type.name === 'table') {
          insideTable = true
          break
        }
      }

      if (insideTable) {
        // Delete the slash text, then move cursor after the table and insert
        editor.chain().focus().deleteRange(range).run()
        // Find the table node and move cursor after it
        const { $from: $pos } = editor.state.selection
        for (let d = $pos.depth; d > 0; d--) {
          if ($pos.node(d).type.name === 'table') {
            const afterTable = $pos.after(d)
            editor
              .chain()
              .focus()
              .setTextSelection(afterTable)
              .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
              .run()
            return
          }
        }
      }

      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run()
    }
  },
  {
    label: 'Blockquote',
    icon: 'format_quote',
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).toggleBlockquote().run()
    }
  },
  {
    label: 'Horizontal Rule',
    icon: 'horizontal_rule',
    command: (editor, range) => {
      editor.chain().focus().deleteRange(range).setHorizontalRule().run()
    }
  }
]

function filterItems(query: string): SlashCommandItem[] {
  return slashCommandItems.filter((item) => item.label.toLowerCase().includes(query.toLowerCase()))
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
        command: ({
          editor,
          range,
          props: item
        }: {
          editor: Editor
          range: Range
          props: SlashCommandItem
        }) => {
          item.command(editor, range)
          // Ensure the editor regains focus after the command executes
          requestAnimationFrame(() => {
            editor.view.focus()
          })
        },
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
                  clientRect: props.clientRect ?? null
                }
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
                      clientRect: props.clientRect ?? null
                    }
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

              if (
                props.event.key === 'ArrowDown' ||
                props.event.key === 'ArrowUp' ||
                props.event.key === 'Enter' ||
                props.event.key === 'Tab'
              ) {
                if (popup) {
                  popup.dispatchEvent(
                    new KeyboardEvent('keydown', {
                      key: props.event.key,
                      bubbles: true
                    })
                  )
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
            }
          }
        }
      } satisfies Partial<SuggestionOptions<SlashCommandItem>>
    }
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion
      })
    ]
  }
})
