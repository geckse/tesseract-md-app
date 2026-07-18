import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte'

const mockApi = {
  tree: vi.fn(),
  listCollections: vi.fn(),
  getActiveCollection: vi.fn(),
  addCollection: vi.fn(),
  createExampleCollection: vi.fn(),
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
  installCli: vi
    .fn()
    .mockResolvedValue({ success: true, path: '/usr/local/bin/mdvdb', version: '1.0.0' }),
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
  doctor: vi.fn()
}

;(globalThis as any).window = Object.assign(globalThis.window ?? {}, { api: mockApi })

import { onboardingComplete } from '../../src/renderer/stores/ui'
import { activeCollectionId, collections } from '../../src/renderer/stores/collections'
import Onboarding from '@renderer/components/Onboarding.svelte'
import { get } from 'svelte/store'

beforeEach(() => {
  vi.clearAllMocks()
  onboardingComplete.set(false)
  collections.set([])
  activeCollectionId.set(null)
  mockApi.detectCli.mockResolvedValue({ found: false })
  mockApi.addCollection.mockResolvedValue(null)
  mockApi.createExampleCollection.mockResolvedValue({
    id: 'example-1',
    name: 'Tesseract Example',
    path: '/documents/Tesseract Example',
    addedAt: 1,
    lastOpenedAt: 1
  })
  mockApi.doctor.mockResolvedValue({ checks: [], passed: 0, total: 0 })
})

