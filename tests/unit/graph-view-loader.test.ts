import { describe, expect, it, vi } from 'vitest'

const graphModuleSpies = vi.hoisted(() => ({
  evaluated: vi.fn(),
  clearCache: vi.fn()
}))

vi.mock('../../src/renderer/components/GraphView.svelte', async () => {
  graphModuleSpies.evaluated()
  const stub = await import('./stubs/StubComponent.svelte')
  return {
    default: stub.default,
    clearGraphStateCache: graphModuleSpies.clearCache
  }
})

import {
  clearLoadedGraphStateCache,
  loadGraphViewComponent
} from '../../src/renderer/lib/graph-view-loader'

describe('graph view module loader', () => {
  it('stays cold until requested, deduplicates imports, and clears only a loaded cache', async () => {
    clearLoadedGraphStateCache()
    expect(graphModuleSpies.evaluated).not.toHaveBeenCalled()
    expect(graphModuleSpies.clearCache).not.toHaveBeenCalled()

    const first = loadGraphViewComponent()
    const second = loadGraphViewComponent()

    expect(first).toBe(second)
    const [firstComponent, secondComponent] = await Promise.all([first, second])
    expect(firstComponent).toBe(secondComponent)
    expect(graphModuleSpies.evaluated).toHaveBeenCalledTimes(1)

    clearLoadedGraphStateCache()
    expect(graphModuleSpies.clearCache).toHaveBeenCalledTimes(1)
  })
})
