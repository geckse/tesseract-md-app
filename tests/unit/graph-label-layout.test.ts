import { describe, expect, it } from 'vitest'

import {
  adaptiveGraphLabelBudget,
  graphLinkPickIntervalMs,
  selectReadableGraphLabels,
  type GraphLabelCandidate
} from '../../src/renderer/lib/graph-label-layout'

function candidate(id: string, x: number, y: number, importance = 0): GraphLabelCandidate {
  return { id, label: id, x, y, importance }
}

describe('adaptiveGraphLabelBudget', () => {
  it('scales with viewport area and lowers the ceiling during active layout', () => {
    const viewport = { width: 2400, height: 1600 }

    expect(adaptiveGraphLabelBudget(viewport, 10_000, false)).toBe(180)
    expect(adaptiveGraphLabelBudget(viewport, 10_000, true)).toBe(96)
  })

  it('never exceeds the available candidates', () => {
    expect(adaptiveGraphLabelBudget({ width: 1400, height: 900 }, 14, false)).toBe(14)
  })
})

describe('graphLinkPickIntervalMs', () => {
  it('only throttles link-grid rebuilds for huge active layouts', () => {
    expect(graphLinkPickIntervalMs(true, 10_000)).toBe(300)
    expect(graphLinkPickIntervalMs(true, 9_999)).toBe(0)
    expect(graphLinkPickIntervalMs(false, 50_000)).toBe(0)
  })
})

describe('selectReadableGraphLabels', () => {
  it('rejects labels outside the viewport', () => {
    const labels = selectReadableGraphLabels(
      [candidate('left', -20, 100, 10), candidate('visible', 200, 100, 1)],
      { width: 400, height: 240 },
      10
    )

    expect(labels.map((label) => label.id)).toEqual(['visible'])
  })

  it('keeps the more important label when screen rectangles collide', () => {
    const labels = selectReadableGraphLabels(
      [candidate('ordinary', 200, 120, 1), candidate('selected', 203, 121, 1000)],
      { width: 400, height: 240 },
      10
    )

    expect(labels.map((label) => label.id)).toEqual(['selected'])
  })

  it('enforces the DOM label budget after collision placement', () => {
    const labels = selectReadableGraphLabels(
      [candidate('one', 80, 80, 4), candidate('two', 240, 80, 3), candidate('three', 400, 80, 2)],
      { width: 500, height: 200 },
      2
    )

    expect(labels.map((label) => label.id)).toEqual(['one', 'two'])
  })
})
