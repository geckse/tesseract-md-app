import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte'

// Mock window.api on the real jsdom window before importing stores
const mockApi = {
  listTableViews: vi.fn().mockResolvedValue([]),
  saveTableView: vi.fn().mockResolvedValue([]),
  deleteTableView: vi.fn().mockResolvedValue([]),
  setDefaultTableView: vi.fn().mockResolvedValue([])
}

Object.defineProperty(window, 'api', { value: mockApi, writable: true, configurable: true })

import { workspace } from '@renderer/stores/workspace.svelte'
import { collections, activeCollectionId } from '../../src/renderer/stores/collections'
import SaveViewModal from '@renderer/components/table/SaveViewModal.svelte'

const testCollection = { id: 'c1', name: 'Test', path: '/test', addedAt: 1, lastOpenedAt: 1 }

describe('SaveViewModal', () => {
  let tabId: string

  beforeEach(() => {
    vi.clearAllMocks()
    workspace.reset()
    collections.set([testCollection])
    activeCollectionId.set('c1')
    tabId = workspace.openTableTab('docs')
  })

  it('autofocuses the name input on open', () => {
    render(SaveViewModal, { props: { tabId, onclose: vi.fn() } })

    expect(document.activeElement).toBe(screen.getByLabelText('View name'))
  })

  it('traps Tab focus inside the modal', async () => {
    render(SaveViewModal, { props: { tabId, onclose: vi.fn() } })

    const closeBtn = screen.getByText('Close')
    closeBtn.focus()

    await fireEvent.keyDown(closeBtn, { key: 'Tab' })

    expect(document.activeElement).toBe(screen.getByLabelText('View name'))
  })

  it('closes on Escape', async () => {
    const onclose = vi.fn()
    const { container } = render(SaveViewModal, { props: { tabId, onclose } })

    await fireEvent.keyDown(container.querySelector('.modal-overlay')!, { key: 'Escape' })

    expect(onclose).toHaveBeenCalled()
  })

  it('uses the scrim token for the backdrop, not a hard-coded color', () => {
    const { container } = render(SaveViewModal, { props: { tabId, onclose: vi.fn() } })

    const backdrop = container.querySelector('.overlay-backdrop')!
    expect(backdrop.getAttribute('style')).toBeNull()
  })

  it('saves a named view, activates it, and closes', async () => {
    const onclose = vi.fn()
    render(SaveViewModal, { props: { tabId, onclose } })

    await fireEvent.input(screen.getByLabelText('View name'), { target: { value: 'My view' } })
    await fireEvent.click(screen.getByText('Save'))

    await waitFor(() => expect(onclose).toHaveBeenCalled())
    expect(mockApi.saveTableView).toHaveBeenCalledTimes(1)
    const [collectionId, folderPath, view] = mockApi.saveTableView.mock.calls[0]
    expect(collectionId).toBe('c1')
    expect(folderPath).toBe('docs')
    expect(view.name).toBe('My view')

    const tab = workspace.tabs[tabId]
    expect(tab?.kind === 'table' && tab.activeViewId).toBe(view.id)
  })

  it('sends a structured-cloneable view over IPC even with ephemeral tab state', async () => {
    // Ephemeral config read back from the workspace $state is a reactive proxy;
    // unsnapshotted it makes IPC fail with "An object could not be cloned".
    workspace.setTableEphemeral(tabId, {
      sort: [{ columnName: 'status', direction: 'asc' }],
      collapsedGroups: ['x']
    })
    const onclose = vi.fn()
    render(SaveViewModal, { props: { tabId, onclose } })

    await fireEvent.input(screen.getByLabelText('View name'), { target: { value: 'Proxied' } })
    await fireEvent.click(screen.getByText('Save'))

    await waitFor(() => expect(mockApi.saveTableView).toHaveBeenCalled())
    const view = mockApi.saveTableView.mock.calls[0][2]
    expect(() => structuredClone(view)).not.toThrow()
    expect(view.config.sort).toEqual([{ columnName: 'status', direction: 'asc' }])
  })

  it('shows an error for an empty name and does not save', async () => {
    render(SaveViewModal, { props: { tabId, onclose: vi.fn() } })

    await fireEvent.click(screen.getByText('Save'))

    expect(screen.getByRole('alert').textContent).toContain('Please enter a name')
    expect(mockApi.saveTableView).not.toHaveBeenCalled()
  })

  describe('existing views management', () => {
    const existing = {
      id: 'v1',
      name: 'Mine',
      version: 1,
      config: { sort: [], filters: [], columns: [], groupBy: null, collapsedGroups: [] },
      recursive: false,
      isDefault: false,
      createdAt: 1,
      updatedAt: 1
    }

    beforeEach(async () => {
      // Seed the views cache for (c1, docs) through the store's own load path
      mockApi.listTableViews.mockResolvedValue([existing])
      const { tableViewsStore } = await import('../../src/renderer/stores/table-views.svelte')
      await tableViewsStore.load('c1', 'docs')
    })

    it('deletes a view via its Delete action', async () => {
      mockApi.deleteTableView.mockResolvedValue([])
      render(SaveViewModal, { props: { tabId, onclose: vi.fn() } })

      expect(screen.getByText('Mine')).toBeTruthy()
      await fireEvent.click(screen.getByTitle('Delete view'))

      await waitFor(() => expect(mockApi.deleteTableView).toHaveBeenCalledWith('c1', 'docs', 'v1'))
      await waitFor(() => expect(screen.queryByText('Mine')).toBeNull())
    })

    it('deleting the active view deactivates it on the tab', async () => {
      workspace.setTableActiveView(tabId, 'v1')
      mockApi.deleteTableView.mockResolvedValue([])
      render(SaveViewModal, { props: { tabId, onclose: vi.fn() } })

      await fireEvent.click(screen.getByTitle('Delete view'))

      await waitFor(() => {
        const tab = workspace.tabs[tabId]
        expect(tab?.kind === 'table' && tab.activeViewId).toBeNull()
      })
    })

    it('marks a view as default via its star action', async () => {
      mockApi.setDefaultTableView.mockResolvedValue([{ ...existing, isDefault: true }])
      render(SaveViewModal, { props: { tabId, onclose: vi.fn() } })

      await fireEvent.click(screen.getByTitle('Make default'))

      await waitFor(() =>
        expect(mockApi.setDefaultTableView).toHaveBeenCalledWith('c1', 'docs', 'v1')
      )
    })
  })
})
