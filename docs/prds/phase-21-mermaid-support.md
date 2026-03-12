# PRD: Mermaid Diagram Support

## Overview

Add native Mermaid diagram rendering across Markdown Preview and the WYSIWYG Block Editor. Standard ` ```mermaid ` fenced code blocks render as interactive SVG diagrams using mermaid.js, configured to match the app's dark theme. In the WYSIWYG editor, mermaid blocks display as rendered diagrams by default with an edit button to toggle into a normal editable code block.

## Problem Statement

The app currently renders ` ```mermaid ` fenced code blocks as plain syntax-highlighted code, identical to any other language. Users of a markdown knowledge base frequently embed diagrams (flowcharts, sequence diagrams, ER diagrams, Gantt charts) to document architecture, processes, and relationships. Without Mermaid rendering, they must use external tools and paste screenshots — which aren't editable, aren't searchable, and break the markdown-native workflow.

## Goals

- Render ` ```mermaid ` fenced code blocks as SVG diagrams in Markdown Preview mode
- In the WYSIWYG editor, display mermaid blocks as rendered diagrams by default; clicking an edit button toggles them into a normal CodeBlockLowlight (with syntax highlighting, undo/redo, ProseMirror cursor); clicking away or pressing Escape returns to the diagram view
- Add a `/mermaid` slash command that inserts a mermaid code block with a starter flowchart template (opens in edit mode)
- Support all standard mermaid.js diagram types (flowchart, sequence, class, state, ER, Gantt, pie, journey, git graph, mindmap, timeline, etc.)
- Configure mermaid theming to match the app's dark design tokens
- Display clear, non-crashing error messages for invalid mermaid syntax
- Preserve round-trip fidelity: ` ```mermaid ` blocks survive Source → WYSIWYG → Source without modification
- Lazy-load mermaid.js to avoid impacting app startup time

## Non-Goals

- Mermaid editing toolbar or visual diagram builder — users edit raw mermaid syntax
- Diagram export to PNG/SVG as a standalone feature
- Custom mermaid theme editor in settings
- Mermaid rendering in the Source Editor (CodeMirror) — it remains a plain fenced code block there
- Server-side or pre-build mermaid rendering — all rendering is client-side in the Electron renderer
- Mermaid directive/config block support beyond standard ` ```mermaid ` fencing
- Collapsible diagram preview — diagrams are always visible

---

## Technical Design

### Data Model Changes

None. Mermaid diagrams are standard markdown fenced code blocks with the `mermaid` language identifier. No new data structures, no index changes, no new IPC channels.

### Interface Changes

**New module: `lib/mermaid-renderer.ts`**

```typescript
/** Lazy-load mermaid and render a diagram string to SVG HTML. */
export async function renderMermaidDiagram(
  id: string,
  code: string
): Promise<{ svg: string } | { error: string }>

/** Initialize mermaid with dark theme config. Called automatically on first render. */
export async function initMermaid(): Promise<void>
```

**New TipTap extension: `lib/tiptap/mermaid-block-extension.ts`**

A custom TipTap `Node.create()` extension that:
- Defines a `mermaidBlock` node type with a `code` attribute
- Uses a Svelte NodeView (`MermaidNodeView.svelte`) to render either SVG preview or editable code
- Handles markdown serialization/deserialization as ` ```mermaid\n...\n``` `

**New Svelte component: `components/wysiwyg/MermaidNodeView.svelte`**

The NodeView component displayed inside the WYSIWYG editor for mermaid blocks. Toggles between preview (SVG diagram + edit button) and edit (CodeBlockLowlight-style code editing) states.

### New Commands / API / UI

| Surface | Change |
|---------|--------|
| Slash command menu | New "Mermaid Diagram" item with `schema` icon |
| Markdown Preview | ` ```mermaid ` blocks render as SVG diagrams instead of code |
| WYSIWYG Editor | Mermaid blocks show as diagrams with hover edit button; edit mode = normal code block |

### Migration Strategy

