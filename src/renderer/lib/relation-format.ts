/**
 * Client-side relation value helpers (phase 42).
 *
 * The CLI is the single resolver — nothing here resolves paths against the
 * vault. These are pure, display/matching-level helpers:
 *  - `parseLinkShaped` — the whole-value link-shape predicate, mirrored from
 *    the CLI (`src/relations.rs::parse_link_shaped`) for the optimistic
 *    display fallback and filter normalization only.
 *  - `relationKey` — the CLI's `relation_key` filter normalization, mirrored
 *    so app-side `equals`/`in` filtering matches `mdvdb --filter` semantics.
 *  - `formatRelationValue` — the ONE commit format the app writes:
 *    `[[<root-relative-path-without-.md>]]`.
 */

/** External / anchor-only targets are never relations (mirrors the CLI). */
function isExternalOrAnchor(target: string): boolean {
  const lower = target.toLowerCase()
  return (
    lower.startsWith('http://') ||
    lower.startsWith('https://') ||
    lower.startsWith('mailto:') ||
    (target.startsWith('#') && !target.includes('/'))
  )
}

/** A parsed link-shaped frontmatter value. */
export interface ParsedLink {
  /** Inner link target (wiki inner before `|`, markdown link target, or bare path). */
  target: string
  /** Display text (alias / link text), falling back to the target. */
  text: string
  isWikilink: boolean
}

/**
 * Whole-value link-shape predicate: the entire trimmed string must be exactly
 * one wiki link, one markdown link with a non-external target, or a bare
 * no-whitespace `.md` path. `"See [[x]] for details"` is NOT link-shaped.
 */
export function parseLinkShaped(value: string): ParsedLink | null {
  const t = value.trim()

  // Wiki link: [[target]] / [[target|alias]]
  if (t.startsWith('[[') && t.endsWith(']]')) {
    const inner = t.slice(2, -2)
    if (inner === '' || inner.includes('[') || inner.includes(']')) return null
    const pipe = inner.indexOf('|')
    const target = (pipe >= 0 ? inner.slice(0, pipe) : inner).trim()
    const text = (pipe >= 0 ? inner.slice(pipe + 1) : inner).trim()
    if (target === '' || isExternalOrAnchor(target)) return null
    return { target, text: text || target, isWikilink: true }
  }

  // Markdown link: [text](target)
  if (t.startsWith('[') && t.endsWith(')')) {
    const idx = t.indexOf('](')
    if (idx < 0) return null
    const text = t.slice(1, idx)
    const target = t.slice(idx + 2, -1).trim()
    if (text.includes(']') || target.includes('(') || target.includes(')')) return null
    if (target === '' || isExternalOrAnchor(target)) return null
    return { target, text: text.trim() || target, isWikilink: false }
  }

  // Bare vault path: no whitespace, ends in .md, not external.
  if (t !== '' && !/\s/.test(t) && t.endsWith('.md') && !isExternalOrAnchor(t)) {
    return { target: t, text: t, isWikilink: false }
  }

  return null
}

/** Whether a frontmatter value is link-shaped (whole-value predicate). */
export function isLinkShaped(value: string): boolean {
  return parseLinkShaped(value) !== null
}

/**
 * The CLI's `relation_key` filter normalization: inner link target,
 * `#fragment` stripped, `\` → `/`, leading `/` stripped, trailing `.md`
 * stripped. Returns null when the value is not link-shaped.
 */
export function relationKey(value: string): string | null {
  const parsed = parseLinkShaped(value)
  if (!parsed) return null
  let t = parsed.target.split('#')[0].replace(/\\/g, '/').trim()
  t = t.replace(/^\/+/, '')
  t = t.endsWith('.md') ? t.slice(0, -3) : t
  return t === '' ? null : t
}

/**
 * Coerce a filter/query value for relation matching: normalized when it is
 * itself link-shaped, else the raw string with a trailing `.md` stripped
 * (mirrors the CLI's `coerce` in `filter_values_equal`).
 */
export function coerceRelationFilterValue(value: string): string {
  return relationKey(value) ?? (value.endsWith('.md') ? value.slice(0, -3) : value)
}

/**
 * The commit format for relation writes: `[[<root-relative-path-sans-.md>]]`.
 * The path contains `/`, so resolution rule 1 (root-relative) makes it
 * deterministic. No alias is ever written — titles are server-resolved.
 */
export function formatRelationValue(path: string): string {
  const sansMd = path.endsWith('.md') ? path.slice(0, -3) : path
  return `[[${sansMd}]]`
}

/** Last path segment without a `.md`/`.markdown` extension. */
export function relationBasename(path: string): string {
  const last = path.split('/').pop() ?? path
  const stem = last.replace(/\.(md|markdown)$/i, '')
  return stem === '' ? last : stem
}

/**
 * Display text for a relation chip with no server-resolved RelationValue
 * (the optimistic window / old CLIs): alias if present, else the target's
 * basename. Returns the raw string for non-link-shaped values.
 */
export function fallbackChipText(raw: string): string {
  const parsed = parseLinkShaped(raw)
  if (!parsed) return raw
  if (parsed.text !== parsed.target) return parsed.text
  return relationBasename(parsed.target.split('#')[0])
}
