import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/svelte'

import GraphPresentationControl from '@renderer/components/GraphPresentationControl.svelte'

describe('GraphPresentationControl', () => {
  it('starts from the automatic root when no node is selected', async () => {
    const onstart = vi.fn()
    render(GraphPresentationControl, {
      props: {
        active: false,
        paused: false,
        revealed: 0,
        total: 8,
        startsFromSelection: false,
        statusMessage: '',
        onstart,
        onpause: vi.fn(),
        onresume: vi.fn(),
        onreset: vi.fn()
      }
    })

    await fireEvent.click(
      screen.getByRole('button', { name: 'Present graph from most root-like node' })
    )
    expect(onstart).toHaveBeenCalledOnce()
  })

  it('describes a selected-node start', () => {
    render(GraphPresentationControl, {
      props: {
        active: false,
        paused: false,
        revealed: 0,
        total: 8,
        startsFromSelection: true,
        statusMessage: '',
        onstart: vi.fn(),
        onpause: vi.fn(),
        onresume: vi.fn(),
        onreset: vi.fn()
      }
    })

    expect(screen.getByRole('button', { name: 'Present graph from selected node' })).toBeTruthy()
  })

  it('shows progress and can pause or reset an active presentation', async () => {
    const onpause = vi.fn()
    const onreset = vi.fn()
    render(GraphPresentationControl, {
      props: {
        active: true,
        paused: false,
        revealed: 4,
        total: 10,
        startsFromSelection: false,
        statusMessage: 'Graph presentation started from the most root-like node.',
        onstart: vi.fn(),
        onpause,
        onresume: vi.fn(),
        onreset
      }
    })

    const pauseButton = screen.getByRole('button', {
      name: 'Pause graph presentation at current step'
    })
    const resetButton = screen.getByRole('button', { name: 'Reset graph presentation' })
    const progress = screen.getByRole('progressbar', { name: 'Graph presentation progress' })
    expect(progress.textContent).toBe('4/10')
    expect(progress.getAttribute('aria-valuenow')).toBe('4')
    expect(progress.getAttribute('aria-valuemax')).toBe('10')
    expect(progress.getAttribute('aria-valuetext')).toBe('4 of 10 nodes revealed')
    expect(screen.getByRole('status').textContent).toBe(
      'Graph presentation started from the most root-like node.'
    )
    await fireEvent.click(pauseButton)
    await fireEvent.click(resetButton)
    expect(onpause).toHaveBeenCalledOnce()
    expect(onreset).toHaveBeenCalledOnce()
  })

  it('continues a paused presentation without resetting its progress', async () => {
    const onresume = vi.fn()
    render(GraphPresentationControl, {
      props: {
        active: true,
        paused: true,
        revealed: 6,
        total: 10,
        startsFromSelection: false,
        statusMessage: 'Graph presentation paused at 6 of 10.',
        onstart: vi.fn(),
        onpause: vi.fn(),
        onresume,
        onreset: vi.fn()
      }
    })

    expect(screen.getByRole('progressbar').textContent).toBe('6/10')
    await fireEvent.click(screen.getByRole('button', { name: 'Continue graph presentation' }))
    expect(onresume).toHaveBeenCalledOnce()
  })

  it('keeps keyboard focus on the primary control when playback starts', async () => {
    const callbacks = {
      onstart: vi.fn(),
      onpause: vi.fn(),
      onresume: vi.fn(),
      onreset: vi.fn()
    }
    const { rerender } = render(GraphPresentationControl, {
      props: {
        active: false,
        paused: false,
        revealed: 0,
        total: 10,
        startsFromSelection: false,
        statusMessage: '',
        ...callbacks
      }
    })
    const primaryButton = screen.getByRole('button', {
      name: 'Present graph from most root-like node'
    })
    primaryButton.focus()

    await rerender({
      active: true,
      paused: false,
      revealed: 1,
      total: 10,
      startsFromSelection: false,
      statusMessage: 'Graph presentation started from the most root-like node.',
      ...callbacks
    })

    expect(screen.getByRole('button', { name: 'Pause graph presentation at current step' })).toBe(
      primaryButton
    )
    expect(document.activeElement).toBe(primaryButton)
  })

  it('is disabled without graph nodes', () => {
    render(GraphPresentationControl, {
      props: {
        active: false,
        paused: false,
        revealed: 0,
        total: 0,
        startsFromSelection: false,
        statusMessage: '',
        onstart: vi.fn(),
        onpause: vi.fn(),
        onresume: vi.fn(),
        onreset: vi.fn()
      }
    })

    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true)
  })
})
