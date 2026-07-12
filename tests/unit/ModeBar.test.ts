import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render } from '@testing-library/svelte'

// Mock window.api before importing stores/components.
const mockApi = {
  saveWindowSession: vi.fn().mockResolvedValue(undefined),
  getWindowSession: vi.fn().mockResolvedValue(null),
  onTabAttach: vi.fn(),
  removeTabAttachListener: vi.fn()
}
;(globalThis as unknown as { window: Window & { api: typeof mockApi } }).window.api = mockApi

import ModeBar from '@renderer/components/ModeBar.svelte'
import { workspace } from '@renderer/stores/workspace.svelte'

describe('ModeBar', () => {
  beforeEach(() => {
    workspace.reset()
  })

  it('shows the Editor/Raw toggle for document tabs', () => {
    const paneId = workspace.paneOrder[0]
    const doc = workspace.openTab('notes.md', paneId)
    workspace.switchTab(doc, paneId)

    const { container, getByRole } = render(ModeBar, { props: { paneId } })

    expect(container.querySelector('.mode-toggle-bar')).not.toBeNull()
    expect(getByRole('tablist', { name: 'Editor mode' })).not.toBeNull()
  })

  it('renders nothing for graph tabs — GraphView owns its own level switcher', () => {
    const paneId = workspace.paneOrder[0]
    workspace.switchTab(workspace.panes[paneId].graphTabId, paneId)

    const { container, queryByRole } = render(ModeBar, { props: { paneId } })

    expect(container.querySelector('.mode-toggle-bar')).toBeNull()
    expect(queryByRole('tablist', { name: 'Graph level' })).toBeNull()
  })
})
