/**
 * Pure markdown document-structure helpers shared by the native menu's
 * Format/Structure commands, both editors (CodeMirror + Tiptap), and the
 * properties-panel outline.
 *
 * Everything here is pure text/array manipulation — no editor, DOM, or
 * store dependencies — so both editors derive structure edits from the
 * same core and can never diverge.
 */

/** A heading found in markdown source. */
export interface ParsedHeading {
  /** Heading level 1–6. */
  level: number
  /** Heading text (trimmed, without the leading hashes). */
  text: string
  /** 1-indexed line number in the original content. */
  line: number
}

/** Strip a leading YAML frontmatter block (`---` … `---`) from markdown. */
export function stripFrontmatter(content: string): string {
  if (!content.startsWith('---')) return content
  const endIdx = content.indexOf('\n---', 3)
  if (endIdx === -1) return content
  const afterFence = content.indexOf('\n', endIdx + 1)
  return afterFence === -1 ? '' : content.slice(afterFence + 1)
}

/**
 * Parse ATX headings (`# …` through `###### …`) from markdown content.
 * Skips a leading frontmatter block and anything inside fenced code blocks.
 * Setext headings (`===` underlines) are intentionally not matched — the
 * editors and the previous outline scanner never supported them.
 */
export function parseHeadings(content: string): ParsedHeading[] {
  const headings: ParsedHeading[] = []
  const lines = content.split('\n')

  // Leading frontmatter block: only when the very first line is `---`.
  let start = 0
  if (lines[0]?.trimEnd() === '---') {
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trimEnd() === '---') {
        start = i + 1
        break
      }
    }
  }

  let inCodeBlock = false
  for (let i = start; i < lines.length; i++) {
    const line = lines[i]
    if (line.trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock
      continue
    }
    if (inCodeBlock) continue

    const match = line.match(/^(#{1,6})\s+(.+)$/)
    if (match) {
      headings.push({
        level: match[1].length,
        text: match[2].trim(),
        line: i + 1
      })
    }
  }
  return headings
}

/** GitHub-style anchor slug for a heading text (without duplicate suffixes). */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
}

/**
 * Assign each heading its GitHub-style anchor slug, suffixing duplicates
 * with `-1`, `-2`, … in document order (matching GitHub's behavior).
 */
export function assignSlugs(headings: ParsedHeading[]): { heading: ParsedHeading; slug: string }[] {
  const seen = new Map<string, number>()
  return headings.map((heading) => {
    const base = slugify(heading.text)
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    return { heading, slug: count === 0 ? base : `${base}-${count}` }
  })
}

/**
 * Build a nested markdown bullet list of heading links:
 * `- [Heading](#heading)`, indented 2 spaces per level below the
 * shallowest heading. Returns '' when there are no headings.
 */
export function buildTocMarkdown(headings: ParsedHeading[]): string {
  if (headings.length === 0) return ''
  const minLevel = Math.min(...headings.map((h) => h.level))
  return assignSlugs(headings)
    .map(({ heading, slug }) => {
      const indent = '  '.repeat(heading.level - minLevel)
      return `${indent}- [${heading.text}](#${slug})`
    })
    .join('\n')
}

/**
 * Normalize skipped heading levels: the first heading keeps its level, and
 * every following heading may increase at most one level over the previous
 * (fixed) heading. Decreases pass through unchanged.
 * `[1, 3, 2, 5] → [1, 2, 2, 3]`.
 */
export function computeFixedHeadingLevels(levels: number[]): number[] {
  const fixed: number[] = []
  for (let i = 0; i < levels.length; i++) {
    fixed.push(i === 0 ? levels[i] : Math.min(levels[i], fixed[i - 1] + 1))
  }
  return fixed
}

