import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, waitFor } from '@testing-library/svelte'

// ── Fake xterm modules (Terminal.svelte lazy-imports them) ───────────────

class FakeXTerm {
  static instances: FakeXTerm[] = []
  writes: string[] = []
  options: Record<string, unknown> = {}
  cols = 80
  rows = 24
  constructor(_opts?: unknown) {
    FakeXTerm.instances.push(this)
  }
  open(_el: HTMLElement): void {}
  loadAddon(_addon: unknown): void {}
  onData(_cb: (data: string) => void): void {}
  onResize(_cb: (size: { cols: number; rows: number }) => void): void {}
  write(data: string): void {
    this.writes.push(data)
  }
  focus(): void {}
  dispose(): void {}
}

vi.mock('@xterm/xterm', () => ({ Terminal: FakeXTerm }))
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit(): void {}
  }
}))
vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: class {
    constructor(_cb: unknown) {}
  }
}))
vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class {
    constructor() {
      throw new Error('no webgl in jsdom')
    }
  }
}))
vi.mock('@xterm/xterm/css/xterm.css', () => ({}))

// ── window.api mock (before store/component imports) ─────────────────────

const mockApi = {
  terminalRebind: vi.fn(),
  terminalCreate: vi.fn().mockResolvedValue({ pid: 1, shell: '/bin/zsh' }),
  terminalDispose: vi.fn().mockResolvedValue(undefined),
  terminalWrite: vi.fn().mockResolvedValue(undefined),
  terminalResize: vi.fn().mockResolvedValue(undefined),
  terminalList: vi.fn().mockResolvedValue([]),
  onTerminalData: vi.fn(),
  onTerminalExit: vi.fn(),
  onTerminalTitle: vi.fn(),
  removeTerminalDataListener: vi.fn(),
  removeTerminalExitListener: vi.fn(),
  removeTerminalTitleListener: vi.fn(),
  openPath: vi.fn().mockResolvedValue(undefined),
  getActiveCollection: vi.fn().mockResolvedValue(null),
  getHomeDir: vi.fn().mockResolvedValue('/home/user'),
  saveWindowSession: vi.fn().mockResolvedValue(undefined),
  getWindowSession: vi.fn().mockResolvedValue(null)
}
;(globalThis as unknown as { window: Window & { api: typeof mockApi } }).window.api = mockApi

import Terminal from '@renderer/components/Terminal.svelte'
import { terminalStore, type TerminalMeta } from '@renderer/stores/terminal.svelte'

function meta(id: string, status: TerminalMeta['status']): TerminalMeta {
  return {
    id,
    title: 'zsh',
    shell: '/bin/zsh',
    cwd: '/proj',
    createdAt: 0,
    status,
    exitCode: null,
    errorMessage: null,
    pid: 1
  }
}

describe('Terminal rebind-on-mount', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    FakeXTerm.instances = []
    terminalStore.terminals = {}
  })

  it('repaints a running session from the main-process scrollback on mount', async () => {
    terminalStore.terminals['t-1'] = meta('t-1', 'running')
    mockApi.terminalRebind.mockResolvedValue({
      scrollback: 'RING_BUFFER_CONTENT',
      shell: '/bin/zsh',
      cwd: '/proj'
    })

    render(Terminal, { props: { terminalId: 't-1' } })

    await waitFor(() => {
      expect(mockApi.terminalRebind).toHaveBeenCalledWith('t-1')
    })
    await waitFor(() => {
      expect(FakeXTerm.instances[0]?.writes.join('')).toContain('RING_BUFFER_CONTENT')
    })
  })

  it('skips the mount rebind when adopt already staged scrollback', async () => {
    // Simulate a cross-window adopt: rebind resolves and stages scrollback.
    mockApi.terminalRebind.mockResolvedValue({
      scrollback: 'STAGED_BY_ADOPT',
      shell: '/bin/zsh',
      cwd: '/proj'
    })
    await terminalStore.adoptTerminal({
      terminalId: 't-2',
      title: 'zsh',
      shell: '/bin/zsh',
      cwd: '/proj'
    })
    expect(mockApi.terminalRebind).toHaveBeenCalledTimes(1)

    render(Terminal, { props: { terminalId: 't-2' } })

    // The staged scrollback is replayed exactly once by the reactive effect…
    await waitFor(() => {
      expect(FakeXTerm.instances[0]?.writes.join('')).toContain('STAGED_BY_ADOPT')
    })
    const replayed = FakeXTerm.instances[0].writes.filter((w) => w.includes('STAGED_BY_ADOPT'))
    expect(replayed).toHaveLength(1)
    // …and the mount path did NOT issue a second rebind
    expect(mockApi.terminalRebind).toHaveBeenCalledTimes(1)
  })

  it('does not rebind terminals that are still starting or already exited', async () => {
    terminalStore.terminals['t-3'] = meta('t-3', 'starting')
    terminalStore.terminals['t-4'] = meta('t-4', 'exited')

    render(Terminal, { props: { terminalId: 't-3' } })
    render(Terminal, { props: { terminalId: 't-4' } })

    // Give both mounts a chance to run their async body
    await new Promise((r) => setTimeout(r, 20))
    expect(mockApi.terminalRebind).not.toHaveBeenCalled()
  })
})
