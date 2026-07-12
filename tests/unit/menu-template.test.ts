import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MenuItemConstructorOptions } from 'electron'
import { buildTemplate, type MenuActions } from '../../src/main/menu-template'
import type { MenuState } from '../../src/main/menu-state'

function makeActions(): MenuActions {
  return {
    sendCommand: vi.fn(),
    openRecent: vi.fn(),
    clearRecents: vi.fn(),
    newWindow: vi.fn(),
    checkForUpdates: vi.fn(),
    showAbout: vi.fn(),
    openExternal: vi.fn()
  }
}

function makeState(overrides: Partial<MenuState> = {}): MenuState {
  return {
    platform: 'darwin',
    isDev: false,
    appName: 'Tesseract',
    collections: [
      { id: 'col-1', name: 'Notes' },
      { id: 'col-2', name: 'Work' }
    ],
    activeCollectionId: 'col-1',
    activeCollectionName: 'Notes',
    watcherEnabled: true,
    recents: [
      { collectionId: 'col-1', filePath: 'notes/a.md', fileName: 'a.md', collectionName: 'Notes' }
    ],
    ...overrides
  }
}

/** Depth-first search for a menu item by id. */
function findById(
  items: MenuItemConstructorOptions[],
  id: string
): MenuItemConstructorOptions | null {
  for (const item of items) {
    if (item.id === id) return item
    if (Array.isArray(item.submenu)) {
      const found = findById(item.submenu, id)
      if (found) return found
    }
  }
  return null
}

/** Collect all items (flattened) with a given predicate. */
function collect(
  items: MenuItemConstructorOptions[],
  predicate: (item: MenuItemConstructorOptions) => boolean,
  out: MenuItemConstructorOptions[] = []
): MenuItemConstructorOptions[] {
  for (const item of items) {
    if (predicate(item)) out.push(item)
    if (Array.isArray(item.submenu)) collect(item.submenu, predicate, out)
  }
  return out
}

