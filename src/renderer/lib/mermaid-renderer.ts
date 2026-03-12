/**
 * Lazy-loading mermaid renderer with dark theme configuration.
 * Mermaid.js is ~2MB and loaded only on first use via dynamic import.
 * All render calls are serialized via an async queue (mermaid is not thread-safe).
 */

const MAX_CODE_SIZE = 50 * 1024 // 50KB

type MermaidModule = typeof import('mermaid')

let mermaidModule: MermaidModule | null = null
let initPromise: Promise<void> | null = null
let counter = 0
let renderQueue: Promise<unknown> = Promise.resolve()

/** Initialize mermaid with dark theme config. Called automatically on first render. */
export async function initMermaid(): Promise<void> {
  if (initPromise) return initPromise
  initPromise = (async () => {
    mermaidModule = await import('mermaid')
    mermaidModule.default.initialize({
      startOnLoad: false,
      theme: 'dark',
      themeVariables: {
        darkMode: true,
        background: '#0f0f10',
        primaryColor: '#00E5FF',
        primaryTextColor: '#e4e4e7',
        primaryBorderColor: '#27272a',
        secondaryColor: '#161617',
        tertiaryColor: '#27272a',
        lineColor: '#71717a',
        textColor: '#e4e4e7',
        mainBkg: '#161617',
        nodeBorder: '#27272a',
        clusterBkg: '#161617',
        clusterBorder: '#27272a',
        titleColor: '#e4e4e7',
        edgeLabelBackground: '#161617',
        nodeTextColor: '#e4e4e7'
      },
      fontFamily: "'Space Grotesk', system-ui, sans-serif",
      securityLevel: 'strict'
    })
  })()
  return initPromise
}

/** Generate a unique ID for mermaid diagrams. */
export function generateMermaidId(): string {
  return `mermaid-diagram-${counter++}`
}

/** Lazy-load mermaid and render a diagram string to SVG HTML. */
export async function renderMermaidDiagram(
  id: string,
  code: string
): Promise<{ svg: string } | { error: string }> {
  if (!code.trim()) {
    return { error: 'Empty diagram' }
  }

  if (code.length > MAX_CODE_SIZE) {
    return { error: 'Diagram code too large' }
  }

  // Serialize all render calls — mermaid uses shared internal DOM state
  const result = new Promise<{ svg: string } | { error: string }>((resolve) => {
    renderQueue = renderQueue.then(async () => {
      try {
        await initMermaid()
        const { svg } = await mermaidModule!.default.render(id, code)
        resolve({ svg })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        resolve({ error: message })
      }
    })
  })

  return result
}

/**
 * Reset internal state — only for testing.
 * @internal
 */
export function _resetForTesting(): void {
  mermaidModule = null
  initPromise = null
  counter = 0
  renderQueue = Promise.resolve()
}
