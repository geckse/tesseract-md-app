# PRD: WYSIWYG Block Editor

## Overview

Add a TipTap-based (ProseMirror) WYSIWYG block editor as a 3rd view mode alongside the existing HTML Preview and CodeMirror Source Editor. The editor provides Notion/Gitbook-style block editing with slash commands, floating formatting toolbar, drag handles, and — critically — fast interactive `[[wikilink]]` autocomplete powered by the existing FTS search backend. Users can also drag files from the FileTree directly into the editor to create links. A visual frontmatter property editor replaces raw YAML editing.

## Problem Statement

The app currently offers two modes: a read-only **HTML Preview** (marked) and a raw **Source Editor** (CodeMirror 6 with syntax highlighting). Users must mentally switch between "reading formatted content" and "editing raw markdown syntax." There's no middle ground — no way to edit content while seeing it rendered.

Tools like Notion and Gitbook have proven that block-based WYSIWYG editing dramatically lowers friction for content creation, especially for:

1. **Linking** — typing `[[` and getting instant suggestions is far faster than manually writing link syntax and remembering file paths.
2. **Structure** — converting a paragraph to a heading or list via slash commands or block menus is more intuitive than adding `#` or `-` characters.
3. **Tables** — visual table editing vs. pipe-delimited markdown syntax.
4. **Frontmatter** — visual property fields vs. raw YAML.

The existing CodeMirror editor is excellent for power users who think in markdown, but a WYSIWYG mode makes the app accessible to a broader audience and faster for everyone when creating linked knowledge.

## Goals

- TipTap-based WYSIWYG editor as a 3rd view mode alongside Preview and Source
- 3-tab toggle in the mode bar: **Preview | WYSIWYG | Source** (Cmd+E cycles all three)
- Block-based editing with drag handles to reorder paragraphs, headings, lists, etc.
- `+` block toolbar on the left of each block (click for type conversion menu, like Notion)
- Slash command menu (`/`) for inserting headings, lists, code blocks, tables, etc.
- Floating bubble menu on text selection (bold, italic, code, strikethrough, link)
- `[[` triggered link autocomplete with typeahead search via lexical FTS (fast, offline)
- Heading anchor selection after file pick: `[[file#heading]]`
- Drag & drop files from FileTree into WYSIWYG editor to create `[[wikilink]]` at drop point
- Visual frontmatter property editor (Notion-style key-value fields above content)
- Lossless markdown round-trip (TipTap ↔ Markdown) including wikilinks, tables, task lists
- Same save/dirty/cache/conflict-detection behavior as existing Source editor
- Dark theme matching existing design system exactly
- Keyboard-first experience: all actions reachable without mouse

## Non-Goals

- **Replacing the Source editor or Preview** — all three modes coexist, each serving a different use case
- **Collaborative/multiplayer editing** — single-user desktop app
- **Custom block types beyond standard markdown** — no callout blocks, toggles, databases, embeds
- **Image upload/paste from clipboard** — images remain as markdown `![alt](path)` references
- **Inline frontmatter editing in Preview mode** — only available in WYSIWYG mode
- **Mobile/responsive layout** — desktop-only Electron app
- **Spell check / grammar integration** — rely on OS-level spell check

---

## Technical Design

### TipTap + Svelte 5 Integration Strategy

The official `svelte-tiptap` wrapper does not support Svelte 5 runes. Use `@tiptap/core` directly with imperative lifecycle management in `onMount`/`onDestroy` — the exact same pattern as `Editor.svelte` manages its CodeMirror instance today. The TipTap editor instance is a plain JavaScript object; use `editor.on('update', ...)` callbacks to sync state to Svelte stores.

```typescript
// In WysiwygEditor.svelte onMount:
const editor = createWysiwygEditor({
  element: containerEl,
  content: body, // markdown string (frontmatter stripped)
  onUpdate: ({ editor }) => {
    const md = editor.getMarkdown()
    const full = joinFrontmatter(currentFrontmatter, md)
    propertiesFileContent.set(full)
    isDirty.set(full !== lastSavedContent)
    wordCount.set(countWords(full))
    tokenCount.set(countTokens(full))
  }
})
```

