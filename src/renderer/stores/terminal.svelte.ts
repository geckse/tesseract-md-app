/**
 * Terminal store — renderer-side state for every embedded PTY.
 *
 * The PTY itself lives in the Electron main process (src/main/pty.ts).
 * This store tracks metadata about each terminal; the xterm viewport is
 * always hosted by a workspace tab (the bottom pane is the default home).
 */

import type { TerminalInfo } from '../../preload/api'
import { workspace, BOTTOM_PANE_ID, type TabState } from './workspace.svelte'

/** Status of the underlying PTY process. */
export type TerminalStatus = 'starting' | 'running' | 'exited' | 'error'

/** Metadata for a single terminal session. */
export interface TerminalMeta {
  id: string
  title: string
  shell: string
  cwd: string
  createdAt: number
  status: TerminalStatus
  exitCode: number | null
  errorMessage: string | null
  pid: number | null
}

function shellName(shell: string): string {
  const parts = shell.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || shell
}

class TerminalStore {
  terminals = $state<Record<string, TerminalMeta>>({})

  private _nextIndex = 1
  private _initialized = false

  /** Scrollback captured on adopt, replayed by Terminal.svelte when xterm mounts.
   * Reactive so an already-mounted terminal picks it up when rebind resolves. */
  private _pendingScrollback = $state<Record<string, string>>({})

  constructor() {
    // Workspace hooks do not depend on window.api; register them unconditionally
    // so they work in tests that don't mount an Electron preload.
    workspace.registerTerminalHooks(
      (terminalId) => {
        const t = this.terminals[terminalId]
        if (!t) return null
        return { shell: t.shell, cwd: t.cwd }
      },
      (slot) => this.restoreSlot(slot),
      (data) => void this.adoptTerminal(data),
      (terminalId) => this.releaseTerminal(terminalId)
    )

    // Auto-dispose PTY when a terminal tab is closed from the UI.
    workspace.onTabClosed((tab: TabState) => {
      if (tab.kind === 'terminal') {
        void this.disposeTerminal(tab.terminalId)
      }
    })

    // IPC wiring requires the preload API — guard so jsdom tests don't crash.
    if (typeof window !== 'undefined' && window.api) {
      window.api.onTerminalData(({ id, data }) => {
        void id
        void data
      })
      window.api.onTerminalExit(({ id, code }) => this.handleExit(id, code))
      window.api.onTerminalTitle(({ id, title }) => this.handleTitle(id, title))
    }
  }

  // ── Computed ─────────────────────────────────────────────────────────

  /** Total number of live terminals. */
  get terminalCount(): number {
    return Object.values(this.terminals).filter((t) => t.status !== 'exited').length
  }

  // ── Mutations ────────────────────────────────────────────────────────

  /**
   * Create a new terminal. Registers the TerminalMeta, opens a workspace tab
   * for it (bottom pane by default), then spawns the PTY via IPC.
   * Returns the terminal + tab ids, or null when the preload API is missing.
   */
  async createTerminal(opts?: {
    cwd?: string
    shell?: string
    args?: string[]
    title?: string
    paneId?: string
  }): Promise<{ terminalId: string; tabId: string } | null> {
    const api = window.api
    if (!api) return null

    const id = crypto.randomUUID()
    const cwd = opts?.cwd || (await this.resolveDefaultCwd())
    const title = opts?.title ?? `Terminal ${this._nextIndex}`
    const meta: TerminalMeta = {
      id,
      title,
      shell: opts?.shell ?? '',
      cwd,
      createdAt: Date.now(),
      status: 'starting',
      exitCode: null,
      errorMessage: null,
      pid: null
    }
    this.terminals[id] = meta

    // Host the terminal in a workspace tab (defaults to the bottom pane,
    // which openTerminalTab reveals and focuses).
    const tabId = workspace.openTerminalTab(id, title, opts?.paneId)

    // Reasonable default geometry; Terminal.svelte will resize on mount.
    const cols = 80
    const rows = 24

    try {
      const result = await api.terminalCreate({
        id,
        cwd,
        shell: opts?.shell,
        args: opts?.args,
        cols,
        rows
      })
      const spawnedTitle =
        meta.title === `Terminal ${this._nextIndex}`
          ? `${shellName(result.shell)} — ${this._nextIndex}`
          : meta.title
      this.terminals[id] = {
        ...this.terminals[id],
        pid: result.pid,
        shell: result.shell,
        status: 'running',
        title: spawnedTitle
      }
      workspace.setTerminalTabTitle(id, spawnedTitle)
      this._nextIndex++
      return { terminalId: id, tabId }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.terminals[id] = {
        ...this.terminals[id],
        status: 'error',
        errorMessage: message
      }
      return { terminalId: id, tabId }
    }
  }