No migration needed. Existing ` ```mermaid ` blocks in markdown files currently render as plain code. After this change they render as diagrams. Purely additive — no data changes, no config changes.

### CSP Considerations

Mermaid.js renders SVG with inline styles. The existing `'unsafe-inline'` in `style-src` (see `index.html`) already permits this. Mermaid does NOT require `eval()` or additional script sources. No CSP changes needed.

### Sanitization Considerations

The `sanitizeHtml()` function in `markdown-render.ts` strips `<script>`, event handlers, `<iframe>`, `<object>`, and `<embed>` tags. Mermaid SVG output contains only `<svg>`, `<g>`, `<path>`, `<rect>`, `<text>`, `<line>`, `<polygon>`, and `<marker>` elements — none of which are stripped. However, mermaid rendering MUST happen AFTER sanitization to be safe: `marked` produces placeholder `<div>`s (which pass sanitization safely), then mermaid renders SVG from the raw code string into those divs post-sanitization.

---

## Implementation Steps

### Step 1: Install mermaid.js dependency

Add `mermaid` to `app/package.json` dependencies:

```json
"mermaid": "^11.0.0"
```

Run `npm install` in the `app/` directory. Mermaid v11 is ESM-native.

### Step 2: Create the mermaid renderer utility

**Create** `app/src/renderer/lib/mermaid-renderer.ts`

This module lazy-loads mermaid on first use to avoid loading ~2MB at startup:

```typescript
let mermaidModule: typeof import('mermaid') | null = null
let initPromise: Promise<void> | null = null
let counter = 0

export async function initMermaid(): Promise<void> {
  if (initPromise) return initPromise
  initPromise = (async () => {
    mermaidModule = await import('mermaid')
    mermaidModule.default.initialize({
      startOnLoad: false,
      theme: 'dark',
      themeVariables: {
        darkMode: true,
        background: '#0f0f10',
        primaryColor: '#00E5FF',
        primaryTextColor: '#e4e4e7',
        primaryBorderColor: '#27272a',
        secondaryColor: '#161617',
        tertiaryColor: '#27272a',
        lineColor: '#71717a',
        textColor: '#e4e4e7',
        mainBkg: '#161617',
        nodeBorder: '#27272a',
        clusterBkg: '#161617',
        clusterBorder: '#27272a',
        titleColor: '#e4e4e7',
        edgeLabelBackground: '#161617',
        nodeTextColor: '#e4e4e7',
      },
      fontFamily: "'Space Grotesk', system-ui, sans-serif",
      securityLevel: 'strict',
    })
  })()
  return initPromise
}
```

Key implementation details:
- Use `const mermaid = await import('mermaid')` for dynamic import with a module-level cache
- `renderMermaidDiagram(id, code)` calls `mermaid.default.render(id, code)` inside try/catch — returns `{ svg }` or `{ error }`
- Generate unique IDs: `mermaid-diagram-${counter++}` to avoid DOM ID collisions
- **Render queue**: Mermaid is NOT thread-safe for concurrent `render()` calls (uses shared internal DOM). Serialize calls with an async queue — a simple `Promise` chain where each call awaits the previous
- **Guard empty/oversized input**: Empty code → `{ error: 'Empty diagram' }`, code > 50KB → `{ error: 'Diagram code too large' }`

### Step 3: Add mermaid rendering to Markdown Preview

**Modify** `app/src/renderer/lib/markdown-render.ts`

Add a `marked` extension that intercepts code blocks with `lang === 'mermaid'`. Instead of rendering as `<pre><code>`, emit a placeholder `<div>`:

```typescript
const mermaidExtension = {
  name: 'mermaid',
  renderer: {
    code({ text, lang }: { text: string; lang?: string }) {
      if (lang === 'mermaid') {
        const encoded = encodeURIComponent(text)
        return `<div class="mermaid-preview" data-mermaid-code="${encoded}"><div class="mermaid-loading">Loading diagram...</div></div>`
      }
      return false  // fall through to default renderer
    }
  }
}

