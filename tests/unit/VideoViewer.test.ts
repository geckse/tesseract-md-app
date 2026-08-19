import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'

const mockApi = {
  openPath: vi.fn(),
  openExternalFile: vi.fn(),
  revealExternalFile: vi.fn()
}

Object.defineProperty(window, 'api', { value: mockApi, writable: true, configurable: true })

import VideoViewer from '@renderer/components/VideoViewer.svelte'
import { activeCollectionId, collections } from '@renderer/stores/collections'

describe('VideoViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    collections.set([])
    activeCollectionId.set(null)
    mockApi.openPath.mockResolvedValue(undefined)
    mockApi.openExternalFile.mockResolvedValue(undefined)
    mockApi.revealExternalFile.mockResolvedValue(undefined)
  })

  it('streams a collection video and provides playback, stop, seek, volume, and speed controls', async () => {
    render(VideoViewer, {
      props: { filePath: 'media/demo.mp4', collectionPath: '/vault/' }
    })

    const video = screen.getByLabelText('Video preview') as HTMLVideoElement
    expect(video.getAttribute('src')).toBe(
      `tesseract-media://asset?path=${encodeURIComponent('/vault/media/demo.mp4')}`
    )

    Object.defineProperty(video, 'duration', { configurable: true, value: 125 })
    const play = vi.spyOn(video, 'play').mockResolvedValue(undefined)
    const pause = vi.spyOn(video, 'pause').mockImplementation(() => undefined)
    await fireEvent(video, new Event('loadedmetadata'))

    await fireEvent.click(screen.getByRole('button', { name: 'Play' }))
    await waitFor(() => expect(play).toHaveBeenCalledOnce())
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy()

    await fireEvent.input(screen.getByLabelText('Seek video'), { target: { value: '42' } })
    expect(video.currentTime).toBe(42)

    await fireEvent.input(screen.getByLabelText('Volume'), { target: { value: '0.4' } })
    expect(video.volume).toBe(0.4)

    await fireEvent.change(screen.getByLabelText('Playback speed'), {
      target: { value: '1.5' }
    })
    expect(video.playbackRate).toBe(1.5)

    await fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(pause).toHaveBeenCalled()
    expect(video.currentTime).toBe(0)
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy()

    await fireEvent.click(screen.getByRole('button', { name: 'Open in Default App' }))
    expect(mockApi.openPath).toHaveBeenCalledWith('/vault/media/demo.mp4')
  })

  it('plays an external object URL and keeps file actions bound to its grant', async () => {
    render(VideoViewer, {
      props: { sourceUrl: 'blob:external-video', externalId: 'video-grant' }
    })

    expect(screen.getByLabelText('External video preview').getAttribute('src')).toBe(
      'blob:external-video'
    )

    await fireEvent.click(screen.getByRole('button', { name: 'Reveal' }))
    await fireEvent.click(screen.getByRole('button', { name: 'Open in Default App' }))

    expect(mockApi.revealExternalFile).toHaveBeenCalledWith('video-grant')
    expect(mockApi.openExternalFile).toHaveBeenCalledWith('video-grant')
    expect(mockApi.openPath).not.toHaveBeenCalled()
  })
})
