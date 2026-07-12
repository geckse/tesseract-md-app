import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'

const openTableTab = vi.fn()
const syncFileStoresFromTab = vi.fn()

vi.mock('../../src/renderer/stores/workspace.svelte', () => ({
  workspace: {
    openTableTab: (...args: unknown[]) => openTableTab(...args)
  }
}))

vi.mock('../../src/renderer/stores/files', () => ({
  syncFileStoresFromTab: (...args: unknown[]) => syncFileStoresFromTab(...args)
}))

import FileNameEditor from '../../src/renderer/components/wysiwyg/FileNameEditor.svelte'

beforeEach(() => {
  vi.clearAllMocks()
})

function renderEditor(filePath: string) {
  render(FileNameEditor, {
    props: {
      filePath,
      collectionPath: '/vault',
      onFileRenamed: vi.fn()
    }
  })
}

describe('FileNameEditor folder breadcrumb', () => {
  it('renders a clickable crumb per folder segment', () => {
    renderEditor('agent-memory/notes/on-filesystem-native-tools.md')

    const nav = screen.getByRole('navigation', { name: 'Folder path' })
    expect(nav).toBeTruthy()
    expect(screen.getByRole('button', { name: 'agent-memory' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'notes' })).toBeTruthy()
    // File name still renders after the breadcrumb
    expect(screen.getByText('on-filesystem-native-tools')).toBeTruthy()
  })

  it('opens the folder as a table tab with the cumulative path', async () => {
    renderEditor('agent-memory/notes/doc.md')

    await fireEvent.click(screen.getByRole('button', { name: 'agent-memory' }))
    expect(openTableTab).toHaveBeenCalledWith('agent-memory')
    expect(syncFileStoresFromTab).toHaveBeenCalledTimes(1)

    await fireEvent.click(screen.getByRole('button', { name: 'notes' }))
    expect(openTableTab).toHaveBeenCalledWith('agent-memory/notes')
    expect(syncFileStoresFromTab).toHaveBeenCalledTimes(2)
  })

  it('renders no breadcrumb for root-level files', () => {
    renderEditor('root-note.md')

    expect(screen.queryByRole('navigation', { name: 'Folder path' })).toBeNull()
    expect(screen.getByText('root-note')).toBeTruthy()
  })
})