marked.use({ extensions: [mermaidExtension] })
```

The placeholder `<div>` passes through `sanitizeHtml()` safely. The actual SVG rendering happens post-mount in `MarkdownPreview.svelte`.

**Modify** `app/src/renderer/components/MarkdownPreview.svelte`

After `renderedHtml` is set and injected into the DOM via `{@html}`, use a `$effect` to find all `.mermaid-preview` elements and render them:

```typescript
import { renderMermaidDiagram } from '../lib/mermaid-renderer'

let previewContainer: HTMLDivElement
// generation counter to prevent stale renders on rapid file switches
let renderGeneration = 0

$effect(() => {
  void renderedHtml  // re-run when content changes
  const gen = ++renderGeneration
  requestAnimationFrame(async () => {
    if (!previewContainer || gen !== renderGeneration) return
    const blocks = previewContainer.querySelectorAll('.mermaid-preview[data-mermaid-code]')
    for (const block of blocks) {
      if (gen !== renderGeneration) return  // abort if file changed
      const code = decodeURIComponent(block.getAttribute('data-mermaid-code') ?? '')
      if (!code) continue
      const result = await renderMermaidDiagram(`preview-${crypto.randomUUID()}`, code)
      if (gen !== renderGeneration) return
      if ('svg' in result) {
        block.innerHTML = result.svg
      } else {
        block.innerHTML = `<div class="mermaid-error"><span class="material-symbols-outlined">error</span><pre>${result.error}</pre></div>`
      }
    }
  })
})
```

Add `bind:this={previewContainer}` to the `.preview-container` div. Add CSS for `.mermaid-preview`, `.mermaid-loading`, and `.mermaid-error` (see Step 8).

### Step 4: Create the TipTap MermaidBlock extension

**Create** `app/src/renderer/lib/tiptap/mermaid-block-extension.ts`

This is a custom TipTap Node that represents a mermaid diagram. The underlying document model stores the mermaid code as an attribute. The NodeView handles the toggle between preview and edit states.

```typescript
import { Node } from '@tiptap/core'
import type { JSONContent, MarkdownToken, MarkdownParseHelpers, MarkdownParseResult } from '@tiptap/core'

export const MermaidBlockExtension = Node.create({
  name: 'mermaidBlock',
  group: 'block',
  atom: true,       // not directly editable by ProseMirror — NodeView handles editing
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      code: { default: '' },
    }
  },

  // Markdown round-trip
  parseMarkdown(token: MarkdownToken, helpers: MarkdownParseHelpers): MarkdownParseResult {
    return helpers.createNode('mermaidBlock', { code: token.text ?? '' })
  },

  renderMarkdown(node: JSONContent): string {
    const code = node.attrs?.code ?? ''
    return `\`\`\`mermaid\n${code}\n\`\`\`\n`
  },

  // HTML serialization (clipboard)
  renderHTML({ node }) {
    return ['div', { class: 'mermaid-block', 'data-mermaid-code': node.attrs.code }, node.attrs.code]
  },

  parseHTML() {
    return [{
      tag: 'div.mermaid-block[data-mermaid-code]',
      getAttrs: (el) => ({ code: (el as HTMLElement).getAttribute('data-mermaid-code') ?? '' })
    }]
  },

  addNodeView() {
    // Use Svelte NodeView — see MermaidNodeView.svelte
    // TipTap v3 has SvelteNodeViewRenderer or use imperative mount/unmount
  },
})
```

**Critical: Markdown tokenization.** The extension needs a `markdownTokenizer` to intercept ` ```mermaid ` blocks before CodeBlockLowlight handles them. Follow the same pattern as the Wikilink extension (`wikilink-extension.ts`) but at `level: 'block'`:

```typescript
markdownTokenizer: {
  name: 'mermaidBlock',
  level: 'block',
  start: '```mermaid',
  tokenize(src, _tokens, _lexer) {
    const match = src.match(/^```mermaid\n([\s\S]*?)```/)
    if (!match) return undefined
    return {
      type: 'mermaidBlock',
      raw: match[0],
      text: match[1].trimEnd(),
    }
  },
}
```

If TipTap v3's markdown tokenizer does not support block-level tokens for fenced code blocks, the fallback approach is:
1. Let CodeBlockLowlight parse all fenced code blocks as `codeBlock` nodes
2. Add a ProseMirror plugin (`appendTransaction`) that transforms `codeBlock` nodes where `language === 'mermaid'` into `mermaidBlock` nodes
3. On markdown serialization, `renderMarkdown` outputs the ` ```mermaid\n...\n``` ` format

### Step 5: Create the MermaidNodeView Svelte component

**Create** `app/src/renderer/components/wysiwyg/MermaidNodeView.svelte`

This component toggles between two states:

**Preview state (default):**
- Renders the mermaid SVG diagram
- Shows a pencil edit button (Material Symbol `edit`) on hover, top-right corner
- Shows a styled error message if the mermaid syntax is invalid
- Shows "Loading diagram..." while rendering
- Clicking the edit button or double-clicking the block switches to edit state

**Edit state:**
- Shows a `<pre contenteditable>` or `<textarea>` with the mermaid code, styled like a code block (monospace, dark background)
- Mermaid syntax highlighting via lowlight if practical, or plain monospace text
- Clicking outside the block (blur) or pressing Escape returns to preview state and re-renders the diagram
- On every code change, update the node's `code` attribute via `updateAttributes({ code: newCode })`

Props:
```typescript
interface Props {
  node: ProseMirrorNode       // from TipTap NodeView
  updateAttributes: (attrs: Record<string, unknown>) => void
  selected: boolean
  editor: Editor
}
```

Key behaviors:
- **Debounced rendering**: When entering preview state, render with a 300ms debounce to avoid re-rendering on every tiny change
- **Generation counter**: Prevent stale renders if the user rapidly toggles in/out of edit mode
- **Cleanup**: Use `onDestroy` to cancel pending renders and timers
- **Read-only mode**: When `editor.isEditable === false`, never show edit button — diagram only
- **Error state**: Red-tinted box with the error message using app's error color tokens

### Step 6: Register MermaidBlock in the editor factory

**Modify** `app/src/renderer/lib/tiptap/editor-factory.ts`

Import and register the extension. It must be registered **before** CodeBlockLowlight so it intercepts mermaid blocks first:

```typescript
import { MermaidBlockExtension } from './mermaid-block-extension'

// In the extensions array:
extensions: [
  // ... StarterKit, Placeholder, Typography, Markdown, Image, TableKit ...
  MermaidBlockExtension,       // BEFORE CodeBlockLowlight
  CodeBlockLowlight.configure({ lowlight }),
  // ... TaskList, TaskItem, Wikilink, SlashCommand, etc. ...
]
```

### Step 7: Add the Mermaid slash command

**Modify** `app/src/renderer/lib/tiptap/slash-command-extension.ts`

Add a new item to `slashCommandItems` after the "Code Block" entry (line 64):

```typescript
{
  label: 'Mermaid Diagram',
  icon: 'schema',
  command: (editor, range) => {
    editor.chain().focus().deleteRange(range).insertContent({
      type: 'mermaidBlock',
      attrs: {
        code: 'graph TD\n    A[Start] --> B{Decision}\n    B -->|Yes| C[Result 1]\n    B -->|No| D[Result 2]',
      },
    }).run()
  },
},
```

The inserted block should open in edit mode so the user can immediately modify the starter template. Set this via a transient flag or by programmatically triggering the NodeView's edit state after insertion.

### Step 8: Add CSS styles

**Modify** `app/src/renderer/lib/tiptap/wysiwyg-theme.css`

Add mermaid block styles for the WYSIWYG editor:

```css
/* Mermaid Diagrams */

