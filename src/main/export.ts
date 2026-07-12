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

/** Guard against runaway payloads (matches the CLI bridge's 10MB buffer). */
const MAX_EXPORT_BYTES = 10 * 1024 * 1024

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

/** Register `export:save` and `export:pdf`. Called from registerIpcHandlers. */
export function registerExportHandlers(): void {
  ipcMain.handle('export:save', (event, request: ExportSaveRequest) =>
    wrap<ExportResult>(async () => {
      // Binary content (docx/odt/epub zip containers) arrives as a
      // structured-clone Uint8Array; text formats as a string.
      const isBinary = typeof request.content !== 'string'
      const size = isBinary
        ? (request.content as Uint8Array).byteLength
        : Buffer.byteLength(request.content as string, 'utf-8')
      if (size > MAX_EXPORT_BYTES) {
        throw new Error('Export too large (over 10MB)')
      }
      const filePath = await pickSavePath(
        ownerWindow(event.sender),
        request.defaultName,
        request.filters
      )
      if (!filePath) return { saved: false }
      if (isBinary) {
        await fs.writeFile(filePath, Buffer.from(request.content as Uint8Array))
      } else {
        await fs.writeFile(filePath, request.content as string, 'utf-8')
      }
      return { saved: true, path: filePath }
    })
  )

  ipcMain.handle('export:pdf', (event, request: ExportPdfRequest) =>
    wrap<ExportResult>(async () => {
      if (Buffer.byteLength(request.html, 'utf-8') > MAX_EXPORT_BYTES) {
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
