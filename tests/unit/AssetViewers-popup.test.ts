import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'

const pdfMocks = vi.hoisted(() => ({
  getDocument: vi.fn(),
  textLayerOptions: [] as Array<{
    textContentSource: { items?: Array<{ str?: string }> }
    container: HTMLElement
    viewport: unknown
  }>
}))

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: pdfMocks.getDocument,
  TextLayer: class {
    options: (typeof pdfMocks.textLayerOptions)[number]

    constructor(options: (typeof pdfMocks.textLayerOptions)[number]) {
      this.options = options
      pdfMocks.textLayerOptions.push(options)
    }

    async render(): Promise<void> {
      for (const item of this.options.textContentSource.items ?? []) {
        if (item.str === undefined) continue
        const span = document.createElement('span')
        span.textContent = item.str
        this.options.container.append(span)
      }
    }
  }
}))

const mockApi = {
  readBinary: vi.fn(),
  readImage: vi.fn(),
  editImage: vi.fn(),
  cancelImageEdit: vi.fn(),
  openPath: vi.fn(),
  openExternalFile: vi.fn(),
  writeToClipboard: vi.fn(),
  showConfirmation: vi.fn()
}
Object.defineProperty(window, 'api', { value: mockApi, writable: true })

import ImageViewer from '@renderer/components/ImageViewer.svelte'
import PdfViewer from '@renderer/components/PdfViewer.svelte'
import AssetInfoCard from '@renderer/components/AssetInfoCard.svelte'
import { activeCollectionId, collections } from '@renderer/stores/collections'

describe('asset viewers in popup windows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    pdfMocks.textLayerOptions.length = 0
    collections.set([])
    activeCollectionId.set(null)
    mockApi.readBinary.mockResolvedValue('')
    mockApi.readImage.mockResolvedValue({
      base64: '',
      mimeType: 'image/png',
      width: 640,
      height: 480,
      size: 1024,
      sha256: 'baseline',
      mtimeMs: 1
    })
    mockApi.openPath.mockResolvedValue(undefined)
    mockApi.openExternalFile.mockResolvedValue(undefined)
    mockApi.writeToClipboard.mockResolvedValue(undefined)
    pdfMocks.getDocument.mockReturnValue({
      promise: Promise.resolve({ numPages: 0 })
    })
  })

  it('loads an image from the explicit popup collection path', async () => {
    render(ImageViewer, {
      props: {
        filePath: 'assets/mockup.png',
        collectionPath: '/vault/'
      }
    })

    await waitFor(() => {
      expect(mockApi.readImage).toHaveBeenCalledWith('/vault/assets/mockup.png')
    })
    expect(screen.queryByText('No active collection')).toBeNull()

    await fireEvent.click(screen.getByRole('button', { name: 'Open in Default App' }))
    expect(mockApi.openPath).toHaveBeenCalledWith('/vault/assets/mockup.png')
  })

  it('loads a PDF from the explicit popup collection path', async () => {
    render(PdfViewer, {
      props: {
        filePath: '/documents/spec.pdf',
        collectionPath: '/vault'
      }
    })

    await waitFor(() => {
      expect(mockApi.readBinary).toHaveBeenCalledWith('/vault/documents/spec.pdf')
      expect(pdfMocks.getDocument).toHaveBeenCalled()
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Open in Default App' }))
    expect(mockApi.openPath).toHaveBeenCalledWith('/vault/documents/spec.pdf')
  })

  it('adds a selectable text layer over every digital PDF page', async () => {
    const viewport = {
      width: 612,
      height: 792,
      scale: 1.5,
      rotation: 0
    }
    const getTextContent = vi.fn().mockResolvedValue({
      items: [{ str: 'Selectable PDF text' }],
      styles: {}
    })
    const renderPage = vi.fn().mockReturnValue({ promise: Promise.resolve() })
    pdfMocks.getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 1,
        getPage: vi.fn().mockResolvedValue({
          getViewport: vi.fn().mockReturnValue(viewport),
          getTextContent,
          render: renderPage
        })
      })
    })

    const { container } = render(PdfViewer, {
      props: {
        filePath: 'documents/selectable.pdf',
        collectionPath: '/vault'
      }
    })

    await waitFor(() => {
      expect(screen.getByText('Selectable PDF text')).toBeTruthy()
    })

    expect(getTextContent).toHaveBeenCalledWith({
      includeMarkedContent: true,
      disableNormalization: false
    })
    expect(pdfMocks.textLayerOptions).toHaveLength(1)
    expect(pdfMocks.textLayerOptions[0].viewport).toBe(viewport)
    expect(container.querySelector('.pdf-page canvas')).toBeTruthy()
    expect(container.querySelector('.pdf-page .textLayer')).toBeTruthy()
    expect(screen.getByLabelText('Selectable text for page 1')).toBeTruthy()
  })

  it('loads an external PDF object URL and opens its exact grant', async () => {
    const fetchPdf = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(new Uint8Array([37, 80, 68, 70])))

    render(PdfViewer, {
      props: {
        sourceUrl: 'blob:external-pdf',
        externalId: 'grant-pdf'
      }
    })

    await waitFor(() => {
      expect(fetchPdf).toHaveBeenCalledWith('blob:external-pdf')
      expect(pdfMocks.getDocument).toHaveBeenCalled()
    })
    expect(mockApi.readBinary).not.toHaveBeenCalled()
    expect(screen.getByLabelText('External PDF preview')).toBeTruthy()

    await fireEvent.click(screen.getByRole('button', { name: 'Open in Default App' }))
    expect(mockApi.openExternalFile).toHaveBeenCalledWith('grant-pdf')
    fetchPdf.mockRestore()
  })

  it('opens generic assets using the explicit popup collection path', async () => {
    render(AssetInfoCard, {
      props: {
        filePath: '/sources/design.buzz',
        mimeCategory: 'other',
        collectionPath: '/vault/'
      }
    })

    await fireEvent.click(screen.getByRole('button', { name: /Open in Default App/ }))
    expect(mockApi.openPath).toHaveBeenCalledWith('/vault/sources/design.buzz')
  })
})
