import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MdvdbApi } from '../../src/preload/api'

const electronMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  sendSync: vi.fn(),
  on: vi.fn(),
  off: vi.fn(),
  removeAllListeners: vi.fn(),
  postMessage: vi.fn(),
  getPathForFile: vi.fn()
}))

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: vi.fn() },
  ipcRenderer: {
    invoke: (...args: unknown[]) => electronMocks.invoke(...args),
    sendSync: (...args: unknown[]) => electronMocks.sendSync(...args),
    on: (...args: unknown[]) => electronMocks.on(...args),
    off: (...args: unknown[]) => electronMocks.off(...args),
    removeAllListeners: (...args: unknown[]) => electronMocks.removeAllListeners(...args),
    postMessage: (...args: unknown[]) => electronMocks.postMessage(...args)
  },
  webUtils: {
    getPathForFile: (...args: unknown[]) => electronMocks.getPathForFile(...args)
  }
}))

vi.mock('@electron-toolkit/preload', () => ({ electronAPI: {} }))

describe('preload external-file bridge', () => {
  let api: MdvdbApi

  beforeAll(async () => {
    electronMocks.sendSync.mockReturnValue(undefined)
    await import('../../src/preload/index')
    api = window.api
  })

  beforeEach(() => {
    electronMocks.invoke.mockReset()
    electronMocks.getPathForFile.mockReset()
  })

  it('resolves an OS-backed File synchronously before invoking the open channel', async () => {
    const file = new File(['# Report\n'], 'report.md', { type: 'text/markdown' })
    const descriptor = {
      id: 'grant-1',
      path: '/outside/report.md',
      name: 'report.md',
      directory: '/outside',
      size: 9,
      kind: 'markdown' as const,
      mimeCategory: 'other' as const,
      content: '# Report\n',
      collectionId: null,
      relativePath: null
    }
    electronMocks.getPathForFile.mockReturnValue('/outside/report.md')
    electronMocks.invoke.mockResolvedValue(descriptor)

    await expect(api.openDroppedFile(file)).resolves.toEqual(descriptor)

    expect(electronMocks.getPathForFile).toHaveBeenCalledWith(file)
    expect(electronMocks.invoke).toHaveBeenCalledWith(
      'external:open-dropped-file',
      '/outside/report.md'
    )
  })

  it('rejects a synthetic File whose Electron path is empty', async () => {
    const file = new File(['data'], 'synthetic.md')
    electronMocks.getPathForFile.mockReturnValue('')

    await expect(api.openDroppedFile(file)).rejects.toThrow(/not backed by a local filesystem path/)
    expect(electronMocks.invoke).not.toHaveBeenCalled()
  })

  it('resolves every import source from its File object before invoking main', async () => {
    const first = new File(['one'], 'one.md')
    const second = new File(['two'], 'two.png')
    electronMocks.getPathForFile
      .mockReturnValueOnce('/outside/one.md')
      .mockReturnValueOnce('/outside/two.png')
    electronMocks.invoke.mockResolvedValue([])

    await expect(api.importDroppedFiles([first, second], 'vault', 'docs')).resolves.toEqual([])

    expect(electronMocks.getPathForFile).toHaveBeenNthCalledWith(1, first)
    expect(electronMocks.getPathForFile).toHaveBeenNthCalledWith(2, second)
    expect(electronMocks.invoke).toHaveBeenCalledWith(
      'external:import-dropped-files',
      ['/outside/one.md', '/outside/two.png'],
      'vault',
      'docs'
    )
  })

  it('does not invoke a partial import when any File lacks a native path', async () => {
    const first = new File(['one'], 'one.md')
    const synthetic = new File(['two'], 'synthetic.png')
    electronMocks.getPathForFile.mockReturnValueOnce('/outside/one.md').mockReturnValueOnce('')

    await expect(api.importDroppedFiles([first, synthetic], 'vault', '')).rejects.toThrow(
      /synthetic\.png/
    )
    expect(electronMocks.invoke).not.toHaveBeenCalled()
  })

  it('routes grant-scoped follow-up methods without accepting paths', async () => {
    electronMocks.invoke.mockResolvedValue(undefined)

    await api.readExternalDocument('grant-1')
    await api.saveExternalDocument('grant-1', 'before', 'after')
    await api.revealExternalFile('grant-1')
    await api.openExternalFile('grant-1')
    await api.releaseExternalFile('grant-1')

    expect(electronMocks.invoke.mock.calls).toEqual([
      ['external:read-document', 'grant-1'],
      ['external:save-document', 'grant-1', 'before', 'after'],
      ['external:reveal-file', 'grant-1'],
      ['external:open-file', 'grant-1'],
      ['external:release-file', 'grant-1']
    ])
  })
})
