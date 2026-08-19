import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/svelte'

const mockApi = {
  openExternalFile: vi.fn(),
  revealExternalFile: vi.fn()
}

Object.defineProperty(window, 'api', { value: mockApi, writable: true, configurable: true })

import ExternalAssetViewer from '@renderer/components/ExternalAssetViewer.svelte'
import type { AssetTab, MimeCategory } from '@renderer/stores/workspace.svelte'

function externalAsset(mimeCategory: MimeCategory, externalUrl: string | null): AssetTab {
  return {
    id: 'asset-1',
    kind: 'asset',
    origin: 'external',
    filePath: 'sample.bin',
    title: 'sample.bin',
    mimeCategory,
    fileSize: 2048,
    externalId: 'grant-1',
    externalPath: '/outside/sample.bin',
    externalUrl,
    isDirty: false,
    imageEditDraft: {
      baselineHash: null,
      recipe: null,
      previewBase64: null,
      previewMimeType: null
    },
    diskChanged: false,
    imageConflict: null
  }
}

describe('ExternalAssetViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockApi.openExternalFile.mockResolvedValue(undefined)
    mockApi.revealExternalFile.mockResolvedValue(undefined)
  })

  it('previews dropped images without collection APIs', () => {
    render(ExternalAssetViewer, {
      props: { tab: externalAsset('image', 'blob:image') }
    })

    const image = screen.getByLabelText('External image preview')
    expect(image.getAttribute('src')).toBe('blob:image')
  })

  it('previews video and audio object URLs', () => {
    const video = render(ExternalAssetViewer, {
      props: { tab: externalAsset('video', 'blob:video') }
    })
    expect(screen.getByLabelText('External video preview').getAttribute('src')).toBe('blob:video')
    video.unmount()

    render(ExternalAssetViewer, {
      props: { tab: externalAsset('audio', 'blob:audio') }
    })
    expect(screen.getByLabelText('External audio preview').getAttribute('src')).toBe('blob:audio')
  })

  it('reveals or opens the exact sender-bound grant', async () => {
    render(ExternalAssetViewer, {
      props: { tab: externalAsset('other', null) }
    })

    await fireEvent.click(screen.getByRole('button', { name: /Reveal/ }))
    await fireEvent.click(screen.getByRole('button', { name: /Open in Default App/ }))

    expect(mockApi.revealExternalFile).toHaveBeenCalledWith('grant-1')
    expect(mockApi.openExternalFile).toHaveBeenCalledWith('grant-1')
    expect(screen.getByText('2.0 KB')).toBeTruthy()
  })
})
