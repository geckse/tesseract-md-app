import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/svelte'

import GraphDisplayControls from '@renderer/components/GraphDisplayControls.svelte'

function renderControls(overrides: Record<string, unknown> = {}) {
  const handlers = {
    onsearch: vi.fn(),
    ontogglelabels: vi.fn(),
    ontogglelines: vi.fn(),
    ontoggleshapes: vi.fn(),
    onrecenter: vi.fn()
  }
  render(GraphDisplayControls, {
    props: {
      searchOpen: false,
      labelsVisible: true,
      linesVisible: true,
      shapesVisible: true,
      shapesAvailable: true,
      ...handlers,
      ...overrides
    }
  })
  return handlers
}

describe('GraphDisplayControls', () => {
  it('opens graph search and recenters from icon buttons', async () => {
    const handlers = renderControls()

    await fireEvent.click(screen.getByRole('button', { name: 'Search graph' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Recenter graph' }))

    expect(handlers.onsearch).toHaveBeenCalledOnce()
    expect(handlers.onrecenter).toHaveBeenCalledOnce()
  })

  it('offers independent label, line, and shape visibility toggles', async () => {
    const handlers = renderControls()

    await fireEvent.click(screen.getByRole('button', { name: 'Hide labels' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Hide lines' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Hide cluster and topic shapes' }))

    expect(handlers.ontogglelabels).toHaveBeenCalledOnce()
    expect(handlers.ontogglelines).toHaveBeenCalledOnce()
    expect(handlers.ontoggleshapes).toHaveBeenCalledOnce()
  })

  it('exposes hidden elements as pressed controls with show actions', () => {
    renderControls({ labelsVisible: false, linesVisible: false, shapesVisible: false })

    for (const name of ['Show labels', 'Show lines', 'Show cluster and topic shapes']) {
      expect(screen.getByRole('button', { name }).getAttribute('aria-pressed')).toBe('true')
    }
  })

  it('disables the shapes control outside cluster and topic views', () => {
    renderControls({ shapesAvailable: false })

    const button = screen.getByRole('button', { name: 'Hide cluster and topic shapes' })
    expect((button as HTMLButtonElement).disabled).toBe(true)
  })

  it('exposes whether graph search is already open', () => {
    renderControls({ searchOpen: true })

    expect(screen.getByRole('button', { name: 'Search graph' }).getAttribute('aria-expanded')).toBe(
      'true'
    )
  })
})