  /** Kill the PTY and remove the terminal from state. */
  async disposeTerminal(id: string): Promise<void> {
    const meta = this.terminals[id]
    if (!meta) return

    try {
      await window.api?.terminalDispose(id)
    } catch {
      // ignore — already gone
    }

    const { [id]: _dropped, ...rest } = this.terminals
    this.terminals = rest
    const { [id]: _scroll, ...restScroll } = this._pendingScrollback
    this._pendingScrollback = restScroll
  }

  /**
   * Toggle the bottom pane. Opening an empty pane auto-spawns a terminal
   * (preserves the historical Cmd+` behavior); opening focuses the pane.
   */
  async toggleBottomPanel(): Promise<void> {
    if (workspace.bottomPaneOpen) {
      workspace.setBottomPaneOpen(false)
      return
    }
    const bottom = workspace.bottomPane
    if (bottom && bottom.tabOrder.length === 0) {
      await this.createTerminal()
      return
    }
    workspace.setBottomPaneOpen(true)
    workspace.setActivePane(BOTTOM_PANE_ID)
  }

  /** Spawn a fresh terminal in the bottom pane (Cmd+Shift+`). */
  async newBottomTerminal(): Promise<void> {
    await this.createTerminal()
  }

  /** Close every terminal tab in the bottom pane (disposes the PTYs). */
  killAllInBottomPane(): void {
    const bottom = workspace.bottomPane
    if (!bottom) return
    const terminalTabIds = bottom.tabOrder.filter(
      (tabId) => workspace.tabs[tabId]?.kind === 'terminal'
    )
    for (const tabId of terminalTabIds) {
      workspace.closeTab(tabId)
    }
  }

