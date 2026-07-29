import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/svelte'

const stub = vi.hoisted(() => async (): Promise<{ default: unknown }> => {
  const mod = await import('./stubs/StubComponent.svelte')
  return { default: mod.default }
})

vi.mock('../../src/renderer/components/FileTree.svelte', stub)
vi.mock('../../src/renderer/components/Favorites.svelte', stub)
vi.mock('../../src/renderer/components/ResizeHandle.svelte', stub)

vi.mock('../../src/renderer/stores/files', () => ({
  loadFileTree: vi.fn().mockResolvedValue(undefined),
  loadAssetTree: vi.fn().mockResolvedValue(undefined),
  syncFileStoresFromTab: vi.fn()
}))

vi.mock('../../src/renderer/stores/workspace.svelte', () => ({
  workspace: { openTableTab: vi.fn() }
}))

vi.mock('../../src/renderer/stores/ingest', () => ({ runIngest: vi.fn() }))

vi.mock('../../src/renderer/stores/ui', async () => {
  const { writable } = await import('svelte/store')
  return { settingsOpen: writable(false) }
})

vi.mock('../../src/renderer/stores/settings', async () => {
  const { writable } = await import('svelte/store')
  return {
    settingsTarget: writable<string | null>(null),
    activeSection: writable('cli')
  }
})

vi.mock('../../src/renderer/stores/watcher', async () => {
  const { writable } = await import('svelte/store')
  return {
    watcherState: writable('stopped'),
    toggleWatcher: vi.fn().mockResolvedValue(undefined)
  }
})

vi.mock('../../src/renderer/stores/terminal.svelte', () => ({
  terminalStore: { createTerminal: vi.fn().mockResolvedValue(null) }
}))

const newWindow = vi.fn().mockResolvedValue(undefined)
;(globalThis as unknown as { window: Window & { api: Record<string, unknown> } }).window.api = {
  newWindow,
  showItemInFolder: vi.fn().mockResolvedValue(undefined),
  writeToClipboard: vi.fn().mockResolvedValue(undefined)
}

import Sidebar from '@renderer/components/Sidebar.svelte'
import {
  activeCollectionId,
  collections,
  collectionsLoading,
  collectionStatus
} from '@renderer/stores/collections'

describe('Sidebar collection context menu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    collections.set([
      { id: 'personal', name: 'Personal', path: '/personal', addedAt: 1, lastOpenedAt: 1 },
      { id: 'work', name: 'Work', path: '/work', addedAt: 2, lastOpenedAt: 2 }
    ])
    activeCollectionId.set('personal')
    collectionsLoading.set(false)
    collectionStatus.set(null)
  })

  it('opens the right-clicked switcher collection in a new window', async () => {
    render(Sidebar)

    await fireEvent.click(screen.getByRole('button', { name: /Personal/ }))
    const workButton = screen.getByText('Work').closest('button')
    expect(workButton).not.toBeNull()

    await fireEvent.contextMenu(workButton!)
    await fireEvent.click(screen.getByRole('button', { name: /Open in New Window/ }))

    expect(newWindow).toHaveBeenCalledWith('work')
  })
})
