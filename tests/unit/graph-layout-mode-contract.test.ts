import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(
  resolve(__dirname, '../../src/renderer/components/GraphView.svelte'),
  'utf8'
)

function functionBody(name: string, nextMarker: string): string {
  const start = source.indexOf(`function ${name}(`)
  const end = source.indexOf(nextMarker, start)
  expect(start, `${name} not found`).toBeGreaterThan(-1)
  expect(end, `${name} terminator not found`).toBeGreaterThan(start)
  return source.slice(start, end)
}

describe('GraphView mode-aware layout contract', () => {
  it('restarts the worker from live data without loading data or moving the camera', () => {
    const body = functionBody('restartLayoutForColoringMode', '/**\n   * Convert GraphData')

    expect(body).toContain('recomputeLayoutGroupCentroids(currentGraph3DData.nodes)')
    expect(body).toContain('startWorkerLayout(currentData, currentGraph3DData, 0.65)')
    expect(body).not.toContain('loadGraphData')
    expect(body).not.toContain('cameraPosition')
    expect(body).not.toContain('selectGraphNode')
  })

  it('routes dropdown changes through the restart and isolates cached layouts by mode', () => {
    const subscriptionStart = source.indexOf('unsubColoring = graphColoringMode.subscribe')
    const subscriptionEnd = source.indexOf('// Selection state', subscriptionStart)
    const subscription = source.slice(subscriptionStart, subscriptionEnd)

    expect(subscriptionStart).toBeGreaterThan(-1)
    expect(subscriptionEnd).toBeGreaterThan(subscriptionStart)
    expect(subscription).toContain('restartLayoutForColoringMode()')

    const workerStart = source.indexOf('function startWorkerLayout(')
    const workerEnd = source.indexOf('function restartLayoutForColoringMode(', workerStart)
    const workerBody = source.slice(workerStart, workerEnd)
    expect(workerBody).toContain('graphTopologyRevision(data, currentColoringMode)')
    expect(workerBody).toContain('groupingMode: currentColoringMode')
  })

  it('renders folder hulls from the same top-level buckets used by layout and legend', () => {
    const hullMode = functionBody('isHullMode', '/**\n   * Grouping id for hulls')
    const hullGroup = functionBody('hullGroupId', '/** Palette used for hulls')

    expect(hullMode).toContain("currentColoringMode === 'folder'")
    expect(hullGroup).toContain("currentColoringMode === 'folder'")
    expect(hullGroup).toContain('graphTopLevelFolder(node.path)')
    expect(source).toContain('shapesAvailable={isHullMode()}')
    expect(source).toContain('graphLabelsVisible && isHullMode()')
  })
})
