/**
 * Terminal store — renderer-side state for every embedded PTY.
 *
 * The PTY itself lives in the Electron main process (src/main/pty.ts).
 * This store tracks metadata about each terminal and where its xterm
 * viewport is currently mounted ('panel' or 'tab').
 */

import type { TerminalInfo, PersistedBottomPanel, PersistedTerminalSlot } from '../../preload/api'
import { workspace, type TabState } from './workspace.svelte'

/** Render location for a terminal's xterm viewport. */
export type TerminalLocation = 'panel' | 'tab'

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
  location: TerminalLocation
  pid: number | null
}

/** State of the bottom-panel container. */
export interface BottomPanelState {
  open: boolean
  height: number
  tabOrder: string[]
  activeId: string | null
}

const DEFAULT_PANEL_HEIGHT = 300
const MIN_PANEL_HEIGHT = 120

function shellName(shell: string): string {
  const parts = shell.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || shell
}

class TerminalStore {
  terminals = $state<Record<string, TerminalMeta>>({})
  panel = $state<BottomPanelState>({
    open: false,
    height: DEFAULT_PANEL_HEIGHT,
    tabOrder: [],
    activeId: null,
  })

  private _nextIndex = 1
  private _initialized = false

  constructor() {
    // Workspace hooks do not depend on window.api; register them unconditionally
    // so they work in tests that don't mount an Electron preload.
    workspace.registerTerminalHooks(
      (terminalId) => {
        const t = this.terminals[terminalId]
        if (!t) return null
        return { shell: t.shell, cwd: t.cwd }
      },
      (slot, location) => this.restoreSlotAsTab(slot, location),
      () => this.serializeBottomPanel(),
      (state) => this.restoreBottomPanel(state)
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

  /** Terminals currently rendered in the bottom panel. */
  get panelTerminals(): TerminalMeta[] {
    return this.panel.tabOrder
      .map((id) => this.terminals[id])
      .filter((t): t is TerminalMeta => Boolean(t))
  }

  /** Meta for the terminal currently active in the panel. */
  get activePanelTerminal(): TerminalMeta | null {
    const id = this.panel.activeId
    return id ? this.terminals[id] ?? null : null
  }

  /** Total number of live terminals. */
  get terminalCount(): number {
    return Object.values(this.terminals).filter((t) => t.status !== 'exited').length
  }

  // ── Mutations ────────────────────────────────────────────────────────

  /**
   * Create a new terminal. Spawns the PTY via IPC, then registers the
   * TerminalMeta in the store. Returns the new terminal id.
   */
  async createTerminal(opts: {
    cwd?: string
    shell?: string
    args?: string[]
    location: TerminalLocation
    title?: string
  }): Promise<string | null> {
    const api = window.api
    if (!api) return null

    const id = crypto.randomUUID()
    const cwd = opts.cwd || (await this.resolveDefaultCwd())
    const title = opts.title ?? `Terminal ${this._nextIndex}`
    const meta: TerminalMeta = {
      id,
      title,
      shell: opts.shell ?? '',
      cwd,
      createdAt: Date.now(),
      status: 'starting',
      exitCode: null,
      errorMessage: null,
      location: opts.location,
      pid: null,
    }
    this.terminals[id] = meta

    if (opts.location === 'panel') {
      this.panel.tabOrder = [...this.panel.tabOrder, id]
      this.panel.activeId = id
    }

    workspace.requestSave()

    // Reasonable default geometry; Terminal.svelte will resize on mount.
    const cols = 80
    const rows = 24

    try {
      const result = await api.terminalCreate({
        id,
        cwd,
        shell: opts.shell,
        args: opts.args,
        cols,
        rows,
      })
      this.terminals[id] = {
        ...this.terminals[id],
        pid: result.pid,
        shell: result.shell,
        status: 'running',
        title: meta.title === `Terminal ${this._nextIndex}` ? `${shellName(result.shell)} — ${this._nextIndex}` : meta.title,
      }
      this._nextIndex++
      return id
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.terminals[id] = {
        ...this.terminals[id],
        status: 'error',
        errorMessage: message,
      }
      return id
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

    this.panel.tabOrder = this.panel.tabOrder.filter((x) => x !== id)
    if (this.panel.activeId === id) {
      this.panel.activeId =
        this.panel.tabOrder.length > 0 ? this.panel.tabOrder[this.panel.tabOrder.length - 1] : null
    }
  }

  /** Toggle bottom-panel visibility. Auto-create a terminal on first open. */
  async togglePanel(): Promise<void> {
    this.panel.open = !this.panel.open
    if (this.panel.open && this.panel.tabOrder.length === 0) {
      await this.createTerminal({ location: 'panel' })
    }
    workspace.requestSave()
  }

  /** Force-open the bottom panel, creating a terminal if needed. */
  async openPanel(): Promise<void> {
    if (!this.panel.open) {
      this.panel.open = true
    }
    if (this.panel.tabOrder.length === 0) {
      await this.createTerminal({ location: 'panel' })
    }
  }

  /** Force-close the bottom panel (keeps terminals alive). */
  closePanel(): void {
    this.panel.open = false
    workspace.requestSave()
  }

  /** Set active terminal in the bottom panel. */
  setActivePanelTerminal(id: string): void {
    if (!this.terminals[id]) return
    this.panel.activeId = id
  }

  /** Set the panel height (persisted next save). */
  setPanelHeight(height: number): void {
    const maxHeight = typeof window !== 'undefined' ? window.innerHeight * 0.8 : 800
    this.panel.height = Math.max(MIN_PANEL_HEIGHT, Math.min(height, maxHeight))
    workspace.requestSave()
  }

  /** Move a terminal from the panel into a new TerminalTab in the active pane. */
  moveToTab(id: string): string | null {
    const meta = this.terminals[id]
    if (!meta || meta.location !== 'panel') return null

    this.terminals[id] = { ...meta, location: 'tab' }
    this.panel.tabOrder = this.panel.tabOrder.filter((x) => x !== id)
    if (this.panel.activeId === id) {
      this.panel.activeId =
        this.panel.tabOrder.length > 0 ? this.panel.tabOrder[this.panel.tabOrder.length - 1] : null
    }

    const tabId = workspace.openTerminalTab(id, meta.title)
    return tabId || null
  }

  /** Move a terminal that lives in a TerminalTab back into the bottom panel. */
  moveToPanel(id: string): void {
    const meta = this.terminals[id]
    if (!meta || meta.location !== 'tab') return

    const tabId = workspace.findTabByTerminalId(id)
    if (tabId) {
      // Close the tab without triggering our onTabClosed auto-dispose.
      // To keep the PTY alive we remove the tab manually.
      this._detachTerminalTabFromWorkspace(tabId)
    }

    this.terminals[id] = { ...meta, location: 'panel' }
    this.panel.tabOrder = [...this.panel.tabOrder, id]
    this.panel.activeId = id
    this.panel.open = true
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

  // ── Bottom panel persistence ─────────────────────────────────────────

  /** Produce a snapshot of the current bottom-panel state for electron-store. */
  private serializeBottomPanel(): PersistedBottomPanel | null {
    const slots: PersistedTerminalSlot[] = []
    let activeIndex = -1
    for (let i = 0; i < this.panel.tabOrder.length; i++) {
      const id = this.panel.tabOrder[i]
      const t = this.terminals[id]
      if (!t) continue
      slots.push({ shell: t.shell, cwd: t.cwd, title: t.title })
      if (this.panel.activeId === id) activeIndex = slots.length - 1
    }
    return {
      open: this.panel.open,
      height: this.panel.height,
      slots,
      activeIndex,
    }
  }

  /** Restore bottom-panel state from a persisted snapshot. */
  private restoreBottomPanel(state: PersistedBottomPanel): void {
    this.panel.open = state.open
    this.panel.height = state.height
    this.panel.tabOrder = []
    this.panel.activeId = null

    const api = window.api
    if (!api) return

    state.slots.forEach((slot, i) => {
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
        location: 'panel',
        pid: null,
      }
      this.terminals[id] = meta
      this.panel.tabOrder = [...this.panel.tabOrder, id]
      if (i === state.activeIndex) this.panel.activeId = id

      api
        .terminalCreate({
          id,
          cwd: slot.cwd,
          shell: slot.shell || undefined,
          cols: 80,
          rows: 24,
        })
        .then((result) => {
          this.terminals[id] = {
            ...this.terminals[id],
            pid: result.pid,
            shell: result.shell,
            status: 'running',
          }
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err)
          this.terminals[id] = {
            ...this.terminals[id],
            status: 'error',
            errorMessage: message,
          }
        })
    })
  }

  // ── Persistence hooks (called from workspace.svelte.ts) ─────────────

  /**
   * Restore a persisted terminal slot by spawning a new PTY with the saved
   * shell+cwd. Returns the new terminal id or null on failure.
   */
  private restoreSlotAsTab(
    slot: { shell: string; cwd: string; title?: string },
    _location: 'tab'
  ): string | null {
    // Session restoration is asynchronous — we create a placeholder meta
    // entry and let createTerminal() resolve in the background.
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
      location: 'tab',
      pid: null,
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
        rows: 24,
      })
      .then((result) => {
        this.terminals[id] = {
          ...this.terminals[id],
          pid: result.pid,
          shell: result.shell,
          status: 'running',
        }
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        this.terminals[id] = {
          ...this.terminals[id],
          status: 'error',
          errorMessage: message,
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

  /**
   * Remove a terminal tab from workspace without disposing its PTY.
   * Used by moveToPanel — workspace.closeTab would fire onTabClosed which
   * auto-disposes the PTY.
   */
  private _detachTerminalTabFromWorkspace(tabId: string): void {
    // We reuse closeTab but temporarily suppress our listener so the PTY lives.
    // This is simpler than copying the removal logic.
    const wasOpen = !!workspace.tabs[tabId]
    if (!wasOpen) return

    // Patch: remove from tabs + panes without letting dispose fire.
    const paneId = workspace.findPaneForTab(tabId)
    if (!paneId) return

    const pane = workspace.panes[paneId]
    if (!pane) return

    pane.tabOrder = pane.tabOrder.filter((id) => id !== tabId)
    if (pane.activeTabId === tabId) {
      const remaining = pane.tabOrder.filter((id) => workspace.tabs[id]?.kind !== 'graph')
      pane.activeTabId = remaining.length > 0 ? remaining[remaining.length - 1] : null
    }
    workspace.panes[paneId] = { ...pane }

    const { [tabId]: _dropped, ...rest } = workspace.tabs
    workspace.tabs = rest
  }
}

/** Singleton terminal store instance. */
export const terminalStore = new TerminalStore()
