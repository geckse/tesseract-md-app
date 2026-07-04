/**
 * IPC handlers for terminal:* channels.
 *
 * Each handler validates input, dispatches to the PtyManager, and
 * serializes errors with wrapHandler for transport across IPC.
 */

import { ipcMain } from 'electron'

import { wrapHandler } from './ipc-handlers'
import type { PtyManager, PtySpawnOpts, PtySpawnResult, TerminalInfo } from './pty'

/** Register all terminal:* IPC handlers. Must be called once from app init. */
export function registerTerminalHandlers(ptyManager: PtyManager): void {
  ipcMain.handle('terminal:create', (event, opts: PtySpawnOpts) =>
    wrapHandler(async (): Promise<PtySpawnResult> => {
      return ptyManager.spawn(opts, event.sender)
    })
  )

  ipcMain.handle('terminal:write', (_event, payload: { id: string; data: string }) =>
    wrapHandler(async () => {
      ptyManager.write(payload.id, payload.data)
    })
  )

  ipcMain.handle('terminal:resize', (_event, payload: { id: string; cols: number; rows: number }) =>
    wrapHandler(async () => {
      ptyManager.resize(payload.id, payload.cols, payload.rows)
    })
  )

  ipcMain.handle('terminal:dispose', (_event, payload: { id: string }) =>
    wrapHandler(async () => {
      ptyManager.dispose(payload.id)
    })
  )

  ipcMain.handle('terminal:list', () =>
    wrapHandler(async (): Promise<TerminalInfo[]> => {
      return ptyManager.list()
    })
  )

  // Adopt a PTY into the calling window (terminal tab moved across windows).
  // Returns buffered scrollback so the adopting renderer can repaint.
  ipcMain.handle('terminal:rebind', (event, payload: { id: string }) =>
    wrapHandler(async () => {
      return ptyManager.rebind(payload.id, event.sender)
    })
  )
}
