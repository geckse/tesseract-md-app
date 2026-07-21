export interface GraphLabelCandidate {
  id: string
  label: string
  x: number
  y: number
  importance: number
}

export interface GraphLabelViewport {
  width: number
  height: number
}

/** Link picking builds an edge spatial index; defer that work during huge moving layouts. */
export function graphLinkPickIntervalMs(layoutActive: boolean, linkCount: number): number {
  return layoutActive && linkCount >= 10_000 ? 300 : 0
}

const LABEL_FONT_WIDTH = 7.2
const LABEL_HORIZONTAL_PADDING = 10
const LABEL_HEIGHT = 18
const LABEL_OFFSET_Y = 6
const LABEL_COLLISION_GAP = 4
const LABEL_VIEWPORT_PADDING = 6
const COLLISION_CELL_SIZE = 16

/**
 * Keep the HTML overlay proportional to the available screen area. The graph
 * can contain tens of thousands of nodes, but the screen can only display a
 * small, readable number of labels at once.
 */
export function adaptiveGraphLabelBudget(
  viewport: GraphLabelViewport,
  candidateCount: number,
  layoutActive: boolean
): number {
  if (candidateCount <= 0 || viewport.width <= 0 || viewport.height <= 0) return 0

  const areaBudget = Math.max(12, Math.floor((viewport.width * viewport.height) / 12_000))
  const activityCap = layoutActive ? 96 : 180
  return Math.min(candidateCount, activityCap, areaBudget)
}

/**
 * Select high-value labels while rejecting off-screen and overlapping text.
 * Candidates are ranked before collision placement, so selected/search/hub
 * labels supplied with a higher importance win the available screen space.
 */
export function selectReadableGraphLabels(
  candidates: readonly GraphLabelCandidate[],
  viewport: GraphLabelViewport,
  budget: number
): GraphLabelCandidate[] {
  if (budget <= 0 || viewport.width <= 0 || viewport.height <= 0) return []

  const columns = Math.max(1, Math.ceil(viewport.width / COLLISION_CELL_SIZE))
  const occupiedCells = new Set<number>()
  const ranked = candidates
    .map((candidate, inputIndex) => ({ candidate, inputIndex }))
    .filter(({ candidate }) => Number.isFinite(candidate.x) && Number.isFinite(candidate.y))
    .sort((a, b) => {
      const aImportance = Number.isFinite(a.candidate.importance) ? a.candidate.importance : 0
      const bImportance = Number.isFinite(b.candidate.importance) ? b.candidate.importance : 0
      return bImportance - aImportance || a.inputIndex - b.inputIndex
    })

  const selected: GraphLabelCandidate[] = []
  for (const { candidate } of ranked) {
    const labelWidth = Math.min(
      Math.max(36, candidate.label.length * LABEL_FONT_WIDTH + LABEL_HORIZONTAL_PADDING),
      Math.max(36, viewport.width - LABEL_VIEWPORT_PADDING * 2)
    )
    const left = candidate.x - labelWidth / 2 - LABEL_COLLISION_GAP
    const right = candidate.x + labelWidth / 2 + LABEL_COLLISION_GAP
    const bottom = candidate.y - LABEL_OFFSET_Y + LABEL_COLLISION_GAP
    const top = bottom - LABEL_HEIGHT - LABEL_COLLISION_GAP * 2

    // A clipped label is not useful and still consumes a DOM element.
    if (
      left < LABEL_VIEWPORT_PADDING ||
      right > viewport.width - LABEL_VIEWPORT_PADDING ||
      top < LABEL_VIEWPORT_PADDING ||
      bottom > viewport.height - LABEL_VIEWPORT_PADDING
    ) {
      continue
    }

    const minCellX = Math.floor(left / COLLISION_CELL_SIZE)
    const maxCellX = Math.floor(right / COLLISION_CELL_SIZE)
    const minCellY = Math.floor(top / COLLISION_CELL_SIZE)
    const maxCellY = Math.floor(bottom / COLLISION_CELL_SIZE)
    let collides = false
    for (let cellY = minCellY; cellY <= maxCellY && !collides; cellY++) {
      for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
        if (occupiedCells.has(cellY * columns + cellX)) {
          collides = true
          break
        }
      }
    }
    if (collides) continue

    selected.push(candidate)
    for (let cellY = minCellY; cellY <= maxCellY; cellY++) {
      for (let cellX = minCellX; cellX <= maxCellX; cellX++) {
        occupiedCells.add(cellY * columns + cellX)
      }
    }
    if (selected.length >= budget) break
  }

  return selected
}