/** Apply {@link computeFixedHeadingLevels} to markdown text. */
export function fixHeadingHierarchyInText(content: string): {
  content: string
  changedLines: number
} {
  const headings = parseHeadings(content)
  const fixed = computeFixedHeadingLevels(headings.map((h) => h.level))
  const lines = content.split('\n')
  let changedLines = 0
  for (let i = 0; i < headings.length; i++) {
    if (fixed[i] !== headings[i].level) {
      const idx = headings[i].line - 1
      lines[idx] = lines[idx].replace(/^#{1,6}/, '#'.repeat(fixed[i]))
      changedLines++
    }
  }
  return { content: lines.join('\n'), changedLines }
}

/**
 * Shift a heading line's level by ±1, clamped to 1–6.
 * Returns null when the line is not a heading or the level is already at
 * the clamp boundary (i.e. nothing would change).
 */
export function shiftHeadingInLine(line: string, delta: 1 | -1): string | null {
  const match = line.match(/^(#{1,6})(\s+.*)$/)
  if (!match) return null
  const level = match[1].length
  const newLevel = Math.min(6, Math.max(1, level + delta))
  if (newLevel === level) return null
  return '#'.repeat(newLevel) + match[2]
}

// ─── Selection-level helpers for the CodeMirror executor ────────────────

/** A text edit in original-document coordinates (CodeMirror change spec). */
export interface TextEdit {
  from: number
  to: number
  insert: string
}

/** Result of an inline-mark toggle: edits + post-edit selection. */
export interface InlineToggleResult {
  changes: TextEdit[]
  /** Selection in post-edit coordinates. */
  selection: { anchor: number; head: number }
}

/**
 * Toggle an inline markdown mark (`**`, `*`, `~~`, `` ` ``) around
 * `[from, to)` of `doc`. Empty selections insert a marker pair and place
 * the cursor inside. Already-wrapped selections (markers inside or
 * immediately outside the selection) unwrap.
 */
export function toggleInlineMark(
  doc: string,
  from: number,
  to: number,
  marker: string
): InlineToggleResult {
  const len = marker.length

  if (from === to) {
    return {
      changes: [{ from, to, insert: marker + marker }],
      selection: { anchor: from + len, head: from + len }
    }
  }

  const selected = doc.slice(from, to)
  if (selected.startsWith(marker) && selected.endsWith(marker) && selected.length >= 2 * len) {
    return {
      changes: [{ from, to, insert: selected.slice(len, selected.length - len) }],
      selection: { anchor: from, head: to - 2 * len }
    }
  }

  if (doc.slice(Math.max(0, from - len), from) === marker && doc.slice(to, to + len) === marker) {
    return {
      changes: [
        { from: from - len, to: from, insert: '' },
        { from: to, to: to + len, insert: '' }
      ],
      selection: { anchor: from - len, head: to - len }
    }
  }

  return {
    changes: [
      { from, to: from, insert: marker },
      { from: to, to, insert: marker }
    ],
    selection: { anchor: from + len, head: to + len }
  }
}

const HEADING_PREFIX = /^#{1,6}\s+/
const BULLET_PREFIX = /^(\s*)-\s+(?!\[[ xX]\]\s)/
const ORDERED_PREFIX = /^(\s*)\d+\.\s+/
const TASK_PREFIX = /^(\s*)-\s+\[[ xX]\]\s+/
const QUOTE_PREFIX = /^>\s?/

/**
 * Set (or clear, with `level = 0`) the ATX heading level on every
 * non-empty line of `text`.
 */
export function setHeadingLevelInText(text: string, level: number): string {
  return text
    .split('\n')
    .map((line) => {
      if (line.trim() === '') return line
      const stripped = line.replace(HEADING_PREFIX, '')
      return level > 0 ? '#'.repeat(level) + ' ' + stripped : stripped
    })
    .join('\n')
}

function toggleListPrefix(
  text: string,
  detect: RegExp,
  makePrefix: (index: number) => string
): string {
  const lines = text.split('\n')
  const nonEmpty = lines.filter((l) => l.trim() !== '')
  const allPrefixed = nonEmpty.length > 0 && nonEmpty.every((l) => detect.test(l))
  let itemIndex = 0
  return lines
    .map((line) => {
      if (line.trim() === '') return line
      if (allPrefixed) return line.replace(detect, '$1')
      // Strip any existing list/task/quote prefix before applying the new one
      const stripped = line
        .replace(TASK_PREFIX, '$1')
        .replace(BULLET_PREFIX, '$1')
        .replace(ORDERED_PREFIX, '$1')
      return makePrefix(itemIndex++) + stripped
    })
    .join('\n')
}

/** Toggle `- ` bullets on every non-empty line. */
export function toggleBulletListInText(text: string): string {
  return toggleListPrefix(text, BULLET_PREFIX, () => '- ')
}

/** Toggle `1. ` numbering on every non-empty line. */
export function toggleOrderedListInText(text: string): string {
  return toggleListPrefix(text, ORDERED_PREFIX, (i) => `${i + 1}. `)
}

/** Toggle `- [ ] ` task markers on every non-empty line. */
export function toggleTaskListInText(text: string): string {
  return toggleListPrefix(text, TASK_PREFIX, () => '- [ ] ')
}

/** Toggle `> ` blockquote markers on every non-empty line. */
export function toggleBlockquoteInText(text: string): string {
  const lines = text.split('\n')
  const nonEmpty = lines.filter((l) => l.trim() !== '')
  const allQuoted = nonEmpty.length > 0 && nonEmpty.every((l) => QUOTE_PREFIX.test(l))
  return lines
    .map((line) => {
      if (line.trim() === '') return line
      return allQuoted ? line.replace(QUOTE_PREFIX, '') : '> ' + line
    })
    .join('\n')
}

/** Markdown source for an empty table (matches the slash-command's 3×3 default). */
export function buildTableMarkdown(rows = 3, cols = 3): string {
  const header = `| ${Array.from({ length: cols }, (_, i) => `Column ${i + 1}`).join(' | ')} |`
  const divider = `| ${Array.from({ length: cols }, () => '---').join(' | ')} |`
  const emptyRow = `| ${Array.from({ length: cols }, () => ' ').join('|')}|`
  const bodyRows = Array.from({ length: Math.max(0, rows - 1) }, () => emptyRow)
  return [header, divider, ...bodyRows].join('\n')
}