describe('buildTemplate', () => {
  let actions: MenuActions

  beforeEach(() => {
    actions = makeActions()
  })

  it('produces the expected top-level menus on macOS', () => {
    const template = buildTemplate(makeState(), actions)
    const labels = template.map((t) => t.label ?? t.role)
    expect(labels).toEqual([
      'Tesseract',
      'File',
      'Edit',
      'Format',
      'View',
      'Collection',
      'windowMenu',
      'Help'
    ])
  })

  it('omits the app menu on Windows/Linux and adds Help about/updates', () => {
    const template = buildTemplate(makeState({ platform: 'win32' }), actions)
    const labels = template.map((t) => t.label ?? t.role)
    expect(labels[0]).toBe('File')
    expect(findById(template, 'help.check-updates')).not.toBeNull()
    expect(findById(template, 'help.about')).not.toBeNull()

    const macTemplate = buildTemplate(makeState(), actions)
    expect(findById(macTemplate, 'help.check-updates')).toBeNull()
    expect(findById(macTemplate, 'help.about')).toBeNull()
    expect(findById(macTemplate, 'app.check-updates')).not.toBeNull()
  })

  describe('accelerator platform matrix', () => {
    const rendererOwnedIds = [
      'file.new-note',
      'file.new-tab',
      'file.quick-open',
      'file.save',
      'file.close-tab',
      'file.reopen-tab',
      'edit.search',
      'format.bold',
      'format.italic',
      'view.toggle-properties',
      'view.toggle-bottom-panel',
      'view.toggle-editor-mode',
      'view.toggle-graph',
      'view.next-tab',
      'view.previous-tab',
      'view.split-editor'
    ]
    const menuOwnedIds = ['view.toggle-sidebar', 'view.zoom-in', 'view.zoom-out', 'view.zoom-reset']

    it('registers renderer-owned accelerators on macOS (page gets keys first)', () => {
      const template = buildTemplate(makeState({ platform: 'darwin' }), actions)
      for (const id of rendererOwnedIds) {
        const item = findById(template, id)
        expect(item, id).not.toBeNull()
        expect(item!.accelerator, id).toBeTruthy()
        expect(item!.registerAccelerator, id).toBeUndefined()
      }
    })

    it('displays but does not register renderer-owned accelerators on win/linux', () => {
      const template = buildTemplate(makeState({ platform: 'win32' }), actions)
      for (const id of rendererOwnedIds) {
        const item = findById(template, id)
        expect(item, id).not.toBeNull()
        expect(item!.accelerator, id).toBeTruthy()
        expect(item!.registerAccelerator, id).toBe(false)
      }
    })

    it('registers menu-owned accelerators on every platform', () => {
      for (const platform of ['darwin', 'win32'] as const) {
        const template = buildTemplate(makeState({ platform }), actions)
        for (const id of menuOwnedIds) {
          const item = findById(template, id)
          expect(item, `${platform}:${id}`).not.toBeNull()
          expect(item!.registerAccelerator, `${platform}:${id}`).toBeUndefined()
        }
      }
    })

    it('never attaches an accelerator to a Z binding', () => {
      for (const platform of ['darwin', 'win32'] as const) {
        const template = buildTemplate(makeState({ platform }), actions)
        const zItems = collect(
          template,
          (item) => typeof item.accelerator === 'string' && /(^|\+)Z$/i.test(item.accelerator)
        )
        expect(zItems).toEqual([])
      }
    })
  })

  describe('Collection menu state', () => {
    it('disables collection actions when no collection is active', () => {
      const template = buildTemplate(
        makeState({ activeCollectionId: null, activeCollectionName: null }),
        actions
      )
      for (const id of [
        'collection.sync',
        'collection.reindex',
        'collection.rebuild',
        'collection.toggle-watcher',
        'collection.doctor',
        'collection.reveal',
        'collection.copy-path',
        'collection.open-terminal',
        'collection.settings-menu'
      ]) {
        expect(findById(template, id)!.enabled, id).toBe(false)
      }
      // Adding a collection must stay possible
      expect(findById(template, 'collection.add')!.enabled).not.toBe(false)
      expect(findById(template, 'collection.active-name')!.label).toBe('No Active Collection')
    })

    it('renders the switch submenu as radios with the active collection checked', () => {
      const template = buildTemplate(makeState(), actions)
      const active = findById(template, 'collection.switch.col-1')!
      const inactive = findById(template, 'collection.switch.col-2')!
      expect(active.type).toBe('radio')
      expect(active.checked).toBe(true)
      expect(inactive.checked).toBe(false)

      active.click!(undefined as never, undefined as never, undefined as never)
      expect(actions.sendCommand).toHaveBeenCalledWith('collection.switch', {
        collectionId: 'col-1'
      })
    })

    it('reflects the persisted watcher flag as a checkbox', () => {
      const on = buildTemplate(makeState({ watcherEnabled: true }), actions)
      expect(findById(on, 'collection.toggle-watcher')!.checked).toBe(true)
      const off = buildTemplate(makeState({ watcherEnabled: false }), actions)
      expect(findById(off, 'collection.toggle-watcher')!.checked).toBe(false)
    })

    it('deep-links every collection settings section', () => {
      const template = buildTemplate(makeState(), actions)
      for (const section of ['embedding', 'search', 'chunking', 'clusters', 'appearance']) {
        const item = findById(template, `collection.settings.${section}`)!
        item.click!(undefined as never, undefined as never, undefined as never)
        expect(actions.sendCommand).toHaveBeenCalledWith('settings.open', {
          target: 'collection',
          section
        })
      }
    })
  })

  describe('Open Recent', () => {
    it('renders recents and dispatches openRecent on click', () => {
      const template = buildTemplate(makeState(), actions)
      const item = findById(template, 'file.open-recent.0')!
      expect(item.label).toBe('a.md — Notes')
      item.click!(undefined as never, undefined as never, undefined as never)
      expect(actions.openRecent).toHaveBeenCalledWith({
        collectionId: 'col-1',
        filePath: 'notes/a.md'
      })
    })

    it('disables Clear Recent Files when there are no recents', () => {
      const template = buildTemplate(makeState({ recents: [] }), actions)
      expect(findById(template, 'file.clear-recents')!.enabled).toBe(false)
    })
  })

  it('shows dev-only view roles only in dev', () => {
    const dev = buildTemplate(makeState({ isDev: true }), actions)
    const devView = dev.find((t) => t.label === 'View')!
    expect(
      (devView.submenu as MenuItemConstructorOptions[]).some((i) => i.role === 'toggleDevTools')
    ).toBe(true)

    const prod = buildTemplate(makeState({ isDev: false }), actions)
    const prodView = prod.find((t) => t.label === 'View')!
    expect(
      (prodView.submenu as MenuItemConstructorOptions[]).some((i) => i.role === 'toggleDevTools')
    ).toBe(false)
  })

  it('dispatches export commands with the format payload', () => {
    const template = buildTemplate(makeState(), actions)
    for (const format of ['html', 'pdf', 'docx', 'odt', 'epub', 'text', 'rtf']) {
      const item = findById(template, `file.export-${format}`)!
      item.click!(undefined as never, undefined as never, undefined as never)
      expect(actions.sendCommand).toHaveBeenCalledWith('file.export', { format })
    }
  })

  it('gives every command item a stable id', () => {
    const template = buildTemplate(makeState(), actions)
    const clickable = collect(template, (item) => typeof item.click === 'function')
    for (const item of clickable) {
      expect(item.id, item.label as string).toBeTruthy()
    }
  })
})
