# PRD: Search

## Overview

Full search UI with a header search input, results panel, and navigate-to-result functionality. Calls `mdvdb search --json --root <path>` on the active collection. Supports all three search modes (hybrid, semantic, lexical). This phase is independent of Phases 7 and 8.

## Problem Statement

Users need to find content across their markdown collections by meaning, not just filename. The CLI's search capabilities (hybrid semantic+lexical, metadata filtering, score ranking) need a visual interface with instant feedback, result previews, and one-click navigation to the matched content.

## Goals

- Search input in the header bar with `Cmd+K` / `Ctrl+K` keyboard shortcut
- Debounced search (300ms) with minimum 2 character threshold
- Results panel showing file path, heading hierarchy, score, and content snippet
- Visual score bars (horizontal fill using primary color)
- Click-to-navigate: opens file and scrolls to matched heading
- Search mode toggle: hybrid / semantic / lexical
- Loading, empty, and no-results states
- Result count badge

## Non-Goals

- Cross-collection search (per-collection only)
- Metadata filter UI (CLI supports `--filter`, but a visual filter builder is deferred)
- Search history or saved searches
- Fuzzy file name search (this is semantic/lexical content search only)
- Search result caching across sessions
- Path-scoped search UI (`--path` flag — deferred)

## Technical Design

### Data Model Changes

No persistent data. New renderer stores:

```typescript
searchQuery: Writable<string>                    // Current search text
searchResults: Writable<SearchOutput | null>      // CLI response
searchLoading: Writable<boolean>                  // True while CLI is running
searchMode: Writable<'hybrid' | 'semantic' | 'lexical'>  // Persisted per-collection
searchOpen: Writable<boolean>                     // Whether results panel is visible
```

### Interface Changes

No new IPC channels. Uses existing `window.api.search(root, query, options)` from Phase 2.

**SearchOptions type:**
```typescript
interface SearchOptions {
  limit?: number              // Default 10
  mode?: 'hybrid' | 'semantic' | 'lexical'
  minScore?: number
  filter?: string             // Raw filter string (e.g., "status=published")
  decay?: boolean
  boostLinks?: boolean
}
```

### New Commands / API / UI

**Search input** (in Header):
- Replaces the placeholder input from Phase 1
- Styled per mockup: `bg-surface-darker border border-border-dark rounded-md py-1.5 pl-9 pr-12 font-mono text-xs`
- Left: search icon (`material-symbols: search`)
- Right: `⌘K` keyboard hint badge (hidden when focused)
- Focus transition: width expands from `w-56` to `w-72`
- Focus: `border-primary ring-1 ring-primary`
- Placeholder: "Search database..."

**Results panel:**
- Drops down below the header, overlaying the editor content
- `bg-surface-darker border border-border-dark rounded-b-md shadow-lg`
- Max height: `max-h-[60vh]`, scrollable
- Each result card:
  - File path: `text-text-dim text-xs font-mono`
  - Heading breadcrumb: `text-primary text-sm` (from `heading_hierarchy` array, joined with " > ")
  - Score bar: horizontal bar, `h-1 rounded bg-primary` with width proportional to score
  - Content snippet: `text-gray-400 text-sm line-clamp-2`
  - Hover: `bg-surface-dark border-primary/30`
  - Click: navigate to file
- Search mode pills: three small toggles below the input (`hybrid` active by default)
- Results count: `"N results"` badge in header

**Keyboard interactions:**
- `Cmd+K` / `Ctrl+K`: focus search input (global shortcut)
- `Escape`: close results panel, blur search
- `Enter` (with results): open first result
- `Arrow Up/Down`: navigate results (highlighted result)
- `Enter` on highlighted result: open that result

### Migration Strategy

N/A — new component.

## Implementation Steps

1. **Create search stores** — `app/src/renderer/stores/search.ts`:
   - `searchQuery`, `searchResults`, `searchLoading`, `searchMode`, `searchOpen` as writable stores.
   - `searchMode` initialized from localStorage per-collection, defaults to `'hybrid'`.
   - `executeSearch(root, query, mode)`: calls `window.api.search()`, updates stores.
   - Debounce helper: 300ms delay, cancels pending on new input.

2. **Build Search component** — `app/src/renderer/components/Search.svelte`:
   - Input element matching mockup styling.
   - `on:input`: debounced search trigger (minimum 2 chars).
   - `on:focus`: set `searchOpen = true`.
   - `on:keydown`: handle Escape (close), Enter (open first/highlighted), Arrow Up/Down (navigate).
   - Bind to `searchQuery` store.

