import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'

const workspaceMocks = vi.hoisted(() => ({
  openAssetTab: vi.fn()
}))
vi.mock('@renderer/stores/workspace.svelte', () => ({
  workspace: {
    openAssetTab: workspaceMocks.openAssetTab,
    paneOrder: ['pane-1', 'pane-2'],
    defaultEditorPaneId: 'pane-1',
    toggleSplit: vi.fn()
  }
}))

const mockApi = {
  fileThumbnail: vi.fn().mockResolvedValue(null),
  openPopup: vi.fn().mockResolvedValue(undefined),
  openPath: vi.fn().mockResolvedValue(undefined),
  showItemInFolder: vi.fn().mockResolvedValue(undefined),
  writeToClipboard: vi.fn().mockResolvedValue(undefined),
  scanAssets: vi.fn()
}
Object.defineProperty(window, 'api', { value: mockApi, writable: true })

import FileCell from '@renderer/components/table/cells/FileCell.svelte'
import { assetTree } from '@renderer/stores/files'
import { cliFeatures } from '@renderer/lib/cli-features.svelte'
import type { CollectionColumn, JsonValue } from '@renderer/types/cli'

const column: CollectionColumn = {
  name: 'attachments',
  field_type: 'File',
  description: null,
  occurrence_count: 1,
  sample_values: [],
  allowed_values: null,
  required: false,
  in_schema: true,
  relation_target: null
}

function setAssets(): void {
  assetTree.set({
    root: {
      name: '.',
      path: '.',
      is_dir: true,
      children: [
        {
          name: 'mockup.png',
          path: 'assets/mockup.png',
          is_dir: false,
          children: [],
          fileSize: 123,
          mimeCategory: 'image'
        },
        {
          name: 'spec.pdf',
          path: 'documents/spec.pdf',
          is_dir: false,
          children: [],
          fileSize: 456,
          mimeCategory: 'pdf'
        }
      ]
    },
    totalAssets: 2,
    scanDurationMs: 1
  })
}

function props(value: JsonValue, editing = false) {
  const oncommit = vi.fn()
  const oncancel = vi.fn()
  return {
    props: {
      column,
      value,
      editing,
      readOnly: false,
      root: '/vault',
      oncommit,
      oncancel
    },
    oncommit,
    oncancel
  }
}

describe('FileCell', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cliFeatures.reset()
    cliFeatures.version = '0.2.0'
    setAssets()
  })

  it('renders compact attachment tiles and opens an asset tab', async () => {
    render(FileCell, props(['[[assets/mockup.png]]', '[[documents/spec.pdf]]']).props)
    const mockup = screen.getByRole('button', { name: 'Open mockup.png' })
    expect(screen.getByRole('button', { name: 'Open spec.pdf' })).toBeTruthy()
    await fireEvent.click(mockup)
    expect(workspaceMocks.openAssetTab).toHaveBeenCalledWith(
      'assets/mockup.png',
      'image',
      123,
      undefined
    )
  })

  it('multi-select appends canonical wikilinks and writes an array', async () => {
    const p = props([], true)
    render(FileCell, p.props)
    await fireEvent.click(screen.getByRole('option', { name: /assets\/mockup\.png/ }))
    await fireEvent.click(screen.getByRole('option', { name: /documents\/spec\.pdf/ }))
    await fireEvent.click(screen.getByRole('button', { name: 'Add files' }))
    expect(p.oncommit).toHaveBeenCalledWith(['[[assets/mockup.png]]', '[[documents/spec.pdf]]'])
  })

  it('moves keyboard focus to search when the file picker opens', async () => {
    render(FileCell, props([], true).props)
    const search = screen.getByPlaceholderText('Search collection files…')

    await waitFor(() => {
      expect(document.activeElement).toBe(search)
    })
  })

  it('normalizes a legacy scalar to an empty list when its last tile is unlinked', async () => {
    const p = props('[[assets/mockup.png]]')
    render(FileCell, p.props)
    await fireEvent.contextMenu(screen.getByRole('button', { name: 'Open mockup.png' }))
    for (const label of [
      'Open in New Tab',
      'Open in Other Pane',
      'Open in Popup',
      'Open in Default App',
      'Reveal in Finder/File Explorer',
      'Copy Path',
      'Copy Relative Path',
      'Copy Wikilink',
      'Unlink'
    ]) {
      expect(screen.getByText(label)).toBeTruthy()
    }
    await fireEvent.mouseDown(screen.getByRole('menuitem', { name: /Unlink$/ }))
    expect(p.oncommit).toHaveBeenCalledWith([])
  })

  it('keeps broken references visible but does not open them', async () => {
    render(FileCell, props(['[[assets/missing.png]]']).props)
    const broken = screen.getByRole('button', { name: 'Missing file missing.png' })
    await fireEvent.click(broken)
    expect(workspaceMocks.openAssetTab).not.toHaveBeenCalled()
  })
})
