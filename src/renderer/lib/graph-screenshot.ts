import { Color, type Camera, type Scene, type WebGLRenderer } from 'three'

const EXPORT_LABEL_SELECTOR = '[data-graph-export-label]'

export interface GraphScreenshotOptions {
  renderer: WebGLRenderer
  scene: Scene
  camera: Camera
  overlayRoot: HTMLElement
  transparent: boolean
}

/** Build a filesystem-safe default name for a graph PNG. */
export function graphScreenshotDefaultName(
  collectionName: string | null | undefined,
  transparent: boolean
): string {
  const withoutControlCharacters = Array.from(collectionName ?? '', (character) =>
    character.charCodeAt(0) < 32 ? '-' : character
  ).join('')
  const safeCollectionName = withoutControlCharacters
    .trim()
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[-. ]+$/g, '')

  const baseName = safeCollectionName ? `${safeCollectionName} - Graph` : 'Knowledge Graph'
  return `${baseName}${transparent ? ' (transparent)' : ''}.png`
}

/**
 * Encode a canvas as a transferable PNG buffer for the sandboxed export IPC.
 *
 * Blob.arrayBuffer() already produces the representation Electron's binary
 * export channel needs. Returning that buffer directly avoids wrapping (and
 * later copying) a potentially large screenshot through another typed array.
 */
export function canvasToPngBytes(canvas: HTMLCanvasElement): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('The graph screenshot could not be encoded as PNG.'))
        return
      }

      blob.arrayBuffer().then(resolve).catch(reject)
    }, 'image/png')
  })
}

function computedFont(style: CSSStyleDeclaration): string {
  if (style.font) return style.font

  return [style.fontStyle, style.fontWeight, style.fontSize, style.fontFamily]
    .filter(Boolean)
    .join(' ')
}

/**
 * Paint only graph-owned HTML labels over a copied WebGL frame. Controls,
 * badges, tooltips, context menus, and tabs deliberately have no export marker.
 */
export function drawGraphExportLabels(
  context: CanvasRenderingContext2D,
  sourceCanvas: HTMLCanvasElement,
  overlayRoot: HTMLElement,
  options: { transparent: boolean; haloColor: string }
): void {
  const canvasRect = sourceCanvas.getBoundingClientRect()
  if (canvasRect.width <= 0 || canvasRect.height <= 0) return

  const scaleX = sourceCanvas.width / canvasRect.width
  const scaleY = sourceCanvas.height / canvasRect.height

  context.save()
  context.scale(scaleX, scaleY)
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.lineJoin = 'round'

  for (const element of overlayRoot.querySelectorAll<HTMLElement>(EXPORT_LABEL_SELECTOR)) {
    const style = getComputedStyle(element)
    const opacity = Number.parseFloat(style.opacity || '1')
    const rect = element.getBoundingClientRect()
    const text = element.textContent?.trim()

    if (
      !text ||
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      opacity <= 0 ||
      rect.width <= 0 ||
      rect.height <= 0
    ) {
      continue
    }

    const x = rect.left - canvasRect.left + rect.width / 2
    const y = rect.top - canvasRect.top + rect.height / 2

    context.save()
    context.globalAlpha = Number.isFinite(opacity) ? opacity : 1
    context.font = computedFont(style)
    context.fillStyle = style.color

    // The live labels use a dark CSS text shadow. Keep that readability halo
    // for opaque exports, but do not bake background-colored pixels into an
    // otherwise transparent PNG.
    if (!options.transparent) {
      context.strokeStyle = options.haloColor
      context.lineWidth = 4
      context.strokeText(text, x, y)
    }

    context.fillText(text, x, y)
    context.restore()
  }

  context.restore()
}

/**
 * Capture the graph's current camera frame and composite its enabled DOM
 * labels. The renderer background is restored synchronously before PNG
 * encoding, so transparent capture never changes the visible graph state.
 */
export async function captureGraphScreenshotPng({
  renderer,
  scene,
  camera,
  overlayRoot,
  transparent
}: GraphScreenshotOptions): Promise<ArrayBuffer> {
  const sourceCanvas = renderer.domElement
  if (sourceCanvas.width <= 0 || sourceCanvas.height <= 0) {
    throw new Error('The graph is not ready to capture yet.')
  }

  const exportCanvas = document.createElement('canvas')
  exportCanvas.width = sourceCanvas.width
  exportCanvas.height = sourceCanvas.height

  const context = exportCanvas.getContext('2d')
  if (!context) {
    throw new Error('A 2D canvas is required to export the graph.')
  }

  const originalClearColor = renderer.getClearColor(new Color()).clone()
  const originalClearAlpha = renderer.getClearAlpha()
  const backgroundColor = `#${originalClearColor.getHexString()}`

  try {
    renderer.setClearColor(originalClearColor, transparent ? 0 : 1)
    renderer.render(scene, camera)

    if (!transparent) {
      context.fillStyle = backgroundColor
      context.fillRect(0, 0, exportCanvas.width, exportCanvas.height)
    }
    context.drawImage(sourceCanvas, 0, 0, exportCanvas.width, exportCanvas.height)
    drawGraphExportLabels(context, sourceCanvas, overlayRoot, {
      transparent,
      haloColor: backgroundColor
    })
  } finally {
    renderer.setClearColor(originalClearColor, originalClearAlpha)
    renderer.render(scene, camera)
  }

  return canvasToPngBytes(exportCanvas)
}
