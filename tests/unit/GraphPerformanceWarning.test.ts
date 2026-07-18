import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/svelte'

import GraphPerformanceWarning from '@renderer/components/GraphPerformanceWarning.svelte'

describe('GraphPerformanceWarning', () => {
  it('does not render for graphs at the performance threshold', () => {
    render(GraphPerformanceWarning, { props: { nodeCount: 500 } })

    expect(screen.queryByRole('status')).toBeNull()
  })

  it('shows the large-graph warning and dismisses it', async () => {
    render(GraphPerformanceWarning, { props: { nodeCount: 501 } })

    expect(screen.getByRole('status').textContent).toContain(
      'Large graph (501 nodes). Some effects disabled for performance.'
    )

    await fireEvent.click(screen.getByRole('button', { name: 'Dismiss large graph warning' }))

    expect(screen.queryByRole('status')).toBeNull()
  })

  it('uses the very-large-graph warning above 2,000 nodes', () => {
    render(GraphPerformanceWarning, { props: { nodeCount: 2001 } })

    expect(screen.getByRole('status').textContent).toContain(
      'Very large graph (2001 nodes). Visual quality reduced for performance.'
    )
  })
})