### NPM Dependencies to Add

```json
{
  "@tiptap/core": "^3.x",
  "@tiptap/starter-kit": "^3.x",
  "@tiptap/extension-link": "^3.x",
  "@tiptap/extension-table": "^3.x",
  "@tiptap/extension-table-row": "^3.x",
  "@tiptap/extension-table-cell": "^3.x",
  "@tiptap/extension-table-header": "^3.x",
  "@tiptap/extension-code-block-lowlight": "^3.x",
  "@tiptap/extension-task-list": "^3.x",
  "@tiptap/extension-task-item": "^3.x",
  "@tiptap/extension-placeholder": "^3.x",
  "@tiptap/extension-typography": "^3.x",
  "@tiptap/extension-image": "^3.x",
  "@tiptap/extension-dropcursor": "^3.x",
  "@tiptap/markdown": "^3.x",
  "@tiptap/suggestion": "^3.x",
  "lowlight": "^3.x"
}
```

`@tiptap/pm` (ProseMirror core) is pulled in transitively by `@tiptap/core`.

### Extension Strategy

#### Built-in TipTap Extensions

| Extension | Package | Purpose |
|---|---|---|
| StarterKit | `@tiptap/starter-kit` | Headings (1-3), bold, italic, strike, code, blockquote, bullet list, ordered list, HR, history |
| Link | `@tiptap/extension-link` | Standard `[text](url)` markdown links |
| Table + TableRow + TableCell + TableHeader | `@tiptap/extension-table` | Interactive table editing (add/remove rows/columns) |
| CodeBlockLowlight | `@tiptap/extension-code-block-lowlight` | Syntax-highlighted fenced code blocks with language selector |
| TaskList + TaskItem | `@tiptap/extension-task-list` | `- [ ]` / `- [x]` todo items |
| Placeholder | `@tiptap/extension-placeholder` | "Type '/' for commands..." hint text |
| Typography | `@tiptap/extension-typography` | Smart quotes, em dashes |
| Image | `@tiptap/extension-image` | Image nodes |
| Dropcursor | `@tiptap/extension-dropcursor` | Visual cursor during drag-and-drop |
| Markdown | `@tiptap/markdown` | Bidirectional markdown parsing/serialization |

#### Custom Extensions (Built In-House)

**1. WikilinkNode** (`lib/tiptap/wikilink-extension.ts`)
- Custom inline node type `wikilink` with attributes `{ target: string, anchor: string | null, display: string | null }`
- Renders as styled `<span class="wikilink">` with cyan color and pointer cursor
- Click handler opens the linked file via `selectFile()`
- Markdown parse rule: detect `[[target]]`, `[[target#anchor]]`, `[[target|display text]]`
- Markdown serialize rule: output `[[target]]` or `[[target#anchor]]` format
- Register via `@tiptap/markdown`'s `addMarkdownSerializer` / `addMarkdownParser` hooks

**2. SlashCommandSuggestion** (`lib/tiptap/slash-command-extension.ts`)
- Uses `@tiptap/suggestion` plugin with `/` trigger character
- Items: Heading 1, Heading 2, Heading 3, Bullet List, Numbered List, Todo List, Code Block, Table, Blockquote, Horizontal Rule, Image
- Each item has icon, label, and maps to a TipTap chain command
- Renders `SlashCommandMenu.svelte` as the popup
- Keyboard: arrow keys to navigate, Enter to select, Escape to dismiss, type to filter

**3. LinkAutocompleteSuggestion** (`lib/tiptap/link-autocomplete-extension.ts`)
- Uses `@tiptap/suggestion` with `[[` trigger (two characters)
- `onQuery` fires debounced (150ms) IPC search: `window.api.search(root, query, { mode: 'lexical', limit: 10 })`
- Results deduplicated by file path (multiple chunks from same file → show file once)
- After file selection, detect `#` keypress to switch to heading browsing mode
- Heading list sourced from `window.api.getFile(root, filePath)` which returns headings
- On confirm, inserts a `wikilink` node
- Renders `LinkAutocomplete.svelte` as the popup

