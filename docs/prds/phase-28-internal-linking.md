# PRD: Make Internal Linking Good

## Overview

Rework the WYSIWYG editor's internal linking to be fast, intuitive, and actually functional. The current `[[` autocomplete is completely broken (collectionPath never reaches the extension). This PRD fixes the showstopper bugs, switches the primary trigger to `@` for speed, adds smart defaults, and polishes the UX for rapid document connection.

## Problem Statement

Internal linking is the killer feature of a knowledge-management editor — it's how users build structure across documents. The current implementation was specced in Phase 18 (WYSIWYG Block Editor) but shipped non-functional:

1. **Broken plumbing**: `WysiwygEditor.svelte` never passes `collectionPath` to `createWysiwygEditor()`, so the `LinkAutocompleteExtension` receives an empty string. Every search call short-circuits at `LinkAutocomplete.svelte:71` (`if (!collectionPath)`). The popover opens but always shows "No results."
2. **Wrong trigger**: `[[` requires two keystrokes and is only familiar to Obsidian users. `@` is universally understood (Notion, Slack, GitHub, Linear) and requires a single keystroke.
3. **Flicker on every keystroke**: The extension unmounts and remounts the entire Svelte component on every `onUpdate` callback, destroying state and causing visual flicker.
4. **No useful defaults**: Typing the trigger shows "Type to search..." instead of immediately useful suggestions.
5. **Raw paths as labels**: Shows `notes/2024/weekly-standup.md` instead of the document's title.
6. **Heading mode unreachable**: The `#` heading drill-down can never activate because search results are always empty.

## Goals

- **P0**: Make linking work end-to-end (type trigger → see results → select → wikilink inserted)
- **P0**: `@` as primary trigger (single character, universally recognized)
- **P1**: Show recent files immediately on empty query (zero-keystroke usefulness)
- **P1**: Display document titles with path as subtitle (human-friendly labels)
- **P1**: Reactive component updates (no unmount/remount flicker)
- **P2**: Keep `[[` as secondary trigger for Obsidian-style power users
- **P2**: Heading anchor drill-down after file selection
- **P2**: Hybrid search for better relevance

## Non-Goals

- **New file creation from `@`** — "Create new note" option when no results match (separate feature)
- **Backlink count in popover** — showing "5 docs link here" is a metadata panel feature
- **Cross-collection linking** — links work within the active collection only
- **Preview of target content** — no inline document preview in the popover
- **Changes to the CodeMirror source editor** — this PRD only covers the TipTap WYSIWYG editor

---

## Technical Design

### 1. Fix collectionPath Passthrough

**File**: `app/src/renderer/components/WysiwygEditor.svelte`

The `createEditor()` function at line 213 calls `createWysiwygEditor()` without `collectionPath`. The active collection is already available via the `activeCollection` derived store.

```typescript
// Before (broken):
wysiwygEditor = createWysiwygEditor(editorEl, body, {
  onUpdate: () => handleEditorUpdate(),
});

// After (fixed):
wysiwygEditor = createWysiwygEditor(editorEl, body, {
  onUpdate: () => handleEditorUpdate(),
  collectionPath: get(activeCollection)?.path ?? '',
});
```

**Why this is safe**: Switching collections triggers the file tree to reload, which resets `selectedFilePath`, which triggers `$effect` at line 230 to destroy and recreate the editor. The `collectionPath` is always fresh at editor creation time.

Import `activeCollection` from `../stores/collections` and `get` from `svelte/store` (or read from a `$derived` rune if the component uses runes).

---

### 2. Dual-Trigger Suggestion Matcher (`@` + `[[`)

**File**: `app/src/renderer/lib/tiptap/link-autocomplete-extension.ts`

Replace `findSuggestionMatch()` with a dual-trigger function. Both triggers return the same shape — the `range` already encodes the correct deletion bounds.

