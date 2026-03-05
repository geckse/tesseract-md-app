import { Extension } from '@tiptap/core'
import { PluginKey } from '@tiptap/pm/state'
import Suggestion from '@tiptap/suggestion'
import type { SuggestionOptions, SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion'
import type { Editor, Range } from '@tiptap/core'
import { mount, unmount } from 'svelte'
import LinkAutocomplete from '../../components/wysiwyg/LinkAutocomplete.svelte'

export interface LinkSuggestionItem {
  /** File path relative to collection root */
  path: string
  /** Optional heading anchor within the file */
  anchor?: string
  /** Display label shown in the popup */
  label: string
}

export const linkAutocompletePluginKey = new PluginKey('linkAutocomplete')

/**
 * Custom findSuggestionMatch that triggers on `[[`.
 * Multi-char `char` triggers are unreliable in @tiptap/suggestion (GitHub #2882/#4931),
 * so we implement a custom match function instead.
 */
function findSuggestionMatch(config: { editor: Editor }): { range: Range; query: string; text: string } | null {
  const { editor } = config
  const { selection } = editor.state
  const { $anchor } = selection

  // Get text from start of current text block to cursor
  const textBefore = $anchor.parent.textBetween(
    0,
    $anchor.parentOffset,
    undefined,
    '\ufffc'
  )

  // Find the last [[ that isn't closed
  const triggerIndex = textBefore.lastIndexOf('[[')
  if (triggerIndex === -1) return null

  // Check there's no ]] between the trigger and cursor
  const afterTrigger = textBefore.slice(triggerIndex + 2)
  if (afterTrigger.includes(']]')) return null

  const query = afterTrigger
  const from = $anchor.start() + triggerIndex
  const to = $anchor.pos

  return {
    range: { from, to },
    query,
    text: textBefore.slice(triggerIndex),
  }
}

export const LinkAutocompleteExtension = Extension.create({
  name: 'linkAutocomplete',

  addOptions() {
    return {
      /** Collection path for IPC search calls */
      collectionPath: '' as string,
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

          return {
            onStart: (props: SuggestionProps<LinkSuggestionItem>) => {
              popup = document.createElement('div')
              popup.classList.add('link-autocomplete-popup')
              document.body.appendChild(popup)

              component = mount(LinkAutocomplete, {
                target: popup,
                props: {
                  query: props.query ?? '',
                  command: props.command,
                  clientRect: props.clientRect ?? null,
                  collectionPath: (props.editor.extensionManager.extensions
                    .find(e => e.name === 'linkAutocomplete')
                    ?.options as { collectionPath?: string })?.collectionPath ?? '',
                },
              })
            },

            onUpdate: (props: SuggestionProps<LinkSuggestionItem>) => {
              if (component && popup) {
                unmount(component)
                component = mount(LinkAutocomplete, {
                  target: popup,
                  props: {
                    query: props.query ?? '',
                    command: props.command,
                    clientRect: props.clientRect ?? null,
                    collectionPath: (props.editor.extensionManager.extensions
                      .find(e => e.name === 'linkAutocomplete')
                      ?.options as { collectionPath?: string })?.collectionPath ?? '',
                  },
                })
              }
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
                props.event.key === 'Enter'
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
          const anchor = props.anchor ? `#${props.anchor}` : ''
          const wikilinkText = `[[${props.path}${anchor}]]`

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
