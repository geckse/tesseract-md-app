<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { terminalStore } from '../stores/terminal.svelte'
  import { getTerminalTheme } from '../lib/terminal-theme'
  import type { TerminalDataPayload, TerminalExitPayload, TerminalTitlePayload } from '../../preload/api'

  interface Props {
    terminalId: string
    fontSize?: number
    onready?: () => void
  }

  const { terminalId, fontSize: fontSizeProp, onready }: Props = $props()

  let containerEl: HTMLDivElement | undefined = $state()
  // Use $state.raw so Svelte does not deeply proxy the xterm object.
  let term = $state.raw<import('@xterm/xterm').Terminal | null>(null)
  let fitAddon = $state.raw<import('@xterm/addon-fit').FitAddon | null>(null)
  let ready = $state(false)
  let loadError = $state<string | null>(null)

  let resizeObserver: ResizeObserver | null = null
  let fitRafId: number | null = null
  let onDataListener: ((payload: TerminalDataPayload) => void) | null = null
  let onExitListener: ((payload: TerminalExitPayload) => void) | null = null
  let onTitleListener: ((payload: TerminalTitlePayload) => void) | null = null

  const meta = $derived(terminalStore.terminals[terminalId])
  const effectiveFontSize = $derived(fontSizeProp ?? 14)

  async function mountTerminal(): Promise<void> {
    if (!containerEl) return
    try {
      // Lazy-load so xterm doesn't bloat the main bundle
      const [{ Terminal: XTerm }, { FitAddon }, { WebLinksAddon }, webglMod] = await Promise.all([
        import('@xterm/xterm'),
        import('@xterm/addon-fit'),
        import('@xterm/addon-web-links'),
        import('@xterm/addon-webgl').catch(() => null),
      ])
      await import('@xterm/xterm/css/xterm.css')

      // xterm measures the character cell by assigning fontFamily to a canvas
      // `ctx.font`, which cannot parse CSS `var()`. Resolve the variable to a
      // concrete stack, and wait for the webfont to load before measuring so
      // the cell geometry matches the rendered glyphs (otherwise letters render
      // with wide, misaligned spacing from a proportional fallback).
      const resolvedMono =
        getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim() ||
        '"JetBrains Mono", ui-monospace, Menlo, monospace'
      try {
        // Force the webfont to load so fonts.ready actually waits for it
        // (it resolves immediately if nothing has requested the font yet).
        await document.fonts.load(`${effectiveFontSize}px ${resolvedMono}`).catch(() => {})
        await document.fonts.ready
      } catch {
        // Font loading API unavailable — proceed with whatever is available
      }

      const xterm = new XTerm({
        cursorBlink: false,
        cursorStyle: 'block',
        macOptionIsMeta: true,
        allowTransparency: false,
        fontSize: effectiveFontSize,
        fontFamily: resolvedMono,
        theme: getTerminalTheme(),
        scrollback: 10000,
        screenReaderMode: false,
      })

      const fit = new FitAddon()
      xterm.loadAddon(fit)

      const links = new WebLinksAddon((event, uri) => {
        event.preventDefault()
        window.api?.openPath(uri).catch(() => {
          // Ignore — not inside a known collection; silently noop
        })
      })
      xterm.loadAddon(links)

      xterm.open(containerEl)

      // Attempt WebGL for perf; fall back to canvas on context loss
      if (webglMod?.WebglAddon) {
        try {
          const webgl = new webglMod.WebglAddon()
          webgl.onContextLoss(() => webgl.dispose())
          xterm.loadAddon(webgl)
        } catch {
          // Canvas renderer fallback — no action required
        }
      }

      try {
        fit.fit()
      } catch {
        // Fit can throw on tiny containers — ignore once; ResizeObserver will retry
      }

      // Wire stdin
      xterm.onData((data) => {
        window.api?.terminalWrite(terminalId, data).catch(() => {
          // Best-effort; if PTY died the exit event will render the banner
        })
      })

      // Wire resize → PTY
      xterm.onResize(({ cols, rows }) => {
        window.api?.terminalResize(terminalId, cols, rows).catch(() => {
          // ignore
        })
      })

      // Subscribe to main → renderer events for this id
      onDataListener = ({ id, data }) => {
        if (id !== terminalId) return
        xterm.write(data)
      }
      onExitListener = ({ id, code }) => {
        if (id !== terminalId) return
        terminalStore.handleExit(id, code)
        const label = `\r\n\x1b[2m[process exited with code ${code}]\x1b[0m\r\n`
        xterm.write(label)
      }
      onTitleListener = ({ id, title }) => {
        if (id !== terminalId) return
        terminalStore.handleTitle(id, title)
      }
      window.api?.onTerminalData(onDataListener)
      window.api?.onTerminalExit(onExitListener)
      window.api?.onTerminalTitle(onTitleListener)

      // ResizeObserver — debounced to a single rAF tick
      resizeObserver = new ResizeObserver(() => {
        if (fitRafId != null) return
        fitRafId = requestAnimationFrame(() => {
          fitRafId = null
          try {
            fit.fit()
          } catch {
            // ignore fit failures
          }
        })
      })
      resizeObserver.observe(containerEl)

      term = xterm
      fitAddon = fit
      ready = true
      onready?.()

      // Push the freshly measured geometry to the PTY so the initial output
      // renders with accurate columns/rows.
      try {
        window.api?.terminalResize(terminalId, xterm.cols, xterm.rows).catch(() => {})
      } catch {
        // ignore
      }

      // Focus the terminal so typing immediately works.
      xterm.focus()
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err)
    }
  }

  function focus(): void {
    term?.focus()
  }

  function fitNow(): void {
    try {
      fitAddon?.fit()
    } catch {
      // ignore
    }
  }

  // Public API for parents (BottomPanel, TabPane)
  export { focus, fitNow }

  onMount(() => {
    void mountTerminal()
  })

  onDestroy(() => {
    if (fitRafId != null) {
      cancelAnimationFrame(fitRafId)
      fitRafId = null
    }
    resizeObserver?.disconnect()
    resizeObserver = null

    if (onDataListener) window.api?.removeTerminalDataListener(onDataListener)
    if (onExitListener) window.api?.removeTerminalExitListener(onExitListener)
    if (onTitleListener) window.api?.removeTerminalTitleListener(onTitleListener)
    onDataListener = null
    onExitListener = null
    onTitleListener = null

    term?.dispose()
    term = null
    fitAddon = null
  })

  // Rewire theme + font size if tokens or settings change
  $effect(() => {
    if (!term) return
    term.options.theme = getTerminalTheme()
    term.options.fontSize = effectiveFontSize
    fitNow()
  })

  function onContainerKeydown(e: KeyboardEvent): void {
    // Escape returns focus to the app (outside the terminal).
    if (e.key === 'Escape' && term) {
      e.stopPropagation()
      ;(document.activeElement as HTMLElement | null)?.blur()
    }
  }