describe('Onboarding component', () => {
  it('renders welcome step on mount', () => {
    const oncomplete = vi.fn()
    render(Onboarding, { props: { oncomplete } })
    expect(screen.getByText('Tesseract')).toBeTruthy()
    expect(screen.getByText(/Search your notes by meaning/)).toBeTruthy()
    expect(screen.getByText('Get Started')).toBeTruthy()
  })

  it('"Get Started" advances to CLI step', async () => {
    const oncomplete = vi.fn()
    render(Onboarding, { props: { oncomplete } })
    await fireEvent.click(screen.getByText('Get Started'))
    expect(screen.getByText('CLI Setup')).toBeTruthy()
  })

  it('CLI step shows detected CLI info when found', async () => {
    mockApi.detectCli.mockResolvedValue({
      found: true,
      path: '/usr/local/bin/mdvdb',
      version: '2.0.0'
    })
    const oncomplete = vi.fn()
    render(Onboarding, { props: { oncomplete } })
    await fireEvent.click(screen.getByText('Get Started'))

    await waitFor(() => {
      expect(screen.getByText('/usr/local/bin/mdvdb')).toBeTruthy()
    })
    expect(screen.getByText('Version 2.0.0')).toBeTruthy()
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
    expect(screen.getByText('Choose an Embedding Provider')).toBeTruthy()
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
    // Go to provider step
    await fireEvent.click(screen.getByText('Skip for now'))
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
    expect(dots).toHaveLength(4)
    expect(dots[0].classList.contains('active')).toBe(true)
    expect(dots[1].classList.contains('active')).toBe(false)
    expect(dots[2].classList.contains('active')).toBe(false)
    expect(dots[3].classList.contains('active')).toBe(false)

    // Advance to step 1
    await fireEvent.click(screen.getByText('Get Started'))

    await waitFor(() => {
      const updatedDots = container.querySelectorAll('.dot')
      expect(updatedDots[0].classList.contains('completed')).toBe(true)
      expect(updatedDots[1].classList.contains('active')).toBe(true)
      expect(updatedDots[2].classList.contains('active')).toBe(false)
    })
  })

  it('saves OpenAI settings at user scope before continuing', async () => {
    render(Onboarding, { props: { oncomplete: vi.fn() } })
    await fireEvent.click(screen.getByText('Get Started'))
    await screen.findByText('Skip for now')
    await fireEvent.click(screen.getByText('Skip for now'))
    await fireEvent.click(screen.getByText('OpenAI'))
    await fireEvent.input(screen.getByPlaceholderText('sk-...'), { target: { value: 'sk-test' } })
    await fireEvent.click(screen.getByText('Continue'))

    await waitFor(() => expect(screen.getByText('Add Your First Collection')).toBeTruthy())
    expect(mockApi.setUserConfig).toHaveBeenCalledWith('MDVDB_EMBEDDING_PROVIDER', 'openai')
    expect(mockApi.setUserConfig).toHaveBeenCalledWith('OPENAI_API_KEY', 'sk-test')
    expect(mockApi.setCollectionConfig).not.toHaveBeenCalled()
  })

  it('saves Ollama defaults at user scope before continuing', async () => {
    render(Onboarding, { props: { oncomplete: vi.fn() } })
    await fireEvent.click(screen.getByText('Get Started'))
    await screen.findByText('Skip for now')
    await fireEvent.click(screen.getByText('Skip for now'))
    await fireEvent.click(screen.getByText('Ollama'))
    await fireEvent.click(screen.getByText('Continue'))

    await waitFor(() => expect(screen.getByText('Add Your First Collection')).toBeTruthy())
    expect(mockApi.setUserConfig).toHaveBeenCalledWith('MDVDB_EMBEDDING_PROVIDER', 'ollama')
    expect(mockApi.setUserConfig).toHaveBeenCalledWith('MDVDB_EMBEDDING_MODEL', 'nomic-embed-text')
    expect(mockApi.setUserConfig).toHaveBeenCalledWith('OLLAMA_HOST', 'http://localhost:11434')
  })

  it('shows an inline Doctor warning for provider failures', async () => {
    mockApi.addCollection.mockResolvedValue({ id: 'c1', name: 'Notes', path: '/notes' })
    mockApi.doctor.mockResolvedValue({
      checks: [{ name: 'API key', status: 'Fail', detail: 'OPENAI_API_KEY not set' }],
      passed: 0,
      total: 1
    })
    const oncomplete = vi.fn()
    render(Onboarding, { props: { oncomplete } })
    await fireEvent.click(screen.getByText('Get Started'))
    await screen.findByText('Skip for now')
    await fireEvent.click(screen.getByText('Skip for now'))
    await fireEvent.click(screen.getByText('Skip for now'))
    await fireEvent.click(screen.getByText('Choose Folder'))

    expect(await screen.findByText('Embedding setup needs attention')).toBeTruthy()
    expect(screen.getByText('OPENAI_API_KEY not set')).toBeTruthy()
    expect(screen.getByText('Open Embedding Settings')).toBeTruthy()
    expect(mockApi.doctor).toHaveBeenCalledWith('/notes')
    expect(oncomplete).not.toHaveBeenCalled()
  })

  it('exposes a modal dialog, semantic progress, and focuses each step heading', async () => {
    mockApi.detectCli.mockResolvedValue({ found: false })
    render(Onboarding, { props: { oncomplete: vi.fn() } })

    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(
      screen.getByText('Meet your workspace').closest('li')?.getAttribute('aria-current')
    ).toBe('step')

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 }))
    })

    await fireEvent.click(screen.getByText('Get Started'))
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'CLI Setup' }))
    })
    expect(screen.getByText('Connect the engine').closest('li')?.getAttribute('aria-current')).toBe(
      'step'
    )
  })

  it('reports a CLI detection failure once instead of retrying forever', async () => {
    mockApi.detectCli.mockRejectedValue(new Error('Detection unavailable'))
    render(Onboarding, { props: { oncomplete: vi.fn() } })

    await fireEvent.click(screen.getByText('Get Started'))

    expect(await screen.findByText('Detection failed')).toBeTruthy()
    expect(screen.getByText('Detection unavailable')).toBeTruthy()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(mockApi.detectCli).toHaveBeenCalledTimes(1)
    expect(screen.getByText('Check again')).toBeTruthy()
  })

  it('does not save an empty OpenAI credential', async () => {
    render(Onboarding, { props: { oncomplete: vi.fn() } })
    await fireEvent.click(screen.getByText('Get Started'))
    await screen.findByText('Skip for now')
    await fireEvent.click(screen.getByText('Skip for now'))
    await fireEvent.click(screen.getByText('OpenAI'))
    await fireEvent.click(screen.getByText('Continue'))

    expect(await screen.findByText('Enter an OpenAI API key, or choose Skip for now.')).toBeTruthy()
    expect(mockApi.setUserConfig).not.toHaveBeenCalled()
    expect(screen.getByText('Choose an Embedding Provider')).toBeTruthy()
  })

  it('keeps onboarding open and explains collection picker failures', async () => {
    mockApi.addCollection.mockRejectedValue(new Error('Folder access was denied'))
    const oncomplete = vi.fn()
    render(Onboarding, { props: { oncomplete } })
    await fireEvent.click(screen.getByText('Get Started'))
    await screen.findByText('Skip for now')
    await fireEvent.click(screen.getByText('Skip for now'))
    await fireEvent.click(screen.getByText('Skip for now'))
    await fireEvent.click(screen.getByText('Choose Folder'))

    expect(await screen.findByText('Folder access was denied')).toBeTruthy()
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(oncomplete).not.toHaveBeenCalled()
  })

  it('creates, activates, and opens the guided example collection', async () => {
    const oncomplete = vi.fn()
    render(Onboarding, { props: { oncomplete } })
    await fireEvent.click(screen.getByText('Get Started'))
    await screen.findByText('Skip for now')
    await fireEvent.click(screen.getByText('Skip for now'))
    await fireEvent.click(screen.getByText('Skip for now'))

    await fireEvent.click(screen.getByText('Explore Example Collection'))

    await waitFor(() => expect(oncomplete).toHaveBeenCalledOnce())
    expect(mockApi.createExampleCollection).toHaveBeenCalledOnce()
    expect(mockApi.setActiveCollection).toHaveBeenCalledWith('example-1')
    expect(get(activeCollectionId)).toBe('example-1')
    expect(get(collections)).toEqual([
      expect.objectContaining({ id: 'example-1', name: 'Tesseract Example' })
    ])
    expect(mockApi.setOnboardingComplete).toHaveBeenCalledWith(true)
  })
})
