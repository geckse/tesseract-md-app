import { describe, it, expect, vi, beforeEach } from 'vitest'
import vm from 'node:vm'

const mockHandle = vi.fn()
const mockOn = vi.fn()
const mockShowSaveDialog = vi.fn()
const mockLoadFile = vi.fn().mockResolvedValue(undefined)
const mockPrintToPDF = vi.fn().mockResolvedValue(Buffer.from('%PDF-fake'))
const mockDestroy = vi.fn()

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp')
  },
  ipcMain: {
    handle: (...args: unknown[]) => mockHandle(...args),
    on: (...args: unknown[]) => mockOn(...args)
  },
  dialog: {
    showSaveDialog: (...args: unknown[]) => mockShowSaveDialog(...args)
  },
  BrowserWindow: Object.assign(
    vi.fn().mockImplementation(() => ({
      loadFile: mockLoadFile,
      webContents: { printToPDF: mockPrintToPDF },
      destroy: mockDestroy
    })),
    { fromWebContents: vi.fn(() => undefined) }
  )
}))

const mockWriteFile = vi.fn().mockResolvedValue(undefined)
const mockUnlink = vi.fn().mockResolvedValue(undefined)
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  const promises = {
    ...actual.promises,
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
    unlink: (...args: unknown[]) => mockUnlink(...args)
  }
  return { ...actual, promises, default: { ...actual, promises } }
})

import { registerExportHandlers } from '../../src/main/export'

function getHandler(channel: string): (...args: unknown[]) => Promise<unknown> {
  registerExportHandlers()
  const call = mockHandle.mock.calls.find((c: unknown[]) => c[0] === channel)
  if (!call) throw new Error(`No handler for channel: ${channel}`)
  return call[1] as (...args: unknown[]) => Promise<unknown>
}

function getListener(channel: string): (...args: unknown[]) => void {
  registerExportHandlers()
  const call = mockOn.mock.calls.find((c: unknown[]) => c[0] === channel)
  if (!call) throw new Error(`No listener for channel: ${channel}`)
  return call[1] as (...args: unknown[]) => void
}

function fakeMessagePort() {
  let messageListener: ((event: { data: unknown }) => void) | undefined
  let closeListener: (() => void) | undefined
  return {
    once: vi.fn((event: string, listener: (value: never) => void) => {
      if (event === 'message') {
        messageListener = listener as unknown as (event: { data: unknown }) => void
      } else if (event === 'close') {
        closeListener = listener as unknown as () => void
      }
    }),
    removeListener: vi.fn((event: string, listener: () => void) => {
      if (event === 'close' && closeListener === listener) closeListener = undefined
    }),
    start: vi.fn(),
    postMessage: vi.fn(),
    close: vi.fn(),
    deliver(data: unknown) {
      messageListener?.({ data })
    }
  }
}

const fakeEvent = { sender: {} }