</script>

<div
  class="terminal-root"
  role="presentation"
  onclick={() => focus()}
  onkeydown={onContainerKeydown}
>
  {#if loadError}
    <div class="terminal-error">
      <p>Failed to load terminal.</p>
      <pre>{loadError}</pre>
    </div>
  {:else if meta?.status === 'error'}
    <div class="terminal-error">
      <p>Terminal failed to start.</p>
      <pre>{meta.errorMessage ?? 'Unknown error'}</pre>
    </div>
  {/if}
  <div class="terminal-host" bind:this={containerEl}></div>
  {#if !ready && !loadError}
    <div class="terminal-loading">Starting shell…</div>
  {/if}
</div>

<style>
  .terminal-root {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: var(--color-surface-dark, #0c0c0d);
  }

  .terminal-host {
    position: absolute;
    inset: 0;
    padding: 4px 8px;
    box-sizing: border-box;
  }

  :global(.terminal-host .xterm) {
    height: 100%;
  }

  :global(.terminal-host .xterm-viewport) {
    background: transparent !important;
  }

  :global(.terminal-host .xterm-viewport::-webkit-scrollbar) {
    width: 10px;
  }

  :global(.terminal-host .xterm-viewport::-webkit-scrollbar-thumb) {
    background: var(--scrollbar-thumb, rgba(255, 255, 255, 0.1));
    border-radius: 5px;
  }

  :global(.terminal-host .xterm-viewport::-webkit-scrollbar-thumb:hover) {
    background: var(--scrollbar-thumb-hover, rgba(255, 255, 255, 0.2));
  }

  .terminal-loading {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    color: var(--color-text-dim, #71717a);
    pointer-events: none;
  }

  .terminal-error {
    position: absolute;
    top: 16px;
    left: 16px;
    right: 16px;
    padding: 12px 14px;
    background: var(--overlay-scrim, rgba(0, 0, 0, 0.5));
    border: 1px solid var(--color-error, #ef4444);
    border-radius: 6px;
    z-index: 2;
  }

  .terminal-error p {
    margin: 0 0 4px;
    color: var(--color-error, #ef4444);
    font-weight: 500;
  }

  .terminal-error pre {
    margin: 0;
    white-space: pre-wrap;
    font-size: 12px;
    color: var(--color-text, #e4e4e7);
  }
</style>
