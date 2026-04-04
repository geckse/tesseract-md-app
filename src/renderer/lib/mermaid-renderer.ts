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

/** Read a CSS custom property value with fallback */
function getCssVar(name: string, fallback: string): string {
  if (typeof document !== 'undefined') {
    const val = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
    if (val) return val
  }
  return fallback
}

/** Initialize mermaid with theme-aware config. Called automatically on first render. */
export async function initMermaid(): Promise<void> {
  if (initPromise) return initPromise
  initPromise = (async () => {
    mermaidModule = await import('mermaid')
    const primaryColor = getCssVar('--color-primary', '#00E5FF')
    const bg = getCssVar('--color-bg', '#0f0f10')
    const surface = getCssVar('--color-surface', '#161617')
    const text = getCssVar('--color-text', '#e4e4e7')
    const border = getCssVar('--color-border', '#27272a')
    const dim = getCssVar('--color-text-dim', '#71717a')
    const isDark = document?.documentElement?.getAttribute('data-theme') !== 'light'
    mermaidModule.default.initialize({
      startOnLoad: false,
      theme: isDark ? 'dark' : 'neutral',
      themeVariables: {
        darkMode: isDark,
        background: bg,
        primaryColor,
        primaryTextColor: text,
        primaryBorderColor: border,
        secondaryColor: surface,
        tertiaryColor: border,
        lineColor: dim,
        textColor: text,
        mainBkg: surface,
        nodeBorder: border,
        clusterBkg: surface,
        clusterBorder: border,
        titleColor: text,
        edgeLabelBackground: surface,
        nodeTextColor: text
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

/** Re-initialize mermaid with updated accent color. Call when the primary color changes. */
export function reinitMermaid(): void {
  mermaidModule = null
  initPromise = null
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
