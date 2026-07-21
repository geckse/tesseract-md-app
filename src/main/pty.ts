/**
 * PtyManager — spawns and manages node-pty processes for embedded terminals.
 *
 * Runs in the main process. Each PTY is owned by the WebContents that created it,
 * so when a window closes, its terminals are cleaned up. On app quit, all PTYs
 * are killed to prevent zombie processes.
 */

import { spawn as ptySpawn, type IPty } from 'node-pty'
import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { WebContents } from 'electron'

import { TerminalSpawnError, TerminalNotFoundError } from './errors'
import { getTerminalShellPath, getTerminalShellArgs } from './store'

/** Options accepted by spawn() */
export interface PtySpawnOpts {
  id: string
  cwd: string
  shell?: string
  args?: string[]
  env?: Record<string, string>
  cols: number
  rows: number
}

/** Info about an active terminal returned by list() */
export interface TerminalInfo {
  id: string
  pid: number
  shell: string
  cwd: string
  status: 'running' | 'exited'
}

/** Internal tracking entry */
interface PtyEntry {
  pty: IPty
  webContents: WebContents
  shell: string
  cwd: string
  status: 'running' | 'exited'
  titlePollTimer: ReturnType<typeof setInterval> | null
  lastTitle: string
  /** Ring buffer of recent output, replayed when the terminal moves windows. */
  scrollback: string[]
  scrollbackBytes: number
}

/** Cap on buffered output per terminal (bytes of UTF-16 code units, roughly). */
const SCROLLBACK_LIMIT = 200_000

/**
 * Presentation overrides from the Electron launch environment must not leak
 * into an interactive PTY. They are commonly set by test runners, package
 * scripts, and headless launchers, and would make child CLIs suppress their
 * ANSI styling despite the PTY advertising true-color support.
 *
 * A caller can still opt into one of these variables explicitly through
 * `PtySpawnOpts.env`; those overrides are merged after inherited values are
 * removed.
 */
const INHERITED_COLOR_OVERRIDES = ['NO_COLOR', 'FORCE_COLOR', 'CLICOLOR', 'NODE_DISABLE_COLORS']

/** Result of spawn() returned to the renderer */
export interface PtySpawnResult {
  pid: number
  shell: string
}

/**
 * Resolve which shell binary to use.
 * Priority: explicit arg > settings override > $SHELL/ComSpec > platform fallback.
 */
export function resolveShell(explicit?: string): { shell: string; args: string[] } {
  const trimmedExplicit = explicit?.trim()
  if (trimmedExplicit) {
    return { shell: trimmedExplicit, args: [] }
  }

  const settingsPath = getTerminalShellPath().trim()
  if (settingsPath) {
    const settingsArgs = getTerminalShellArgs()
      .split(' ')
      .map((a) => a.trim())
      .filter((a) => a.length > 0)
    return { shell: settingsPath, args: settingsArgs }
  }

  if (process.platform === 'win32') {
    return { shell: process.env.ComSpec || 'powershell.exe', args: [] }
  }

  const envShell = process.env.SHELL
  if (envShell) {
    return { shell: envShell, args: [] }
  }

  if (process.platform === 'darwin') {
    return { shell: '/bin/zsh', args: [] }
  }
  return { shell: '/bin/bash', args: [] }
}

/**
 * Build the environment for a new PTY.
 * Inherits process.env, applies terminal-specific overrides, then caller env.
 */
export function buildPtyEnv(cwd: string, extra?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === 'string') env[k] = v
  }
  for (const key of INHERITED_COLOR_OVERRIDES) {
    delete env[key]
  }
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  env.MDVDB_COLLECTION_ROOT = cwd
  if (extra) {
    for (const [k, v] of Object.entries(extra)) {
      env[k] = v
    }
  }
  return env
}

/** Validate that cwd exists and is a directory; falls back to homedir on failure. */
function resolveCwd(cwd: string): string {
  try {
    if (cwd && existsSync(cwd) && statSync(cwd).isDirectory()) {
      return cwd
    }
  } catch {
    // fall through
  }
  return homedir()
}

export class PtyManager {
  private entries: Map<string, PtyEntry> = new Map()

