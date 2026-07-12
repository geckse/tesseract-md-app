/**
 * Build Tiptap JSON for an inserted Table of Contents — a nested bullet
 * list of heading links. Mirrors buildTocMarkdown (lib/markdown-structure)
 * for the WYSIWYG editor, where inserting JSON preserves undo history.
 */

import { assignSlugs, type ParsedHeading } from '../markdown-structure'

interface TocEntry {
  text: string
  slug: string
  level: number
}

export interface TiptapNode {
  type: string
  attrs?: Record<string, unknown>
  content?: TiptapNode[]
  text?: string
  marks?: { type: string; attrs?: Record<string, unknown> }[]
}

function listItem(entry: TocEntry): TiptapNode {
  return {
    type: 'listItem',
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: entry.text,
            marks: [{ type: 'link', attrs: { href: `#${entry.slug}` } }]
          }
        ]
      }
    ]
  }
}

/** Build nested bulletList nodes from entries at/below `level`. */
function buildLevel(entries: TocEntry[], start: number, level: number): [TiptapNode, number] {
  const list: TiptapNode = { type: 'bulletList', content: [] }
  let i = start
  while (i < entries.length && entries[i].level >= level) {
    if (entries[i].level === level) {
      const item = listItem(entries[i])
      i++
      if (i < entries.length && entries[i].level > level) {
        const [nested, next] = buildLevel(entries, i, entries[i].level)
        item.content!.push(nested)
        i = next
      }
      list.content!.push(item)
    } else {
      // Entry deeper than current level with no parent at this level:
      // treat it as a direct child list of a synthetic empty item.
      const [nested, next] = buildLevel(entries, i, entries[i].level)
      list.content!.push({ type: 'listItem', content: [nested] })
      i = next
    }
  }
  return [list, i]
}

/** Build the Tiptap JSON bulletList for a document's headings (null if none). */
export function buildTocTiptapJSON(headings: ParsedHeading[]): TiptapNode | null {
  if (headings.length === 0) return null
  const entries: TocEntry[] = assignSlugs(headings).map(({ heading, slug }) => ({
    text: heading.text,
    slug,
    level: heading.level
  }))
  const minLevel = Math.min(...entries.map((e) => e.level))
  const [list] = buildLevel(entries, 0, minLevel)
  return list
}
