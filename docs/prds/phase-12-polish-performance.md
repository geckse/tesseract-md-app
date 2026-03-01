# PRD: Polish & Performance

## Overview

Final pass for animations, keyboard navigation, accessibility, performance optimization for large collections, and edge case handling. This phase makes the app feel polished and professional — smooth transitions, comprehensive keyboard support, a11y compliance, and graceful degradation for demanding scenarios.

## Problem Statement

Previous phases focused on functionality. This phase addresses the experience gap: transitions between states feel abrupt, keyboard-only users can't navigate efficiently, screen reader support is missing, large collections (1000+ files) cause UI lag, and various edge cases (large files, CLI crashes, corrupted indexes) lack graceful handling.

## Goals

- Smooth animations and transitions on all state changes
- Comprehensive keyboard navigation (shortcuts, focus management, arrow key nav)
- Quick file open: `Cmd+P` fuzzy finder overlay
- Accessibility: ARIA labels, focus rings, screen reader announcements, `prefers-reduced-motion`
- File tree virtualization for collections with 1000+ files
- Editor document caching for instant file switching
- Graceful edge case handling: large files, concurrent edits, CLI failures, corrupted index
- Resizable sidebar and metadata panel (drag handles)
- Window state persistence (size, position, panel states)

## Non-Goals

- Light mode theme
- Custom theme creation
- Touch/tablet optimization
- Voice control
- Internationalization (i18n) / localization
- Offline mode (the app already works offline except for embedding API calls)

## Technical Design

### Data Model Changes

**Store updates:**

```typescript
interface AppStore {
  // ... existing fields ...
  windowBounds: { x: number; y: number; width: number; height: number }
  sidebarWidth: number           // Default 256, resizable
  metadataPanelWidth: number     // Default 288, resizable
}
```

### Interface Changes

No new IPC channels. This phase modifies existing components and adds new UI utilities.

### New Commands / API / UI

**Animations:**

| Transition | Duration | Easing | Trigger |
|---|---|---|---|
| Sidebar collapse/expand | 200ms | ease-out | Toggle sidebar |
| Metadata panel slide | 200ms | ease-out | Toggle panel |
| File tree node expand | 150ms | ease-out | Click directory |
| Search results appear | 150ms | fade-in | Results load |
| Tab/panel switch | 100ms | ease-in-out | Content change |
| Status indicator pulse | 2s | infinite | Watcher active |
| Hover states | 150ms | ease | Mouse enter/leave |
| Focus ring | 100ms | ease | Focus change |
| Toast notifications | 300ms slide-in, 200ms fade-out | ease-out | Events |

**Keyboard shortcuts:**

| Shortcut | Action |
|---|---|
| `Cmd+K` | Open search (existing, Phase 6) |
| `Cmd+S` | Save file (existing, Phase 5) |
| `Cmd+P` | Quick file open (fuzzy finder) |
| `Cmd+B` | Toggle sidebar |
| `Cmd+Shift+B` | Toggle metadata panel |
| `Cmd+1..9` | Switch to collection 1-9 |
| `Cmd+W` | Close current file (deselect) |
| `Cmd+,` | Open settings |
| `Escape` | Close modal/search/popover, deselect |
| `Arrow Up/Down` | Navigate file tree (when sidebar focused) |
| `Enter` | Open selected tree node / expand directory |
| `Arrow Left/Right` | Collapse/expand directory in tree |
| `Tab` / `Shift+Tab` | Move focus between major regions (sidebar → editor → metadata panel) |

**Quick file open (`Cmd+P`):**
- Modal overlay similar to VS Code's quick open
- Text input with fuzzy matching on file paths
- Results list: file path with matched characters highlighted
- Arrow keys to navigate, Enter to open, Escape to close
- Searches across all files in the active collection (uses `fileTree` store data, no CLI call)

**Accessibility:**
- All interactive elements: `role`, `aria-label`, `aria-expanded` (for collapsibles), `aria-selected` (for lists)
- Focus ring: `ring-2 ring-primary ring-offset-2 ring-offset-background-dark` (visible focus indicator)
- `aria-live="polite"` regions for: search result count changes, watcher events, ingest progress
- `prefers-reduced-motion`: disable all `transition` and `animation` CSS; use instant state changes instead
- Landmark regions: `role="navigation"` (sidebar), `role="main"` (editor), `role="complementary"` (metadata panel)
- Skip link: hidden "Skip to main content" link that becomes visible on Tab focus

**Performance optimizations:**
- **File tree virtualization**: For collections with 500+ visible nodes, use a virtual list that only renders nodes within the viewport. Libraries: `svelte-virtual-list` or custom implementation with `IntersectionObserver`.
- **Editor document cache**: Keep the last 5 file contents in a Map. When switching files, check cache first. Avoids re-reading from disk and re-initializing CodeMirror.
- **Search result virtual list**: If >20 results, virtualize the results panel.
- **Lazy component loading**: Load the Settings panel, KeyboardShortcuts modal, and IngestPanel only when needed (dynamic import).
- **Debounce all CLI calls**: Ensure no duplicate concurrent calls for the same command. Use a request dedup map.
- **Tree diff updates**: When refreshing the file tree, diff against the previous tree and only update changed nodes. Avoids full re-render.

