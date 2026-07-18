import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'
import { get } from 'svelte/store'

// Mock window.api before importing stores
const mockApi = {
  tree: vi.fn(),
  readFile: vi.fn(),
  getActiveCollection: vi.fn()
}

Object.defineProperty(globalThis, 'window', {
  value: { api: mockApi },
  writable: true
})

import { expandedPaths } from '../../src/renderer/stores/files'
import FileTreeNode from '@renderer/components/FileTreeNode.svelte'
import type { UnifiedTreeNode } from '../../src/renderer/types/cli'

const dirNode: UnifiedTreeNode = {
  name: 'docs',
  path: 'docs',
  is_dir: true,
  state: null,
  children: []
}

const fileNode: UnifiedTreeNode = {
  name: 'readme.md',
  path: 'readme.md',
  is_dir: false,
  state: 'indexed',
  children: []
}

describe('FileTreeNode folder interactions', () => {
  beforeEach(() => {
    expandedPaths.set(new Set())
  })

  it('single click on a directory opens the table, fires folder click, and toggles expansion', async () => {
    const onfolderopen = vi.fn()
    const onfolderclick = vi.fn()
    render(FileTreeNode, {
      props: { node: dirNode, onfolderopen, onfolderclick }
    })

    await fireEvent.click(screen.getByTitle('docs'))

    expect(onfolderopen).toHaveBeenCalledWith('docs')
    expect(onfolderclick).toHaveBeenCalledWith('docs')
    expect(get(expandedPaths).has('docs')).toBe(true)
  })

  it('single click on a file selects it and does not open a table', async () => {
    const onfolderopen = vi.fn()
    const onfileselect = vi.fn()
    render(FileTreeNode, {
      props: { node: fileNode, onfolderopen, onfileselect }
    })

    await fireEvent.click(screen.getByTitle('readme.md'))

    expect(onfileselect).toHaveBeenCalledWith({ path: 'readme.md' })
    expect(onfolderopen).not.toHaveBeenCalled()
    expect(get(expandedPaths).has('readme.md')).toBe(false)
  })

  it('double click on a directory opens the table', async () => {
    const onfolderopen = vi.fn()
    render(FileTreeNode, { props: { node: dirNode, onfolderopen } })

    await fireEvent.dblClick(screen.getByTitle('docs'))

    expect(onfolderopen).toHaveBeenCalledWith('docs')
  })

  it('hover table-action button opens the table without toggling expansion', async () => {
    const onfolderopen = vi.fn()
    render(FileTreeNode, { props: { node: dirNode, onfolderopen } })

    await fireEvent.click(screen.getByRole('button', { name: 'Open docs as table' }))

    expect(onfolderopen).toHaveBeenCalledWith('docs')
    expect(get(expandedPaths).has('docs')).toBe(false)
  })

  it('does not render the table-action button for files', () => {
    render(FileTreeNode, { props: { node: fileNode } })

    expect(screen.queryByRole('button', { name: /as table/ })).toBeNull()
  })
})

describe('FileTreeNode inline rename (phase 43)', () => {
  it('renders an input instead of the row button while renaming', () => {
    render(FileTreeNode, {
      props: { node: fileNode, renamingPath: 'readme.md', renameInitial: 'readme' }
    })

    const input = screen.getByRole('textbox', { name: 'Rename readme.md' }) as HTMLInputElement
    expect(input.value).toBe('readme')
    expect(screen.getByRole('treeitem')).not.toBeNull()
    expect(screen.queryByRole('button', { name: /readme.md/ })).toBeNull()
  })

  it('commits the draft on Enter and cancels on Escape', async () => {
    const onrenamecommit = vi.fn()
    const onrenamecancel = vi.fn()
    render(FileTreeNode, {
      props: {
        node: fileNode,
        renamingPath: 'readme.md',
        renameInitial: 'readme',
        onrenamecommit,
        onrenamecancel
      }
    })

    const input = screen.getByRole('textbox', { name: 'Rename readme.md' }) as HTMLInputElement
    await fireEvent.input(input, { target: { value: 'guide' } })
    await fireEvent.keyDown(input, { key: 'Enter' })
    expect(onrenamecommit).toHaveBeenCalledWith('guide')

    await fireEvent.keyDown(input, { key: 'Escape' })
    expect(onrenamecancel).toHaveBeenCalled()
  })

  it('shows the error indicator when renameError is set', () => {
    render(FileTreeNode, {
      props: {
        node: fileNode,
        renamingPath: 'readme.md',
        renameInitial: 'readme',
        renameError: 'already exists'
      }
    })

    expect(screen.getByTitle('already exists')).toBeTruthy()
  })

  it('renders normally when a different node is being renamed', () => {
    render(FileTreeNode, {
      props: { node: fileNode, renamingPath: 'other.md', renameInitial: 'other' }
    })

    expect(screen.getByRole('treeitem')).toBeTruthy()
    expect(screen.queryByRole('textbox')).toBeNull()
  })
})
