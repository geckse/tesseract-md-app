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

    await fireEvent.click(screen.getByRole('treeitem'))

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

    await fireEvent.click(screen.getByRole('treeitem'))

    expect(onfileselect).toHaveBeenCalledWith({ path: 'readme.md' })
    expect(onfolderopen).not.toHaveBeenCalled()
    expect(get(expandedPaths).has('readme.md')).toBe(false)
  })

  it('double click on a directory opens the table', async () => {
    const onfolderopen = vi.fn()
    render(FileTreeNode, { props: { node: dirNode, onfolderopen } })

    await fireEvent.dblClick(screen.getByRole('treeitem'))

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