```typescript
function findSuggestionMatch(config: { editor: Editor }) {
  const { editor } = config;
  if (!editor?.state) return null;
  const { $anchor } = editor.state.selection;

  const textBefore = $anchor.parent.textBetween(
    0, $anchor.parentOffset, undefined, '\ufffc'
  );

  // --- Try [[ trigger first (longer match wins) ---
  const bracketIndex = textBefore.lastIndexOf('[[');
  if (bracketIndex !== -1) {
    const afterBracket = textBefore.slice(bracketIndex + 2);
    if (!afterBracket.includes(']]')) {
      return {
        range: { from: $anchor.start() + bracketIndex, to: $anchor.pos },
        query: afterBracket,
        text: textBefore.slice(bracketIndex),
      };
    }
  }

  // --- Try @ trigger ---
  const atIndex = textBefore.lastIndexOf('@');
  if (atIndex !== -1) {
    // Must be preceded by whitespace, start-of-text, or start-of-node
    // to avoid triggering on email addresses like user@example.com
    if (atIndex === 0 || /\s/.test(textBefore[atIndex - 1])) {
      const afterAt = textBefore.slice(atIndex + 1);
      // Don't trigger if it looks like an email (contains . before space)
      if (!/^\S+@/.test(afterAt)) {
        return {
          range: { from: $anchor.start() + atIndex, to: $anchor.pos },
          query: afterAt,
          text: textBefore.slice(atIndex),
        };
      }
    }
  }

  return null;
}
```

**Key design decisions**:
- `[[` is checked first — if the user types `[[`, it takes priority over any `@` earlier in the text
- `@` requires preceding whitespace or start-of-node — prevents false positives on `user@email.com`
- Both triggers produce the same `{ range, query, text }` shape — the existing `command` handler works unchanged

---

### 3. Reactive Svelte State Bridge

**New file**: `app/src/renderer/lib/tiptap/link-autocomplete-state.svelte.ts`

Svelte 5's `mount()` does not support reactive prop updates after initial mount. The current workaround — unmount/remount on every `onUpdate` — causes flicker. Instead, create a shared reactive state object that the extension writes to and the component reads from.

```typescript
import type { LinkSuggestionItem } from './link-autocomplete-extension';

interface LinkAutocompleteState {
  query: string;
  command: ((item: LinkSuggestionItem) => void) | null;
  clientRect: (() => DOMRect | null) | null;
  collectionPath: string;
  active: boolean;
}

export const linkAutocompleteState: LinkAutocompleteState = $state({
  query: '',
  command: null,
  clientRect: null,
  collectionPath: '',
  active: false,
});
```

**Extension changes** (in `link-autocomplete-extension.ts`):

```typescript
import { linkAutocompleteState } from './link-autocomplete-state.svelte';

render: () => {
  let component: Record<string, unknown> | null = null;
  let popup: HTMLDivElement | null = null;

  return {
    onStart: (props) => {
      popup = document.createElement('div');
      popup.classList.add('link-autocomplete-popup');
      document.body.appendChild(popup);

      // Set reactive state
      linkAutocompleteState.query = props.query ?? '';
      linkAutocompleteState.command = props.command;
      linkAutocompleteState.clientRect = props.clientRect ?? null;
      linkAutocompleteState.collectionPath = /* read from extension options */;
      linkAutocompleteState.active = true;

      // Mount ONCE
      component = mount(LinkAutocomplete, { target: popup });
    },

    onUpdate: (props) => {
      // Just update state — no unmount/remount
      linkAutocompleteState.query = props.query ?? '';
      linkAutocompleteState.command = props.command;
      linkAutocompleteState.clientRect = props.clientRect ?? null;
    },

    onExit: () => {
      linkAutocompleteState.active = false;
      if (component) { unmount(component); component = null; }
      if (popup) { popup.remove(); popup = null; }
    },
  };
}
```

**Component changes** (`LinkAutocomplete.svelte`):

Replace `$props()` with imported state:

```typescript
import { linkAutocompleteState as state } from '../../lib/tiptap/link-autocomplete-state.svelte';

// Use state.query, state.command, state.clientRect, state.collectionPath
// All $effect() blocks that referenced props now reference state.*
```

---

### 4. Smart Default Results (Recent Files)

**File**: `app/src/renderer/components/wysiwyg/LinkAutocomplete.svelte`

When the query is empty (user just typed `@`), show recently opened files from the current collection.

```typescript
async function loadRecentFiles(): Promise<void> {
  loading = true;
  try {
    const recents = await window.api.listRecents();
    // Filter to current collection and map to suggestion items
    const collectionId = /* get from activeCollection store or pass through state */;
    const filtered = recents
      .filter(r => r.collectionId === collectionId)
      .slice(0, 8);

    items = filtered.map(r => ({
      path: r.filePath,
      label: fileNameToTitle(r.filePath),
      subtitle: r.filePath,
    }));
  } catch {
    items = [];
  } finally {
    loading = false;
  }
}
```

Update the `$effect` query watcher:
```typescript
$effect(() => {
  const q = state.query;
  if (q.length < 1) {
    loadRecentFiles();  // Show recents instead of empty state
    return;
  }
  // ... existing debounced search logic
});
```

