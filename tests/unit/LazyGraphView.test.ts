import { render, screen, waitFor } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  loadGraphViewComponent: vi.fn(),
  syncGraphStoresFromTab: vi.fn()
}))

vi.mock('../../src/renderer/lib/graph-view-loader', () => ({
  loadGraphViewComponent: mocks.loadGraphViewComponent
}))

vi.mock('../../src/renderer/stores/graph', () => ({
  syncGraphStoresFromTab: mocks.syncGraphStoresFromTab
}))

import LazyGraphView from '../../src/renderer/components/LazyGraphView.svelte'
import StubComponent from './stubs/StubComponent.svelte'

beforeEach(() => {
  mocks.loadGraphViewComponent.mockReset()
  mocks.syncGraphStoresFromTab.mockReset()
  mocks.loadGraphViewComponent.mockResolvedValue(StubComponent)
})

describe('LazyGraphView', () => {
  it('starts the lazy import during component setup without mutating state from the template', async () => {
    expect(() => render(LazyGraphView, { props: { paneId: 'graph-pane' } })).not.toThrow()
    expect(mocks.loadGraphViewComponent).toHaveBeenCalledTimes(1)

    expect(await screen.findByTestId('stub-component')).toBeTruthy()
    await waitFor(() => expect(mocks.syncGraphStoresFromTab).toHaveBeenCalledTimes(1))
  })
})
