import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render } from '@testing-library/svelte'
import { tick } from 'svelte'

// Mock window.api before importing stores/components.
const mockApi = {
  saveWindowSession: vi.fn().mockResolvedValue(undefined),
  getWindowSession: vi.fn().mockResolvedValue(null),
  onTabAttach: vi.fn(),
  removeTabAttachListener: vi.fn()
}
;(globalThis as unknown as { window: Window & { api: typeof mockApi } }).window.api = mockApi

// Stub every heavy content component TabPane can render — this test is about
// TabPane's terminal keep-alive frames, not the content implementations.
// (vi.hoisted so the factory exists when the hoisted vi.mock calls run.)
const stub = vi.hoisted(() => async (): Promise<{ default: unknown }> => {
  const mod = await import('./stubs/StubComponent.svelte')
  return { default: mod.default }
})
vi.mock('../../src/renderer/components/Terminal.svelte', stub)
vi.mock('../../src/renderer/components/Editor.svelte', stub)
vi.mock('../../src/renderer/components/WysiwygEditor.svelte', stub)
vi.mock('../../src/renderer/components/GraphView.svelte', stub)
vi.mock('../../src/renderer/components/ImageViewer.svelte', stub)
vi.mock('../../src/renderer/components/PdfViewer.svelte', stub)
vi.mock('../../src/renderer/components/AssetInfoCard.svelte', stub)
vi.mock('../../src/renderer/components/SaveAsModal.svelte', stub)
vi.mock('../../src/renderer/components/ModeBar.svelte', stub)
vi.mock('../../src/renderer/components/table/TableView.svelte', stub)

import TabPane from '@renderer/components/TabPane.svelte'
import { workspace } from '@renderer/stores/workspace.svelte'

function hardReset(): void {
  for (const [id, tab] of Object.entries(workspace.tabs)) {
    if (tab.kind === 'terminal') workspace.removeTabSilently(id)
  }
  workspace.reset()
}

describe('TabPane terminal keep-alive frames', () => {
  beforeEach(() => {
    hardReset()
  })

  it('keeps every terminal tab mounted; only the active one is visible', async () => {
    const paneId = workspace.paneOrder[0]
    const term1 = workspace.openTerminalTab('pty-1', 'zsh — 1', paneId)
    const term2 = workspace.openTerminalTab('pty-2', 'zsh — 2', paneId)
    const doc = workspace.openTab('notes.md', paneId)
    workspace.switchTab(doc, paneId)

    const { container } = render(TabPane, { props: { paneId } })

    // Both terminals mounted even though a document tab is active
    let frames = container.querySelectorAll('.terminal-frame')
    expect(frames).toHaveLength(2)
    expect(container.querySelectorAll('.terminal-frame.visible')).toHaveLength(0)

    // Activate the first terminal — its frame becomes visible, both stay mounted
    workspace.switchTab(term1, paneId)
    await tick()
    frames = container.querySelectorAll('.terminal-frame')
    expect(frames).toHaveLength(2)
    const visible1 = container.querySelector(
      '.terminal-frame.visible [data-testid="stub-component"]'
    )
    expect(visible1?.getAttribute('data-terminal-id')).toBe('pty-1')

    // Switch to the second terminal — visibility flips, no unmount
    workspace.switchTab(term2, paneId)
    await tick()
    expect(container.querySelectorAll('.terminal-frame')).toHaveLength(2)
    const visible2 = container.querySelector(
      '.terminal-frame.visible [data-testid="stub-component"]'
    )
    expect(visible2?.getAttribute('data-terminal-id')).toBe('pty-2')

    // Back to the document — terminals remain mounted, hidden
    workspace.switchTab(doc, paneId)
    await tick()
    expect(container.querySelectorAll('.terminal-frame')).toHaveLength(2)
    expect(container.querySelectorAll('.terminal-frame.visible')).toHaveLength(0)
  })

  it('shows no empty state while a terminal tab is active', async () => {
    const paneId = workspace.paneOrder[0]
    const term = workspace.openTerminalTab('pty-1', 'zsh', paneId)
    workspace.switchTab(term, paneId)

    const { container } = render(TabPane, { props: { paneId } })
    await tick()

    expect(container.querySelector('.empty-state')).toBeNull()
    expect(container.querySelector('.terminal-frame.visible')).not.toBeNull()
  })

  it('removes the frame when the terminal tab is closed', async () => {
    const paneId = workspace.paneOrder[0]
    const term = workspace.openTerminalTab('pty-1', 'zsh', paneId)

    const { container } = render(TabPane, { props: { paneId } })
    expect(container.querySelectorAll('.terminal-frame')).toHaveLength(1)

    workspace.closeTab(term, paneId)
    await tick()
    expect(container.querySelectorAll('.terminal-frame')).toHaveLength(0)
  })
})