**4. BlockDragPlugin** (`lib/tiptap/block-drag-extension.ts`)
- ProseMirror plugin that decorates top-level block nodes with a drag handle widget
- Handle appears on hover (left side of each block, grip icon)
- Uses ProseMirror's built-in drag/drop support for node reordering
- Also renders the `+` button that shows block type conversion options (reuses slash command items)

### Markdown Round-Trip Strategy

#### Frontmatter Handling

`lib/tiptap/markdown-bridge.ts` provides:

```typescript
interface MarkdownBridgeResult {
  frontmatter: string | null     // Raw YAML block including --- delimiters
  body: string                    // Markdown body without frontmatter
  data: Record<string, any> | null // Parsed key-value pairs
}

function splitFrontmatter(markdown: string): MarkdownBridgeResult
function joinFrontmatter(frontmatter: string | null, body: string): string
function serializeFrontmatter(data: Record<string, any>): string
```

This extracts the same logic from `stores/properties.ts:parseFrontmatter()` into a shared utility. The TipTap editor only receives the body; frontmatter is managed separately by `FrontmatterEditor.svelte`.

#### Content Lifecycle

```
File loaded from disk (via fileContent store)
  → splitFrontmatter() extracts YAML header and body
  → body fed to TipTap via editor.commands.setContent(body, { contentType: 'markdown' })
  → frontmatter data passed to FrontmatterEditor.svelte

User edits in TipTap
  → On every change (debounced 200ms, same as CodeMirror editor):
    - body = editor.getMarkdown()
    - fullContent = joinFrontmatter(currentFrontmatter, body)
    - propertiesFileContent.set(fullContent)  // updates outline + properties panel
    - isDirty.set(fullContent !== lastSavedContent)
    - wordCount.set(countWords(fullContent))
    - tokenCount.set(countTokens(fullContent))

User edits frontmatter in FrontmatterEditor.svelte
  → serializeFrontmatter() → recombine with body → isDirty.set(true)

User saves (Cmd+S)
  → fullContent = joinFrontmatter(currentFrontmatterYaml, editor.getMarkdown())
  → window.api.writeFile(fullPath, fullContent)
  → isDirty.set(false)
```

#### Elements That Must Round-Trip Correctly

| Element | TipTap Extension | Markdown Syntax |
|---|---|---|
| Headings | StarterKit | `# / ## / ###` |
| Bold | StarterKit | `**text**` |
| Italic | StarterKit | `*text*` |
| Strikethrough | StarterKit | `~~text~~` |
| Inline code | StarterKit | `` `code` `` |
| Code blocks | CodeBlockLowlight | ` ```lang ... ``` ` |
| Bullet lists | StarterKit | `- item` |
| Ordered lists | StarterKit | `1. item` |
| Task lists | TaskList/TaskItem | `- [ ] / - [x]` |
| Blockquotes | StarterKit | `> quote` |
| Horizontal rule | StarterKit | `---` |
| Links | Link | `[text](url)` |
| Images | Image | `![alt](src)` |
| Tables | Table | `\| ... \|` pipe syntax |
| Wikilinks | Custom WikilinkNode | `[[target]]` |

### Store Modifications

**`stores/editor.ts`** (currently lines 28-41):

```typescript
// BEFORE:
export type EditorMode = 'preview' | 'editor'
export function toggleEditorMode(): void {
  editorMode.update((m) => (m === 'editor' ? 'preview' : 'editor'))
}

// AFTER:
export type EditorMode = 'preview' | 'editor' | 'wysiwyg'
export function toggleEditorMode(): void {
  editorMode.update((m) => {
    if (m === 'preview') return 'wysiwyg'
    if (m === 'wysiwyg') return 'editor'
    return 'preview'
  })
}
```

All shared stores (`isDirty`, `wordCount`, `tokenCount`, `propertiesFileContent`, `saveRequested`) work identically — they're set by whichever editor is currently active.

### Mode Switching Data Flow

