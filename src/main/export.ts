/**
 * Export IPC handlers: File > Save a Copy… / Export ▸ (phase 43).
 *
 * These deliberately do NOT route through the collection-bounded `fs:*`
 * handlers — the user-driven native save dialog is the consent boundary
 * for writing outside a collection. The renderer converts (it owns marked
 * and the live buffer); main shows the dialog and writes bytes. PDF is the
 * exception: main renders the provided standalone HTML in a hidden window
 * and prints it via printToPDF.
 */

import { app, dialog, ipcMain, BrowserWindow } from 'electron'
import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import type { SerializedError } from './errors'
import type { ExportSaveRequest, ExportPdfRequest, ExportResult } from '../preload/api'

/** Text/HTML is structured-cloned over invoke, so keep its original tight cap. */
const MAX_TEXT_EXPORT_BYTES = 10 * 1024 * 1024

/**
 * Binary exports use a transferred MessagePort and may legitimately be much
 * larger than text (for example a high-DPI graph PNG). Keep a generous but
 * finite ceiling so a compromised renderer cannot make main retain unbounded
 * memory. The bytes are not sent until after the user picks a path.
 */
const MAX_BINARY_EXPORT_BYTES = 256 * 1024 * 1024

interface BinaryExportMetadata {
  defaultName: string
  filters: { name: string; extensions: string[] }[]
  byteLength: number
}

/**
 * Local error wrapper matching ipc-handlers' wrapHandler shape (importing
 * it directly would create a module cycle — ipc-handlers imports this file).
 */
function wrap<T>(fn: () => Promise<T>): Promise<T | SerializedError> {
  return fn().catch((error: unknown) => ({
    error: true as const,
    type: 'CliExecutionError' as const,
    message: error instanceof Error ? error.message : String(error)
  }))
}

function ownerWindow(sender: Electron.WebContents): BrowserWindow | undefined {
  return BrowserWindow.fromWebContents(sender) ?? undefined
}

function parseBinaryExportMetadata(value: unknown): BinaryExportMetadata {
  if (typeof value !== 'object' || value === null) {
    throw new Error('Invalid binary export request')
  }

  const request = value as Partial<BinaryExportMetadata>
  if (
    typeof request.defaultName !== 'string' ||
    request.defaultName.length === 0 ||
    request.defaultName.length > 1024 ||
    !Number.isSafeInteger(request.byteLength) ||
    (request.byteLength ?? -1) < 0 ||
    !Array.isArray(request.filters) ||
    request.filters.length > 16 ||
    !request.filters.every(
      (filter) =>
        typeof filter === 'object' &&
        filter !== null &&
        typeof filter.name === 'string' &&
        filter.name.length <= 256 &&
        Array.isArray(filter.extensions) &&
        filter.extensions.length <= 32 &&
        filter.extensions.every(
          (extension) => typeof extension === 'string' && extension.length <= 32
        )
    )
  ) {
    throw new Error('Invalid binary export request')
  }

  if (request.byteLength! > MAX_BINARY_EXPORT_BYTES) {
    throw new Error('Binary export too large (over 256MB)')
  }

  return request as BinaryExportMetadata
}

function binaryBuffer(content: ArrayBuffer | Uint8Array): Buffer {
  if (Object.prototype.toString.call(content) === '[object ArrayBuffer]') {
    return Buffer.from(content as ArrayBuffer)
  }
  return Buffer.from(content.buffer, content.byteOffset, content.byteLength)
}

function binaryExportBuffer(value: unknown): Buffer | null {
  // Use the intrinsic tag instead of instanceof so a buffer originating in a
  // different V8 realm is still accepted.
  if (Object.prototype.toString.call(value) === '[object ArrayBuffer]') {
    return Buffer.from(value as ArrayBuffer)
  }

  // Electron deserializes binary values received by MessagePortMain as a
  // Uint8Array/Buffer on some release lines even when the renderer posted an
  // ArrayBuffer. Accept any byte view and preserve its exact visible slice.
  if (ArrayBuffer.isView(value)) {
    return Buffer.from(value.buffer, value.byteOffset, value.byteLength)
  }

  return null
}

function receiveBinaryBuffer(port: Electron.MessagePortMain): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const handleClose = (): void => reject(new Error('The binary export was interrupted.'))
    port.once('close', handleClose)
    port.once('message', (message) => {
      port.removeListener('close', handleClose)
      const content = binaryExportBuffer(message.data)
      if (!content) {
        reject(new Error('Invalid binary export payload'))
        return
      }
      resolve(content)
    })
    port.start()
  })
}

