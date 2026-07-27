import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'

const mockApi = {
  readImage: vi.fn(),
  editImage: vi.fn(),
  cancelImageEdit: vi.fn(),
  openPath: vi.fn(),
  showConfirmation: vi.fn()
}

Object.defineProperty(window, 'api', {
  configurable: true,
  value: mockApi,
  writable: true
})

import ImageViewer from '@renderer/components/ImageViewer.svelte'

const sourceImage = {
  base64: 'iVBORw0KGgo=',
  mimeType: 'image/png',
  width: 640,
  height: 480,
  size: 1024,
  sha256: 'source-sha',
  mtimeMs: 1
}

const savedImage = {
  width: 320,
  height: 240,
  size: 768,
  sha256: 'saved-sha',
  mtimeMs: 2,
  mimeType: 'image/png'
}

function renderViewer() {
  return render(ImageViewer, {
    props: {
      filePath: 'images/photo.png',
      collectionPath: '/vault'
    }
  })
}

describe('ImageViewer editing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApi.readImage.mockResolvedValue(sourceImage)
    mockApi.editImage.mockResolvedValue(savedImage)
    mockApi.cancelImageEdit.mockResolvedValue(undefined)
    mockApi.showConfirmation.mockResolvedValue(true)
  })

  it('applies crop presets and supports undo and redo', async () => {
    renderViewer()
    await screen.findByText('640 × 480')

    await fireEvent.click(screen.getByRole('button', { name: /Crop/ }))
    await fireEvent.click(screen.getByRole('button', { name: '1:1' }))
    expect(screen.getByRole('application', { name: /Crop selection/ })).toBeTruthy()

    await fireEvent.click(screen.getByRole('button', { name: 'Apply Crop' }))
    expect(screen.getByText('480 × 480')).toBeTruthy()

    await fireEvent.click(screen.getByTitle('Undo'))
    expect(screen.queryByText('480 × 480')).toBeNull()

    await fireEvent.click(screen.getByTitle('Redo'))
    expect(screen.getByText('480 × 480')).toBeTruthy()
  })

  it('resizes with the aspect lock and confirms an overwrite on every save', async () => {
    renderViewer()
    await screen.findByText('640 × 480')

    await fireEvent.click(screen.getByRole('button', { name: /Resize/ }))
    await fireEvent.input(screen.getByLabelText('Width'), { target: { value: '320' } })
    expect((screen.getByLabelText('Height') as HTMLInputElement).value).toBe('240')
    await fireEvent.click(screen.getByRole('button', { name: 'Apply Resize' }))

    expect(screen.getByText('320 × 240')).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: /Save/ }))

    await waitFor(() => expect(mockApi.editImage).toHaveBeenCalledOnce())
    expect(mockApi.showConfirmation).toHaveBeenCalledWith({
      title: 'Overwrite photo.png?',
      message: 'This will overwrite photo.png with the edited image. This cannot be undone.',
      confirmLabel: 'Overwrite Image',
      cancelLabel: 'Keep Editing',
      tone: 'danger'
    })
    expect(mockApi.editImage).toHaveBeenCalledWith('/vault/images/photo.png', {
      requestId: expect.any(String),
      expectedSha256: 'source-sha',
      recipe: { rotation: 0, crop: null, width: 320, height: 240 }
    })
    expect(await screen.findByText('Image saved')).toBeTruthy()
  })

  it('blocks a stale overwrite and offers both conflict recovery actions', async () => {
    mockApi.editImage.mockRejectedValueOnce(new Error('IMAGE_CHANGED: source changed'))
    renderViewer()
    await screen.findByText('640 × 480')

    await fireEvent.click(screen.getByTitle('Rotate right 90°'))
    await fireEvent.click(screen.getByRole('button', { name: /Save/ }))

    const conflict = await screen.findByRole('alert')
    expect(conflict.textContent).toContain('changed on disk')
    expect(screen.getByRole('button', { name: 'Apply edits to latest' })).toBeTruthy()

    await fireEvent.click(screen.getByRole('button', { name: 'Discard edits and reload' }))
    await waitFor(() => expect(mockApi.readImage).toHaveBeenCalledTimes(2))
    expect((screen.getByRole('button', { name: /Save/ }) as HTMLButtonElement).disabled).toBe(true)
  })
})
