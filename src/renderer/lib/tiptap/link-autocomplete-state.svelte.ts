import type { LinkSuggestionItem } from './link-autocomplete-extension'

/**
 * Reactive state bridge between the TipTap suggestion extension and the
 * LinkAutocomplete Svelte component. The extension writes to this state
 * on onStart/onUpdate; the component reads it via $effect.
 * This avoids the unmount/remount-on-every-keystroke pattern.
 */

interface LinkAutocompleteState {
  query: string
  command: ((item: LinkSuggestionItem) => void) | null
  clientRect: (() => DOMRect | null) | null
  collectionPath: string
  collectionId: string
  active: boolean
}

export const linkAutocompleteState: LinkAutocompleteState = $state({
  query: '',
  command: null,
  clientRect: null,
  collectionPath: '',
  collectionId: '',
  active: false,
})
