import type { ChildProcess } from 'node:child_process'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ElectronApplication } from '@playwright/test'

const execFileAsync = promisify(execFile)

function waitForProcessExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true)

  return new Promise((resolve) => {
    const onExit = (): void => {
      clearTimeout(timer)
      resolve(true)
    }
    const timer = setTimeout(() => {
      child.off('exit', onExit)
      resolve(false)
    }, timeoutMs)
    child.once('exit', onExit)
  })
}

/**
 * Close an Electron process without triggering Playwright's Windows debugger
 * deadlock. Playwright launches Electron through cmd.exe on Windows, and its
 * close() call can wait forever for that process tree. Give Electron a brief
 * chance to exit itself, then terminate the test-only process tree if needed.
 */
export async function closeElectronApp(
  electronApp: ElectronApplication | undefined
): Promise<void> {
  if (!electronApp) return
  if (process.platform !== 'win32') {
    await electronApp.close()
    return
  }

  const child = electronApp.process()
  void electronApp
    .evaluate(({ app }) => {
      setImmediate(() => app.exit(0))
    })
    .catch(() => {})

  if (await waitForProcessExit(child, 500)) return

  const pid = child.pid
  if (!pid) throw new Error('Cannot terminate Electron: launched process has no PID')

  await execFileAsync('taskkill', ['/PID', String(pid), '/T', '/F'], {
    windowsHide: true
  }).catch((error: unknown) => {
    if (child.exitCode === null && child.signalCode === null) throw error
  })

  if (!(await waitForProcessExit(child, 5_000))) {
    throw new Error(`Electron process tree ${pid} did not exit after taskkill`)
  }
}