3. **Build SearchResults component** — `app/src/renderer/components/SearchResults.svelte`:
   - Rendered below the Search input when `searchOpen && searchResults`.
   - Maps over `searchResults.results` to render result cards.
   - Score bar: `<div>` with `width: ${score * 100}%` and `bg-primary`.
   - Heading breadcrumb: join `chunk.heading_hierarchy` with " > ".
   - Content snippet: `chunk.content` truncated to ~150 chars.
   - Click handler: calls `navigateToResult(result)`.
   - Loading state: spinner/skeleton while `searchLoading`.
   - No results: "No results for 'query'" message.
   - Empty state (no query): "Type to search across [collection name]".

4. **Build search mode toggle** — Small pill buttons: `hybrid | semantic | lexical`. Active pill: `bg-primary text-surface-darker`. Inactive: `bg-surface-dark text-text-dim`. Clicking sets `searchMode` and re-triggers search.

5. **Implement navigate-to-result** — `navigateToResult(result)`:
   - Set `activeFilePath` to `result.file.path`.
   - After file loads in editor, scroll to line `result.chunk.start_line` using CodeMirror's `EditorView.dispatch({ effects: EditorView.scrollIntoView(pos) })`.
   - Close search results panel.

6. **Register global keyboard shortcut** — In `App.svelte` or a global shortcut handler:
   - `Cmd+K` / `Ctrl+K`: focus the search input.
   - Prevent default browser behavior.

7. **Integrate into Header** — Replace the placeholder search input with the real `Search` component. Add results count badge next to the search input when results exist.

8. **Handle collection switching** — When active collection changes, clear search query and results.

9. **Write unit tests** — `tests/unit/Search.test.ts`:
    - Verify debounce: typing fast only triggers one search call.
    - Verify minimum 2 char threshold.
    - Verify search mode is passed correctly to the API call.
    - Verify keyboard shortcuts (Escape closes, Enter navigates).
    - `tests/unit/SearchResults.test.ts`: render with mock results, verify cards, score bars, click handlers.

10. **Write E2E tests** — `tests/e2e/search.test.ts`:
    - Open a collection that has been ingested.
    - Press Cmd+K, verify search input is focused.
    - Type a query, wait for results.
    - Verify result cards appear with file paths and scores.
    - Click a result, verify file opens in editor.
    - Toggle search mode, verify re-search occurs.

## Validation Criteria

- [ ] `Cmd+K` focuses the search input
- [ ] Typing 2+ characters triggers a debounced search after 300ms
- [ ] Results display file path, heading hierarchy, score bar, and content snippet
- [ ] Score bars have width proportional to the score
- [ ] Clicking a result opens the file in the editor
- [ ] Clicking a result scrolls to the matched chunk's line range
- [ ] Search mode toggle switches between hybrid/semantic/lexical
- [ ] Escape closes the results panel
- [ ] Arrow keys navigate between results, Enter opens the highlighted result
- [ ] Loading spinner shows while waiting for CLI
- [ ] "No results" message shows for queries with no matches
- [ ] Results count badge shows total matches
- [ ] Switching collections clears the search state
- [ ] All unit and E2E tests pass

## Anti-Patterns to Avoid

- **Do NOT search on every keystroke** — Use 300ms debounce. The CLI spawns a child process for each search, which is expensive compared to an in-process API call.
- **Do NOT cache search results across different queries** — Each query produces different results. Only cache within the same query string (to avoid re-fetching while typing).
- **Do NOT block the UI during search** — Search is async. Show a loading state. The editor and sidebar should remain interactive.
- **Do NOT parse the content snippet** — Display it as plain text, truncated. The CLI returns raw markdown content — don't try to render it as styled markdown in the result card.
- **Do NOT use a full overlay/modal for search** — Use a dropdown panel below the header (like VS Code's command palette or Spotlight). The editor content should be visible behind/below the results.

## Patterns to Follow

- **Mockup search styling** — Reference `app-mockup-code.html` lines 155-163 for exact search input styling.
- **Svelte stores for search state** — Keep all search state in dedicated stores, not component-local state. This allows other components (e.g., keyboard shortcuts) to interact with search state.
- **Score normalization** — The CLI returns scores between 0 and 1. Use directly as percentage for the score bar width.
- **Debounce pattern** — Use a simple `setTimeout` / `clearTimeout` pattern. No need for a library.
