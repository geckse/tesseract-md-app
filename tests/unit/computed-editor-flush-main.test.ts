import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow, IpcMainEvent } from 'electron'
import type { WindowManager } from '../../src/main/window-manager'
import type {
  ComputedEditorFlushRequest,
  ComputedEditorFlushResponse
} from '../../src/shared/computed-editor-flush'

const mocks = vi.hoisted(() => ({
  on: vi.fn(),
  getActiveCollection: vi.fn()
}))

vi.mock('electron', () => ({
  ipcMain: { on: (...args: unknown[]) => mocks.on(...args) }
}))

vi.mock('../../src/main/store', () => ({
  getActiveCollection: (...args: unknown[]) => mocks.getActiveCollection(...args)
}))

import {
  assertNoDirtyDocumentsAcrossWindows,
  flushDirtyDocumentsAcrossWindows,
  registerComputedEditorFlushResponseHandler
} from '../../src/main/computed-editor-flush'

type ResponseListener = (event: IpcMainEvent, response: ComputedEditorFlushResponse) => void
type Responder = (request: ComputedEditorFlushRequest) => ComputedEditorFlushResponse

let responseListener: ResponseListener

function response(
  request: ComputedEditorFlushRequest,
  options: Partial<ComputedEditorFlushResponse> = {}
): ComputedEditorFlushResponse {
  return {
    requestId: request.requestId,
    phase: request.phase,
    collectionId: request.collectionId,
    applies: true,
    ok: true,
    dirtyDocuments: [],
    blockers: [],
    ...options
  }
}

function createWindow(id: number, responder: Responder): BrowserWindow {
  return {
    webContents: {
      id,
      send: vi.fn((_channel: string, request: ComputedEditorFlushRequest) => {
        queueMicrotask(() => {
          responseListener({ sender: { id } } as IpcMainEvent, responder(request))
        })
      })
    }
  } as unknown as BrowserWindow
}

function createWindowManager(
  windows: BrowserWindow[],
  selections: Record<number, string | null | undefined> = {}
): WindowManager {
  return {
    getAllWindows: () => windows,
    getWindowCollectionId: (id: number) => selections[id],
    broadcastToAll: vi.fn()
  } as unknown as WindowManager
}

