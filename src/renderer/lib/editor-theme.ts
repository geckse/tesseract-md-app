/**
 * Editor Theme — mdvdb
 *
 * CodeMirror 6 base theme and syntax highlighting for the markdown editor.
 * Colors and typography match the design tokens in tokens.css.
 */

import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import type { Extension } from '@codemirror/state';

/* -------------------------------------------------------------------------- */
/*  Base Editor Theme                                                         */
/* -------------------------------------------------------------------------- */

const baseTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: '#0f0f10',
      color: '#e4e4e7',
      fontFamily: "'Space Grotesk', system-ui, sans-serif",
      fontSize: '0.875rem',
      lineHeight: '1.8',
    },

    '.cm-content': {
      caretColor: '#00E5FF',
      padding: '1rem 0',
    },

    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: '#00E5FF',
      borderLeftWidth: '2px',
    },

    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
      backgroundColor: 'rgba(0, 229, 255, 0.1)',
    },

    '.cm-activeLine': {
      backgroundColor: 'rgba(255, 255, 255, 0.03)',
    },

    '.cm-gutters': {
      backgroundColor: '#0f0f10',
      color: '#526366',
      border: 'none',
    },

    '.cm-activeLineGutter': {
      backgroundColor: 'rgba(255, 255, 255, 0.03)',
      color: '#e4e4e7',
    },

    '.cm-lineNumbers .cm-gutterElement': {
      fontFamily: "'JetBrains Mono', ui-monospace, monospace",
      fontSize: '0.75rem',
    },

    '.cm-scroller': {
      overflow: 'auto',
    },

    '.cm-panels': {
      backgroundColor: '#161617',
      color: '#e4e4e7',
    },

    '.cm-tooltip': {
      backgroundColor: '#161617',
      border: '1px solid #27272a',
      color: '#e4e4e7',
    },
  },
  { dark: true },
);

/* -------------------------------------------------------------------------- */
/*  Markdown Syntax Highlighting                                              */
/* -------------------------------------------------------------------------- */

const markdownHighlightStyle = HighlightStyle.define([
  // Headings
  {
    tag: tags.heading1,
    fontSize: '2.25rem',
    fontWeight: '700',
    color: '#ffffff',
    lineHeight: '1.2',
  },
  {
    tag: tags.heading2,
    fontSize: '1.5rem',
    fontWeight: '600',
    color: '#e4e4e7',
    lineHeight: '1.2',
  },
  {
    tag: tags.heading3,
    fontSize: '1.25rem',
    fontWeight: '500',
    color: '#e4e4e7',
    lineHeight: '1.2',
  },

  // Inline styles
  { tag: tags.emphasis, fontStyle: 'italic', color: '#e4e4e7' },
  { tag: tags.strong, fontWeight: '700', color: '#ffffff' },

  // Links
  { tag: tags.link, color: '#00E5FF', textDecoration: 'none' },
  { tag: tags.url, color: '#00E5FF' },

  // Code / monospace
  {
    tag: tags.monospace,
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    color: '#00E5FF',
    backgroundColor: 'rgba(0, 229, 255, 0.1)',
    borderRadius: '0.25rem',
  },

  // Meta (frontmatter delimiters, heading markers, etc.)
  { tag: tags.meta, color: '#526366' },
  { tag: tags.processingInstruction, color: '#526366' },

  // Blockquotes
  { tag: tags.quote, color: '#9ca3af', fontStyle: 'italic' },

  // Lists
  { tag: tags.list, color: '#71717a' },

  // Horizontal rule
  { tag: tags.contentSeparator, color: '#27272a' },

  // Comments
  { tag: tags.comment, color: '#526366', fontStyle: 'italic' },
]);

/* -------------------------------------------------------------------------- */
/*  Composable Extensions                                                     */
/* -------------------------------------------------------------------------- */

/** Base editor theme (dark background, caret, selections, gutters). */
export function editorBaseTheme(): Extension {
  return baseTheme;
}

/** Markdown syntax highlighting (headings, emphasis, links, code, etc.). */
export function editorHighlighting(): Extension {
  return syntaxHighlighting(markdownHighlightStyle);
}

/** Combined editor theme: base + syntax highlighting. */
export function editorTheme(): Extension {
  return [baseTheme, syntaxHighlighting(markdownHighlightStyle)];
}
