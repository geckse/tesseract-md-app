# PRD: Metadata Panel (Right Sidebar)

## Overview

The right sidebar displays three live sections: frontmatter properties, document heading outline, and backlinks/links between files. Properties and outline are parsed client-side from the current editor content and update in real-time as the user types (not just on save). Backlinks are fetched from the CLI. This phase is independent of Phases 6 and 7.

## Problem Statement

Users need contextual information about the document they're editing: what metadata is set, what sections exist, and what other files link to this one. This information exists in the CLI (`mdvdb get`, `mdvdb backlinks`) and in the file content (frontmatter, headings), but it needs to be surfaced alongside the editor in a non-intrusive panel.

## Goals

- Right sidebar (288px) matching the mockup layout
- **Properties section**: live frontmatter display, updated on every editor keystroke (debounced 200ms)
- **Outline section**: heading hierarchy from current document, click to scroll editor
- **Backlinks section**: incoming links from other files (via `mdvdb backlinks --json`)
- Toggle button in the header to show/hide the panel
- Active heading tracking in the outline based on editor scroll position
- Backlink cards with filename and context snippet

## Non-Goals

- Editing frontmatter from the sidebar (read-only display)
- Outgoing links display (showing what the current file links TO — deferred)
- Orphan detection in the sidebar (use `mdvdb orphans` CLI)
- Link graph visualization
- Nested/indented outline (all headings at flat list for now, but with visual level indicators)
- Cross-collection backlinks

## Technical Design

### Data Model Changes

No persistent data. New stores and derived state:

```typescript
frontmatterData: Writable<Record<string, unknown> | null>  // Parsed from editor content
headingOutline: Writable<HeadingEntry[]>                    // Parsed from editor content
backlinks: Writable<BacklinkEntry[]>                        // From CLI
metadataPanelOpen: Writable<boolean>                        // Panel visibility (persisted)
activeHeadingIndex: Writable<number>                        // Based on scroll position

interface HeadingEntry {
  level: number          // 1-6
  text: string           // Heading text without # prefix
  line: number           // Line number in the document
}

interface BacklinkEntry {
  sourcePath: string     // File that links to the current file
  sourceTitle: string    // First heading or filename
  context: string        // Text snippet around the link
  lineNumber: number     // Line in the source file
}
```

### Interface Changes

No new IPC channels. Uses existing:
- `window.api.backlinks(root, filePath)` from Phase 2
- Frontmatter parsing and heading extraction are client-side only

### New Commands / API / UI

**Metadata panel layout** (matching mockup right sidebar):

```
┌─ METADATA ──────────────────────────┐
│                                      │
│ ⚙ PROPERTIES                        │
│                                      │
│ Status    [● In Progress]            │
│ Tags      [#design] [#specs] [#v1]   │
│ Created   Oct 24, 2023               │
│ author    John Doe                   │
│                                      │
│ ────────────────────────             │
│                                      │
│ 🔗 BACKLINKS                    [2]  │
│                                      │
│ ┌─ Product Roadmap ────────────────┐ │
│ │ ...as referenced in the [[Design │ │
│ │ Specs]], we will be moving to...  │ │
│ └──────────────────────────────────┘ │
│                                      │
│ ┌─ Daily Standup 10/24 ────────────┐ │
│ │ ...discussed the [[Design        │ │
│ │ Specs]] with the engineering...   │ │
│ └──────────────────────────────────┘ │
│                                      │
│ ────────────────────────             │
│                                      │
│ 📋 OUTLINE                           │
│ │                                    │
│ ├ Markdown Editor View  (active)     │
│ ├ Core Components                    │
│ ├ Design Principles                  │
│ └ Next Steps                         │
│                                      │
└──────────────────────────────────────┘
```

**Properties section styling** (from mockup):
- Section header: `text-[11px] font-bold text-text-dim uppercase tracking-wider` with tune icon
- Grid layout: `grid-cols-[80px_1fr]` for label/value pairs
- Status badge: colored pill — yellow for "In Progress", green for "Done", red for "Blocked", blue for "Draft"
- Tags: small chips with `bg-surface-dark border border-border-dark text-[11px]`, hover → `border-primary text-primary`
- Dates: `font-mono text-xs text-gray-400`, formatted as "Oct 24, 2023"
- String values: `text-gray-400 text-xs`

