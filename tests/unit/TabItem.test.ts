import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/svelte'

const mockApi = { detachTab: vi.fn() }
Object.defineProperty(window, 'api', { value: mockApi, writable: true, configurable: true })

import TabItem from '@renderer/components/TabItem.svelte'
import type { TabState } from '../../src/renderer/stores/workspace.svelte'

function iconFor(tab: TabState): string {
  const { container } = render(TabItem, { props: { tab } })
  return container.querySelector('.tab-icon')?.textContent?.trim() ?? ''
}

describe('TabItem icons', () => {
  it('table tabs get the table icon', () => {
    const tab = {
      id: 't1',
      kind: 'table',
      folderPath: 'docs',
      title: 'docs',
      recursive: false,
      activeViewId: null,
      ephemeral: null
    } as TabState

    expect(iconFor(tab)).toBe('table')
  })

  it('document tabs keep the description icon', () => {
    const tab = {
      id: 'd1',
      kind: 'document',
      filePath: 'a.md',
      title: 'a.md',
      isDirty: false,
      isUntitled: false,
      content: null,
      savedContent: null,
      editorMode: 'wysiwyg'
    } as unknown as TabState

    expect(iconFor(tab)).toBe('description')
  })

  it('graph and terminal tabs keep their icons', () => {
    const graph = {
      id: 'g1',
      kind: 'graph',
      title: 'Graph',
      graphLevel: 'document',
      graphPathFilter: null,
      graphColoringMode: 'cluster'
    } as unknown as TabState
    const terminal = {
      id: 'x1',
      kind: 'terminal',
      title: 'zsh'
    } as unknown as TabState

    expect(iconFor(graph)).toBe('hub')
    expect(iconFor(terminal)).toBe('terminal')
  })
})
