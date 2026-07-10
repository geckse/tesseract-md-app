/**
 * Pure line-based three-way merge (diff3).
 *
 * Given a common ancestor (`base`), the local edits (`ours`), and the disk
 * edits (`theirs`), compose a single document containing both sets of changes.
 * When the two sides touched different lines the merge is "clean"; when they
 * changed the same lines it is a conflict (the UI declines to auto-merge and
 * falls back to Keep Mine / Take Disk).
 *
 * No DOM — unit-testable in isolation.
 */

/** Above this many lines in any input the merge is declined (perf guard). */
const MAX_MERGE_LINES = 3000

export interface MergeResult {
  /** True when both sides composed without overlapping conflicts. */
  clean: boolean
  /** The composed document (git-style conflict markers when not clean). */
  merged: string
  /** Number of conflicting regions (0 when clean; -1 when declined for size). */
  conflicts: number
}

export interface MergeLabels {
  ours: string
  theirs: string
}

/** One differing region of `base` replaced by a region of the other text. */
interface Hunk {
  oStart: number
  oEnd: number
  nStart: number
  nEnd: number
}

interface TaggedHunk extends Hunk {
  side: 'a' | 'b'
}

function splitLines(text: string): string[] {
  return text.split('\n')
}

/** Longest-common-subsequence matched index pairs between two line arrays. */
function lcsMatches(a: string[], b: string[]): Array<[number, number]> {
  const n = a.length
  const m = b.length
  // dp[i][j] = LCS length of a[i:] and b[j:]
  const dp: Int32Array[] = Array.from({ length: n + 1 }, () => new Int32Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    const row = dp[i]
    const next = dp[i + 1]
    for (let j = m - 1; j >= 0; j--) {
      row[j] = a[i] === b[j] ? next[j + 1] + 1 : Math.max(next[j], row[j + 1])
    }
  }

  const matches: Array<[number, number]> = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      matches.push([i, j])
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++
    } else {
      j++
    }
  }
  return matches
}

/** Differing regions of `o` (base) replaced by regions of `n` (other). */
function diffToHunks(o: string[], n: string[]): Hunk[] {
  const matches = lcsMatches(o, n)
  const hunks: Hunk[] = []
  let oi = 0
  let ni = 0
  for (const [om, nm] of matches) {
    if (om > oi || nm > ni) {
      hunks.push({ oStart: oi, oEnd: om, nStart: ni, nEnd: nm })
    }
    oi = om + 1
    ni = nm + 1
  }
  if (oi < o.length || ni < n.length) {
    hunks.push({ oStart: oi, oEnd: o.length, nStart: ni, nEnd: n.length })
  }
  return hunks
}

/** Compose one side's version of base range [regionStart, regionEnd). */
function composeSide(
  hunks: Hunk[],
  regionStart: number,
  regionEnd: number,
  base: string[],
  other: string[]
): string[] {
  const out: string[] = []
  let o = regionStart
  for (const h of hunks) {
    for (let k = o; k < h.oStart; k++) out.push(base[k])
    for (let k = h.nStart; k < h.nEnd; k++) out.push(other[k])
    o = h.oEnd
  }
  for (let k = o; k < regionEnd; k++) out.push(base[k])
  return out
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

/**
 * Three-way merge of line arrays. Returns the composed lines and whether any
 * region conflicted (both sides changed the same lines differently).
 */
export function threeWayMerge(
  base: string,
  ours: string,
  theirs: string,
  labels: MergeLabels = { ours: 'Editor (unsaved)', theirs: 'On disk' }
): MergeResult {
  const O = splitLines(base)
  const A = splitLines(ours)
  const B = splitLines(theirs)

  if (O.length > MAX_MERGE_LINES || A.length > MAX_MERGE_LINES || B.length > MAX_MERGE_LINES) {
    return { clean: false, merged: '', conflicts: -1 }
  }

  const aHunks = diffToHunks(O, A)
  const bHunks = diffToHunks(O, B)

  const all: TaggedHunk[] = [
    ...aHunks.map((h) => ({ ...h, side: 'a' as const })),
    ...bHunks.map((h) => ({ ...h, side: 'b' as const }))
  ].sort((x, y) => x.oStart - y.oStart || x.oEnd - y.oEnd)

  const result: string[] = []
  let conflicts = 0
  let oi = 0
  let idx = 0

  while (oi < O.length || idx < all.length) {
    if (idx >= all.length) {
      for (let k = oi; k < O.length; k++) result.push(O[k])
      break
    }

    const first = all[idx]
    if (first.oStart > oi) {
      for (let k = oi; k < first.oStart; k++) result.push(O[k])
      oi = first.oStart
      continue
    }

    // Group: all hunks starting exactly here (catches same-position inserts
    // from both sides), then extend by strict overlap. Adjacent (touching)
    // hunks on different sides stay separate → merge cleanly.
    const regionStart = first.oStart
    const group: TaggedHunk[] = []
    let regionEnd = first.oEnd
    let j = idx
    while (j < all.length && all[j].oStart === regionStart) {
      regionEnd = Math.max(regionEnd, all[j].oEnd)
      group.push(all[j])
      j++
    }
    while (j < all.length && all[j].oStart < regionEnd) {
      regionEnd = Math.max(regionEnd, all[j].oEnd)
      group.push(all[j])
      j++
    }

    const aSide = group.filter((g) => g.side === 'a')
    const bSide = group.filter((g) => g.side === 'b')
    const changedA = aSide.length > 0
    const changedB = bSide.length > 0
    const aText = composeSide(aSide, regionStart, regionEnd, O, A)
    const bText = composeSide(bSide, regionStart, regionEnd, O, B)

    if (changedA && !changedB) {
      result.push(...aText)
    } else if (changedB && !changedA) {
      result.push(...bText)
    } else if (arraysEqual(aText, bText)) {
      result.push(...aText)
    } else {
      conflicts++
      result.push(`<<<<<<< ${labels.ours}`)
      result.push(...aText)
      result.push('=======')
      result.push(...bText)
      result.push(`>>>>>>> ${labels.theirs}`)
    }

    oi = regionEnd
    idx = j
  }

  return { clean: conflicts === 0, merged: result.join('\n'), conflicts }
}