**Edge case handling:**
- **Large files (>1MB)**: Warn the user before loading. Disable live frontmatter/outline parsing (too slow). Fall back to basic CodeMirror without decorations.
- **CLI timeout**: Show "The operation is taking longer than expected" with a cancel button.
- **CLI not found after installation**: Re-detect CLI and show a clear error message in the status bar.
- **Corrupted index**: Detect via `mdvdb doctor --json` check failures. Show "Index issue detected" banner with "Reindex" button.
- **Concurrent file edits**: If the watcher reports a change to the currently edited file, show "File changed on disk" notification with options: "Reload" (discard editor changes) or "Keep mine" (overwrite on next save).
- **Network errors during ingest**: Show the error from the CLI (e.g., "Failed to connect to OpenAI API") with a "Retry" button.

**Resizable panels:**
- Sidebar: drag handle on right edge (cursor: `col-resize`)
- Metadata panel: drag handle on left edge
- Min/max widths: sidebar 180-400px, metadata panel 200-500px
- Panel widths persisted in electron-store

**Window management:**
- Save window bounds (x, y, width, height) on move/resize (debounced 500ms)
- Restore on app launch
- Minimum window size: 900x600

### Migration Strategy

N/A — modifications to existing components.

## Implementation Steps

1. **Add CSS transition utilities** — Create `app/src/renderer/styles/transitions.css`:
   - Define reusable transition classes: `transition-slide`, `transition-fade`, `transition-expand`.
   - Add `@media (prefers-reduced-motion: reduce)` block that sets all transition durations to 0.

2. **Add animations to existing components**:
   - Sidebar: wrap in Svelte `transition:slide` or CSS transition on width.
   - Metadata panel: same slide transition.
   - File tree expand: height animation on `{#if expanded}` blocks.
   - Search results: `transition:fade` on the results panel.
   - Hover states: ensure all interactive elements have `transition-colors duration-150`.

3. **Build keyboard shortcut system** — `app/src/renderer/lib/shortcuts.ts`:
   - Global keydown listener on `window`.
   - Map of shortcut → action function.
   - Platform-aware: `Cmd` on macOS, `Ctrl` on Windows/Linux.
   - Prevent shortcuts when inside input fields (except Cmd+S, Escape).
   - Register all shortcuts from the table above.

4. **Build QuickOpen component** — `app/src/renderer/components/QuickOpen.svelte`:
   - Modal overlay: `fixed inset-0 bg-black/50 flex items-start justify-center pt-[20vh]`.
   - Input with fuzzy search against `fileTree` paths.
   - Results list: virtual list if >20 items.
   - Highlight matched characters in file paths.
   - Arrow Up/Down to navigate, Enter to open, Escape to close.
   - `Cmd+P` to toggle.

5. **Implement focus management**:
   - Tab order: sidebar → editor → metadata panel.
   - `tabindex` on major regions.
   - Arrow key navigation within the file tree.
   - Auto-focus editor when a file is opened.
   - Return focus to sidebar when file is deselected.

6. **Add ARIA attributes** — Update all components:
   - Sidebar: `role="navigation"`, `aria-label="File navigation"`.
   - File tree items: `role="treeitem"`, `aria-expanded`, `aria-selected`.
   - Editor: `role="main"`, `aria-label="Document editor"`.
   - Metadata panel: `role="complementary"`, `aria-label="Document metadata"`.
   - Search results: `role="listbox"`, individual results `role="option"`.
   - Live regions: `aria-live="polite"` on status bar, search result count, ingest progress.

7. **Add skip navigation link** — Hidden link at top of page: visible on focus, jumps to editor content.

8. **Implement file tree virtualization** — For the `FileTree` component:
   - Flatten the tree into a visible-nodes array (only expanded directories contribute children).
   - Render only nodes within the scroll viewport + 10 node buffer above/below.
   - Use fixed row height (32px per node) for accurate scroll calculations.
   - Recalculate visible nodes on scroll (throttled to 60fps).

9. **Implement editor document cache** — `app/src/renderer/lib/doc-cache.ts`:
   - LRU cache with max 5 entries.
   - Key: `collectionId:filePath`. Value: `{ content, scrollPos, cursorPos }`.
   - On file switch: save current state to cache, load next file from cache (if hit) or disk.
   - On save: update cache entry.

10. **Build resizable panels** — `app/src/renderer/components/ResizeHandle.svelte`:
    - Vertical drag handle component (8px wide, visible on hover).
    - `mousedown` → track drag → update panel width → `mouseup`.
    - Clamp to min/max widths.
    - Persist widths to electron-store on mouseup (debounced).