  /** Spawn a new PTY. Throws TerminalSpawnError on failure. */
  spawn(opts: PtySpawnOpts, webContents: WebContents): PtySpawnResult {
    if (this.entries.has(opts.id)) {
      throw new TerminalSpawnError(`Terminal id already exists: ${opts.id}`)
    }

    const { shell, args: defaultArgs } = resolveShell(opts.shell)
    const args = opts.args && opts.args.length > 0 ? opts.args : defaultArgs
    const cwd = resolveCwd(opts.cwd)
    const env = buildPtyEnv(cwd, opts.env)

    let pty: IPty
    try {
      pty = ptySpawn(shell, args, {
        name: 'xterm-256color',
        cols: opts.cols > 0 ? opts.cols : 80,
        rows: opts.rows > 0 ? opts.rows : 24,
        cwd,
        env
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new TerminalSpawnError(`Failed to spawn shell "${shell}": ${message}`)
    }

    const entry: PtyEntry = {
      pty,
      webContents,
      shell,
      cwd,
      status: 'running',
      titlePollTimer: null,
      lastTitle: '',
      scrollback: [],
      scrollbackBytes: 0
    }
    this.entries.set(opts.id, entry)

    // Event closures read entry.webContents (not the spawn parameter) so
    // rebind() can transfer ownership to another window mid-session.
    pty.onData((data) => {
      entry.scrollback.push(data)
      entry.scrollbackBytes += data.length
      while (entry.scrollbackBytes > SCROLLBACK_LIMIT && entry.scrollback.length > 1) {
        entry.scrollbackBytes -= entry.scrollback[0].length
        entry.scrollback.shift()
      }
      if (!entry.webContents.isDestroyed()) {
        entry.webContents.send('terminal:data', { id: opts.id, data })
      }
    })

    pty.onExit(({ exitCode, signal }) => {
      entry.status = 'exited'
      if (entry.titlePollTimer) {
        clearInterval(entry.titlePollTimer)
        entry.titlePollTimer = null
      }
      if (!entry.webContents.isDestroyed()) {
        entry.webContents.send('terminal:exit', { id: opts.id, code: exitCode, signal })
      }
      // Keep entry briefly so renderer can still observe; drop it on next tick
      setTimeout(() => this.entries.delete(opts.id), 0)
    })

    // Poll foreground process title, fire event when it changes.
    entry.titlePollTimer = setInterval(() => {
      try {
        const title = pty.process
        if (title && title !== entry.lastTitle) {
          entry.lastTitle = title
          if (!entry.webContents.isDestroyed()) {
            entry.webContents.send('terminal:title', { id: opts.id, title })
          }
        }
      } catch {
        // node-pty may throw on Windows if process has exited; ignore
      }
    }, 1000)

    return { pid: pty.pid, shell }
  }

  /**
   * Transfer PTY ownership to another window (tab moved/detached). Subsequent
   * output, exit, and title events go to the new WebContents, and window-close
   * cleanup follows it. Returns the buffered scrollback so the adopting
   * renderer can repaint the session.
   */
  rebind(id: string, webContents: WebContents): { scrollback: string; shell: string; cwd: string } {
    const entry = this.entries.get(id)
    if (!entry) throw new TerminalNotFoundError(id)
    entry.webContents = webContents
    return { scrollback: entry.scrollback.join(''), shell: entry.shell, cwd: entry.cwd }
  }

  /** Write stdin data to the PTY. */
  write(id: string, data: string): void {
    const entry = this.entries.get(id)
    if (!entry) throw new TerminalNotFoundError(id)
    entry.pty.write(data)
  }

  /** Resize the PTY window. */
  resize(id: string, cols: number, rows: number): void {
    const entry = this.entries.get(id)
    if (!entry) throw new TerminalNotFoundError(id)
    const c = Math.max(1, Math.floor(cols))
    const r = Math.max(1, Math.floor(rows))
    try {
      entry.pty.resize(c, r)
    } catch {
      // node-pty can throw on resize if process has exited — ignore
    }
  }

  /** Kill a single PTY and drop its entry. */
  dispose(id: string): void {
    const entry = this.entries.get(id)
    if (!entry) return
    if (entry.titlePollTimer) {
      clearInterval(entry.titlePollTimer)
      entry.titlePollTimer = null
    }
    try {
      entry.pty.kill()
    } catch {
      // ignore
    }
    this.entries.delete(id)
  }

  /** Kill all PTYs owned by the given WebContents. */
  disposeByWindow(webContentsId: number): void {
    for (const [id, entry] of this.entries) {
      if (entry.webContents.id === webContentsId) {
        if (entry.titlePollTimer) {
          clearInterval(entry.titlePollTimer)
          entry.titlePollTimer = null
        }
        try {
          entry.pty.kill()
        } catch {
          // ignore
        }
        this.entries.delete(id)
      }
    }
  }

  /** Kill every PTY (call on app quit). */
  disposeAll(): void {
    for (const [, entry] of this.entries) {
      if (entry.titlePollTimer) {
        clearInterval(entry.titlePollTimer)
        entry.titlePollTimer = null
      }
      try {
        entry.pty.kill()
      } catch {
        // ignore
      }
    }
    this.entries.clear()
  }

  /** List all active PTYs. */
  list(): TerminalInfo[] {
    const out: TerminalInfo[] = []
    for (const [id, entry] of this.entries) {
      out.push({
        id,
        pid: entry.pty.pid,
        shell: entry.shell,
        cwd: entry.cwd,
        status: entry.status
      })
    }
    return out
  }

  /** Check if an id is known. */
  has(id: string): boolean {
    return this.entries.has(id)
  }
}
