import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  focusedWindow: null as unknown,
  buildFromTemplate: vi.fn(() => ({ built: true })),
  setApplicationMenu: vi.fn(),
  buildTemplate: vi.fn(() => []),
  getMenuState: vi.fn((graph: unknown) => ({ graph })),
  initStore: vi.fn(() => ({ set: vi.fn() }))
}))

const defaultGraphContext = vi.hoisted(() => ({
  active: false,
  ready: false,
  labelsVisible: true,
  linesVisible: true,
  shapesVisible: true,
  shapesAvailable: false,
  unconnectedHighlighted: false,
  unconnectedCount: 0,
  hasSelection: false,
  presentationState: 'idle' as const,
  exportingScreenshot: false,
  level: 'document' as const,
  coloringMode: 'cluster' as const,
  topicsAvailable: false
}))

vi.mock('electron', () => ({
  Menu: {
    buildFromTemplate: mocks.buildFromTemplate,
    setApplicationMenu: mocks.setApplicationMenu
  },
  BrowserWindow: {
    getFocusedWindow: () => mocks.focusedWindow
  },
  app: {
    name: 'Tesseract',
    getVersion: () => '1.0.0',
    setAboutPanelOptions: vi.fn(),
    showAboutPanel: vi.fn()
  },
  shell: { openExternal: vi.fn() }
}))

vi.mock('../../src/main/store', () => ({ initStore: mocks.initStore }))
vi.mock('../../src/main/menu-state', () => ({
  DEFAULT_GRAPH_MENU_CONTEXT: defaultGraphContext,
  getMenuState: mocks.getMenuState
}))
vi.mock('../../src/main/menu-template', () => ({
  buildTemplate: mocks.buildTemplate
}))
vi.mock('../../src/main/updater', () => ({
  getAppUpdater: () => ({ checkForUpdates: vi.fn() })
}))

import { buildAppMenu, clearWindowMenuContext, updateWindowMenuContext } from '../../src/main/menu'

function windowStub(webContentsId: number) {
  return {
    isDestroyed: () => false,
    webContents: { id: webContentsId, send: vi.fn() }
  }
}

describe('native menu window routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('uses a focused graph popup only for graph-local commands and state', async () => {
    const primary = windowStub(11)
    const popup = windowStub(22)
    const windowManager = {
      isPopup: (webContentsId: number) => webContentsId === 22,
      getPrimaryWindowId: () => 101,
      getWindow: (windowId: number) => (windowId === 101 ? primary : undefined),
      getAllWindows: () => [primary, popup],
      createWindow: vi.fn(),
      broadcastToAll: vi.fn()
    }

    mocks.focusedWindow = primary
    buildAppMenu(windowManager as never)
    updateWindowMenuContext(11, { active: false })
    await Promise.resolve()

    mocks.focusedWindow = popup
    updateWindowMenuContext(22, { active: true, ready: true })
    await Promise.resolve()

    const latestState = mocks.buildTemplate.mock.calls.at(-1)?.[0] as {
      graph: typeof defaultGraphContext
    }
    expect(latestState.graph).toMatchObject({ active: true, ready: true })

    const actions = mocks.buildTemplate.mock.calls.at(-1)?.[1] as {
      sendCommand: (id: string) => void
    }
    actions.sendCommand('graph.screenshot')
    expect(popup.webContents.send).toHaveBeenCalledWith('menu:command', {
      id: 'graph.screenshot',
      payload: undefined
    })

    actions.sendCommand('file.save')
    actions.sendCommand('graph.open')
    expect(primary.webContents.send).toHaveBeenCalledWith('menu:command', {
      id: 'file.save',
      payload: undefined
    })
    expect(primary.webContents.send).toHaveBeenCalledWith('menu:command', {
      id: 'graph.open',
      payload: undefined
    })

    clearWindowMenuContext(22)
  })
})