**Backlinks section styling** (from mockup):
- Section header with count badge: `bg-surface-dark px-1.5 py-0.5 rounded text-[10px] font-mono border border-border-dark`
- Each backlink as a card: `p-3 rounded bg-surface-dark border border-border-dark hover:border-primary/50`
- Title: `text-[13px] text-gray-300 font-medium` with article icon
- Context: `text-[11px] text-text-dim line-clamp-2 font-mono`

**Outline section styling** (from mockup):
- Left border: `border-l border-border-dark ml-1.5 pl-3`
- Active heading: `text-primary font-medium`
- Inactive: `text-text-dim hover:text-white`
- Font size: `text-[13px]`
- Indent: h2 = 0px extra indent, h3 = 12px, h4 = 24px (relative to base)

**Toggle button:**
- In header: `side_navigation` Material Symbol icon
- `text-text-dim hover:text-primary hover:bg-surface-darker rounded`
- When panel is open: icon highlighted in primary color

### Migration Strategy

N/A — new component.

## Implementation Steps

1. **Create frontmatter parser** — `app/src/renderer/lib/frontmatter-parser.ts`:
   - `parseFrontmatter(markdown: string): Record<string, unknown> | null`
   - Find opening `---` at start of document (line 1 or after optional whitespace).
   - Find closing `---`.
   - Extract the YAML string between them.
   - Parse with `js-yaml` (`npm install js-yaml @types/js-yaml`).
   - Return null if no valid frontmatter found.
   - Handle edge cases: no frontmatter, empty frontmatter, invalid YAML.

2. **Create heading extractor** — `app/src/renderer/lib/heading-extractor.ts`:
   - `extractHeadings(markdown: string): HeadingEntry[]`
   - Regex: `/^(#{1,6})\s+(.+)$/gm` — match ATX headings.
   - For each match: extract level (number of `#`), text (trimmed), line number.
   - Skip headings inside code blocks (between triple backtick fences).
   - Return sorted by line number.

3. **Create stores** — `app/src/renderer/stores/metadata.ts`:
   - `frontmatterData`, `headingOutline`, `backlinks`, `metadataPanelOpen`, `activeHeadingIndex`.
   - `metadataPanelOpen` persisted via localStorage, defaults to `true`.
   - `updateFromEditor(content: string)`: debounced (200ms), calls `parseFrontmatter()` and `extractHeadings()`, updates stores.
   - `fetchBacklinks(root, filePath)`: calls `window.api.backlinks(root, filePath)`, maps to `BacklinkEntry[]`.

4. **Wire editor content to metadata stores** — In `Editor.svelte` or a parent component:
   - On every CodeMirror `updateListener`: call `updateFromEditor(doc.toString())` with 200ms debounce.
   - On file open: call `fetchBacklinks()` for the new file.

5. **Build Properties section** — `app/src/renderer/components/metadata/Properties.svelte`:
   - Renders `frontmatterData` as key-value grid.
   - Special rendering for known keys:
     - `status`: colored badge (map common values: "in-progress" → yellow, "done" → green, "draft" → blue, "blocked" → red, other → gray).
     - `tags`: array of pill chips.
     - `date`, `created`, `updated`: formatted with `toLocaleDateString()`.
     - Other: plain text display.
   - Empty state: "No frontmatter" dim text.

6. **Build Outline section** — `app/src/renderer/components/metadata/Outline.svelte`:
   - Renders `headingOutline` as a nav list.
   - Each heading: click handler scrolls the editor to that line via CodeMirror API.
   - Active heading tracking: listen to editor scroll position, find the heading closest to the current viewport top, set `activeHeadingIndex`.
   - Indent levels: h1 = no indent, h2 = +0px, h3 = +12px, h4 = +24px (visual hierarchy within the flat list).

