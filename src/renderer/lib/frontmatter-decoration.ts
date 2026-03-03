/**
 * Frontmatter decoration ViewPlugin: detects --- delimited YAML
 * at document start and applies styled decorations for container
 * and value-type coloring.
 */
import {
  type DecorationSet,
  Decoration,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view'
import { type EditorState, Prec, type Range } from '@codemirror/state'

/* ── Decoration marks ─────────────────────────────────────── */

const delimiterMark = Decoration.mark({ class: 'cm-fm-delimiter' })
const keyMark = Decoration.mark({ class: 'cm-fm-key' })
const stringMark = Decoration.mark({ class: 'cm-fm-string' })
const statusMark = Decoration.mark({ class: 'cm-fm-status' })
const arrayMark = Decoration.mark({ class: 'cm-fm-array' })
const dateMark = Decoration.mark({ class: 'cm-fm-date' })

/* ── Line decoration for container styling ────────────────── */

const containerLine = Decoration.line({ class: 'cm-fm-line' })

/* ── Patterns ─────────────────────────────────────────────── */

const STATUS_KEYWORDS = new Set([
  'draft', 'published', 'archived', 'active', 'inactive',
  'todo', 'done', 'in-progress', 'review', 'approved',
  'true', 'false',
])

const DATE_RE = /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z?)?$/
const ARRAY_RE = /^\[.*\]$/

/* ── Theme ────────────────────────────────────────────────── */

const frontmatterTheme = EditorView.theme({
  '.cm-fm-line': {
    backgroundColor: '#0a0a0a',
    borderLeft: '2px solid #27272a',
    paddingLeft: '8px',
    fontFamily: 'JetBrains Mono, monospace',
  },
  '.cm-fm-line:hover': {
    borderLeftColor: '#00E5FF',
  },
  '.cm-fm-delimiter': {
    color: '#7b8a8d',
  },
  '.cm-fm-key': {
    color: '#9ca3af',
  },
  '.cm-fm-string': {
    color: '#00E5FF',
  },
  '.cm-fm-status': {
    color: '#34d399',
  },
  '.cm-fm-array': {
    color: '#60a5fa',
  },
  '.cm-fm-date': {
    color: '#fdba74',
  },
})

/* ── Build decorations ────────────────────────────────────── */

function buildDecorations(state: EditorState): DecorationSet {
  const doc = state.doc
  const decorations: Range<Decoration>[] = []

  // Must start with ---
  const firstLine = doc.lineAt(1)
  if (firstLine.text.trim() !== '---') {
    return Decoration.set([])
  }

  // Find closing ---
  let closingLineNum = -1
  for (let i = 2; i <= doc.lines; i++) {
    if (doc.line(i).text.trim() === '---') {
      closingLineNum = i
      break
    }
  }

  if (closingLineNum === -1) {
    return Decoration.set([])
  }

  // Apply container line decoration to all frontmatter lines
  for (let i = 1; i <= closingLineNum; i++) {
    const line = doc.line(i)
    decorations.push(containerLine.range(line.from))
  }

  // Delimiter lines (first and last ---)
  const openLine = doc.line(1)
  const closeLine = doc.line(closingLineNum)
  decorations.push(delimiterMark.range(openLine.from, openLine.to))
  decorations.push(delimiterMark.range(closeLine.from, closeLine.to))

  // Parse key-value lines between delimiters
  for (let i = 2; i < closingLineNum; i++) {
    const line = doc.line(i)
    const text = line.text
    const colonIdx = text.indexOf(':')

    if (colonIdx === -1) {
      // Could be a continuation line (array item, multiline string)
      const trimmed = text.trimStart()
      if (trimmed.startsWith('- ')) {
        decorations.push(arrayMark.range(line.from, line.to))
      }
      continue
    }

    // Mark key (everything before colon, inclusive)
    const keyEnd = line.from + colonIdx + 1
    decorations.push(keyMark.range(line.from, keyEnd))

    // Parse value
    const valueStr = text.slice(colonIdx + 1).trim()
    if (valueStr.length === 0) continue

    const valueFrom = line.from + text.indexOf(valueStr, colonIdx + 1)
    const valueTo = valueFrom + valueStr.length

    // Classify value type
    const unquoted = valueStr.replace(/^['"]|['"]$/g, '')

    if (STATUS_KEYWORDS.has(unquoted.toLowerCase())) {
      decorations.push(statusMark.range(valueFrom, valueTo))
    } else if (DATE_RE.test(unquoted)) {
      decorations.push(dateMark.range(valueFrom, valueTo))
    } else if (ARRAY_RE.test(valueStr)) {
      decorations.push(arrayMark.range(valueFrom, valueTo))
    } else {
      decorations.push(stringMark.range(valueFrom, valueTo))
    }
  }

  // Sort by position (required by CodeMirror)
  decorations.sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide)
  return Decoration.set(decorations)
}

/* ── Plugin ────────────────────────────────────────────────── */

const frontmatterPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view.state)
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) {
        this.decorations = buildDecorations(update.state)
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
)

/** Frontmatter decoration extension: styles YAML frontmatter blocks */
export function frontmatterDecoration() {
  return Prec.highest([frontmatterTheme, frontmatterPlugin])
}