.ProseMirror .mermaid-node-view {
  background-color: var(--color-surface, #161617);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  margin: 0.75rem 0;
  overflow: hidden;
  position: relative;
}

.ProseMirror .mermaid-node-view.selected {
  outline: 2px solid var(--color-primary, #00E5FF);
  outline-offset: 2px;
}

.ProseMirror .mermaid-edit-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  background: rgba(22, 22, 23, 0.8);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  color: var(--color-text-dim, #71717a);
  padding: 4px;
  cursor: pointer;
  opacity: 0;
  transition: opacity 150ms ease, color 150ms ease;
  z-index: 1;
}

.ProseMirror .mermaid-node-view:hover .mermaid-edit-btn {
  opacity: 1;
}

.ProseMirror .mermaid-edit-btn:hover {
  color: var(--color-primary, #00E5FF);
}

.ProseMirror .mermaid-svg-preview {
  padding: 1.5rem;
  display: flex;
  justify-content: center;
  overflow-x: auto;
}

.ProseMirror .mermaid-svg-preview svg {
  max-width: 100%;
  height: auto;
}

.ProseMirror .mermaid-code-editor {
  width: 100%;
  background: transparent;
  color: var(--color-text, #e4e4e7);
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  font-size: 13px;
  line-height: 1.6;
  padding: 1rem 1.25rem;
  border: none;
  outline: none;
  resize: vertical;
  min-height: 80px;
}

.ProseMirror .mermaid-error {
  padding: 0.75rem 1rem;
  background: rgba(239, 68, 68, 0.05);
  color: #ef4444;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  font-size: 12px;
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.ProseMirror .mermaid-error pre {
  background: none;
  border: none;
  padding: 0;
  margin: 0;
  color: inherit;
  font-size: inherit;
  white-space: pre-wrap;
}

.ProseMirror .mermaid-loading {
  padding: 1.5rem;
  text-align: center;
  color: var(--color-text-dim, #71717a);
  font-size: 12px;
}

@media (prefers-reduced-motion: reduce) {
  .ProseMirror .mermaid-edit-btn {
    transition: none;
  }
}
```

**Modify** `app/src/renderer/components/MarkdownPreview.svelte` `<style>` block

Add styles for mermaid in preview mode using `:global()` selectors:

```css
.markdown-body :global(.mermaid-preview) {
  background: var(--color-surface, #161617);
  border: 1px solid var(--color-border, #27272a);
  border-radius: var(--radius-md, 6px);
  padding: var(--space-4, 16px);
  margin: 1em 0;
  display: flex;
  justify-content: center;
  overflow-x: auto;
}

.markdown-body :global(.mermaid-preview svg) {
  max-width: 100%;
  height: auto;
}

.markdown-body :global(.mermaid-error) {
  padding: var(--space-3, 12px);
  background: rgba(239, 68, 68, 0.05);
  border: 1px solid rgba(239, 68, 68, 0.2);
  border-radius: var(--radius-md, 6px);
  color: #ef4444;
  font-family: var(--font-mono, 'JetBrains Mono', monospace);
  font-size: var(--text-sm, 12px);
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 1em 0;
}

.markdown-body :global(.mermaid-error pre) {
  background: none;
  border: none;
  padding: 0;
  margin: 0;
  color: inherit;
  white-space: pre-wrap;
}

.markdown-body :global(.mermaid-loading) {
  color: var(--color-text-dim, #71717a);
  font-size: var(--text-sm, 12px);
  padding: var(--space-4, 16px);
  text-align: center;
}
```

### Step 9: Handle edge cases

**In `mermaid-renderer.ts`:**
- Empty code string: return `{ error: 'Empty diagram' }` without calling mermaid
- Extremely long code (> 50KB): return `{ error: 'Diagram code too large' }` to prevent hangs
- Concurrent renders: serialize with async queue (Promise chain), only one `mermaid.render()` at a time

**In `MermaidNodeView.svelte`:**
- Handle component destroyed mid-render: generation counter, abort if generation changed
- Use `onDestroy` to clean up debounce timers
- When editor is read-only, hide the edit button — show diagram only

**In `MarkdownPreview.svelte`:**
- Generation counter to abort stale renders when user switches files rapidly
- Don't re-render diagrams if the mermaid code hasn't changed (compare `data-mermaid-code` values)

### Step 10: Write tests

**Create** `app/tests/unit/mermaid-renderer.test.ts`

Test the mermaid renderer utility (mock mermaid module since jsdom can't do full SVG rendering):

```typescript
vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: '<svg>mock</svg>' }),
  }
}))
```

Tests:
- `initMermaid()` completes without error
- `renderMermaidDiagram()` returns `{ svg }` for valid input
- `renderMermaidDiagram()` returns `{ error }` when mermaid.render throws
- Empty code returns `{ error: 'Empty diagram' }` without calling mermaid
- Oversized code returns `{ error: 'Diagram code too large' }`
- Unique ID generation produces distinct IDs
- Concurrent calls are serialized (second call waits for first)

**Modify** existing slash command test to verify Mermaid Diagram command presence:

```typescript
it('includes Mermaid Diagram command', () => {
  const labels = slashCommandItems.map((i) => i.label)
  expect(labels).toContain('Mermaid Diagram')
})
```

**Create** `app/tests/unit/mermaid-block-extension.test.ts`

Test markdown round-trip serialization:
- `renderMarkdown()` produces correct fenced code block format
- Code attribute is preserved through parse → serialize cycle

---

## New Files

| File | Purpose |
|------|---------|
| `app/src/renderer/lib/mermaid-renderer.ts` | Lazy-loading mermaid init, render function, dark theme config, render queue |
| `app/src/renderer/lib/tiptap/mermaid-block-extension.ts` | TipTap Node extension for mermaid blocks with markdown round-trip |
| `app/src/renderer/components/wysiwyg/MermaidNodeView.svelte` | NodeView: toggle between SVG preview (default) and code editing |
| `app/tests/unit/mermaid-renderer.test.ts` | Unit tests for mermaid renderer utility |
| `app/tests/unit/mermaid-block-extension.test.ts` | Unit tests for mermaid extension markdown serialization |

## Modified Files

| File | Changes |
|------|---------|
| `app/package.json` | Add `mermaid` dependency |
| `app/src/renderer/lib/markdown-render.ts` | Add `marked.use()` extension to intercept mermaid code blocks → placeholder divs |
| `app/src/renderer/components/MarkdownPreview.svelte` | Add `$effect` to post-process mermaid placeholders into rendered SVGs; add `bind:this` on container; add mermaid CSS |
| `app/src/renderer/lib/tiptap/editor-factory.ts` | Import and register `MermaidBlockExtension` before CodeBlockLowlight |
| `app/src/renderer/lib/tiptap/slash-command-extension.ts` | Add "Mermaid Diagram" item to `slashCommandItems` after "Code Block" |
| `app/src/renderer/lib/tiptap/wysiwyg-theme.css` | Add mermaid block styles (`.mermaid-node-view`, `.mermaid-edit-btn`, `.mermaid-svg-preview`, etc.) |

---

## Validation Criteria

- [ ] ` ```mermaid ` blocks in Markdown Preview render as SVG diagrams, not code
- [ ] All standard diagram types render correctly: flowchart, sequence, class, state, ER, Gantt, pie, journey, mindmap
- [ ] WYSIWYG editor shows mermaid blocks as rendered SVG diagrams by default
- [ ] Hovering a mermaid block in WYSIWYG reveals a pencil edit button (top-right)
- [ ] Clicking edit button switches to editable code block with syntax highlighting
- [ ] Clicking outside the block or pressing Escape exits edit mode and re-renders the diagram
- [ ] Invalid mermaid syntax shows a styled error message, does not crash the app
- [ ] Empty mermaid blocks show a clear error/empty state
- [ ] `/mermaid` slash command appears in the menu and inserts a starter template in edit mode
- [ ] Mermaid diagrams use the dark theme matching the app's design tokens
- [ ] Round-trip fidelity: Source → WYSIWYG → Source preserves the exact mermaid code
- [ ] Opening an existing file with ` ```mermaid ` blocks renders correctly in both Preview and WYSIWYG
- [ ] Mermaid.js is lazy-loaded — initial app startup does not load the library until first mermaid block is encountered
- [ ] No CSP violations in the Electron console
- [ ] Sanitization does not strip mermaid SVG output
- [ ] Rapidly switching files does not leave stale diagrams (generation counter works)
- [ ] `npm test` passes with all new and existing tests
- [ ] `npm run typecheck` passes
- [ ] `npm run lint` passes
- [ ] All transitions respect `@media (prefers-reduced-motion: reduce)`

## Anti-Patterns to Avoid

- **DO NOT extend CodeBlockLowlight for the preview state.** CodeBlockLowlight renders a single editable code block. The mermaid NodeView needs to render an SVG diagram by default and only switch to code editing on explicit user action. These are fundamentally different DOM structures requiring a custom Node with its own NodeView.
- **DO NOT render mermaid SVG inside `sanitizeHtml()`.** Mermaid SVG must be rendered from the raw code string, then inserted into the DOM directly post-sanitization. Passing SVG through the sanitizer could strip inline styles on SVG elements.
- **DO NOT import mermaid at module top level.** Mermaid.js is ~2MB and takes 200-400ms to initialize. Dynamic `import('mermaid')` ensures the library loads only when the first mermaid block is encountered.
- **DO NOT use `mermaid.init()` or `mermaid.run()` with DOM selectors.** These global functions scan the DOM and mutate elements in place, conflicting with Svelte's reactivity. Always use `mermaid.render(id, code)` which returns an SVG string without touching the DOM.
- **DO NOT allow concurrent `mermaid.render()` calls.** Mermaid uses internal state (a shared DOM container for measuring) that is NOT safe for concurrent use. Serialize render calls with an async queue.
- **DO NOT use `innerHTML` to construct mermaid input.** Pass the code string directly to `mermaid.render()`. Never construct HTML from user input.
- **DO NOT forget component teardown.** The MermaidNodeView may be destroyed while a render is in-flight (user deletes the block, switches files). Use generation counters to prevent stale renders from writing to unmounted components.

## Patterns to Follow

- **Lazy dynamic import**: Use `const mod = await import('mermaid')` with a module-level cache. This avoids impacting startup time and follows the app's lazy-loading convention for heavy dependencies.
- **TipTap Node extension pattern**: Follow the Wikilink extension at `lib/tiptap/wikilink-extension.ts` — it demonstrates `Node.create()`, `addAttributes()`, `markdownTokenizer`, `parseMarkdown()`, `renderMarkdown()`, `renderHTML()`, `parseHTML()`. The mermaid block is `group: 'block'` (not inline) and `atom: true` (not directly editable).
- **Slash command pattern**: Follow existing items in `lib/tiptap/slash-command-extension.ts` — each has `label`, `icon` (Material Symbols name), and `command` using `editor.chain().focus().deleteRange(range)...run()`.
- **WYSIWYG CSS pattern**: Follow `lib/tiptap/wysiwyg-theme.css` — use `.ProseMirror .mermaid-*` selectors, reference design tokens via CSS custom properties, include `@media (prefers-reduced-motion: reduce)`.
- **Preview rendering pattern**: Follow `MarkdownPreview.svelte` — use `$derived` for computed HTML, scoped styles with `:global()` for dynamic content, design token variables.
- **Svelte 5 component pattern**: Use `$state()`, `$derived()`, `$effect()` runes. Props via `interface Props` with `let { ... }: Props = $props()`. Follow `components/wysiwyg/SlashCommandMenu.svelte`.
- **Test pattern**: Follow `tests/unit/` files — `describe`/`it`/`expect` from Vitest, mock heavy dependencies with `vi.mock()`.
