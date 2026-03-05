import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'

// Mock window.api before importing stores
const mockApi = {
  tree: vi.fn(),
  listCollections: vi.fn(),
  getActiveCollection: vi.fn(),
  addCollection: vi.fn(),
  removeCollection: vi.fn(),
  setActiveCollection: vi.fn(),
  status: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  search: vi.fn().mockResolvedValue({ results: [], query: '', total_results: 0 }),
  getUserConfig: vi.fn().mockResolvedValue({}),
  getCollectionConfig: vi.fn().mockResolvedValue({}),
  setUserConfig: vi.fn().mockResolvedValue(undefined),
  setCollectionConfig: vi.fn().mockResolvedValue(undefined),
  deleteUserConfig: vi.fn().mockResolvedValue(undefined),
  deleteCollectionConfig: vi.fn().mockResolvedValue(undefined),
  findCli: vi.fn().mockResolvedValue('/usr/local/bin/mdvdb'),
  getCliVersion: vi.fn().mockResolvedValue('1.2.3'),
  checkLatestCliVersion: vi.fn().mockResolvedValue('1.3.0'),
  installCli: vi.fn().mockResolvedValue(undefined),
  getEditorFontSize: vi.fn().mockResolvedValue(14),
  setEditorFontSize: vi.fn().mockResolvedValue(undefined),
  openPath: vi.fn(),
}

// Attach mock api to the existing jsdom window (don't replace window itself)
;(globalThis as any).window.api = mockApi

// Mock KeyboardShortcuts component to avoid complex child rendering
vi.mock('../../src/renderer/components/KeyboardShortcuts.svelte', () => ({
  default: vi.fn(),
}))

import {
  userConfig,
  collectionConfig,
  configLoading,
  activeSection,
} from '../../src/renderer/stores/settings'
import { collections, activeCollectionId } from '../../src/renderer/stores/collections'
import { get } from 'svelte/store'
import Settings from '@renderer/components/Settings.svelte'

function resetStores() {
  userConfig.set({})
  collectionConfig.set({})
  configLoading.set(false)
  activeSection.set('cli')
  collections.set([])
  activeCollectionId.set(null)
}

beforeEach(() => {
  resetStores()
  vi.clearAllMocks()
  // Re-setup default mocks
  mockApi.findCli.mockResolvedValue('/usr/local/bin/mdvdb')
  mockApi.getCliVersion.mockResolvedValue('1.2.3')
  mockApi.getEditorFontSize.mockResolvedValue(14)
  mockApi.getUserConfig.mockResolvedValue({})
})

describe('Settings component', () => {
  it('renders all 6 section headings in navigation', () => {
    render(Settings, { props: { onclose: vi.fn() } })

    expect(screen.getByText('CLI')).toBeTruthy()
    expect(screen.getByText('Embedding Provider')).toBeTruthy()
    expect(screen.getByText('Search Defaults')).toBeTruthy()
    expect(screen.getByText('Chunking')).toBeTruthy()
    expect(screen.getByText('Appearance')).toBeTruthy()
    expect(screen.getByText('About')).toBeTruthy()
  })

  it('section navigation switches active section', async () => {
    render(Settings, { props: { onclose: vi.fn() } })

    const embeddingNav = screen.getByText('Embedding Provider')
    await fireEvent.click(embeddingNav)

    expect(get(activeSection)).toBe('embedding')
  })

  it('API key input has show/hide toggle', async () => {
    activeSection.set('embedding')
    render(Settings, { props: { onclose: vi.fn() } })

    // Default state: password field with visibility icon
    const apiKeyInput = screen.getByPlaceholderText('sk-...')
    expect(apiKeyInput).toBeTruthy()
    expect(apiKeyInput.getAttribute('type')).toBe('password')

    // Find the visibility toggle button
    const visibilityBtn = screen.getByTitle('Show')
    await fireEvent.click(visibilityBtn)

    // After click, input type should be text
    expect(apiKeyInput.getAttribute('type')).toBe('text')

    // Toggle back
    const hideBtn = screen.getByTitle('Hide')
    await fireEvent.click(hideBtn)
    expect(apiKeyInput.getAttribute('type')).toBe('password')
  })

  it('provider dropdown shows API key for OpenAI, host URL for Ollama', async () => {
    activeSection.set('embedding')
    userConfig.set({ MDVDB_EMBEDDING_PROVIDER: 'openai' })
    render(Settings, { props: { onclose: vi.fn() } })

    // OpenAI: API key visible, no host URL
    expect(screen.getByPlaceholderText('sk-...')).toBeTruthy()
    expect(screen.queryByPlaceholderText('http://localhost:11434')).toBeNull()
  })

  it('provider dropdown shows host URL for Ollama', async () => {
    activeSection.set('embedding')
    userConfig.set({ MDVDB_EMBEDDING_PROVIDER: 'ollama' })
    render(Settings, { props: { onclose: vi.fn() } })

    // Ollama: host URL visible
    expect(screen.getByPlaceholderText('http://localhost:11434')).toBeTruthy()
  })

  it('font size +/- buttons work', async () => {
    activeSection.set('appearance')
    render(Settings, { props: { onclose: vi.fn() } })

    // Wait for $effect to resolve font size
    await new Promise((r) => setTimeout(r, 10))

    expect(screen.getByText('14px')).toBeTruthy()

    // Click + button (the "add" icon button)
    const addBtn = screen.getByText('add').closest('button')!
    await fireEvent.click(addBtn)

    expect(screen.getByText('15px')).toBeTruthy()
    expect(mockApi.setEditorFontSize).toHaveBeenCalledWith(15)

    // Click - button
    const removeBtn = screen.getByText('remove').closest('button')!
    await fireEvent.click(removeBtn)

    expect(screen.getByText('14px')).toBeTruthy()
    expect(mockApi.setEditorFontSize).toHaveBeenCalledWith(14)
  })

  it('close button fires close event', async () => {
    const onclose = vi.fn()
    render(Settings, { props: { onclose } })

    const closeBtn = screen.getByTitle('Close settings')
    await fireEvent.click(closeBtn)

    expect(onclose).toHaveBeenCalledOnce()
  })

  it('CLI section shows version and path', async () => {
    activeSection.set('cli')
    render(Settings, { props: { onclose: vi.fn() } })

    // Wait for async $effect to populate CLI info
    await new Promise((r) => setTimeout(r, 10))

    expect(screen.getByText('/usr/local/bin/mdvdb')).toBeTruthy()
    expect(screen.getByText('1.2.3')).toBeTruthy()
  })
})
