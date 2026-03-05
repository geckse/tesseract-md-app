import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'

const mockApi = {
  tree: vi.fn(),
  listCollections: vi.fn(),
  getActiveCollection: vi.fn(),
  addCollection: vi.fn(),
  removeCollection: vi.fn(),
  setActiveCollection: vi.fn(),
  status: vi.fn().mockResolvedValue({}),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  search: vi.fn().mockResolvedValue({ results: [], query: '', total_results: 0 }),
  startWatcher: vi.fn(),
  stopWatcher: vi.fn(),
  getWatcherStatus: vi.fn().mockResolvedValue({ state: 'stopped' }),
  onWatcherEvent: vi.fn(),
  removeWatcherEventListener: vi.fn(),
  ingest: vi.fn(),
  ingestPreview: vi.fn(),
  cancelIngest: vi.fn(),
  checkForUpdates: vi.fn().mockResolvedValue({ updateAvailable: false }),
  downloadUpdate: vi.fn().mockResolvedValue(undefined),
  installUpdate: vi.fn().mockResolvedValue(undefined),
  onUpdateEvent: vi.fn(),
  removeUpdateEventListener: vi.fn(),
  skipVersion: vi.fn().mockResolvedValue(undefined),
  getAppVersion: vi.fn().mockResolvedValue('1.0.0'),
}

Object.defineProperty(globalThis, 'window', {
  value: { api: mockApi },
  writable: true,
})

import {
  updateState,
  updateVersion,
  downloadProgress,
  updateError,
  updateDismissed,
} from '../../src/renderer/stores/updater'
import UpdateNotification from '@renderer/components/UpdateNotification.svelte'

function resetStores() {
  updateState.set('idle')
  updateVersion.set(null)
  downloadProgress.set(0)
  updateError.set(null)
  updateDismissed.set(false)
}

beforeEach(() => {
  resetStores()
  vi.clearAllMocks()
})

describe('UpdateNotification component', () => {
  // --- Hidden state ---

  it('is hidden when state is idle', () => {
    const { container } = render(UpdateNotification)
    expect(container.querySelector('.update-banner')).toBeNull()
  })

  it('is hidden when state is checking', () => {
    updateState.set('checking')
    const { container } = render(UpdateNotification)
    expect(container.querySelector('.update-banner')).toBeNull()
  })

  it('is hidden when dismissed even if update available', () => {
    updateState.set('update-available')
    updateDismissed.set(true)
    const { container } = render(UpdateNotification)
    expect(container.querySelector('.update-banner')).toBeNull()
  })

  // --- Update available state ---

  it('shows banner when update is available', () => {
    updateState.set('update-available')
    updateVersion.set('2.0.0')
    const { container } = render(UpdateNotification)
    expect(container.querySelector('.update-banner')).toBeTruthy()
    expect(screen.getByText(/Version 2\.0\.0 is available/)).toBeTruthy()
  })

  it('shows Download, Later, and Skip buttons when update available', () => {
    updateState.set('update-available')
    render(UpdateNotification)
    expect(screen.getByText('Download')).toBeTruthy()
    expect(screen.getByText('Later')).toBeTruthy()
    expect(screen.getByText('Skip')).toBeTruthy()
  })

  it('shows "unknown" when version is null', () => {
    updateState.set('update-available')
    updateVersion.set(null)
    render(UpdateNotification)
    expect(screen.getByText(/Version unknown is available/)).toBeTruthy()
  })

  it('Download button calls downloadUpdate', async () => {
    updateState.set('update-available')
    render(UpdateNotification)
    await fireEvent.click(screen.getByText('Download'))
    expect(mockApi.downloadUpdate).toHaveBeenCalled()
  })

  it('Skip button dismisses and resets state', async () => {
    updateState.set('update-available')
    updateVersion.set('2.0.0')
    const { container } = render(UpdateNotification)
    await fireEvent.click(screen.getByText('Skip'))
    // After skip, banner should disappear (dismissed + idle)
    // Need to wait for reactivity
    await new Promise((r) => setTimeout(r, 0))
    expect(container.querySelector('.update-banner')).toBeNull()
  })

  it('Later button dismisses notification', async () => {
    updateState.set('update-available')
    const { container } = render(UpdateNotification)
    await fireEvent.click(screen.getByText('Later'))
    await new Promise((r) => setTimeout(r, 0))
    expect(container.querySelector('.update-banner')).toBeNull()
  })

  // --- Downloading state ---

  it('shows downloading state with progress', () => {
    updateState.set('downloading')
    downloadProgress.set(45)
    render(UpdateNotification)
    expect(screen.getByText(/Downloading update… 45%/)).toBeTruthy()
  })

  it('renders progress bar track and fill', () => {
    updateState.set('downloading')
    downloadProgress.set(60)
    const { container } = render(UpdateNotification)
    const track = container.querySelector('.update-progress-track')
    const fill = container.querySelector('.update-progress-fill')
    expect(track).toBeTruthy()
    expect(fill).toBeTruthy()
    expect((fill as HTMLElement).style.width).toBe('60%')
  })

  it('shows spinning icon during download', () => {
    updateState.set('downloading')
    const { container } = render(UpdateNotification)
    const icon = container.querySelector('.spinning')
    expect(icon).toBeTruthy()
  })

  // --- Ready state ---

  it('shows ready state with Restart Now and Later buttons', () => {
    updateState.set('ready')
    render(UpdateNotification)
    expect(screen.getByText('Update ready to install')).toBeTruthy()
    expect(screen.getByText('Restart Now')).toBeTruthy()
    expect(screen.getByText('Later')).toBeTruthy()
  })

  it('Restart Now button calls installUpdate', async () => {
    updateState.set('ready')
    render(UpdateNotification)
    await fireEvent.click(screen.getByText('Restart Now'))
    expect(mockApi.installUpdate).toHaveBeenCalled()
  })

  it('Later button in ready state dismisses notification', async () => {
    updateState.set('ready')
    const { container } = render(UpdateNotification)
    await fireEvent.click(screen.getByText('Later'))
    await new Promise((r) => setTimeout(r, 0))
    expect(container.querySelector('.update-banner')).toBeNull()
  })

  // --- Error state ---

  it('shows error state with error message', () => {
    updateState.set('error')
    updateError.set('Network timeout')
    render(UpdateNotification)
    expect(screen.getByText(/Update failed: Network timeout/)).toBeTruthy()
  })

  it('shows Dismiss button in error state', () => {
    updateState.set('error')
    render(UpdateNotification)
    expect(screen.getByText('Dismiss')).toBeTruthy()
  })

  it('Dismiss button in error state hides banner', async () => {
    updateState.set('error')
    const { container } = render(UpdateNotification)
    await fireEvent.click(screen.getByText('Dismiss'))
    await new Promise((r) => setTimeout(r, 0))
    expect(container.querySelector('.update-banner')).toBeNull()
  })

  it('error state applies update-error class', () => {
    updateState.set('error')
    const { container } = render(UpdateNotification)
    const banner = container.querySelector('.update-banner')
    expect(banner?.classList.contains('update-error')).toBe(true)
  })

  it('non-error states do not apply update-error class', () => {
    updateState.set('update-available')
    const { container } = render(UpdateNotification)
    const banner = container.querySelector('.update-banner')
    expect(banner?.classList.contains('update-error')).toBe(false)
  })

  it('shows "Unknown error" when error is null', () => {
    updateState.set('error')
    updateError.set(null)
    render(UpdateNotification)
    expect(screen.getByText(/Update failed: Unknown error/)).toBeTruthy()
  })
})
