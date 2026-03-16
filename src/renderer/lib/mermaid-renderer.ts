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
        // Strip fixed width/height so SVG scales as vector via viewBox
        resolve({ svg: makeScalableSvg(svg) })
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        resolve({ error: message })
      }
    })
  })

  return result
}

/**
 * Make a Mermaid SVG scalable by ensuring viewBox is set and removing
 * fixed width/height attributes. This prevents pixelation when zooming
 * because the browser re-rasterizes the vector at any scale.
 */
function makeScalableSvg(svg: string): string {
  const parser = new DOMParser()
  const doc = parser.parseFromString(svg, 'image/svg+xml')
  const svgEl = doc.querySelector('svg')
  if (!svgEl) return svg

  const w = svgEl.getAttribute('width')
  const h = svgEl.getAttribute('height')

  // Ensure viewBox exists so the SVG knows its intrinsic coordinate space
  if (!svgEl.getAttribute('viewBox') && w && h) {
    const width = parseFloat(w)
    const height = parseFloat(h)
    if (!isNaN(width) && !isNaN(height)) {
      svgEl.setAttribute('viewBox', `0 0 ${width} ${height}`)
    }
  }

  // Remove fixed dimensions — let CSS control the rendered size
  svgEl.removeAttribute('width')
  svgEl.removeAttribute('height')
  // Make it fill its container
  svgEl.style.width = '100%'
  svgEl.style.height = '100%'

  return svgEl.outerHTML
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