```
Source → WYSIWYG:
  CodeMirror saves content to docCache + fileContent store
  → WysiwygEditor reads from fileContent → splitFrontmatter() → TipTap loads body

WYSIWYG → Source:
  TipTap serializes → joinFrontmatter() → fileContent store + docCache
  → CodeMirror reads from fileContent

WYSIWYG → Preview:
  TipTap serializes → propertiesFileContent store → MarkdownPreview renders

Any mode → Any mode:
  Content always passes through markdown string representation via shared stores
  Only one editor is mounted at a time (key invariant)
```

### App.svelte Changes

Add 3rd tab button in the `.mode-toggle` bar (currently lines 301-331):

```svelte
<div class="mode-toggle" role="tablist" aria-label="Editor mode">
  <button class="mode-tab" class:active={$editorMode === 'preview'}
    onclick={() => editorMode.set('preview')}>Preview</button>
  <button class="mode-tab" class:active={$editorMode === 'wysiwyg'}
    onclick={() => editorMode.set('wysiwyg')}>WYSIWYG</button>
  <button class="mode-tab" class:active={$editorMode === 'editor'}
    onclick={() => editorMode.set('editor')}>Source</button>
</div>
```

Conditional rendering (currently lines 333-348):

```svelte
{#if $editorMode === 'editor'}
  <div class="editor-region" ...><Editor /></div>
{:else if $editorMode === 'wysiwyg'}
  <div class="wysiwyg-region" ...><WysiwygEditor /></div>
{:else}
  <div class="preview-content-region" ...><MarkdownPreview /></div>
{/if}
```

Note: The current approach keeps `Editor` always mounted (hidden via CSS) — with the 3-tab system, we switch to conditional mounting (`{#if}`) for all three views to avoid keeping two editor instances in memory.

### Link Autocomplete Data Flow (Critical Feature)

```
User types "[[chunki"
  → LinkAutocompleteSuggestion.onQuery("chunki") fires
  → Debounce 150ms (shorter than search panel's 300ms for responsiveness)
  → Await window.api.search(collectionPath, "chunki", { mode: 'lexical', limit: 10 })
  → IPC → main process → execFile('mdvdb', ['search', '--json', '--mode', 'lexical', '--limit', '10', 'chunki'])
  → Parse SearchOutput.results
  → Deduplicate by file path (multiple chunks from same file → show file once)
  → Map to { path: string, name: string, pathContext: string }
  → Render in LinkAutocomplete.svelte popup

User selects a file, then types "#"
  → Fetch headings: window.api.getFile(root, filePath) returns DocumentInfo with headings
  → Or parse from file content if available in outline store
  → Show heading hierarchy list (indented by level)

User selects heading (or presses Enter without heading)
  → Insert wikilink node: { target: "chunking-strategies", anchor: "Heading Name" }
  → Serializes to [[chunking-strategies#Heading Name]]
  → Popup closes
```

**Stale result prevention**: Use the same generation counter pattern from `stores/search.ts` — increment a counter, discard results from older generations.

### FileTree Drag & Drop

**FileTreeNode.svelte changes:**

```svelte
<button
  class="tree-node-button"
  draggable={!node.is_dir}
  ondragstart={(e) => {
    const name = node.name.replace(/\.md$/, '')
    e.dataTransfer.setData('text/plain', `[[${name}]]`)
    e.dataTransfer.setData('application/x-mdvdb-path', node.path)
    e.dataTransfer.effectAllowed = 'link'
  }}
  ...
>
```

**WysiwygEditor.svelte drop handling:**

A ProseMirror plugin listens for `drop` events, checks for `application/x-mdvdb-path` in `dataTransfer`, calculates drop position via `view.posAtCoords()`, and inserts a `wikilink` node. TipTap's `Dropcursor` extension provides the visual indicator.

### Visual Frontmatter Editor

`FrontmatterEditor.svelte` renders above TipTap content inside `WysiwygEditor.svelte`:

- Each key-value pair is an inline editable row with type-aware inputs
- **Supported types**: text (string input), number (number input), date (date picker), tags (array of chips with add button), boolean (toggle switch)
- "Add property" button at the bottom opens an inline form (key name + type selector)
- Delete property via trash icon with confirmation popover
- Changes immediately update `isDirty` and call `serializeFrontmatter()` to rebuild YAML
- Original key ordering is preserved; new keys appended at end
- Complex nested YAML values (objects, deeply nested arrays) shown as raw text fields

