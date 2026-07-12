import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockHandle = vi.fn()
const mockShowSaveDialog = vi.fn()
const mockLoadFile = vi.fn().mockResolvedValue(undefined)
const mockPrintToPDF = vi.fn().mockResolvedValue(Buffer.from('%PDF-fake'))
const mockDestroy = vi.fn()

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp')
  },
  ipcMain: {
    handle: (...args: unknown[]) => mockHandle(...args)
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

    it('applies the 10MB cap to binary content by byte length', async () => {
      const handler = getHandler('export:save')
      const result = (await handler(fakeEvent, {
        defaultName: 'big.epub',
        content: new Uint8Array(11 * 1024 * 1024),
        filters: [{ name: 'EPUB', extensions: ['epub'] }]
      })) as { error?: boolean; message?: string }
      expect(result.error).toBe(true)
      expect(result.message).toContain('10MB')
      expect(mockShowSaveDialog).not.toHaveBeenCalled()
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