7. **Build Backlinks section** — `app/src/renderer/components/metadata/Backlinks.svelte`:
   - Renders `backlinks` array as cards.
   - Count badge showing total backlinks.
   - Each card: source file title (first heading from `mdvdb get` or filename), context snippet from the CLI response.
   - Click: navigate to that file (set `activeFilePath`).
   - Loading state while fetching.
   - Empty state: "No backlinks" dim text.

8. **Build MetadataPanel container** — `app/src/renderer/components/MetadataPanel.svelte`:
   - Container: `w-72 bg-surface-darker border-l border-border-dark flex flex-col`.
   - Header: "Metadata" label in same style as mockup.
   - Three sections with dividers between them.
   - Scrollable content area.
   - Conditionally rendered based on `metadataPanelOpen`.

9. **Add toggle button to Header** — Add `side_navigation` icon button next to the Edit button. Click toggles `metadataPanelOpen`. Highlight when open.

10. **Integrate into App layout** — MetadataPanel renders to the right of the editor, inside the content `flex` container. When hidden, editor gets full width.

11. **Write unit tests**:
    - `tests/unit/frontmatter-parser.test.ts`: valid YAML, empty frontmatter, no frontmatter, invalid YAML, frontmatter with arrays/objects/dates.
    - `tests/unit/heading-extractor.test.ts`: h1-h6, multiple headings, headings inside code blocks (should be skipped), empty document.
    - `tests/unit/Properties.test.ts`: render with mock frontmatter, verify status badge color, verify tags as chips.
    - `tests/unit/Outline.test.ts`: render with mock headings, verify click handlers, verify active heading highlight.
    - `tests/unit/Backlinks.test.ts`: render with mock backlinks, verify card rendering, verify click navigation.

12. **Write E2E tests** — `tests/e2e/metadata-panel.test.ts`:
    - Open a file with frontmatter, verify properties panel shows values.
    - Edit frontmatter in the editor, verify panel updates within ~200ms.
    - Verify outline shows headings from the document.
    - Click an outline heading, verify editor scrolls to that position.
    - Toggle panel visibility, verify it hides/shows.

## Validation Criteria

- [ ] Panel shows frontmatter properties parsed from the current editor content
- [ ] Editing frontmatter in the editor updates the properties display within ~200ms
- [ ] Status values show as colored badges (yellow/green/red/blue)
- [ ] Tags display as small clickable chips
- [ ] Dates are formatted in human-readable form
- [ ] Heading outline lists all headings with correct hierarchy
- [ ] Clicking an outline heading scrolls the editor to that position
- [ ] Active heading is highlighted based on current scroll position
- [ ] Backlinks section shows files that link to the current file
- [ ] Backlink cards show source filename and context snippet
- [ ] Clicking a backlink opens that file in the editor
- [ ] Panel can be toggled open/closed via the header button
- [ ] Panel visibility persists across app restarts
- [ ] Empty states shown for no frontmatter, no headings, no backlinks
- [ ] All unit and E2E tests pass

## Anti-Patterns to Avoid

- **Do NOT parse frontmatter on every keystroke** — Use 200ms debounce. Parsing YAML on every character would cause lag.
- **Do NOT fetch backlinks on every keystroke** — Backlinks only change when files are saved or the index updates. Fetch on file open and on watcher events, not on editor changes.
- **Do NOT use the CLI to parse frontmatter** — Client-side `js-yaml` parsing is instant. No need to spawn a CLI process for this.
- **Do NOT modify the markdown file from the metadata panel** — The panel is read-only. All editing happens in the CodeMirror editor.
- **Do NOT parse headings from inside code blocks** — A line like `# Comment` inside a fenced code block is not a heading. The heading extractor must track code fence state.

## Patterns to Follow

- **Mockup reference** — Right sidebar layout, spacing, and typography exactly match `app-mockup-code.html` lines 255-325.
- **Live updates from editor** — Use CodeMirror's `EditorView.updateListener` extension to get content changes, then parse client-side. This is instantaneous compared to CLI calls.
- **Debounce with cleanup** — The debounce function should clear its timeout when the component unmounts to prevent updating stores of a destroyed component.
- **Svelte reactive updates** — Use `$:` reactive declarations to derive display values from the raw frontmatter data (e.g., format dates, map status to colors).
