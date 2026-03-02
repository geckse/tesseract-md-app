/**
 * Soft-render ViewPlugin: dims markdown syntax characters
 * so content stands out while syntax fades into the background.
 */
import {
  type DecorationSet,
  Decoration,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view'
import { type EditorState, Prec, type Range } from '@codemirror/state'
import { syntaxTree } from '@codemirror/language'

const dimMark = Decoration.mark({ class: 'cm-syntax-dim' })

const dimTheme = EditorView.theme({
  '.cm-syntax-dim': {
    color: '#526366',
    opacity: '0.5',
    fontWeight: 'normal',
  },
})

/** Node types whose full range should be dimmed */
const FULL_DIM_NODES = new Set([
  'HeaderMark',       // #, ##, ### etc.
  'EmphasisMark',     // * or _
  'StrongEmphasisMark', // ** or __
  'CodeMark',         // ` (inline code delimiters)
  'CodeInfo',         // language info on fences
  'QuoteMark',        // >
  'ListMark',         // - * +
  'LinkMark',         // [ ] ( )
  'HorizontalRule',   // --- *** ___
  'TaskMarker',       // [x] or [ ] (the x or space inside)
])

/** Fenced code delimiter nodes */
const FENCE_NODES = new Set(['FencedCode'])

function buildDecorations(state: EditorState): DecorationSet {
  const decorations: Range<Decoration>[] = []

  syntaxTree(state).iterate({
    enter(node) {
      if (FULL_DIM_NODES.has(node.name)) {
        decorations.push(dimMark.range(node.from, node.to))
      }
      // Dim the opening/closing ``` of fenced code blocks
      if (node.name === 'FencedCode') {
        // The CodeMark children handle the ``` delimiters already
        return
      }
    },
  })

  return Decoration.set(decorations, true)
}

const softRenderPlugin = ViewPlugin.fromClass(
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

/** Soft-render extension: dims markdown syntax characters */
export function softRender() {
  return Prec.highest([dimTheme, softRenderPlugin])
}
