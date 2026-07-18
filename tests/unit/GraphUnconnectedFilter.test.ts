import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/svelte'

import GraphUnconnectedFilter from '@renderer/components/GraphUnconnectedFilter.svelte'

describe('GraphUnconnectedFilter', () => {
  it('shows the unconnected count and toggles the highlight', async () => {
    const ontoggle = vi.fn()
    render(GraphUnconnectedFilter, { props: { count: 3, active: false, ontoggle } })

    const button = screen.getByRole('button', {
      name: 'Highlight 3 unconnected nodes with no incoming or outgoing connections'
    })
    expect(button.getAttribute('aria-pressed')).toBe('false')
    expect(button.textContent).toContain('Unconnected')
    expect(button.textContent).toContain('3')

    await fireEvent.click(button)
    expect(ontoggle).toHaveBeenCalledOnce()
  })

  it('exposes the active state as a pressed toggle', () => {
    render(GraphUnconnectedFilter, { props: { count: 1, active: true, ontoggle: vi.fn() } })

    const button = screen.getByRole('button', { name: 'Show normal graph colors' })
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(button.className).toContain('active')
  })

  it('is disabled when there are no unconnected nodes', () => {
    render(GraphUnconnectedFilter, { props: { count: 0, active: false, ontoggle: vi.fn() } })

    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true)
  })
})