**Fallback**: If recents are empty (fresh collection), show the first 10 files from `window.api.tree()` flattened alphabetically.

---

### 5. Friendly Labels

**File**: `app/src/renderer/components/wysiwyg/LinkAutocomplete.svelte`

Extract human-readable titles from search results:

```typescript
function extractTitle(file: SearchResultFile): string {
  // Try frontmatter title first
  if (file.frontmatter && typeof file.frontmatter === 'object') {
    const title = (file.frontmatter as Record<string, unknown>).title;
    if (typeof title === 'string' && title.trim()) return title.trim();
  }
  // Fallback: filename without extension, dashes/underscores → spaces
  const filename = file.path.split('/').pop() ?? file.path;
  return filename.replace(/\.md$/i, '').replace(/[-_]/g, ' ');
}
```

Update the search result mapping:
```typescript
deduped.push({
  path: r.file.path,
  label: extractTitle(r.file),
  subtitle: r.file.path,   // Full relative path, shown dimmed
});
```

**Update `LinkSuggestionItem`**:
```typescript
export interface LinkSuggestionItem {
  path: string;
  anchor?: string;
  label: string;
  subtitle?: string;  // NEW — relative path shown dimmed
}
```

**Template update**:
```svelte
<button class="link-item" ...>
  <span class="link-icon material-symbols-outlined">
    {headingMode ? 'tag' : 'description'}
  </span>
  <span class="link-text">
    <span class="link-label">{item.label}</span>
    {#if item.subtitle && item.subtitle !== item.label}
      <span class="link-subtitle">{item.subtitle}</span>
    {/if}
  </span>
</button>
```

**CSS**:
```css
.link-text {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.link-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.link-subtitle {
  font-size: 11px;
  color: var(--color-text-dim, #71717a);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
```

---

### 6. Heading Anchor Drill-Down Fix

**File**: `app/src/renderer/components/wysiwyg/LinkAutocomplete.svelte`

The current `#` detection at line 200 tries to match the typed text before `#` against items. Fix the matching to be robust:

```typescript
const hashIndex = q.indexOf('#');
if (hashIndex > 0 && !headingMode) {
  const filePart = q.slice(0, hashIndex).toLowerCase().replace(/\.md$/i, '');
  const match = items.find((i) => {
    const normalized = i.path.toLowerCase().replace(/\.md$/i, '');
    const nameOnly = normalized.split('/').pop() ?? '';
    return normalized === filePart ||
           nameOnly === filePart ||
           normalized.endsWith('/' + filePart);
  });
  if (match) {
    switchToHeadingMode(match.path);
    return;
  }
}
```

---

### 7. Hybrid Search with Fallback

**File**: `app/src/renderer/components/wysiwyg/LinkAutocomplete.svelte`

Switch from lexical-only to hybrid search. Hybrid combines BM25 lexical matching with semantic vector similarity for better relevance. Fall back to lexical if the collection doesn't have embeddings configured.

```typescript
async function searchFiles(searchQuery: string): Promise<void> {
  // ...
  let result;
  try {
    result = await window.api.search(collectionPath, searchQuery, {
      mode: 'hybrid',
      limit: 10,
    });
  } catch {
    // Fallback: hybrid requires embeddings; lexical always works
    result = await window.api.search(collectionPath, searchQuery, {
      mode: 'lexical',
      limit: 10,
    });
  }
  // ...
}
```

---

### 8. Keyboard UX

**File**: `app/src/renderer/lib/tiptap/link-autocomplete-extension.ts`

Add Tab key to the `onKeyDown` handler for selection (consistent with slash commands):

```typescript
onKeyDown: (props) => {
  if (props.event.key === 'Escape') { ... }
  if (['ArrowDown', 'ArrowUp', 'Enter', 'Tab'].includes(props.event.key)) {
    popup?.dispatchEvent(new KeyboardEvent('keydown', {
      key: props.event.key,
      bubbles: true,
    }));
    return true;
  }
  return false;
}
```

Update `handleKeyDown` in `LinkAutocomplete.svelte`:
```typescript
} else if (e.key === 'Enter' || e.key === 'Tab') {
  e.preventDefault();
  if (items[selectedIndex]) selectItem(selectedIndex);
}
```

Also: scroll the selected item into view on arrow key navigation:
```typescript
$effect(() => {
  void selectedIndex;
  const el = menuEl?.querySelector('.link-item.selected');
  el?.scrollIntoView({ block: 'nearest' });
});
```

