# PRD: Markdown Editor (CodeMirror 6)

## Overview

Integrate CodeMirror 6 as the central content editor with a custom soft-render theme that dims markdown syntax characters while preserving the underlying structure. The editor matches the mockup exactly: Space Grotesk body, dimmed `#`/`**`/backtick markers, styled frontmatter blocks, sized headings, and colored code blocks. Files are loaded on selection and saved with Cmd+S.

## Problem Statement

Users need to view and edit markdown files within the app. A raw textarea loses the visual hierarchy of headings, frontmatter, and code blocks. A full WYSIWYG hides the markdown structure. The mockup defines a middle ground — "soft-render" — where syntax characters are visible but dimmed, letting users see the raw markdown while keeping the document readable.

## Goals

- CodeMirror 6 editor with markdown language support
- Custom theme matching the mockup's soft-render aesthetic exactly
- Dimmed syntax characters (`#`, `**`, backticks, `>`, `---`, `- [ ]`) in `#526366`
- Styled headings at progressive font sizes
- Styled frontmatter block with colored YAML values
- Code blocks with dark background and JetBrains Mono font
- File loading from `fileContent` store on selection
- File saving via Cmd+S / Ctrl+S through IPC
- Dirty state tracking (unsaved changes indicator)
- Status bar: word count, estimated reading time

## Non-Goals

- Vim or Emacs keybindings (future enhancement)
- Image preview or embedding
- Live collaborative editing
- Spell checking (future enhancement)
- Split pane or side-by-side preview
- File creation or deletion (handled at OS level)
- Markdown export to HTML/PDF

## Technical Design

### Data Model Changes

No persistent data changes. New in-memory state:

```typescript
isDirty: Writable<boolean>        // True when editor content differs from saved file
wordCount: Writable<number>       // Updated on content change
readingTime: Writable<string>     // "N mins" (250 words/min average)
```

### Interface Changes

**New IPC channel:**
- `'fs:write-file'` → writes content to an absolute file path

**Updated preload `window.api`:**
```typescript
interface MdvdbApi {
  // ... existing methods ...
  writeFile(absolutePath: string, content: string): Promise<void>
}
```

### New Commands / API / UI

**Editor component: `app/src/renderer/components/Editor.svelte`**

The main content area component. Full width of the remaining space after sidebar, centered with `max-w-3xl`.

**Soft-render theme specifications** (from `app-mockup-code.html`):

| Element | Font | Size | Color | Extra |
|---|---|---|---|---|
| Body text | Space Grotesk | 17px | `#d1d5db` (gray-300) | `line-height: 1.8` |
| H1 | Space Grotesk | 2.25rem (36px) | `#ffffff` | `font-bold`, `tracking-tight` |
| H2 | Space Grotesk | 1.5rem (24px) | `#ffffff` | `font-semibold`, `tracking-tight` |
| H3 | Space Grotesk | 1.25rem (20px) | `#ffffff` | `font-medium`, `tracking-tight` |
| Syntax chars (`#`, `**`, etc.) | Space Grotesk | inherit | `#526366` | `opacity: 0.4-0.6`, `font-weight: normal` |
| Frontmatter delimiters `---` | JetBrains Mono | 13px | `#526366` | `opacity: 0.5` |
| Frontmatter keys | JetBrains Mono | 13px | `#71717a` (text-dim) | — |
| Frontmatter string values | JetBrains Mono | 13px | `#00E5FF` (primary) | — |
| Frontmatter status values | JetBrains Mono | 13px | `#34d399` (emerald-400) | — |
| Frontmatter array values | JetBrains Mono | 13px | `#60a5fa` (blue-400) | — |
| Frontmatter date values | JetBrains Mono | 13px | `#fdba74` (orange-300) | — |
| Code blocks | JetBrains Mono | 13px | `#71717a` | `bg: #0a0a0a`, `border: #27272a`, `rounded` |
| Code block header | JetBrains Mono | 11px | `#71717a` | `bg: #161617`, `border-b` |
| Inline code | JetBrains Mono | 13px | `#00E5FF` | `bg: #161617`, `border: #27272a`, `px-1.5 py-0.5 rounded` |
| Links | Space Grotesk | inherit | `#00E5FF` | `hover:underline`, `underline-offset-4` |
| Wikilinks `[[...]]` | Space Grotesk | inherit | `#00E5FF` | Same as links |
| Blockquotes | Space Grotesk | inherit | `#9ca3af` (gray-400) | `italic`, `border-l-2 border-primary`, `pl-5` |
| Bullet marker `-` | Space Grotesk | inherit | `#526366` | `select-none` |
| Checkbox unchecked `- [ ]` | — | — | `#71717a` border | `w-4 h-4`, `rounded-sm`, `bg-surface-darker` |
| Checkbox checked `- [x]` | — | — | `#00E5FF` fill | `shadow: 0 0 8px rgba(0,229,255,0.3)` |

