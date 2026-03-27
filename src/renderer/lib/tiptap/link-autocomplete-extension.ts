import { Extension } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion from '@tiptap/suggestion'
import type { SuggestionOptions, SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion'
import type { Editor, Range } from '@tiptap/core'
import { mount, unmount } from 'svelte'
import LinkAutocomplete from '../../components/wysiwyg/LinkAutocomplete.svelte'
import { linkAutocompleteState } from './link-autocomplete-state.svelte'

export interface LinkSuggestionItem {
  /** File path relative to collection root */
  path: string
  /** Optional heading anchor within the file */
  anchor?: string
  /** Display label shown in the popup */
  label: string
  /** Dimmed subtitle (relative path) */
  subtitle?: string
}

export const linkAutocompletePluginKey = new PluginKey('linkAutocomplete')

/**
 * Custom findSuggestionMatch that triggers on `@` (primary) and `[[` (secondary).
 * `@` is single-char and universally recognized (Notion, Slack, GitHub).
 * `[[` is kept for Obsidian-style power users.
 * Multi-char `char` triggers are unreliable in @tiptap/suggestion (GitHub #2882/#4931),
 * so we implement a custom match function instead.
 */
function findSuggestionMatch(config: { editor: Editor }): { range: Range; query: string; text: string } | null {
  const { editor } = config
  if (!editor?.state) return null
  const { selection } = editor.state
  const { $anchor } = selection

  // Get text from start of current text block to cursor
  const textBefore = $anchor.parent.textBetween(
    0,
    $anchor.parentOffset,
    undefined,
    '\ufffc'
  )

  // --- Try [[ trigger first (longer match takes priority) ---
  const bracketIndex = textBefore.lastIndexOf('[[')
  if (bracketIndex !== -1) {
    const afterBracket = textBefore.slice(bracketIndex + 2)
    if (!afterBracket.includes(']]')) {
      return {
        range: { from: $anchor.start() + bracketIndex, to: $anchor.pos },
        query: afterBracket,
        text: textBefore.slice(bracketIndex),
      }
    }
  }

  // --- Try @ trigger ---
  const atIndex = textBefore.lastIndexOf('@')
  if (atIndex !== -1) {
    // Must be preceded by whitespace or start-of-text to avoid
    // triggering on email addresses like user@example.com
    if (atIndex === 0 || /\s/.test(textBefore[atIndex - 1])) {
      const afterAt = textBefore.slice(atIndex + 1)
      // Don't trigger if it looks like an email (word chars followed by another @)
      if (!/^\S+@/.test(afterAt)) {
        return {
          range: { from: $anchor.start() + atIndex, to: $anchor.pos },
          query: afterAt,
          text: textBefore.slice(atIndex),
        }
      }
    }
  }

  return null
}

export const LinkAutocompleteExtension = Extension.create({
  name: 'linkAutocomplete',

  addOptions() {
    return {
      /** Collection path for IPC search calls */
      collectionPath: '' as string,
      /** Collection ID for filtering recents */
      collectionId: '' as string,
      suggestion: {
        pluginKey: linkAutocompletePluginKey,
        allowSpaces: true,
        // Use custom match instead of char trigger
        findSuggestionMatch,
        items: ({ query }: { query: string }) => {
          // Items are fetched asynchronously inside the component
          // Return empty array; the component handles search via IPC
          return [] as LinkSuggestionItem[]
        },
        render: () => {
          let component: Record<string, unknown> | null = null
          let popup: HTMLDivElement | null = null

          const getExtensionOptions = (editor: Editor) => {
            const ext = editor.extensionManager.extensions
              .find(e => e.name === 'linkAutocomplete')
            return ext?.options as { collectionPath?: string; collectionId?: string } | undefined
          }

          return {
            onStart: (props: SuggestionProps<LinkSuggestionItem>) => {
              popup = document.createElement('div')
              popup.classList.add('link-autocomplete-popup')
              document.body.appendChild(popup)

              const opts = getExtensionOptions(props.editor)

              // Set reactive state — component reads from this
              linkAutocompleteState.query = props.query ?? ''
              linkAutocompleteState.command = props.command
              linkAutocompleteState.clientRect = props.clientRect ?? null
              linkAutocompleteState.collectionPath = opts?.collectionPath ?? ''
              linkAutocompleteState.collectionId = opts?.collectionId ?? ''
              linkAutocompleteState.active = true

              // Mount ONCE — subsequent updates go through state
              component = mount(LinkAutocomplete, { target: popup })
            },

            onUpdate: (props: SuggestionProps<LinkSuggestionItem>) => {
              // Just update reactive state — no unmount/remount
              linkAutocompleteState.query = props.query ?? ''
              linkAutocompleteState.command = props.command
              linkAutocompleteState.clientRect = props.clientRect ?? null
            },

            onKeyDown: (props: SuggestionKeyDownProps) => {
              if (props.event.key === 'Escape') {
                if (popup) {
                  popup.dispatchEvent(new CustomEvent('link-dismiss'))
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
                      bubbles: true,
                    })
                  )
                }
                return true
              }

              return false
            },

            onExit: () => {
              linkAutocompleteState.active = false
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
        command: ({ editor, range, props }: { editor: Editor; range: Range; props: LinkSuggestionItem }) => {
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent({
              type: 'wikilink',
              attrs: {
                target: props.path,
                anchor: props.anchor ?? null,
                display: null,
              },
            })
            .run()
        },
      } satisfies Partial<SuggestionOptions<LinkSuggestionItem>>,
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