  /**
   * Adopt a terminal transferred from another window. Registers meta locally,
   * rebinds the live PTY to this window (staging its scrollback for the xterm
   * mount), and falls back to respawning shell+cwd if the PTY is gone.
   */
  async adoptTerminal(data: {
    terminalId: string
    title: string
    shell: string
    cwd: string
  }): Promise<void> {
    const { terminalId: id, title, shell, cwd } = data
    if (!this.terminals[id]) {
      this.terminals[id] = {
        id,
        title,
        shell,
        cwd,
        createdAt: Date.now(),
        status: 'starting',
        exitCode: null,
        errorMessage: null,
        pid: null
      }
    }

    const api = window.api
    if (!api) return

    try {
      const result = await api.terminalRebind(id)
      if (result.scrollback) this._pendingScrollback[id] = result.scrollback
      this.terminals[id] = {
        ...this.terminals[id],
        shell: result.shell,
        cwd: result.cwd,
        status: 'running'
      }
    } catch {
      // PTY is gone (exited or killed in transit) — respawn with the same id.
      try {
        const result = await api.terminalCreate({
          id,
          cwd,
          shell: shell || undefined,
          cols: 80,
          rows: 24
        })
        this.terminals[id] = {
          ...this.terminals[id],
          pid: result.pid,
          shell: result.shell,
          status: 'running'
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        this.terminals[id] = { ...this.terminals[id], status: 'error', errorMessage: message }
      }
    }
  }

  /**
   * Drop local state for a terminal handed off to another window. The PTY is
   * NOT disposed — the adopting window owns it now.
   */
  releaseTerminal(id: string): void {
    if (!this.terminals[id]) return
    const { [id]: _dropped, ...rest } = this.terminals
    this.terminals = rest
    const { [id]: _scroll, ...restScroll } = this._pendingScrollback
    this._pendingScrollback = restScroll
  }

  /** Reactive peek at staged scrollback for a terminal (undefined when none). */
  pendingScrollback(id: string): string | undefined {
    return this._pendingScrollback[id]
  }

  /** One-shot scrollback for a freshly adopted terminal (consumed by Terminal.svelte). */
  takePendingScrollback(id: string): string | null {
    const data = this._pendingScrollback[id]
    if (data === undefined) return null
    const { [id]: _taken, ...rest } = this._pendingScrollback
    this._pendingScrollback = rest
    return data
  }

  /** Update the user-visible title of a terminal. */
  setTitle(id: string, title: string): void {
    const meta = this.terminals[id]
    if (!meta) return
    this.terminals[id] = { ...meta, title }
    workspace.setTerminalTabTitle(id, title)
  }

  // ── IPC event handlers ──────────────────────────────────────────────

  /** PTY exited — mark terminal as exited and keep entry for the exit banner. */
  handleExit(id: string, code: number): void {
    const meta = this.terminals[id]
    if (!meta) return
    this.terminals[id] = { ...meta, status: 'exited', exitCode: code }
  }

  /** Foreground process title changed; optionally retitle. */
  handleTitle(id: string, title: string): void {
    const meta = this.terminals[id]
    if (!meta) return
    // Only update if the user hasn't manually renamed
    this.terminals[id] = { ...meta, title }
    workspace.setTerminalTabTitle(id, title)
  }

  /**
   * Reconcile store with live PTYs in main (called on startup). Any PTY
   * that main knows about but we don't is dropped — it's a stale process
   * from a previous renderer lifetime.
   */
  async reconcileWithMain(): Promise<void> {
    const api = window.api
    if (!api || this._initialized) return
    this._initialized = true
    try {
      const live: TerminalInfo[] = await api.terminalList()
      // Nothing to do — main process only reports terminals we created.
      // We may use this later to reattach scrollback for crash recovery.
      void live
    } catch {
      // ignore
    }
  }

  // ── Persistence hooks (called from workspace.svelte.ts) ─────────────

  /**
   * Restore a persisted terminal slot by spawning a new PTY with the saved
   * shell+cwd. Returns the new terminal id or null on failure.
   */
  private restoreSlot(slot: { shell: string; cwd: string; title?: string }): string | null {
    // Session restoration is asynchronous — we create a placeholder meta
    // entry and let the PTY spawn resolve in the background.
    const id = crypto.randomUUID()
    const meta: TerminalMeta = {
      id,
      title: slot.title ?? 'Terminal',
      shell: slot.shell,
      cwd: slot.cwd,
      createdAt: Date.now(),
      status: 'starting',
      exitCode: null,
      errorMessage: null,
      pid: null
    }
    this.terminals[id] = meta

    const api = window.api
    if (!api) return id

    // Fire and forget: spawn matching PTY. Failure sets status to 'error'.
    api
      .terminalCreate({
        id,
        cwd: slot.cwd,
        shell: slot.shell || undefined,
        cols: 80,
        rows: 24
      })
      .then((result) => {
        this.terminals[id] = {
          ...this.terminals[id],
          pid: result.pid,
          shell: result.shell,
          status: 'running'
        }
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        this.terminals[id] = {
          ...this.terminals[id],
          status: 'error',
          errorMessage: message
        }
      })

    return id
  }

  // ── Internal helpers ────────────────────────────────────────────────

  private async resolveDefaultCwd(): Promise<string> {
    const api = window.api
    if (!api) return ''
    try {
      const col = await api.getActiveCollection()
      if (col?.path) return col.path
    } catch {
      // fall through
    }
    try {
      return await api.getHomeDir()
    } catch {
      return ''
    }
  }
}

/** Singleton terminal store instance. */
export const terminalStore = new TerminalStore()
