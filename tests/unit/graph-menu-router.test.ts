import { describe, expect, it, vi } from 'vitest'

import { routeGraphMenuAction, type GraphMenuController } from '@renderer/lib/graph-menu-router'

function controller(overrides: Partial<GraphMenuController> = {}): GraphMenuController {
  return {
    presentationActive: false,
    presentationPaused: false,
    shapesAvailable: true,
    search: vi.fn(),
    recenter: vi.fn(),
    toggleLabels: vi.fn(),
    toggleLines: vi.fn(),
    toggleShapes: vi.fn(),
    startPresentation: vi.fn(),
    pausePresentation: vi.fn(),
    continuePresentation: vi.fn(),
    resetPresentation: vi.fn(),
    screenshot: vi.fn(),
    ...overrides
  }
}

describe('routeGraphMenuAction', () => {
  it('routes search, camera, display, and screenshot actions', () => {
    const target = controller()

    routeGraphMenuAction('search', target)
    routeGraphMenuAction('recenter', target)
    routeGraphMenuAction('toggle-labels', target)
    routeGraphMenuAction('toggle-lines', target)
    routeGraphMenuAction('toggle-shapes', target)
    routeGraphMenuAction('screenshot', target)
    routeGraphMenuAction('screenshot-transparent', target)

    expect(target.search).toHaveBeenCalledOnce()
    expect(target.recenter).toHaveBeenCalledOnce()
    expect(target.toggleLabels).toHaveBeenCalledOnce()
    expect(target.toggleLines).toHaveBeenCalledOnce()
    expect(target.toggleShapes).toHaveBeenCalledOnce()
    expect(target.screenshot).toHaveBeenNthCalledWith(1, false)
    expect(target.screenshot).toHaveBeenNthCalledWith(2, true)
  })

  it('starts, pauses, or continues presentation from its current state', () => {
    const idle = controller()
    const playing = controller({ presentationActive: true })
    const paused = controller({ presentationActive: true, presentationPaused: true })

    routeGraphMenuAction('presentation-toggle', idle)
    routeGraphMenuAction('presentation-toggle', playing)
    routeGraphMenuAction('presentation-toggle', paused)

    expect(idle.startPresentation).toHaveBeenCalledOnce()
    expect(playing.pausePresentation).toHaveBeenCalledOnce()
    expect(paused.continuePresentation).toHaveBeenCalledOnce()
  })

  it('guards unavailable shapes and presentation reset while idle', () => {
    const idle = controller({ shapesAvailable: false })
    routeGraphMenuAction('toggle-shapes', idle)
    routeGraphMenuAction('presentation-reset', idle)
    expect(idle.toggleShapes).not.toHaveBeenCalled()
    expect(idle.resetPresentation).not.toHaveBeenCalled()

    const active = controller({ presentationActive: true })
    routeGraphMenuAction('presentation-reset', active)
    expect(active.resetPresentation).toHaveBeenCalledOnce()
  })
})
