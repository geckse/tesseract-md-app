import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'

const openTableTab = vi.fn()
const syncFileStoresFromTab = vi.fn()
const renameFile = vi.fn()

Object.defineProperty(globalThis, 'window', {
  value: Object.assign(globalThis.window ?? {}, { api: { renameFile } }),
  writable: true
})

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
  renameFile.mockResolvedValue(undefined)
})

function renderEditor(filePath: string, onFileRenamed = vi.fn()) {
  render(FileNameEditor, {
    props: {
      filePath,
      collectionPath: '/vault',
      onFileRenamed
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

  it('renames only once when Enter is followed by the input blur', async () => {
    const onFileRenamed = vi.fn()
    renderEditor('notes/script.md', onFileRenamed)

    await fireEvent.click(screen.getByRole('button', { name: 'script' }))
    const input = screen.getByRole('textbox') as HTMLInputElement
    await fireEvent.input(input, { target: { value: 'claude-watermark' } })
    await fireEvent.keyDown(input, { key: 'Enter' })
    await fireEvent.blur(input)

    await vi.waitFor(() => {
      expect(renameFile).toHaveBeenCalledTimes(1)
      expect(renameFile).toHaveBeenCalledWith(
        '/vault/notes/script.md',
        '/vault/notes/claude-watermark.md'
      )
      expect(onFileRenamed).toHaveBeenCalledTimes(1)
      expect(onFileRenamed).toHaveBeenCalledWith('notes/claude-watermark.md')
    })
  })
})
