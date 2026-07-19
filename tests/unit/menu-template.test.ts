import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MenuItemConstructorOptions } from 'electron'
import { buildTemplate, type MenuActions } from '../../src/main/menu-template'
import { DEFAULT_GRAPH_MENU_CONTEXT, type MenuState } from '../../src/main/menu-state'
import type { GraphMenuContext } from '../../src/preload/api'

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
    graph: makeGraphContext(),
    ...overrides
  }
}

function makeGraphContext(overrides: Partial<GraphMenuContext> = {}): GraphMenuContext {
  return { ...DEFAULT_GRAPH_MENU_CONTEXT, ...overrides }
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
      'Graph',
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
      'graph.open',
      'graph.search',
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

  describe('Graph menu state', () => {
    const graphLocalIds = [
      'graph.search',
      'graph.recenter',
      'graph.presentation-toggle',
      'graph.presentation-reset',
      'graph.color.cluster',
      'graph.color.custom-cluster',
      'graph.color.folder',
      'graph.color.none',
      'graph.level.document',
      'graph.level.chunk',
      'graph.toggle-labels',
      'graph.toggle-lines',
      'graph.toggle-shapes',
      'graph.toggle-unconnected',
      'graph.screenshot',
      'graph.screenshot-transparent'
    ]

    it('keeps graph entry points available while view-local actions wait for a ready graph', () => {
      const template = buildTemplate(makeState(), actions)

      expect(findById(template, 'graph.open')!.enabled).toBe(true)
      expect(findById(template, 'graph.open-popup')!.enabled).toBe(true)
      expect(findById(template, 'view.toggle-graph')).toBeNull()
      for (const id of graphLocalIds) {
        expect(findById(template, id)!.enabled, id).toBe(false)
      }
    })

    it('disables graph entry points when no collection is active', () => {
      const template = buildTemplate(
        makeState({ activeCollectionId: null, activeCollectionName: null }),
        actions
      )

      expect(findById(template, 'graph.open')!.enabled).toBe(false)
      expect(findById(template, 'graph.open-popup')!.enabled).toBe(false)
    })

    it('reflects ready graph modes, levels, display flags, and availability', () => {
      const template = buildTemplate(
        makeState({
          graph: makeGraphContext({
            active: true,
            ready: true,
            labelsVisible: false,
            linesVisible: false,
            shapesVisible: false,
            shapesAvailable: true,
            unconnectedHighlighted: true,
            unconnectedCount: 0,
            level: 'chunk',
            coloringMode: 'custom-cluster',
            topicsAvailable: true
          })
        }),
        actions
      )

      for (const id of [
        'graph.search',
        'graph.recenter',
        'graph.presentation-toggle',
        'graph.color.custom-cluster',
        'graph.level.chunk',
        'graph.toggle-labels',
        'graph.toggle-lines',
        'graph.toggle-shapes',
        'graph.toggle-unconnected',
        'graph.screenshot',
        'graph.screenshot-transparent'
      ]) {
        expect(findById(template, id)!.enabled, id).toBe(true)
      }

      expect(findById(template, 'graph.color.custom-cluster')!.checked).toBe(true)
      expect(findById(template, 'graph.level.chunk')!.checked).toBe(true)
      expect(findById(template, 'graph.toggle-labels')!.checked).toBe(false)
      expect(findById(template, 'graph.toggle-lines')!.checked).toBe(false)
      expect(findById(template, 'graph.toggle-shapes')!.checked).toBe(false)
      expect(findById(template, 'graph.toggle-unconnected')!.checked).toBe(true)
      expect(findById(template, 'graph.presentation-reset')!.enabled).toBe(false)
    })

    it('disables unavailable topic, shape, and empty unconnected choices', () => {
      const template = buildTemplate(
        makeState({
          graph: makeGraphContext({ active: true, ready: true })
        }),
        actions
      )

      expect(findById(template, 'graph.color.cluster')!.checked).toBe(true)
      expect(findById(template, 'graph.level.document')!.checked).toBe(true)
      expect(findById(template, 'graph.color.custom-cluster')!.enabled).toBe(false)
      expect(findById(template, 'graph.toggle-shapes')!.enabled).toBe(false)
      expect(findById(template, 'graph.toggle-unconnected')!.enabled).toBe(false)
    })

    it('uses state-specific presentation labels and reset availability', () => {
      const cases: Array<{
        context: Partial<GraphMenuContext>
        label: string
        resetEnabled: boolean
      }> = [
        { context: {}, label: 'Present Graph', resetEnabled: false },
        {
          context: { hasSelection: true },
          label: 'Present from Selected Node',
          resetEnabled: false
        },
        {
          context: { presentationState: 'playing' },
          label: 'Pause Presentation',
          resetEnabled: true
        },
        {
          context: { presentationState: 'paused' },
          label: 'Continue Presentation',
          resetEnabled: true
        }
      ]

      for (const { context, label, resetEnabled } of cases) {
        const template = buildTemplate(
          makeState({
            graph: makeGraphContext({ active: true, ready: true, ...context })
          }),
          actions
        )
        expect(findById(template, 'graph.presentation-toggle')!.label).toBe(label)
        expect(findById(template, 'graph.presentation-reset')!.enabled).toBe(resetEnabled)
      }
    })

    it('disables both screenshot actions while an export is in progress', () => {
      const template = buildTemplate(
        makeState({
          graph: makeGraphContext({
            active: true,
            ready: true,
            exportingScreenshot: true
          })
        }),
        actions
      )

      expect(findById(template, 'graph.screenshot')!.enabled).toBe(false)
      expect(findById(template, 'graph.screenshot-transparent')!.enabled).toBe(false)
      expect(findById(template, 'graph.recenter')!.enabled).toBe(true)
    })

    it('dispatches graph commands and state-changing payloads', () => {
      const template = buildTemplate(
        makeState({
          graph: makeGraphContext({
            active: true,
            ready: true,
            shapesAvailable: true,
            unconnectedCount: 2,
            topicsAvailable: true
          })
        }),
        actions
      )
      const click = (id: string): void => {
        findById(template, id)!.click!(undefined as never, undefined as never, undefined as never)
      }

      for (const id of [
        'graph.open',
        'graph.open-popup',
        'graph.search',
        'graph.recenter',
        'graph.presentation-toggle',
        'graph.presentation-reset',
        'graph.toggle-labels',
        'graph.toggle-lines',
        'graph.toggle-shapes',
        'graph.toggle-unconnected',
        'graph.screenshot',
        'graph.screenshot-transparent'
      ]) {
        click(id)
        expect(actions.sendCommand).toHaveBeenCalledWith(id, undefined)
      }

      click('graph.color.custom-cluster')
      expect(actions.sendCommand).toHaveBeenCalledWith('graph.set-coloring', {
        mode: 'custom-cluster'
      })
      click('graph.level.chunk')
      expect(actions.sendCommand).toHaveBeenCalledWith('graph.set-level', { level: 'chunk' })
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
