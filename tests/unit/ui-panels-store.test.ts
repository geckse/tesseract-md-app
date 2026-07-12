import { describe, it, expect, vi, beforeEach } from 'vitest'
import { get } from 'svelte/store'

const mockApi = {
  listCollections: vi.fn().mockResolvedValue([]),
  getActiveCollection: vi.fn().mockResolvedValue(null)
}
Object.defineProperty(globalThis, 'window', {
  value: Object.assign(globalThis.window ?? {}, { api: mockApi }),
  writable: true
})

import {
  propertiesOpen,
  togglePropertiesPanel,
  sidebarVisible,
  toggleSidebar,
  settingsOpen,
  shortcutsModalOpen
} from '@renderer/stores/ui'
import { openSettingsSection, settingsTarget, activeSection } from '@renderer/stores/settings'
import { activeCollectionId } from '@renderer/stores/collections'

describe('panel visibility stores (phase 43)', () => {
  beforeEach(() => {
    settingsOpen.set(false)
    shortcutsModalOpen.set(false)
  })

  it('toggles and persists the properties panel state', () => {
    propertiesOpen.set(false)
    togglePropertiesPanel()
    expect(get(propertiesOpen)).toBe(true)
    expect(localStorage.getItem('mdvdb-properties-open')).toBe('true')

    togglePropertiesPanel()
    expect(get(propertiesOpen)).toBe(false)
    expect(localStorage.getItem('mdvdb-properties-open')).toBe('false')
  })

  it('toggles and persists sidebar visibility', () => {
    sidebarVisible.set(true)
    toggleSidebar()
    expect(get(sidebarVisible)).toBe(false)
    expect(localStorage.getItem('mdvdb-sidebar-visible')).toBe('false')

    toggleSidebar()
    expect(get(sidebarVisible)).toBe(true)
  })
})

describe('openSettingsSection (phase 43)', () => {
  it('deep-links to a collection section using the active collection', () => {
    activeCollectionId.set('col-9')
    openSettingsSection('collection', 'clusters')
    expect(get(settingsTarget)).toBe('col-9')
    expect(get(activeSection)).toBe('clusters')
    expect(get(settingsOpen)).toBe(true)
  })

  it('falls back to global when no collection is active', () => {
    activeCollectionId.set(null)
    openSettingsSection('collection', 'search')
    expect(get(settingsTarget)).toBe('global')
    expect(get(activeSection)).toBe('search')
  })

  it('targets global explicitly', () => {
    activeCollectionId.set('col-9')
    openSettingsSection('global', 'cli')
    expect(get(settingsTarget)).toBe('global')
    expect(get(activeSection)).toBe('cli')
    expect(get(settingsOpen)).toBe(true)
  })
})
