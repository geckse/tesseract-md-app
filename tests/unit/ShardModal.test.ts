import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import type { ShardInfo } from '../../src/renderer/types/cli'

const shardActions = vi.hoisted(() => ({
  add: vi.fn(),
  update: vi.fn()
}))

vi.mock('../../src/renderer/stores/files', async () => {
  const { writable } = await import('svelte/store')
  return {
    collectionDirectories: writable<string[]>([])
  }
})

vi.mock('../../src/renderer/stores/shards', async (importOriginal) => {
  const { writable } = await import('svelte/store')
  const actual = await importOriginal<typeof import('../../src/renderer/stores/shards')>()
  return {
    ...actual,
    shardsByCollection: writable<Record<string, ShardInfo[]>>({}),
    addShardDefinition: shardActions.add,
    updateShardDefinition: shardActions.update
  }
})

import ShardModal from '@renderer/components/ShardModal.svelte'
import { activeCollectionId } from '@renderer/stores/collections'
import { collectionDirectories } from '@renderer/stores/files'
import { shardsByCollection } from '@renderer/stores/shards'

const existingShard: ShardInfo = {
  id: 'research',
  name: 'Research',
  path: 'work/research',
  parent_id: null,
  exists: true
}

function renderModal(
  props: Partial<{
    collectionId: string
    shard: ShardInfo | null
    initialPath: string
    onclose: () => void
    onsaved: (shardId: string) => void
  }> = {}
) {
  const onclose = vi.fn()
  const onsaved = vi.fn()
  render(ShardModal, {
    props: {
      collectionId: 'vault',
      onclose,
      onsaved,
      ...props
    }
  })
  return { onclose, onsaved }
}

describe('ShardModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    shardActions.add.mockResolvedValue({ action: 'added', shards: [] })
    shardActions.update.mockResolvedValue({ action: 'updated', shards: [] })
    activeCollectionId.set('vault')
    collectionDirectories.set(['', 'work', 'work/research'])
    shardsByCollection.set({ vault: [] })
  })

  afterEach(() => {
    cleanup()
  })

  it('introduces a Shard as a folder-scoped sub-collection', () => {
    renderModal()

    expect(
      screen.getByText(
        'A named sub-collection scoped to a folder and everything inside it. Files and the shared index stay untouched.'
      )
    ).toBeTruthy()
  })

  it('validates the name, collection-relative path, and missing-folder opt-in', async () => {
    renderModal({ initialPath: 'work/research' })

    const name = screen.getByLabelText('Name')
    const folder = screen.getByPlaceholderText('work/research')
    const submit = screen.getByRole('button', { name: 'Create Shard' })

    await fireEvent.input(name, { target: { value: ' ' } })
    await fireEvent.click(submit)
    expect(screen.getByRole('alert').textContent).toBe('Enter a Shard name.')

    await fireEvent.input(name, { target: { value: 'Research' } })
    await fireEvent.input(folder, { target: { value: '/absolute/path' } })
    await fireEvent.click(submit)
    expect(screen.getByRole('alert').textContent).toContain('must be relative to the collection')

    await fireEvent.input(folder, { target: { value: 'work/new-area' } })
    await fireEvent.click(submit)
    expect(screen.getByRole('alert').textContent).toContain('does not exist')
    expect(shardActions.add).not.toHaveBeenCalled()
  })

  it('creates an existing-folder Shard with a deterministic collision-free ID', async () => {
    shardsByCollection.set({
      vault: [
        existingShard,
        {
          ...existingShard,
          id: 'research-2',
          name: 'Old Research',
          path: 'archive/research'
        }
      ]
    })
    const { onclose, onsaved } = renderModal({ initialPath: 'work/research' })

    await fireEvent.input(screen.getByLabelText('Name'), {
      target: { value: 'Research' }
    })

    expect(screen.getByText('research-3')).toBeTruthy()
    expect(screen.queryByRole('checkbox')).toBeNull()

    await fireEvent.click(screen.getByRole('button', { name: 'Create Shard' }))

    await waitFor(() =>
      expect(shardActions.add).toHaveBeenCalledWith('Research', 'work/research', false, 'vault')
    )
    expect(onsaved).toHaveBeenCalledWith('research-3')
    expect(onclose).toHaveBeenCalledOnce()
  })

  it('passes create-dir only after the user opts into creating a missing folder', async () => {
    collectionDirectories.set([''])
    const { onsaved } = renderModal({ initialPath: 'teams/platform' })

    await fireEvent.input(screen.getByLabelText('Name'), {
      target: { value: 'Platform' }
    })
    const createFolder = screen.getByRole('checkbox')
    expect((createFolder as HTMLInputElement).checked).toBe(false)

    await fireEvent.click(createFolder)
    await fireEvent.click(screen.getByRole('button', { name: 'Create Shard' }))

    await waitFor(() =>
      expect(shardActions.add).toHaveBeenCalledWith('Platform', 'teams/platform', true, 'vault')
    )
    expect(onsaved).toHaveBeenCalledWith('platform')
  })

  it('keeps the ID immutable while editing and repairs a missing folder explicitly', async () => {
    collectionDirectories.set(['', 'work'])
    const missingShard: ShardInfo = {
      ...existingShard,
      exists: false
    }
    const { onclose, onsaved } = renderModal({ shard: missingShard })

    expect(screen.getByRole('heading', { name: 'Edit Shard' })).toBeTruthy()
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe('Research')
    expect((screen.getByPlaceholderText('work/research') as HTMLInputElement).value).toBe(
      'work/research'
    )
    expect(screen.getByText('IDs are immutable.')).toBeTruthy()
    expect(screen.getByText(/folder is missing/i)).toBeTruthy()

    await fireEvent.input(screen.getByLabelText('Name'), {
      target: { value: 'Research Lab' }
    })
    await fireEvent.input(screen.getByPlaceholderText('work/research'), {
      target: { value: 'work/research-lab' }
    })
    await fireEvent.click(screen.getByRole('checkbox'))
    await fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() =>
      expect(shardActions.update).toHaveBeenCalledWith(
        'research',
        'Research Lab',
        'work/research-lab',
        true,
        'vault'
      )
    )
    expect(onsaved).toHaveBeenCalledWith('research')
    expect(onclose).toHaveBeenCalledOnce()
  })

  it('surfaces validation errors returned by the CLI-backed edit action', async () => {
    shardActions.update.mockRejectedValue(
      new Error('Shard names must be unique (case-insensitive)')
    )
    renderModal({ shard: existingShard })

    await fireEvent.input(screen.getByLabelText('Name'), {
      target: { value: 'Duplicate' }
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Shard names must be unique')
    )
  })
})