describe('computed editor flush coordinator', () => {
  beforeEach(() => {
    mocks.on.mockReset()
    mocks.getActiveCollection.mockReset().mockReturnValue({ id: 'collection-1', path: '/vault' })
    registerComputedEditorFlushResponseHandler()
    responseListener = mocks.on.mock.calls[0][1] as ResponseListener
  })

  it('stops after inspection when every target renderer is already clean', async () => {
    const phases: string[] = []
    const win = createWindow(1, (request) => {
      phases.push(request.phase)
      return response(request)
    })

    await flushDirtyDocumentsAcrossWindows(createWindowManager([win]), 'collection-1', '/vault')

    expect(phases).toEqual(['inspect'])
  })

  it('runs inspect, flush, and verify across every target renderer', async () => {
    const phases = new Map<number, string[]>()
    const responder =
      (id: number): Responder =>
      (request) => {
        phases.set(id, [...(phases.get(id) ?? []), request.phase])
        if (request.phase === 'inspect' && id === 1) {
          return response(request, {
            dirtyDocuments: [{ tabId: 'tab-1', path: 'contacts/alice.md' }]
          })
        }
        return response(request)
      }
    const windows = [createWindow(1, responder(1)), createWindow(2, responder(2))]

    await flushDirtyDocumentsAcrossWindows(createWindowManager(windows), 'collection-1', '/vault')

    expect(phases.get(1)).toEqual(['inspect', 'flush', 'verify'])
    expect(phases.get(2)).toEqual(['inspect', 'flush', 'verify'])
  })

  it('blocks before writing when one path has multiple dirty editor copies', async () => {
    const phases: string[] = []
    const responder =
      (id: number): Responder =>
      (request) => {
        phases.push(request.phase)
        return response(request, {
          dirtyDocuments: [{ tabId: `tab-${id}`, path: 'clients/acme.md' }]
        })
      }
    const windows = [createWindow(1, responder(1)), createWindow(2, responder(2))]

    await expect(
      flushDirtyDocumentsAcrossWindows(createWindowManager(windows), 'collection-1', '/vault')
    ).rejects.toThrow(/multiple tabs or windows/)
    expect(phases).toEqual(['inspect', 'inspect'])
  })

  it('surfaces a renderer save failure and never enters verification', async () => {
    const phases: string[] = []
    const win = createWindow(1, (request) => {
      phases.push(request.phase)
      if (request.phase === 'inspect') {
        return response(request, {
          dirtyDocuments: [{ tabId: 'tab-1', path: 'invoices/1.md' }]
        })
      }
      return response(request, {
        ok: false,
        dirtyDocuments: [{ tabId: 'tab-1', path: 'invoices/1.md' }],
        blockers: [{ path: 'invoices/1.md', reason: 'permission denied' }]
      })
    })

    await expect(
      flushDirtyDocumentsAcrossWindows(createWindowManager([win]), 'collection-1', '/vault')
    ).rejects.toThrow(/permission denied/)
    expect(phases).toEqual(['inspect', 'flush'])
  })

  it('asks every window and lets unrelated renderers opt out authoritatively', async () => {
    const target = createWindow(1, (request) => response(request))
    const unrelated = createWindow(2, (request) => response(request, { applies: false }))

    await flushDirtyDocumentsAcrossWindows(
      createWindowManager([target, unrelated], {
        1: 'collection-1',
        2: 'collection-2'
      }),
      'collection-1',
      '/vault'
    )

    expect(target.webContents.send).toHaveBeenCalledOnce()
    expect(unrelated.webContents.send).toHaveBeenCalledOnce()
  })

  it('queries an unmapped window once and excludes it when its renderer owns another collection', async () => {
    const targetPhases: string[] = []
    const unknownPhases: string[] = []
    const target = createWindow(1, (request) => {
      targetPhases.push(request.phase)
      if (request.phase === 'inspect') {
        return response(request, {
          dirtyDocuments: [{ tabId: 'tab-1', path: 'contacts/alice.md' }]
        })
      }
      return response(request)
    })
    const unknown = createWindow(2, (request) => {
      unknownPhases.push(request.phase)
      return response(request, { applies: false })
    })

    await flushDirtyDocumentsAcrossWindows(
      createWindowManager([target, unknown], { 1: 'collection-1' }),
      'collection-1',
      '/vault'
    )

    expect(targetPhases).toEqual(['inspect', 'flush', 'verify'])
    expect(unknownPhases).toEqual(['inspect'])
  })

  it('continues to flush safe documents when inspection reports another blocked draft', async () => {
    const phases: string[] = []
    const win = createWindow(1, (request) => {
      phases.push(request.phase)
      if (request.phase === 'inspect') {
        return response(request, {
          ok: false,
          dirtyDocuments: [
            { tabId: 'safe', path: 'contacts/alice.md' },
            { tabId: 'blocked', path: 'Untitled' }
          ],
          blockers: [{ tabId: 'blocked', path: 'Untitled', reason: 'needs a filename' }]
        })
      }
      return response(request, {
        ok: false,
        dirtyDocuments: [{ tabId: 'blocked', path: 'Untitled' }],
        blockers: [{ tabId: 'blocked', path: 'Untitled', reason: 'needs a filename' }]
      })
    })

    await expect(
      flushDirtyDocumentsAcrossWindows(createWindowManager([win]), 'collection-1', '/vault')
    ).rejects.toThrow(/needs a filename/)
    expect(phases).toEqual(['inspect', 'flush'])
  })

  it('blocks a destructive operation when another window owns a dirty document', async () => {
    const clean = createWindow(1, (request) => response(request))
    const dirty = createWindow(2, (request) =>
      response(request, {
        dirtyDocuments: [{ tabId: 'tab-2', path: 'clients/acme.md' }]
      })
    )

    await expect(
      assertNoDirtyDocumentsAcrossWindows(
        createWindowManager([clean, dirty]),
        'collection-1',
        '/vault'
      )
    ).rejects.toThrow(/clients\/acme\.md.*unsaved edits/)
    expect(clean.webContents.send).toHaveBeenCalledOnce()
    expect(dirty.webContents.send).toHaveBeenCalledOnce()
  })
})