---

## Implementation Order

### Phase 1 — Make It Work (P0)

| # | Task | File |
|---|------|------|
| 1 | Pass `collectionPath` to `createWysiwygEditor()` | `WysiwygEditor.svelte` |
| 2 | Add `@` trigger to `findSuggestionMatch()` (keep `[[` too) | `link-autocomplete-extension.ts` |
| 3 | Verify: type `@note` → results appear → Enter → wikilink inserted | Manual test |

### Phase 2 — Make It Good (P1)

| # | Task | File |
|---|------|------|
| 4 | Create reactive state bridge | `link-autocomplete-state.svelte.ts` (NEW) |
| 5 | Refactor extension to mount once, update state reactively | `link-autocomplete-extension.ts` |
| 6 | Refactor component to read from state instead of props | `LinkAutocomplete.svelte` |
| 7 | Add recent files on empty query | `LinkAutocomplete.svelte` |
| 8 | Extract titles from frontmatter, show path as subtitle | `LinkAutocomplete.svelte` |
| 9 | Add Tab key for selection + scroll selected into view | Both files |

### Phase 3 — Make It Great (P2)

| # | Task | File |
|---|------|------|
| 10 | Fix heading mode matching logic | `LinkAutocomplete.svelte` |
| 11 | Switch to hybrid search with lexical fallback | `LinkAutocomplete.svelte` |
| 12 | Add section headers ("Recent" / "Search Results") | `LinkAutocomplete.svelte` |

---

## Files Modified

| File | Phase | Changes |
|------|-------|---------|
| `app/src/renderer/components/WysiwygEditor.svelte` | 1 | Pass `collectionPath` to editor factory |
| `app/src/renderer/lib/tiptap/link-autocomplete-extension.ts` | 1, 2 | Dual-trigger matcher, reactive mount lifecycle, Tab key |
| `app/src/renderer/components/wysiwyg/LinkAutocomplete.svelte` | 2, 3 | State bridge, recent files, titles, subtitles, heading fix, hybrid search |
| `app/src/renderer/lib/tiptap/link-autocomplete-state.svelte.ts` | 2 | NEW — reactive state shared between extension and component |

---

## Testing

### Unit Tests

- `findSuggestionMatch`: `@note` triggers, `[[note` triggers, `user@email.com` does NOT trigger, `@` at start of line triggers, `@` mid-word does NOT trigger
- `extractTitle`: frontmatter with title, frontmatter without title, no frontmatter, filename fallback
- Recent files filtering: correct collection, limit to 8 results

### Integration Tests

- Type `@` → popover appears with recent files
- Type `@meeting` → search results appear with titles and subtitles
- Arrow Down → Enter → wikilink node inserted in editor
- Type `[[project` → same behavior via secondary trigger
- Type `@file#heading` → heading drill-down mode activates
- Rapid typing does not cause flicker or stale results
- Escape closes the popover

### Manual Verification

1. Open a collection with indexed files
2. Open any file in WYSIWYG mode
3. Type `@` — recent files appear instantly
4. Type a search term — results update smoothly
5. Select with arrow keys + Enter — wikilink `[[target]]` inserted
6. Click the wikilink — navigates to target file
7. Type `[[` — same popover, same behavior
8. Type `@file#` — headings of the matched file appear

---

## Risks

| Risk | Mitigation |
|------|------------|
| `@` false positives on emails | Require preceding whitespace or start-of-node |
| Hybrid search slower than lexical | 150ms debounce already in place; lexical fallback if hybrid fails |
| Recents API returns all collections | Filter by active collection ID before displaying |
| `.svelte.ts` state file may confuse build | electron-vite + svelte plugin already supports `.svelte.ts` files |

---

## Acceptance Criteria

- [ ] Typing `@` in the WYSIWYG editor opens the link popover with recent files
- [ ] Typing `@<query>` shows search results with document titles and path subtitles
- [ ] Typing `[[<query>` shows the same popover (secondary trigger)
- [ ] Selecting a result inserts a `[[wikilink]]` node
- [ ] Arrow keys navigate the list, Enter/Tab confirms selection
- [ ] Escape closes the popover
- [ ] Typing `@file#` drills into that file's headings
- [ ] No flicker on rapid typing
- [ ] `@` does NOT trigger in the middle of a word or on email addresses
- [ ] Clicking an inserted wikilink navigates to the target file
- [ ] All existing WYSIWYG tests continue to pass
