import { afterEach, describe, expect, it, vi } from 'vitest'
import { Color, type Camera, type Scene, type WebGLRenderer } from 'three'

import {
  canvasToPngBytes,
  captureGraphScreenshotPng,
  drawGraphExportLabels,
  graphScreenshotDefaultName
} from '@renderer/lib/graph-screenshot'

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => ({})
  }
}

function fakeContext(): CanvasRenderingContext2D {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    scale: vi.fn(),
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    strokeText: vi.fn(),
    fillText: vi.fn()
  } as unknown as CanvasRenderingContext2D
}

function pngBlob(bytes = [0x89, 0x50, 0x4e, 0x47]): Blob {
  return {
    arrayBuffer: vi.fn(async () => Uint8Array.from(bytes).buffer)
  } as unknown as Blob
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('graph screenshot helpers', () => {
  it('builds safe opaque and transparent default names', () => {
    expect(graphScreenshotDefaultName('Research/Notes:*', false)).toBe('Research-Notes - Graph.png')
    expect(graphScreenshotDefaultName('Research', true)).toBe('Research - Graph (transparent).png')
    expect(graphScreenshotDefaultName('', false)).toBe('Knowledge Graph.png')
  })

  it('encodes a canvas PNG as binary bytes and rejects a null blob', async () => {
    const canvas = document.createElement('canvas')
    canvas.toBlob = vi.fn((callback) => callback(pngBlob()))

    await expect(canvasToPngBytes(canvas)).resolves.toEqual(
      Uint8Array.from([0x89, 0x50, 0x4e, 0x47])
    )

    canvas.toBlob = vi.fn((callback) => callback(null))
    await expect(canvasToPngBytes(canvas)).rejects.toThrow('could not be encoded as PNG')
  })

  it('maps exported DOM labels from CSS pixels to the WebGL backing canvas', () => {
    const context = fakeContext()
    const sourceCanvas = document.createElement('canvas')
    sourceCanvas.width = 200
    sourceCanvas.height = 100
    sourceCanvas.getBoundingClientRect = vi.fn(() => rect(10, 20, 100, 50))

    const overlayRoot = document.createElement('div')
    const label = document.createElement('span')
    label.dataset.graphExportLabel = ''
    label.textContent = 'Node A'
    label.style.color = 'rgb(255, 255, 255)'
    label.style.font = '12px monospace'
    label.style.opacity = '0.5'
    label.getBoundingClientRect = vi.fn(() => rect(30, 40, 20, 10))
    const graphControl = document.createElement('button')
    graphControl.textContent = 'This UI must not be exported'
    graphControl.getBoundingClientRect = vi.fn(() => rect(0, 0, 100, 20))
    overlayRoot.append(label, graphControl)

    drawGraphExportLabels(context, sourceCanvas, overlayRoot, {
      transparent: false,
      haloColor: '#101010'
    })

    expect(context.scale).toHaveBeenCalledWith(2, 2)
    expect(context.strokeText).toHaveBeenCalledWith('Node A', 30, 25)
    expect(context.fillText).toHaveBeenCalledWith('Node A', 30, 25)
    expect(context.fillText).toHaveBeenCalledOnce()
  })

  it('does not bake an opaque label halo into a transparent screenshot', () => {
    const context = fakeContext()
    const sourceCanvas = document.createElement('canvas')
    sourceCanvas.width = 100
    sourceCanvas.height = 100
    sourceCanvas.getBoundingClientRect = vi.fn(() => rect(0, 0, 100, 100))

    const overlayRoot = document.createElement('div')
    const label = document.createElement('span')
    label.dataset.graphExportLabel = ''
    label.textContent = 'Transparent label'
    label.style.color = '#ffffff'
    label.getBoundingClientRect = vi.fn(() => rect(10, 10, 40, 12))
    overlayRoot.append(label)

    drawGraphExportLabels(context, sourceCanvas, overlayRoot, {
      transparent: true,
      haloColor: '#101010'
    })

    expect(context.strokeText).not.toHaveBeenCalled()
    expect(context.fillText).toHaveBeenCalledOnce()
  })

  it('captures transparent graph pixels synchronously and restores the live renderer', async () => {
    const sourceCanvas = document.createElement('canvas')
    sourceCanvas.width = 320
    sourceCanvas.height = 180
    sourceCanvas.getBoundingClientRect = vi.fn(() => rect(0, 0, 160, 90))
    const context = fakeContext()
    const exportCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context),
      toBlob: vi.fn((callback: BlobCallback) => callback(pngBlob([1, 2, 3])))
    } as unknown as HTMLCanvasElement
    const overlayRoot = document.createElement('div')
    vi.spyOn(document, 'createElement').mockReturnValue(exportCanvas)

    const clearColor = new Color('#123456')
    const renderer = {
      domElement: sourceCanvas,
      getClearColor: vi.fn((target: Color) => target.copy(clearColor)),
      getClearAlpha: vi.fn(() => 1),
      setClearColor: vi.fn(),
      render: vi.fn()
    } as unknown as WebGLRenderer

    const result = await captureGraphScreenshotPng({
      renderer,
      scene: {} as Scene,
      camera: {} as Camera,
      overlayRoot,
      transparent: true
    })

    expect(result).toEqual(Uint8Array.from([1, 2, 3]))
    expect(renderer.setClearColor).toHaveBeenNthCalledWith(1, expect.any(Color), 0)
    expect(renderer.setClearColor).toHaveBeenLastCalledWith(expect.any(Color), 1)
    expect(renderer.render).toHaveBeenCalledTimes(2)
    expect(context.fillRect).not.toHaveBeenCalled()
    expect(context.drawImage).toHaveBeenCalledWith(sourceCanvas, 0, 0, 320, 180)
  })

  it('restores the renderer even when copying the WebGL frame fails', async () => {
    const sourceCanvas = document.createElement('canvas')
    sourceCanvas.width = 100
    sourceCanvas.height = 100
    const context = fakeContext()
    vi.mocked(context.drawImage).mockImplementation(() => {
      throw new Error('copy failed')
    })
    const exportCanvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context)
    } as unknown as HTMLCanvasElement
    const overlayRoot = document.createElement('div')
    vi.spyOn(document, 'createElement').mockReturnValue(exportCanvas)

    const renderer = {
      domElement: sourceCanvas,
      getClearColor: vi.fn((target: Color) => target.set('#101010')),
      getClearAlpha: vi.fn(() => 0.75),
      setClearColor: vi.fn(),
      render: vi.fn()
    } as unknown as WebGLRenderer

    await expect(
      captureGraphScreenshotPng({
        renderer,
        scene: {} as Scene,
        camera: {} as Camera,
        overlayRoot,
        transparent: false
      })
    ).rejects.toThrow('copy failed')

    expect(renderer.setClearColor).toHaveBeenLastCalledWith(expect.any(Color), 0.75)
    expect(renderer.render).toHaveBeenCalledTimes(2)
  })
})
