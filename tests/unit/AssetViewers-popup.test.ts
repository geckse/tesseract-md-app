import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'

const pdfMocks = vi.hoisted(() => ({
  getDocument: vi.fn()
}))

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: pdfMocks.getDocument
}))

const mockApi = {
  readBinary: vi.fn(),
  openPath: vi.fn(),
  writeToClipboard: vi.fn()
}
Object.defineProperty(window, 'api', { value: mockApi, writable: true })

import ImageViewer from '@renderer/components/ImageViewer.svelte'
import PdfViewer from '@renderer/components/PdfViewer.svelte'
import AssetInfoCard from '@renderer/components/AssetInfoCard.svelte'
import { activeCollectionId, collections } from '@renderer/stores/collections'

describe('asset viewers in popup windows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    collections.set([])
    activeCollectionId.set(null)
    mockApi.readBinary.mockResolvedValue('')
    mockApi.openPath.mockResolvedValue(undefined)
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
      expect(mockApi.readBinary).toHaveBeenCalledWith('/vault/assets/mockup.png')
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