### Design System

All styles match the existing design tokens from `tokens.css`:

| Element | Style |
|---|---|
| Editor background | `var(--color-background)` (#0f0f10) |
| Content surface | `var(--color-surface)` (#161617) |
| Headings | Space Grotesk, H1 2.25em / H2 1.5em / H3 1.25em, `var(--color-text-main)` |
| Body text | Space Grotesk, 1em, `var(--color-text-main)` (#e4e4e7) |
| Code | JetBrains Mono, `rgba(0, 229, 255, 0.1)` background |
| Wikilinks | `var(--color-primary)` (#00E5FF), pointer cursor, underline on hover |
| Slash menu | Dark surface card, `var(--color-border)` border, cyan highlight on selected item |
| Bubble menu | Dark floating bar, icon buttons, cyan active states |
| Block handles | Subtle grip icon, `var(--color-text-dim)` (#71717a), visible on hover |
| `+` button | Same dim color, hover → `var(--color-primary)` |
| Link popup | Compact list, file icon + path text, cyan highlight on focused result |
| Frontmatter | `var(--color-surface)` panel, `var(--color-border)` divider below |

---

## New Files

| File | Purpose |
|---|---|
| `components/WysiwygEditor.svelte` | Main component: TipTap lifecycle, file switching, save, cache, conflict detection |
| `components/wysiwyg/SlashCommandMenu.svelte` | Slash command popup (filterable block type list) |
| `components/wysiwyg/BubbleMenu.svelte` | Floating inline formatting toolbar on text selection |
| `components/wysiwyg/BlockToolbar.svelte` | Left-side `+` button and drag handle per block |
| `components/wysiwyg/LinkAutocomplete.svelte` | `[[` triggered link suggestion popup with typeahead |
| `components/wysiwyg/FrontmatterEditor.svelte` | Visual property editor above content |
| `lib/tiptap/wikilink-extension.ts` | Custom TipTap node for `[[wikilinks]]` with markdown round-trip |
| `lib/tiptap/slash-command-extension.ts` | `/` suggestion plugin binding slash commands |
| `lib/tiptap/link-autocomplete-extension.ts` | `[[` suggestion plugin with FTS search integration |
| `lib/tiptap/block-drag-extension.ts` | Block drag handles + `+` toolbar ProseMirror plugin |
| `lib/tiptap/markdown-bridge.ts` | Frontmatter split/join, YAML serialization |
| `lib/tiptap/editor-factory.ts` | Factory to create a fully configured TipTap instance |
| `lib/tiptap/wysiwyg-theme.css` | Dark theme CSS for TipTap matching design system |

## Modified Files

| File | Changes |
|---|---|
| `stores/editor.ts` | Add `'wysiwyg'` to `EditorMode` type, update `toggleEditorMode()` to cycle 3 modes |
| `App.svelte` | Add 3rd "WYSIWYG" tab button, conditional render `<WysiwygEditor />`, update Cmd+E shortcut |
| `components/FileTreeNode.svelte` | Add `draggable` attribute + `ondragstart` handler for drag-and-drop links |
| `package.json` | Add TipTap + lowlight dependencies |

---

## Implementation Steps

### Subtask 1: Store + Routing Foundation
- Add `'wysiwyg'` to `EditorMode` type in `stores/editor.ts`
- Update `toggleEditorMode()` to cycle: preview → wysiwyg → editor → preview
- Add `setEditorMode()` already supports the new type via the union
- Add 3rd "WYSIWYG" tab button in `App.svelte` mode toggle bar
- Rename "Editor" tab label to "Source" for clarity
- Conditional render: show `<WysiwygEditor />` when mode is `wysiwyg`
- Create minimal `WysiwygEditor.svelte` placeholder (empty div, no TipTap yet)
- Verify mode cycling with Cmd+E and all three tabs render correctly

### Subtask 2: TipTap Core + Markdown Bridge
- Install all TipTap npm dependencies listed above
- Implement `splitFrontmatter()` and `joinFrontmatter()` in `lib/tiptap/markdown-bridge.ts`
- Create `createWysiwygEditor()` factory in `lib/tiptap/editor-factory.ts` with: StarterKit, Link, Placeholder, Typography, Markdown, Dropcursor, Image
- Wire `WysiwygEditor.svelte` fully:
  - Mount TipTap editor in `onMount`, destroy in `onDestroy`
  - Load content from `fileContent` store via `splitFrontmatter()`
  - Handle file switching (same destroy/recreate pattern as `Editor.svelte`)
  - Debounced (200ms) content sync to `propertiesFileContent`, `isDirty`, `wordCount`, `tokenCount`
  - Handle `saveRequested` store subscription for Cmd+S
- Apply dark theme CSS in `lib/tiptap/wysiwyg-theme.css`
- Verify: open a file in WYSIWYG mode, see rendered content, edit and save

### Subtask 3: Wikilink Custom Extension
- Define ProseMirror inline node spec for `wikilink` node in `lib/tiptap/wikilink-extension.ts`
- Attributes: `target` (string), `anchor` (string | null), `display` (string | null)
- Implement markdown parse rule: detect `[[target]]`, `[[target#anchor]]`, `[[target|display]]`
- Implement markdown serialize rule: output correct `[[...]]` format
- Register via `@tiptap/markdown` custom tokenizer API
- Style: cyan color, pointer cursor, subtle underline on hover
- Click handler: navigate to target file via `selectFile(target)`
- Verify: open file with wikilinks → rendered as cyan spans → click navigates → save preserves syntax

### Subtask 4: Bubble Menu (Inline Formatting Toolbar)
- Create `components/wysiwyg/BubbleMenu.svelte`
- Floating toolbar appears on text selection
- Buttons: Bold (B), Italic (I), Code (< >), Strikethrough (S), Link (chain icon)
- Position via ProseMirror selection coordinates using `view.coordsAtPos()`
- Toggle active state based on current marks
- Link button: prompts for URL or toggles link mark
- Dark theme: `var(--color-surface)` background, `var(--color-border)` border, icon buttons

### Subtask 5: Slash Command Menu
- Implement TipTap suggestion plugin with `/` trigger in `lib/tiptap/slash-command-extension.ts`
- Define command items with Material Symbols icons:
  - Heading 1 (`format_h1`), Heading 2 (`format_h2`), Heading 3 (`format_h3`)
  - Bullet List (`format_list_bulleted`), Numbered List (`format_list_numbered`)
  - Todo List (`checklist`), Code Block (`code_blocks`), Table (`table`)
  - Blockquote (`format_quote`), Horizontal Rule (`horizontal_rule`), Image (`image`)
- Each item maps to TipTap chain command (e.g., `editor.chain().focus().toggleHeading({ level: 1 }).run()`)
- Create `components/wysiwyg/SlashCommandMenu.svelte`:
  - Filterable list (type after `/` to narrow)
  - Keyboard navigation: arrow keys, Enter to select, Escape to dismiss
  - Dark surface card with cyan highlight on focused item
  - Item: icon + label + optional description

### Subtask 6: Table, CodeBlock, TaskList Extensions
- Add Table suite extensions (Table, TableRow, TableCell, TableHeader) to editor factory
- Add CodeBlockLowlight with `lowlight` for syntax highlighting
- Language selector dropdown on code blocks (top-right corner)
- Add TaskList + TaskItem for interactive todo checkboxes
- Register markdown serializers for all elements
- Verify: create tables in WYSIWYG → add/remove rows/columns → save → source shows pipe syntax

### Subtask 7: Link Autocomplete (Critical Feature)
- Implement suggestion plugin with `[[` trigger in `lib/tiptap/link-autocomplete-extension.ts`
- On query change (after debounce 150ms):
  - Call `window.api.search(root, query, { mode: 'lexical', limit: 10 })`
  - Deduplicate results by `file.path` (multiple chunks from same file → one result)
  - Map to `{ path, name, pathContext }` for display
- Create `components/wysiwyg/LinkAutocomplete.svelte`:
  - Compact list: file icon + name + dim path context
  - Keyboard: arrow keys, Enter to select, Escape to dismiss
  - Generation counter to prevent stale results
- After file selection: detect `#` keypress to enter heading mode
  - Fetch headings via `window.api.getFile(root, filePath)`
  - Display heading hierarchy (indented by level)
  - Arrow keys + Enter to select heading
- On confirm: insert `wikilink` node with `{ target, anchor }`
- Handle edge cases: empty query (show recent files?), no results message, network errors

### Subtask 8: Block Drag Handles + `+` Toolbar
- Create ProseMirror decoration plugin in `lib/tiptap/block-drag-extension.ts`
- For each top-level block node, add a widget decoration on the left side:
  - Drag handle (grip icon, `drag_indicator` Material Symbol)
  - `+` button (`add` Material Symbol)
- Handles visible on hover (transition from transparent to `var(--color-text-dim)`)
- Drag handle: enables ProseMirror node drag/drop for block reordering
- `+` button click: show block type conversion menu (reuse slash command items from Subtask 5)
- Create `components/wysiwyg/BlockToolbar.svelte` for the popup menu
- Verify: hover shows handles → drag to reorder → `+` shows menu → select converts block type

### Subtask 9: Visual Frontmatter Editor
- Create `components/wysiwyg/FrontmatterEditor.svelte`
- Receives parsed frontmatter data from `markdown-bridge.ts:splitFrontmatter()`
- Render each key-value pair as an editable row:
  - Key: editable text label
  - Value: type-aware input based on auto-detection:
    - String → text input
    - Number → number input
    - Boolean → toggle switch
    - Date (ISO string) → date picker
    - Array of strings → tag chips with `+` add button and `×` remove per chip
    - Complex (object, nested) → raw text textarea
- "Add property" button: inline form with key name + type dropdown
- Delete property: trash icon → confirmation popover → remove
- On any change:
  - `serializeFrontmatter(data)` → rebuild YAML string
  - `joinFrontmatter(newYaml, body)` → update full content
  - `isDirty.set(true)`
- Preserve original key ordering; new keys appended at end
- Visual: `var(--color-surface)` background, `var(--color-border)` bottom divider, collapsible

### Subtask 10: FileTree Drag & Drop into Editor
- Modify `components/FileTreeNode.svelte`:
  - Add `draggable={!node.is_dir}` to the button element
  - Add `ondragstart` handler setting `text/plain` (wikilink) + `application/x-mdvdb-path` (path)
  - Set `e.dataTransfer.effectAllowed = 'link'`
- Add ProseMirror plugin or `drop` event handler in `WysiwygEditor.svelte`:
  - Check for `application/x-mdvdb-path` in `dataTransfer`
  - Calculate drop position via `view.posAtCoords({ left: e.clientX, top: e.clientY })`
  - Insert `wikilink` node at that position with target = file name (sans `.md`)
- TipTap's `Dropcursor` extension (already installed in Subtask 2) provides visual indicator
- Verify: drag file from tree → see cursor in editor → drop → wikilink inserted at correct position

### Subtask 11: Document Cache + External Change Detection
- Integrate `WysiwygEditor.svelte` with existing `DocumentCache` from `lib/doc-cache.ts`
  - On file switch: serialize TipTap to markdown, save to cache with scroll position
  - On file load: check cache first, restore content + scroll position
  - Cache stores markdown strings (not TipTap JSON), so both editors share the same cache
- Implement 2-second external file change polling (same pattern as `Editor.svelte`):
  - Read file from disk periodically
  - Compare to `lastSavedContent`
  - If changed externally, show conflict notification via existing `ConflictNotification`
- Handle `saveRequested` counter properly (same as Source editor)
- Verify: switch files → come back → state restored → edit file externally → conflict shown

### Subtask 12: Polish + Accessibility
- Add `@media (prefers-reduced-motion: reduce)` on all transitions and animations
- Add ARIA attributes: `role="menu"` on slash/link popups, `role="toolbar"` on bubble menu, `aria-label` on all interactive elements
- Focus management: Escape closes any open popup, Tab moves to next interactive region
- Large file handling: disable WYSIWYG for files >1MB (reuse `LARGE_FILE_THRESHOLD`), show warning banner, force Source/Preview mode
- Verify all keyboard shortcuts work within TipTap: Cmd+B (bold), Cmd+I (italic), Cmd+K (link), Cmd+Z (undo), Cmd+Shift+Z (redo)
- Test all markdown elements round-trip with real files from `test-vault/`

---

## Anti-Patterns to Avoid

- **Do NOT use `svelte-tiptap` wrapper** — it doesn't support Svelte 5 runes. Use `@tiptap/core` directly.
- **Do NOT store TipTap JSON in the document cache** — always serialize to markdown. This ensures both editors (Source + WYSIWYG) share the same cache and content is always in a portable format.
- **Do NOT modify markdown files to add metadata** — the system NEVER writes computed data to markdown files. Frontmatter edits are the only exception (user-initiated).
- **Do NOT keep multiple editor instances mounted** — only one editor (Source or WYSIWYG) should be in the DOM at a time. Destroy on mode switch.
- **Do NOT reinvent search** — link autocomplete must use the existing `window.api.search()` IPC call, not a client-side file list scan.
- **Do NOT block the UI during search** — all IPC calls for link autocomplete must be async with proper debouncing and stale-result prevention.

## Patterns to Follow

- **Editor lifecycle**: Follow the exact same mount/destroy/cache/save/conflict pattern from `Editor.svelte` (the CodeMirror wrapper). It handles all the edge cases.
- **Store subscriptions**: Use `store.subscribe()` in `$effect()` blocks with cleanup, same as all existing components.
- **Debounced updates**: Use 200ms debounce for content sync to stores (same as `Editor.svelte`).
- **Design tokens**: Use CSS custom properties from `tokens.css`, never hardcode colors.
- **Material Symbols**: Use the existing icon font for all icons (already loaded globally).
- **Dark theme**: Match the existing CodeMirror theme colors exactly (see `lib/editor-theme.ts`).

---

## Validation Criteria

- [ ] 3-tab toggle works: Preview | WYSIWYG | Source, all three render correctly
- [ ] Cmd+E cycles through all three modes in order
- [ ] Opening a file in WYSIWYG shows rendered content (headings, lists, links, code blocks, tables)
- [ ] Editing in WYSIWYG sets `isDirty`, Cmd+S saves correctly, file on disk matches expected markdown
- [ ] Switching Source → WYSIWYG → Source preserves content exactly (markdown round-trip)
- [ ] `[[wikilinks]]` survive round-trip and render as cyan inline elements
- [ ] Clicking a wikilink in WYSIWYG navigates to the target file
- [ ] Typing `[[` opens link autocomplete popup with search results from FTS
- [ ] Link autocomplete filters as you type, keyboard navigable
- [ ] Selecting a file and typing `#` shows heading anchors for that file
- [ ] Slash command `/` opens filterable menu with all block types
- [ ] Selecting a slash command inserts the correct block type
- [ ] Text selection shows bubble menu with formatting options
- [ ] Applying formatting (bold, italic, etc.) via bubble menu works and persists on save
- [ ] Block drag handles appear on hover (left side of blocks)
- [ ] Blocks can be reordered via drag and drop
- [ ] `+` button on blocks opens type conversion menu
- [ ] Dragging a file from FileTree into WYSIWYG creates `[[wikilink]]` at drop point
- [ ] Drop indicator visible while dragging over editor
- [ ] Frontmatter editor shows document properties as editable fields
- [ ] Editing frontmatter values syncs back to YAML and marks file dirty
- [ ] Add/delete frontmatter property works correctly
- [ ] Tables can be created and edited (add/remove rows/columns)
- [ ] Code blocks show language selector and syntax highlighting
- [ ] Task list checkboxes toggle on click
- [ ] Document cache preserves WYSIWYG state across file switches
- [ ] External file changes trigger conflict notification in WYSIWYG mode
- [ ] Large files (>1MB) show warning and force Source/Preview mode
- [ ] Dark theme matches existing design system perfectly (no color mismatches)
- [ ] All transitions respect `prefers-reduced-motion`
- [ ] ARIA attributes present on all interactive elements
- [ ] `npm run lint` clean