**Frontmatter block container:**
- `bg-surface-darker border border-border-dark rounded-md p-5`
- Left accent bar: `w-1 h-full bg-border-dark` (hover: `bg-primary`)
- Grid layout: `grid-cols-[100px_1fr]` for key-value pairs

**Content area layout:**
- Container: `max-w-3xl mx-auto py-16 px-10`
- Background: `#0f0f10` (background-dark)

### Migration Strategy

N/A — new component.

## Implementation Steps

1. **Install CodeMirror 6 packages** — `npm install @codemirror/view @codemirror/state @codemirror/language @codemirror/commands @codemirror/lang-markdown @codemirror/language-data @lezer/highlight`. These are the core CM6 modules needed for markdown editing.

2. **Add file writing IPC** — In `app/src/main/ipc-handlers.ts`, add handler for `'fs:write-file'`: accepts `(absolutePath, content)`, validates path is within a known collection root, writes with `fs.promises.writeFile(path, content, 'utf-8')`. Update preload with `writeFile()` method.

3. **Create editor theme** — `app/src/renderer/lib/editor-theme.ts`:
   - Use `EditorView.theme()` to define the base theme: background color, cursor color, selection color, line height, font family, padding.
   - Use `HighlightStyle.define()` with `@lezer/highlight` tags to style markdown tokens:
     - `tags.heading1` → large font, white, bold
     - `tags.heading2` → medium font, white, semibold
     - `tags.heading3` → slightly larger font, white, medium
     - `tags.emphasis` → italic
     - `tags.strong` → bold, white
     - `tags.link` → primary color
     - `tags.url` → primary color, dimmed
     - `tags.monospace` → JetBrains Mono, primary color, surface background
     - `tags.meta` (frontmatter) → dimmed syntax color
     - `tags.processingInstruction` (code fences) → dimmed
   - Create custom decorations for markdown syntax characters to apply `#526366` color and reduced opacity.

4. **Create frontmatter decoration plugin** — `app/src/renderer/lib/frontmatter-decoration.ts`:
   - CodeMirror `ViewPlugin` that detects `---` delimited YAML at the start of the document.
   - Wraps the entire frontmatter block in a `Decoration.widget` or `Decoration.line` to apply the styled container (background, border, padding, accent bar).
   - Applies syntax highlighting to frontmatter values by type (string → primary, status keywords → emerald, arrays → blue, dates → orange).

5. **Create soft-render plugin** — `app/src/renderer/lib/soft-render.ts`:
   - CodeMirror `ViewPlugin` that finds markdown syntax characters (`#`, `**`, `__`, backticks, `>`, `-`, `- [ ]`, `- [x]`, `---`) and applies `Decoration.mark` with the dimmed syntax color class.
   - Heading markers (`#`, `##`, `###`) get `opacity: 0.4`, `font-weight: normal`, `color: #526366`.
   - Bold/italic markers (`**`, `__`, `*`, `_`) get same dimmed treatment.
   - List markers (`-`) get `color: #526366`.

6. **Build Editor component** — `app/src/renderer/components/Editor.svelte`:
   - Create `EditorView` on mount with extensions: markdown language, theme, soft-render plugin, frontmatter decoration, key bindings (default + save).
   - Subscribe to `fileContent` store: when it changes, replace editor content with `view.dispatch({ changes: { from: 0, to: doc.length, insert: newContent } })`.
   - On content change: update `isDirty`, `wordCount`, `readingTime` stores.
   - Save keybinding: `Mod-s` → get editor content → construct absolute path → call `window.api.writeFile()` → set `isDirty = false`.
   - Wrap in `max-w-3xl mx-auto py-16 px-10` container.
   - Destroy `EditorView` on component unmount.