11. **Wire window state persistence** — In `app/src/main/index.ts`:
    - On window `move`/`resize` (debounced 500ms): save bounds to store.
    - On create window: restore from store. Fall back to centered default.
    - Set `minWidth: 900, minHeight: 600`.

12. **Handle edge cases**:
    - Large file detection: check `fileContent.length > 1_000_000` before initializing decorations.
    - Concurrent edit detection: compare file mtime on watcher event vs editor's last-load time.
    - CLI failure recovery: wrap all CLI calls in try/catch, show user-friendly errors.
    - Corrupted index: run `mdvdb doctor --json` on collection open, show banner if checks fail.

13. **Write unit tests**:
    - `tests/unit/shortcuts.test.ts`: verify each shortcut triggers the correct action, verify platform-aware Cmd/Ctrl.
    - `tests/unit/QuickOpen.test.ts`: fuzzy match algorithm, highlight matched chars, keyboard navigation.
    - `tests/unit/doc-cache.test.ts`: LRU eviction, save/restore cursor position.
    - `tests/unit/ResizeHandle.test.ts`: drag behavior, min/max clamping.

14. **Write E2E tests**:
    - `tests/e2e/keyboard.test.ts`: press Cmd+K (search opens), Cmd+S (file saves), Cmd+B (sidebar toggles), Cmd+P (quick open appears).
    - `tests/e2e/performance.test.ts`: create collection with 1000 dummy files, open in app, verify file tree renders within 2s, scrolling is smooth.
    - `tests/e2e/accessibility.test.ts`: run axe-core audit via Playwright `@axe-core/playwright`, verify zero critical/serious violations.
    - `tests/e2e/window.test.ts`: resize window, close, reopen, verify same size.

15. **Run axe-core accessibility audit** — Integrate `@axe-core/playwright` into the E2E test suite. Run on the main app view. Fix all critical and serious violations.

## Validation Criteria

- [ ] All animations run at 60fps (no jank during transitions)
- [ ] `prefers-reduced-motion` disables all animations
- [ ] All keyboard shortcuts work correctly (Cmd+K, Cmd+S, Cmd+P, Cmd+B, etc.)
- [ ] `Cmd+P` opens fuzzy file finder that searches all files in collection
- [ ] Arrow keys navigate the file tree when sidebar is focused
- [ ] Tab/Shift+Tab cycles focus between sidebar, editor, and metadata panel
- [ ] All interactive elements have appropriate ARIA attributes
- [ ] axe-core accessibility audit: zero critical/serious violations
- [ ] File tree renders 1000+ files without lag (virtualized)
- [ ] Switching between recently opened files is instant (cached)
- [ ] Sidebar and metadata panel are resizable via drag handles
- [ ] Panel widths persist across app restarts
- [ ] Window size and position persist across restarts
- [ ] Large files (>1MB) show warning and load with basic decorations
- [ ] Concurrent file edit (watcher + editor) shows conflict notification
- [ ] CLI failures show user-friendly error messages with retry options
- [ ] No zombie processes on app quit in any scenario
- [ ] All unit, E2E, and accessibility tests pass

## Anti-Patterns to Avoid

- **Do NOT add animations without `prefers-reduced-motion` fallback** — Every `transition` and `animation` CSS property must have a reduced-motion override.
- **Do NOT use `setTimeout` for animations** — Use CSS transitions or Svelte's built-in transition system. JavaScript animation timers are unreliable and cause jank.
- **Do NOT render all 1000+ tree nodes** — Virtualize. Only render visible nodes. Rendering thousands of DOM elements kills scroll performance.
- **Do NOT cache unlimited documents** — The LRU cache is capped at 5 entries. Each cached document occupies memory (string content + cursor state).
- **Do NOT intercept browser-native shortcuts** — Don't override `Cmd+C` (copy), `Cmd+V` (paste), `Cmd+Z` (undo), `Cmd+A` (select all). These should always work natively in the editor.
- **Do NOT add aria-label to every element** — Only add ARIA attributes where native HTML semantics are insufficient. A `<button>` with visible text doesn't need `aria-label`.

## Patterns to Follow

- **Svelte transitions** — Use `transition:slide`, `transition:fade`, `in:fly`, `out:fade` for component mount/unmount animations. These are declarative and respect Svelte's lifecycle.
- **Virtual list pattern** — Calculate total height from item count × item height. Use `transform: translateY()` to offset the rendered items. Only render items within `scrollTop ± buffer`.
- **LRU cache** — Use a Map for O(1) lookups. On access, delete and re-insert to maintain insertion order. On insert, if size > max, delete the first entry (oldest).
- **Focus trap for modals** — When QuickOpen or KeyboardShortcuts modal is open, trap focus within the modal. On Escape, return focus to the previously focused element.
- **Conflict resolution UI** — Show inline notification bar below the header: "This file has been modified outside the editor." Two buttons: "Reload from disk" and "Keep editor version". No auto-merge — let the user decide.