describe('export IPC handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrintToPDF.mockResolvedValue(Buffer.from('%PDF-fake'))
  })

  describe('export:save', () => {
    it('returns saved:false without writing when the dialog is canceled', async () => {
      mockShowSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined })
      const handler = getHandler('export:save')
      const result = await handler(fakeEvent, {
        defaultName: 'note.html',
        content: '<html></html>',
        filters: [{ name: 'HTML', extensions: ['html'] }]
      })
      expect(result).toEqual({ saved: false })
      expect(mockWriteFile).not.toHaveBeenCalled()
    })

    it('writes the content to the picked path', async () => {
      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: '/exports/note.html' })
      const handler = getHandler('export:save')
      const result = await handler(fakeEvent, {
        defaultName: 'note.html',
        content: '<html>hi</html>',
        filters: [{ name: 'HTML', extensions: ['html'] }]
      })
      expect(result).toEqual({ saved: true, path: '/exports/note.html' })
      expect(mockWriteFile).toHaveBeenCalledWith('/exports/note.html', '<html>hi</html>', 'utf-8')
    })

    it('passes defaultName and filters into the save dialog', async () => {
      mockShowSaveDialog.mockResolvedValue({ canceled: true })
      const handler = getHandler('export:save')
      await handler(fakeEvent, {
        defaultName: 'doc.rtf',
        content: '{\\rtf1}',
        filters: [{ name: 'Rich Text Format', extensions: ['rtf'] }]
      })
      expect(mockShowSaveDialog).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultPath: 'doc.rtf',
          filters: [{ name: 'Rich Text Format', extensions: ['rtf'] }]
        })
      )
    })

    it('serializes oversized exports as an error object', async () => {
      const handler = getHandler('export:save')
      const result = (await handler(fakeEvent, {
        defaultName: 'big.txt',
        content: 'x'.repeat(11 * 1024 * 1024),
        filters: [{ name: 'Plain Text', extensions: ['txt'] }]
      })) as { error?: boolean; message?: string }
      expect(result.error).toBe(true)
      expect(result.message).toContain('10MB')
      expect(mockShowSaveDialog).not.toHaveBeenCalled()
    })

    it('writes binary content (docx/odt/epub) verbatim without an encoding', async () => {
      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: '/exports/note.docx' })
      const handler = getHandler('export:save')
      const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0xff])
      const result = await handler(fakeEvent, {
        defaultName: 'note.docx',
        content: bytes,
        filters: [{ name: 'Word Document', extensions: ['docx'] }]
      })
      expect(result).toEqual({ saved: true, path: '/exports/note.docx' })
      const [path, data] = mockWriteFile.mock.calls[0] as [string, Buffer]
      expect(path).toBe('/exports/note.docx')
      expect(Buffer.isBuffer(data)).toBe(true)
      expect([...data]).toEqual([...bytes])
    })

    it('writes a binary ArrayBuffer created in a different V8 realm', async () => {
      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: '/exports/graph.png' })
      const handler = getHandler('export:save')
      const content = vm.runInNewContext(
        'Uint8Array.from([0x89, 0x50, 0x4e, 0x47]).buffer'
      ) as ArrayBuffer

      const result = await handler(fakeEvent, {
        defaultName: 'graph.png',
        content,
        filters: [{ name: 'PNG Image', extensions: ['png'] }]
      })

      expect(result).toEqual({ saved: true, path: '/exports/graph.png' })
      expect([...(mockWriteFile.mock.calls[0]?.[1] as Buffer)]).toEqual([0x89, 0x50, 0x4e, 0x47])
    })

    it('allows large binary content beyond the text cap', async () => {
      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: '/exports/big.epub' })
      const handler = getHandler('export:save')
      const bytes = new Uint8Array(11 * 1024 * 1024)
      const result = await handler(fakeEvent, {
        defaultName: 'big.epub',
        content: bytes,
        filters: [{ name: 'EPUB', extensions: ['epub'] }]
      })
      expect(result).toEqual({ saved: true, path: '/exports/big.epub' })
      const written = mockWriteFile.mock.calls[0]?.[1] as Buffer
      expect(written.byteLength).toBe(bytes.byteLength)
    })
  })

  describe('export:save-binary', () => {
    it('waits until after the save dialog before requesting and writing the buffer', async () => {
      let resolveDialog: ((value: { canceled: boolean; filePath: string }) => void) | undefined
      mockShowSaveDialog.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveDialog = resolve
          })
      )
      const listener = getListener('export:save-binary')
      const port = fakeMessagePort()
      listener(
        { sender: {}, ports: [port] },
        {
          defaultName: 'graph.png',
          filters: [{ name: 'PNG Image', extensions: ['png'] }],
          byteLength: 4
        }
      )

      expect(port.postMessage).not.toHaveBeenCalled()
      resolveDialog?.({ canceled: false, filePath: '/exports/graph.png' })
      await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledWith({ type: 'ready' }))

      const content = Uint8Array.from([0x89, 0x50, 0x4e, 0x47])
      port.deliver(content)
      await vi.waitFor(() =>
        expect(port.postMessage).toHaveBeenCalledWith({
          type: 'result',
          value: { saved: true, path: '/exports/graph.png' }
        })
      )
      const [path, data] = mockWriteFile.mock.calls[0] as [string, Buffer]
      expect(path).toBe('/exports/graph.png')
      expect([...data]).toEqual([0x89, 0x50, 0x4e, 0x47])
      expect(port.close).toHaveBeenCalledOnce()
    })

    it('does not request the binary payload when the dialog is canceled', async () => {
      mockShowSaveDialog.mockResolvedValue({ canceled: true, filePath: undefined })
      const listener = getListener('export:save-binary')
      const port = fakeMessagePort()
      listener(
        { sender: {}, ports: [port] },
        {
          defaultName: 'graph.png',
          filters: [{ name: 'PNG Image', extensions: ['png'] }],
          byteLength: 20 * 1024 * 1024
        }
      )

      await vi.waitFor(() =>
        expect(port.postMessage).toHaveBeenCalledWith({
          type: 'result',
          value: { saved: false }
        })
      )
      expect(port.postMessage).not.toHaveBeenCalledWith({ type: 'ready' })
      expect(mockWriteFile).not.toHaveBeenCalled()
    })

    it('rejects oversized metadata before showing a dialog or receiving bytes', async () => {
      const listener = getListener('export:save-binary')
      const port = fakeMessagePort()
      listener(
        { sender: {}, ports: [port] },
        {
          defaultName: 'huge.png',
          filters: [{ name: 'PNG Image', extensions: ['png'] }],
          byteLength: 257 * 1024 * 1024
        }
      )

      await vi.waitFor(() =>
        expect(port.postMessage).toHaveBeenCalledWith({
          type: 'result',
          value: expect.objectContaining({ error: true, message: expect.stringContaining('256MB') })
        })
      )
      expect(mockShowSaveDialog).not.toHaveBeenCalled()
      expect(mockWriteFile).not.toHaveBeenCalled()
    })

    it('rejects a payload whose byte length differs from its metadata', async () => {
      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: '/exports/graph.png' })
      const listener = getListener('export:save-binary')
      const port = fakeMessagePort()
      listener(
        { sender: {}, ports: [port] },
        {
          defaultName: 'graph.png',
          filters: [{ name: 'PNG Image', extensions: ['png'] }],
          byteLength: 4
        }
      )
      await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledWith({ type: 'ready' }))
      port.deliver(new ArrayBuffer(3))

      await vi.waitFor(() =>
        expect(port.postMessage).toHaveBeenCalledWith({
          type: 'result',
          value: expect.objectContaining({
            error: true,
            message: expect.stringContaining('did not match')
          })
        })
      )
      expect(mockWriteFile).not.toHaveBeenCalled()
    })

    it('accepts Electron binary views and writes only their visible bytes', async () => {
      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: '/exports/graph.png' })
      const listener = getListener('export:save-binary')
      const port = fakeMessagePort()
      listener(
        { sender: {}, ports: [port] },
        {
          defaultName: 'graph.png',
          filters: [{ name: 'PNG Image', extensions: ['png'] }],
          byteLength: 4
        }
      )
      await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledWith({ type: 'ready' }))

      const transported = Buffer.from([0, 0x89, 0x50, 0x4e, 0x47, 0])
      port.deliver(transported.subarray(1, 5))

      await vi.waitFor(() =>
        expect(port.postMessage).toHaveBeenCalledWith({
          type: 'result',
          value: { saved: true, path: '/exports/graph.png' }
        })
      )
      const written = mockWriteFile.mock.calls[0]?.[1] as Buffer
      expect([...written]).toEqual([0x89, 0x50, 0x4e, 0x47])
    })

    it('accepts an ArrayBuffer created in a different V8 realm', async () => {
      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: '/exports/graph.png' })
      const listener = getListener('export:save-binary')
      const port = fakeMessagePort()
      listener(
        { sender: {}, ports: [port] },
        {
          defaultName: 'graph.png',
          filters: [{ name: 'PNG Image', extensions: ['png'] }],
          byteLength: 4
        }
      )
      await vi.waitFor(() => expect(port.postMessage).toHaveBeenCalledWith({ type: 'ready' }))

      const foreignBuffer = vm.runInNewContext(
        'Uint8Array.from([0x89, 0x50, 0x4e, 0x47]).buffer'
      ) as ArrayBuffer
      expect(foreignBuffer instanceof ArrayBuffer).toBe(false)
      port.deliver(foreignBuffer)

      await vi.waitFor(() =>
        expect(port.postMessage).toHaveBeenCalledWith({
          type: 'result',
          value: { saved: true, path: '/exports/graph.png' }
        })
      )
      const written = mockWriteFile.mock.calls[0]?.[1] as Buffer
      expect([...written]).toEqual([0x89, 0x50, 0x4e, 0x47])
    })
  })

  describe('export:pdf', () => {
    it('renders the html in a hidden window and writes the pdf', async () => {
      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: '/exports/note.pdf' })
      const handler = getHandler('export:pdf')
      const result = await handler(fakeEvent, {
        defaultName: 'note.pdf',
        html: '<!doctype html><html><body>hi</body></html>'
      })
      expect(result).toEqual({ saved: true, path: '/exports/note.pdf' })
      // temp html written, then pdf buffer written
      expect(mockLoadFile).toHaveBeenCalled()
      expect(mockPrintToPDF).toHaveBeenCalledWith(
        expect.objectContaining({ printBackground: true })
      )
      expect(mockWriteFile).toHaveBeenCalledWith('/exports/note.pdf', expect.any(Buffer))
      // hidden window destroyed + temp file cleaned up
      expect(mockDestroy).toHaveBeenCalled()
      expect(mockUnlink).toHaveBeenCalled()
    })

    it('skips rendering when the dialog is canceled', async () => {
      mockShowSaveDialog.mockResolvedValue({ canceled: true })
      const handler = getHandler('export:pdf')
      const result = await handler(fakeEvent, { defaultName: 'note.pdf', html: '<html></html>' })
      expect(result).toEqual({ saved: false })
      expect(mockPrintToPDF).not.toHaveBeenCalled()
    })

    it('destroys the hidden window even when printing fails', async () => {
      mockShowSaveDialog.mockResolvedValue({ canceled: false, filePath: '/exports/note.pdf' })
      mockPrintToPDF.mockRejectedValue(new Error('print blew up'))
      const handler = getHandler('export:pdf')
      const result = (await handler(fakeEvent, {
        defaultName: 'note.pdf',
        html: '<html></html>'
      })) as { error?: boolean; message?: string }
      expect(result.error).toBe(true)
      expect(result.message).toContain('print blew up')
      expect(mockDestroy).toHaveBeenCalled()
      expect(mockUnlink).toHaveBeenCalled()
    })
  })
})
