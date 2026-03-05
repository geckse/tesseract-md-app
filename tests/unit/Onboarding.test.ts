import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte'

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
  ingest: vi.fn().mockResolvedValue({ files_processed: 0, chunks_created: 0 }),
  ingestPreview: vi.fn().mockResolvedValue({ files: [], total_files: 0 }),
  cancelIngest: vi.fn(),
  detectCli: vi.fn().mockResolvedValue({ found: false }),
  installCli: vi.fn().mockResolvedValue({ success: true, path: '/usr/local/bin/mdvdb', version: '1.0.0' }),
  onInstallProgress: vi.fn(),
  removeInstallProgressListener: vi.fn(),
  getOnboardingComplete: vi.fn().mockResolvedValue(false),
  setOnboardingComplete: vi.fn().mockResolvedValue(undefined),
  getEditorFontSize: vi.fn().mockResolvedValue(17),
  setEditorFontSize: vi.fn(),
  getUserConfig: vi.fn().mockResolvedValue({}),
  setUserConfig: vi.fn(),
  deleteUserConfig: vi.fn(),
  getCollectionConfig: vi.fn().mockResolvedValue({}),
  setCollectionConfig: vi.fn(),
  deleteCollectionConfig: vi.fn(),
}

;(globalThis as any).window = Object.assign(globalThis.window ?? {}, { api: mockApi })

import { onboardingComplete } from '../../src/renderer/stores/ui'
import Onboarding from '@renderer/components/Onboarding.svelte'
import { get } from 'svelte/store'

beforeEach(() => {
  vi.clearAllMocks()
  onboardingComplete.set(false)
  mockApi.detectCli.mockResolvedValue({ found: false })
})

describe('Onboarding component', () => {
  it('renders welcome step on mount', () => {
    const oncomplete = vi.fn()
    render(Onboarding, { props: { oncomplete } })
    expect(screen.getByText('Markdown VDB')).toBeTruthy()
    expect(screen.getByText('Search your notes by meaning')).toBeTruthy()
    expect(screen.getByText('Get Started')).toBeTruthy()
  })

  it('"Get Started" advances to CLI step', async () => {
    const oncomplete = vi.fn()
    render(Onboarding, { props: { oncomplete } })
    await fireEvent.click(screen.getByText('Get Started'))
    expect(screen.getByText('CLI Setup')).toBeTruthy()
  })

  it('CLI step shows detected CLI info when found', async () => {
    mockApi.detectCli.mockResolvedValue({ found: true, path: '/usr/local/bin/mdvdb', version: '2.0.0' })
    const oncomplete = vi.fn()
    render(Onboarding, { props: { oncomplete } })
    await fireEvent.click(screen.getByText('Get Started'))

    await waitFor(() => {
      expect(screen.getByText('/usr/local/bin/mdvdb')).toBeTruthy()
    })
    expect(screen.getByText('v2.0.0')).toBeTruthy()
    expect(screen.getByText('Continue')).toBeTruthy()
  })

  it('CLI step shows install button when not found', async () => {
    mockApi.detectCli.mockResolvedValue({ found: false })
    const oncomplete = vi.fn()
    render(Onboarding, { props: { oncomplete } })
    await fireEvent.click(screen.getByText('Get Started'))

    await waitFor(() => {
      expect(screen.getByText('The CLI tool was not found on your system.')).toBeTruthy()
    })
    expect(screen.getByText('Install CLI')).toBeTruthy()
  })

  it('skip buttons work on CLI step', async () => {
    mockApi.detectCli.mockResolvedValue({ found: false })
    const oncomplete = vi.fn()
    render(Onboarding, { props: { oncomplete } })
    await fireEvent.click(screen.getByText('Get Started'))

    await waitFor(() => {
      expect(screen.getByText('Skip for now')).toBeTruthy()
    })
    await fireEvent.click(screen.getByText('Skip for now'))
    expect(screen.getByText('Add Your First Collection')).toBeTruthy()
  })

  it('skip button on collection step completes onboarding', async () => {
    mockApi.detectCli.mockResolvedValue({ found: false })
    const oncomplete = vi.fn()
    render(Onboarding, { props: { oncomplete } })

    // Go to step 1
    await fireEvent.click(screen.getByText('Get Started'))
    await waitFor(() => {
      expect(screen.getByText('Skip for now')).toBeTruthy()
    })
    // Go to step 2
    await fireEvent.click(screen.getByText('Skip for now'))
    expect(screen.getByText('Add Your First Collection')).toBeTruthy()

    // Skip collection step
    await fireEvent.click(screen.getByText('Skip'))

    await waitFor(() => {
      expect(oncomplete).toHaveBeenCalled()
    })
    expect(mockApi.setOnboardingComplete).toHaveBeenCalledWith(true)
    expect(get(onboardingComplete)).toBe(true)
  })

  it('step indicators show correct active state', async () => {
    mockApi.detectCli.mockResolvedValue({ found: false })
    const oncomplete = vi.fn()
    const { container } = render(Onboarding, { props: { oncomplete } })

    // Step 0: first dot active
    const dots = container.querySelectorAll('.dot')
    expect(dots).toHaveLength(3)
    expect(dots[0].classList.contains('active')).toBe(true)
    expect(dots[1].classList.contains('active')).toBe(false)
    expect(dots[2].classList.contains('active')).toBe(false)

    // Advance to step 1
    await fireEvent.click(screen.getByText('Get Started'))

    await waitFor(() => {
      const updatedDots = container.querySelectorAll('.dot')
      expect(updatedDots[0].classList.contains('completed')).toBe(true)
      expect(updatedDots[1].classList.contains('active')).toBe(true)
      expect(updatedDots[2].classList.contains('active')).toBe(false)
    })
  })
})