7. **Integrate into App layout** — Render `Editor` component in the main content area (between header and status bar). Show only when `activeFilePath` is not null. When null, show empty state: "Select a file from the sidebar".

8. **Update StatusBar** — Subscribe to `isDirty`, `wordCount`, `readingTime` stores:
   - Left side: "Markdown" label, word count (e.g., "742 words"), reading time (e.g., "4 mins").
   - Show dirty indicator: dot or "Modified" text next to the file name when unsaved.

9. **Update Header** — Add "Edit" button (from mockup): `bg-primary text-surface-darker rounded-sm font-bold text-xs uppercase`. For now this button is visual only (editor is always editable). Future phases may add a read-only toggle.

10. **Write unit tests** — `tests/unit/Editor.test.ts`:
    - Mount Editor component with mock content.
    - Verify EditorView is created.
    - Verify content loads correctly.
    - Verify `isDirty` becomes true after typing.
    - Test save handler writes correct content via mocked API.
    - Verify word count and reading time are calculated correctly.

11. **Write theme tests** — `tests/unit/editor-theme.test.ts`:
    - Verify theme produces correct CSS properties for background, text color, cursor.
    - Verify highlight styles map markdown tags to correct colors.

12. **Write E2E tests** — `tests/e2e/editor.test.ts`:
    - Open a collection, select a file.
    - Verify editor renders with content.
    - Type some text, verify dirty indicator appears.
    - Press Cmd+S, verify dirty indicator clears.
    - Reopen the file, verify saved content persists.

## Validation Criteria

- [ ] Opening a markdown file renders it in CodeMirror with the soft-render theme
- [ ] Markdown syntax characters (`#`, `**`, backticks, etc.) are dimmed to `#526366`
- [ ] H1 renders at 2.25rem bold white, H2 at 1.5rem semibold, H3 at 1.25rem medium
- [ ] Frontmatter block has styled container with left accent bar and colored values
- [ ] Code blocks render with `#0a0a0a` background, `#27272a` border, JetBrains Mono font
- [ ] Inline code renders with surface-darker background and primary text color
- [ ] Links and wikilinks render in `#00E5FF`
- [ ] Blockquotes have left primary border and italic gray text
- [ ] Checkboxes styled: unchecked = dim border, checked = primary fill with glow
- [ ] Cmd+S saves the file to disk
- [ ] Dirty indicator appears when content is modified, clears on save
- [ ] Status bar shows accurate word count and reading time
- [ ] Content area is centered with `max-w-3xl` and generous padding
- [ ] Editor properly cleans up on unmount / file switch
- [ ] All unit and E2E tests pass

## Anti-Patterns to Avoid

- **Do NOT use CodeMirror 5** — CodeMirror 6 is the current version. CM5 is legacy and has a different API. All imports should be from `@codemirror/*`.
- **Do NOT render markdown to HTML** — This is a source editor, not a preview renderer. The soft-render approach keeps the raw markdown editable while styling it visually. Never convert markdown to HTML for display.
- **Do NOT debounce file saving** — Save is explicit (Cmd+S only). No auto-save. Users expect manual save semantics.
- **Do NOT load the entire file into a Svelte store as reactive state** — Use CodeMirror's own document model. The Svelte `fileContent` store is for initial loading only. Once loaded into CM, the editor owns the content.
- **Do NOT create one giant extensions array** — Split extensions into separate modules: theme, soft-render plugin, frontmatter plugin, keybindings. Compose them in the Editor component.
- **Do NOT use `innerHTML` for any rendering** — CodeMirror handles all DOM manipulation through its own view system. Never inject HTML directly.

## Patterns to Follow

- **Mockup as source of truth** — Every visual element must match `docs/prds/app/app-mockup-code.html`. Cross-reference colors, font sizes, spacing, and layout with the HTML mockup file.
- **CodeMirror 6 plugin architecture** — Use `ViewPlugin` for decorations that need to re-run on document changes. Use `StateField` for state that needs to persist across transactions. Use `EditorView.theme()` for static CSS.
- **Extension composition** — Build each feature (theme, soft-render, frontmatter, keybindings) as a separate extension function that returns `Extension`. Combine with `[...allExtensions]` in the Editor component.
- **Reactive file loading** — Subscribe to `activeFilePath` in the Editor component. When it changes, dispatch a full content replacement transaction to CodeMirror.