function respondOnPort(
  port: Electron.MessagePortMain,
  value: ExportResult | SerializedError
): void {
  try {
    port.postMessage({ type: 'result', value })
  } catch {
    // The renderer may have closed while a save dialog was open.
  } finally {
    port.close()
  }
}

async function pickSavePath(
  win: BrowserWindow | undefined,
  defaultName: string,
  filters: { name: string; extensions: string[] }[]
): Promise<string | null> {
  const options: Electron.SaveDialogOptions = {
    defaultPath: defaultName,
    filters
  }
  const result = win
    ? await dialog.showSaveDialog(win, options)
    : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return null
  return result.filePath
}

/** Render `html` in a hidden window and return the PDF bytes. */
async function renderHtmlToPdf(html: string): Promise<Buffer> {
  // A temp file (not a data: URL) so relative-turned-file:// images resolve —
  // data: origins cannot load file:// subresources.
  const tmpPath = path.join(app.getPath('temp'), `mdvdb-export-${randomUUID()}.html`)
  await fs.writeFile(tmpPath, html, 'utf-8')

  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  try {
    await win.loadFile(tmpPath)
    return await win.webContents.printToPDF({
      printBackground: true,
      margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 },
      pageSize: 'A4'
    })
  } finally {
    win.destroy()
    fs.unlink(tmpPath).catch(() => {})
  }
}

/** Register text, deferred-binary, and PDF export channels. */
export function registerExportHandlers(): void {
  ipcMain.on('export:save-binary', (event, metadata: unknown) => {
    const port = event.ports[0]
    if (!port) return

    void wrap<ExportResult>(async () => {
      const request = parseBinaryExportMetadata(metadata)
      const filePath = await pickSavePath(
        ownerWindow(event.sender),
        request.defaultName,
        request.filters
      )
      if (!filePath) return { saved: false }

      // Ask preload to send the bytes only after the save dialog succeeds;
      // canceled exports never copy the potentially large PNG into main.
      port.postMessage({ type: 'ready' })
      const content = await receiveBinaryBuffer(port)
      if (content.byteLength !== request.byteLength) {
        throw new Error('Binary export payload size did not match its request')
      }

      await fs.writeFile(filePath, content)
      return { saved: true, path: filePath }
    }).then((result) => respondOnPort(port, result))
  })

  ipcMain.handle('export:save', (event, request: ExportSaveRequest) =>
    wrap<ExportResult>(async () => {
      // Binary content (docx/odt/epub zip containers) arrives as a
      // structured-clone Uint8Array; text formats as a string.
      const isBinary = typeof request.content !== 'string'
      const size = isBinary
        ? (request.content as ArrayBuffer | Uint8Array).byteLength
        : Buffer.byteLength(request.content as string, 'utf-8')
      const maxBytes = isBinary ? MAX_BINARY_EXPORT_BYTES : MAX_TEXT_EXPORT_BYTES
      if (size > maxBytes) {
        if (isBinary) throw new Error('Binary export too large (over 256MB)')
        throw new Error('Export too large (over 10MB)')
      }
      const filePath = await pickSavePath(
        ownerWindow(event.sender),
        request.defaultName,
        request.filters
      )
      if (!filePath) return { saved: false }
      if (isBinary) {
        await fs.writeFile(filePath, binaryBuffer(request.content as ArrayBuffer | Uint8Array))
      } else {
        await fs.writeFile(filePath, request.content as string, 'utf-8')
      }
      return { saved: true, path: filePath }
    })
  )

  ipcMain.handle('export:pdf', (event, request: ExportPdfRequest) =>
    wrap<ExportResult>(async () => {
      if (Buffer.byteLength(request.html, 'utf-8') > MAX_TEXT_EXPORT_BYTES) {
        throw new Error('Export too large (over 10MB)')
      }
      const filePath = await pickSavePath(ownerWindow(event.sender), request.defaultName, [
        { name: 'PDF', extensions: ['pdf'] }
      ])
      if (!filePath) return { saved: false }
      const pdf = await renderHtmlToPdf(request.html)
      await fs.writeFile(filePath, pdf)
      return { saved: true, path: filePath }
    })
  )
}
