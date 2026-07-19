import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'

import GraphBackgroundContextMenu from '@renderer/components/GraphBackgroundContextMenu.svelte'

function renderMenu(overrides: Record<string, unknown> = {}) {
  const handlers = {
    ondismiss: vi.fn(),
    onrecenter: vi.fn(),
    ontogglelabels: vi.fn(),
    onscreenshot: vi.fn(),
    onscreenshottransparent: vi.fn()
  }

  render(GraphBackgroundContextMenu, {
    props: {
      x: 120,
      y: 240,
      labelsVisible: true,
      busy: false,
      exporting: false,
      ...handlers,
      ...overrides
    }
  })

  return handlers
}

describe('GraphBackgroundContextMenu', () => {
  it('renders at the requested graph coordinates with accessible menu actions', () => {
    renderMenu()

    const menu = screen.getByRole('menu', { name: 'Graph background actions' })
    expect(menu.getAttribute('style')).toContain('left: 120px')
    expect(menu.getAttribute('style')).toContain('top: 240px')
    expect(screen.getAllByRole('menuitem')).toHaveLength(4)
    for (const name of [
      'Recenter graph',
      'Hide labels',
      'Screenshot',
      'Screenshot transparent background'
    ]) {
      expect(screen.getByRole('menuitem', { name, exact: true })).toBeTruthy()
    }
  })

  it('invokes each graph action from native menu buttons', async () => {
    const handlers = renderMenu()

    await fireEvent.click(screen.getByRole('menuitem', { name: 'Recenter graph' }))
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Hide labels' }))
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Screenshot', exact: true }))
    await fireEvent.click(
      screen.getByRole('menuitem', { name: 'Screenshot transparent background' })
    )

    expect(handlers.onrecenter).toHaveBeenCalledOnce()
    expect(handlers.ontogglelabels).toHaveBeenCalledOnce()
    expect(handlers.onscreenshot).toHaveBeenCalledOnce()
    expect(handlers.onscreenshottransparent).toHaveBeenCalledOnce()
  })

  it('offers to show labels when graph labels are hidden', () => {
    renderMenu({ labelsVisible: false })

    expect(screen.getByRole('menuitem', { name: 'Show labels' })).toBeTruthy()
    expect(screen.queryByRole('menuitem', { name: 'Hide labels' })).toBeNull()
  })

  it('dismisses from the backdrop and Escape key', async () => {
    const handlers = renderMenu()
    const backdrop = screen.getByRole('button', { name: 'Dismiss graph background menu' })

    await fireEvent.click(backdrop)
    await fireEvent.contextMenu(backdrop)
    await fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })

    expect(handlers.ondismiss).toHaveBeenCalledTimes(3)
  })

  it('supports arrow-key menu navigation and focuses the first action on mount', async () => {
    renderMenu()
    const items = screen.getAllByRole('menuitem') as HTMLButtonElement[]

    await waitFor(() => expect(document.activeElement).toBe(items[0]))
    await fireEvent.keyDown(items[0], { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[1])
    await fireEvent.keyDown(items[1], { key: 'End' })
    expect(document.activeElement).toBe(items[3])
    await fireEvent.keyDown(items[3], { key: 'ArrowDown' })
    expect(document.activeElement).toBe(items[0])
  })

  it('disables duplicate actions and announces an export in progress', () => {
    renderMenu({ exporting: true })

    const menu = screen.getByRole('menu', { name: 'Graph background actions' })
    expect(menu.getAttribute('aria-busy')).toBe('true')
    expect(
      screen.getAllByRole('menuitem').every((item) => (item as HTMLButtonElement).disabled)
    ).toBe(true)
    expect(screen.getByRole('status').textContent?.trim()).toBe('Exporting graph screenshot.')
  })
})
