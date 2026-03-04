/**
 * Fuzzy match a query against a target string.
 * Returns a score (higher is better) and an array of matching character indices.
 */
export interface FuzzyMatch {
  score: number
  indices: number[]
}

/**
 * Fuzzy match algorithm that scores based on:
 * - Consecutive character matches (bonus)
 * - Matches at word boundaries (bonus)
 * - Case-sensitive exact matches (bonus)
 * - Earlier matches (slight bonus)
 *
 * Returns null if no match found.
 */
export function fuzzyMatch(query: string, target: string): FuzzyMatch | null {
  if (!query) return { score: 0, indices: [] }

  const queryLower = query.toLowerCase()
  const targetLower = target.toLowerCase()

  const indices: number[] = []
  let queryIndex = 0
  let targetIndex = 0
  let score = 0
  let consecutive = 0

  // Find all matching characters in order
  while (queryIndex < queryLower.length && targetIndex < targetLower.length) {
    if (queryLower[queryIndex] === targetLower[targetIndex]) {
      indices.push(targetIndex)

      // Base score for each match
      score += 1

      // Bonus for consecutive matches
      if (consecutive > 0) {
        score += consecutive * 5
      }
      consecutive++

      // Bonus for matching at word boundaries (after /, -, _, or space)
      if (targetIndex === 0 ||
          target[targetIndex - 1] === '/' ||
          target[targetIndex - 1] === '-' ||
          target[targetIndex - 1] === '_' ||
          target[targetIndex - 1] === ' ') {
        score += 10
      }

      // Bonus for case-sensitive exact match
      if (query[queryIndex] === target[targetIndex]) {
        score += 2
      }

      // Slight bonus for earlier matches
      score += Math.max(0, 10 - targetIndex * 0.1)

      queryIndex++
    } else {
      consecutive = 0
    }
    targetIndex++
  }

  // No match if we didn't match all query characters
  if (queryIndex < queryLower.length) {
    return null
  }

  // Bonus for shorter targets (prefer shorter paths)
  score += Math.max(0, 50 - target.length)

  return { score, indices }
}

/**
 * Match and score a list of items, returning sorted results.
 */
export function fuzzyFilter<T>(
  query: string,
  items: T[],
  getText: (item: T) => string
): Array<{ item: T; match: FuzzyMatch }> {
  const results: Array<{ item: T; match: FuzzyMatch }> = []

  for (const item of items) {
    const text = getText(item)
    const match = fuzzyMatch(query, text)
    if (match) {
      results.push({ item, match })
    }
  }

  // Sort by score (descending)
  results.sort((a, b) => b.match.score - a.match.score)

  return results
}
