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
    expect(body).toContain(
      'startWorkerLayout(currentData, currentGraph3DData, 0.65, !reducedMotion)'
    )
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
    expect(workerBody).toContain('graphTopologyRevision(data, currentColoringMode, graph3DData)')
    expect(workerBody).toContain('groupingMode: currentColoringMode')
  })

  it('eases cached and live worker layouts from the currently visible coordinates', () => {
    const workerStart = source.indexOf('function startWorkerLayout(')
    const workerEnd = source.indexOf('function restartLayoutForColoringMode(', workerStart)
    const workerBody = source.slice(workerStart, workerEnd)
    const transition = functionBody(
      'runLayoutModeTransitionFrame',
      'function beginLayoutModeTransition'
    )

    expect(workerBody).toContain('visibleStartPositions')
    expect(workerBody).toContain('beginLayoutModeTransition(')
    expect(workerBody).toContain('completeCacheHit ? initialPositions.slice()')
    expect(workerBody).toContain('if (!animateCachedRestore)')
    expect(transition).toContain('applyGraphLayoutTransitionInOrder(')
    expect(transition).toContain('batchedLayer.syncPositions(updateArrows)')
    expect(transition).toContain('requestAnimationFrame(runLayoutModeTransitionFrame)')
    expect(source).toContain('retargetLayoutModeTransition(event.positions, workerSettled)')
    expect(source).toContain('prefers-reduced-motion: reduce')
  })

  it('animates topology-changing folder mode and scales spawned hubs', () => {
    const rebuild = functionBody('rebuildGraphForColoringMode', '/**\n   * Convert GraphData')
    const feed = functionBody('feedData', 'function applyGraphDelta')
    const transition = functionBody(
      'runLayoutModeTransitionFrame',
      'function beginLayoutModeTransition'
    )

    expect(rebuild).toContain('feedData(currentData, !reducedMotion)')
    expect(feed).toContain('collapseFolderHierarchyForSpawn(graph3DData.nodes)')
    expect(feed).toContain('folderHubSpawnProgress = 0')
    expect(feed).toContain('animateTopologyChange')
    expect(transition).toContain('FOLDER_HUB_SPAWN_MS')
    expect(source).toContain('Math.max(0.04, folderHubSpawnProgress)')
  })

  it('renders folder hulls from the same scope-relative branches used by hierarchy layout', () => {
    const hullMode = functionBody('isHullMode', '/**\n   * Grouping id for hulls')
    const hullGroup = functionBody('hullGroupId', '/** Palette used for hulls')

    expect(hullMode).toContain("currentColoringMode === 'folder'")
    expect(hullGroup).toContain("currentColoringMode === 'folder'")
    expect(hullGroup).toContain('node.folder_group ?? null')
    expect(source).toContain('shapesAvailable={isHullMode()}')
    expect(source).toContain('graphLabelsVisible && isHullMode()')
  })

  it('surfaces the active legend hull while preserving the Shapes preference otherwise', () => {
    const visibility = functionBody('hullsShouldBeVisible', 'function syncHullLegendHighlight')
    const legendSync = functionBody('syncHullLegendHighlight', '/**\n   * Compute node color')
    const hullUpdate = functionBody('updateClusterSpheres', 'function updateClusterLabelPositions')

    expect(visibility).toContain('graphShapesVisible || activeHullHighlightId() !== null')
    expect(legendSync).toContain('updateClusterSpheres(true)')
    expect(legendSync).toContain('setVisible(hullsShouldBeVisible())')
    expect(hullUpdate).toContain('if (!hullsShouldBeVisible())')
  })

  it('builds and seeds a scoped folder hierarchy while retaining content links', () => {
    expect(source).toContain('folderScopePath: effectiveFolderScopePath()')
    expect(source).toContain('folderRootLabel: graphFolderRootLabel()')
    expect(source).toContain('seedFolderHierarchyPositions(graph3DData.nodes, spreadRadius)')
    expect(source).toContain("currentColoringMode === 'folder' ? idle * 0.42 : idle")
    expect(source).toContain(
      '!isFolderHierarchyLink(link) && !isEdgeVisible(link, currentEdgeFilter)'
    )
    expect(source).toContain('isFolderHierarchyLink(link) ||')
    expect(source).toContain("engine: 'd3-force-3d-worker-v4'")
    expect(source).toContain('graphLayoutSeedRadius(currentLevel, currentColoringMode)')
  })

  it('routes folder hubs away from document actions and keeps labels interactive', () => {
    const selection = functionBody('selectBatchedNode', 'function selectFolderLabel')
    const navigation = functionBody('navigateToConnectedNode', 'function handleRetry')
    const contextMenu = functionBody('onBatchedContextMenu', 'function onBatchedPointerLeave')

    expect(selection).toContain('if (isFolderGraphNode(node))')
    expect(selection).toContain('selectGraphNode(null)')
    expect(selection).toContain('setGraphHighlightedFolder(node.path)')
    expect(selection).toContain('focusCameraOnNode(node)')
    expect(contextMenu).toContain('node && isFolderGraphNode(node)')
    expect(navigation).toContain('isFolderGraphNode(neighborNode)')
    expect(source).toContain('data-folder-path={lbl.path}')
    expect(source).toContain('onclick={() => selectFolderLabel(lbl.id)}')
    expect(source).toContain('folder_document_count')
    expect(source).toContain('No document links found. The folder hierarchy is still available.')
  })
})
