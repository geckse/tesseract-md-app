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
      backgroundColor: 'var(--color-canvas, #0a0a0a)',
      color: 'var(--color-text, #e4e4e7)',
      fontFamily: "'Space Grotesk', system-ui, sans-serif",
      fontSize: '0.875rem',
      lineHeight: '1.8',
    },

    '.cm-content': {
      caretColor: 'var(--color-primary, #00E5FF)',
      padding: '1rem 0',
    },

    '.cm-cursor, .cm-dropCursor': {
      borderLeftColor: 'var(--color-primary, #00E5FF)',
      borderLeftWidth: '2px',
    },

    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
      backgroundColor: 'var(--color-primary-dim, rgba(0, 229, 255, 0.1))',
    },

    '.cm-activeLine': {
      backgroundColor: 'var(--overlay-hover, rgba(255, 255, 255, 0.03))',
    },

    '.cm-gutters': {
      backgroundColor: 'var(--color-canvas, #0a0a0a)',
      color: 'var(--color-text-dim, #7b8a8d)',
      border: 'none',
    },

    '.cm-activeLineGutter': {
      backgroundColor: 'var(--overlay-hover, rgba(255, 255, 255, 0.03))',
      color: 'var(--color-text, #e4e4e7)',
    },

    '.cm-lineNumbers .cm-gutterElement': {
      fontFamily: "'JetBrains Mono', ui-monospace, monospace",
      fontSize: '0.75rem',
    },

    '.cm-scroller': {
      overflow: 'auto',
    },

    '.cm-panels': {
      backgroundColor: 'var(--color-surface, #161617)',
      color: 'var(--color-text, #e4e4e7)',
      borderBottom: '1px solid var(--color-border, #27272a)',
    },

    '.cm-panels.cm-panels-top': {
      borderBottom: '1px solid var(--color-border, #27272a)',
    },

    /* Search panel */
    '.cm-search': {
      padding: '6px 12px',
      display: 'flex',
      flexWrap: 'wrap',
      gap: '4px',
      alignItems: 'center',
      fontFamily: "'JetBrains Mono', ui-monospace, monospace",
      fontSize: '12px',
    },

    '.cm-search label': {
      color: 'var(--color-text-dim, #71717a)',
      fontSize: '10px',
    },

    '.cm-search input, .cm-search [type=checkbox]': {
      backgroundColor: 'var(--color-surface-dark, #0a0a0a)',
      color: 'var(--color-text, #e4e4e7)',
      border: '1px solid var(--color-border, #27272a)',
      borderRadius: '4px',
      padding: '3px 8px',
      fontSize: '12px',
      fontFamily: "'JetBrains Mono', ui-monospace, monospace",
      outline: 'none',
    },

    '.cm-search input:focus': {
      borderColor: 'var(--color-primary, #00E5FF)',
    },

    '.cm-search button': {
      backgroundColor: 'var(--color-surface-dark, #0a0a0a)',
      color: 'var(--color-text, #e4e4e7)',
      border: '1px solid var(--color-border, #27272a)',
      borderRadius: '4px',
      padding: '3px 8px',
      fontSize: '10px',
      fontFamily: "'JetBrains Mono', ui-monospace, monospace",
      cursor: 'pointer',
    },

    '.cm-search button:hover': {
      borderColor: 'var(--color-border-hover, #3f3f46)',
      color: 'var(--color-text-white, #ffffff)',
    },

    'button[name="close"]': {
      color: 'var(--color-text-dim, #71717a)',
      cursor: 'pointer',
    },

    'button[name="close"]:hover': {
      color: 'var(--color-text, #e4e4e7)',
    },

    /* Search match highlights */
    '.cm-searchMatch': {
      backgroundColor: 'var(--color-primary-dim, rgba(0, 229, 255, 0.15))',
      borderRadius: '2px',
    },

    '.cm-searchMatch-selected': {
      backgroundColor: 'var(--color-primary-glow, rgba(0, 229, 255, 0.35))',
    },

    '.cm-tooltip': {
      backgroundColor: 'var(--color-surface, #161617)',
      border: '1px solid var(--color-border, #27272a)',
      color: 'var(--color-text, #e4e4e7)',
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
    color: 'var(--color-text-white, #ffffff)',
    lineHeight: '1.2',
  },
  {
    tag: tags.heading2,
    fontSize: '1.5rem',
    fontWeight: '600',
    color: 'var(--color-text, #e4e4e7)',
    lineHeight: '1.2',
  },
  {
    tag: tags.heading3,
    fontSize: '1.25rem',
    fontWeight: '500',
    color: 'var(--color-text, #e4e4e7)',
    lineHeight: '1.2',
  },

  // Inline styles
  { tag: tags.emphasis, fontStyle: 'italic', color: 'var(--color-text, #e4e4e7)' },
  { tag: tags.strong, fontWeight: '700', color: 'var(--color-text-white, #ffffff)' },

  // Links
  { tag: tags.link, color: 'var(--color-primary, #00E5FF)', textDecoration: 'none' },
  { tag: tags.url, color: 'var(--color-primary, #00E5FF)' },

  // Code / monospace
  {
    tag: tags.monospace,
    fontFamily: "'JetBrains Mono', ui-monospace, monospace",
    color: 'var(--color-primary, #00E5FF)',
    backgroundColor: 'var(--color-primary-dim, rgba(0, 229, 255, 0.1))',
    borderRadius: '0.25rem',
  },

  // Meta (frontmatter delimiters, heading markers, etc.)
  { tag: tags.meta, color: 'var(--color-text-dim, #7b8a8d)' },
  { tag: tags.processingInstruction, color: 'var(--color-text-dim, #7b8a8d)' },

  // Blockquotes
  { tag: tags.quote, color: 'var(--color-text-muted, #b0b8bf)', fontStyle: 'italic' },

  // Lists
  { tag: tags.list, color: 'var(--color-text-dim, #8c8c96)' },

  // Horizontal rule
  { tag: tags.contentSeparator, color: 'var(--color-border-hover, #3f3f46)' },

  // Comments
  { tag: tags.comment, color: 'var(--color-text-dim, #7b8a8d)', fontStyle: 'italic' },
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
