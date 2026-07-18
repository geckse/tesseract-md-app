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
  config: vi.fn().mockResolvedValue({}),
  clusterDefinitions: vi.fn().mockResolvedValue([]),
  customClusters: vi.fn().mockResolvedValue([]),
  topicUnassigned: vi.fn().mockResolvedValue(null),
  getUserConfig: vi.fn().mockResolvedValue({}),
  getCollectionConfig: vi.fn().mockResolvedValue({}),
  setUserConfig: vi.fn().mockResolvedValue(undefined),
  setCollectionConfig: vi.fn().mockResolvedValue(undefined),
  deleteUserConfig: vi.fn().mockResolvedValue(undefined),
  deleteCollectionConfig: vi.fn().mockResolvedValue(undefined),
  findCli: vi.fn().mockResolvedValue('/usr/local/bin/mdvdb'),
  getCliVersion: vi.fn().mockResolvedValue('1.2.3'),
  getAppVersion: vi.fn().mockResolvedValue('0.1.0'),
  checkLatestCliVersion: vi.fn().mockResolvedValue('1.3.0'),
  installCli: vi.fn().mockResolvedValue(undefined),
  getEditorFontSize: vi.fn().mockResolvedValue(14),
  setEditorFontSize: vi.fn().mockResolvedValue(undefined),
  getAutoShowDiff: vi.fn().mockResolvedValue(true),
  setAutoShowDiff: vi.fn().mockResolvedValue(undefined),
  getTerminalShellPath: vi.fn().mockResolvedValue(''),
  setTerminalShellPath: vi.fn().mockResolvedValue(undefined),
  getTerminalShellArgs: vi.fn().mockResolvedValue(''),
  setTerminalShellArgs: vi.fn().mockResolvedValue(undefined),
  getTerminalFontSize: vi.fn().mockResolvedValue(14),
  setTerminalFontSize: vi.fn().mockResolvedValue(undefined),
  showConfirmation: vi.fn().mockResolvedValue(true),
  openPath: vi.fn()
}

// Attach mock api to the existing jsdom window (don't replace window itself)
;(globalThis as any).window.api = mockApi

// Mock KeyboardShortcuts component to avoid complex child rendering
vi.mock('../../src/renderer/components/KeyboardShortcuts.svelte', () => ({
  default: vi.fn()
}))

import {
  userConfig,
  collectionConfig,
  configLoading,
  activeSection,
  settingsTarget,
  userDraft,
  collectionDraft,
  collectionDeletions,
  stageUserConfig
} from '../../src/renderer/stores/settings'
import { collections, activeCollectionId } from '../../src/renderer/stores/collections'
import { get } from 'svelte/store'
import Settings from '@renderer/components/Settings.svelte'

function resetStores() {
  userConfig.set({})
  collectionConfig.set({})
  configLoading.set(false)
  userDraft.set({})
  collectionDraft.set({})
  collectionDeletions.set(new Set())
  activeSection.set('cli')
  settingsTarget.set('global')
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
  mockApi.getAppVersion.mockResolvedValue('0.1.0')
  mockApi.getUserConfig.mockResolvedValue({})
  mockApi.showConfirmation.mockResolvedValue(true)
})

describe('Settings component', () => {
  it('renders Global Settings in navigation', () => {
    render(Settings, { props: { onclose: vi.fn() } })

    expect(screen.getByText('Global Settings')).toBeTruthy()
  })

  it('renders all section tabs for global view', () => {
    render(Settings, { props: { onclose: vi.fn() } })

    // Section tabs should be visible in the content area
    expect(screen.getByText('CLI')).toBeTruthy()
    expect(screen.getByText('Embedding Provider')).toBeTruthy()
    expect(screen.getByText('Search Defaults')).toBeTruthy()
    expect(screen.getByText('Chunking')).toBeTruthy()
    expect(screen.getByText('Appearance')).toBeTruthy()
    expect(screen.getByText('About')).toBeTruthy()
  })

  it('shows global page title and explainer', () => {
    render(Settings, { props: { onclose: vi.fn() } })

    expect(screen.getByText('Global System-Wide Settings')).toBeTruthy()
    expect(screen.getByText(/These settings apply to all collections/)).toBeTruthy()
  })

  it('renders collections in nav when collections exist', () => {
    collections.set([
      { id: 'c1', name: 'My Notes', path: '/tmp/notes' },
      { id: 'c2', name: 'Work Docs', path: '/tmp/work' }
    ])
    render(Settings, { props: { onclose: vi.fn() } })

    expect(screen.getByText('Collections')).toBeTruthy()
    expect(screen.getByText('My Notes')).toBeTruthy()
    expect(screen.getByText('Work Docs')).toBeTruthy()
  })

  it('clicking collection in nav shows collection settings', async () => {
    collections.set([{ id: 'c1', name: 'My Notes', path: '/tmp/notes' }])
    render(Settings, { props: { onclose: vi.fn() } })

    const collectionNav = screen.getByText('My Notes')
    await fireEvent.click(collectionNav)

    expect(get(settingsTarget)).toBe('c1')
    expect(screen.getByText('Settings for My Notes')).toBeTruthy()
    expect(screen.getByText(/These settings override global defaults/)).toBeTruthy()
  })

  it('collection view shows only embedding/search/chunking/appearance tabs', async () => {
    collections.set([{ id: 'c1', name: 'My Notes', path: '/tmp/notes' }])
    settingsTarget.set('c1')
    activeSection.set('embedding')
    render(Settings, { props: { onclose: vi.fn() } })

    // These should be present as section tabs
    const sectionTabs = screen
      .getAllByRole('button')
      .filter((btn) => btn.classList.contains('section-tab'))
    const tabTexts = sectionTabs.map((btn) => btn.textContent?.trim() ?? '')

    expect(tabTexts.some((t) => t.includes('Embedding Provider'))).toBe(true)
    expect(tabTexts.some((t) => t.includes('Search Defaults'))).toBe(true)
    expect(tabTexts.some((t) => t.includes('Chunking'))).toBe(true)
    expect(tabTexts.some((t) => t.includes('Appearance'))).toBe(true)
    // These should NOT be present
    expect(tabTexts.some((t) => t.includes('CLI'))).toBe(false)
    expect(tabTexts.some((t) => t.includes('About'))).toBe(false)
  })

  it('section tab navigation switches active section', async () => {
    render(Settings, { props: { onclose: vi.fn() } })

    // Find the Embedding Provider section tab and click it
    const tabs = screen
      .getAllByRole('button')
      .filter((btn) => btn.classList.contains('section-tab'))
    const embeddingTab = tabs.find((btn) => btn.textContent?.includes('Embedding Provider'))
    expect(embeddingTab).toBeTruthy()
    await fireEvent.click(embeddingTab!)

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

  it('close button fires close event and resets target', async () => {
    const onclose = vi.fn()
    settingsTarget.set('some-collection')
    render(Settings, { props: { onclose } })

    const closeBtn = screen.getByTitle('Close settings')
    await fireEvent.click(closeBtn)

    expect(onclose).toHaveBeenCalledOnce()
    expect(get(settingsTarget)).toBe('global')
    expect(get(activeSection)).toBe('cli')
  })

  it('keeps unsaved settings open when the native discard dialog is cancelled', async () => {
    const onclose = vi.fn()
    mockApi.showConfirmation.mockResolvedValue(false)
    render(Settings, { props: { onclose } })
    stageUserConfig('MDVDB_EMBEDDING_PROVIDER', 'ollama')

    await fireEvent.click(screen.getByTitle('Close settings'))

    await vi.waitFor(() => expect(mockApi.showConfirmation).toHaveBeenCalledOnce())
    expect(onclose).not.toHaveBeenCalled()
    expect(get(userDraft)).toEqual({ MDVDB_EMBEDDING_PROVIDER: 'ollama' })
    expect(mockApi.showConfirmation).toHaveBeenCalledWith({
      title: 'Discard unsaved settings?',
      message: 'Your unsaved settings changes will be lost.',
      confirmLabel: 'Discard Changes',
      cancelLabel: 'Keep Editing',
      tone: 'danger'
    })
  })

  it('discards unsaved settings only after native confirmation', async () => {
    const onclose = vi.fn()
    render(Settings, { props: { onclose } })
    stageUserConfig('MDVDB_EMBEDDING_PROVIDER', 'ollama')

    await fireEvent.click(screen.getByTitle('Close settings'))

    await vi.waitFor(() => expect(onclose).toHaveBeenCalledOnce())
    expect(get(userDraft)).toEqual({})
  })

  it('does not discard drafts when the current settings target is clicked again', async () => {
    render(Settings, { props: { onclose: vi.fn() } })
    stageUserConfig('MDVDB_EMBEDDING_PROVIDER', 'ollama')

    await fireEvent.click(screen.getByText('Global Settings'))

    expect(mockApi.showConfirmation).not.toHaveBeenCalled()
    expect(get(userDraft)).toEqual({ MDVDB_EMBEDDING_PROVIDER: 'ollama' })
  })

  it('cancels settings target changes when native discard is declined', async () => {
    collections.set([{ id: 'c1', name: 'My Notes', path: '/tmp/notes' }])
    mockApi.showConfirmation.mockResolvedValue(false)
    render(Settings, { props: { onclose: vi.fn() } })
    stageUserConfig('MDVDB_EMBEDDING_PROVIDER', 'ollama')

    await fireEvent.click(screen.getByText('My Notes'))

    await vi.waitFor(() => expect(mockApi.showConfirmation).toHaveBeenCalledOnce())
    expect(get(settingsTarget)).toBe('global')
    expect(get(userDraft)).toEqual({ MDVDB_EMBEDDING_PROVIDER: 'ollama' })
  })

  it('CLI section shows version and path', async () => {
    activeSection.set('cli')
    render(Settings, { props: { onclose: vi.fn() } })

    // Wait for async $effect to populate CLI info
    await new Promise((r) => setTimeout(r, 10))

    expect(screen.getByText('/usr/local/bin/mdvdb')).toBeTruthy()
    expect(screen.getByText('1.2.3')).toBeTruthy()
  })

  it('shows section explainer text', () => {
    activeSection.set('cli')
    render(Settings, { props: { onclose: vi.fn() } })

    expect(
      screen.getByText('Manage the mdvdb command-line binary used for indexing and search.')
    ).toBeTruthy()
  })

  it('shows an update label and hint when a newer CLI is available', async () => {
    activeSection.set('cli')
    render(Settings, { props: { onclose: vi.fn() } })
    await new Promise((resolve) => setTimeout(resolve, 10))
    await fireEvent.click(screen.getByText('Check for Update'))
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(screen.getByText('Update available: 1.3.0')).toBeTruthy()
    expect(screen.getByText('Update CLI')).toBeTruthy()
  })

  it('warns when an API key is edited at collection scope', () => {
    collections.set([{ id: 'c1', name: 'My Notes', path: '/tmp/notes' }])
    settingsTarget.set('c1')
    activeSection.set('embedding')
    render(Settings, { props: { onclose: vi.fn() } })

    expect(screen.getByText(/Collection API keys are stored in plaintext/)).toBeTruthy()
    expect(screen.getByText(/Collection API keys/).textContent).toContain('.markdownvdb/.config')
    expect(screen.getByText(/Collection API keys/).textContent).toContain('~/.mdvdb/config')
  })

  it('shows app and CLI versions separately in About', async () => {
    activeSection.set('about')
    render(Settings, { props: { onclose: vi.fn() } })
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(screen.getByText('App Version')).toBeTruthy()
    expect(screen.getByText('0.1.0')).toBeTruthy()
    expect(screen.getByText('CLI Version')).toBeTruthy()
    expect(screen.getByText('1.2.3')).toBeTruthy()
  })

  it('collection view shows annotations for overridden and inherited fields', async () => {
    collections.set([{ id: 'c1', name: 'My Notes', path: '/tmp/notes' }])
    settingsTarget.set('c1')
    activeSection.set('embedding')
    userConfig.set({ MDVDB_EMBEDDING_PROVIDER: 'openai' })
    collectionConfig.set({ MDVDB_EMBEDDING_PROVIDER: 'ollama' })
    render(Settings, { props: { onclose: vi.fn() } })

    // The overridden field should show (overridden) annotation
    expect(screen.getByText('(overridden)')).toBeTruthy()
    // Non-overridden fields should show (inherited from global)
    const inheritedAnnotations = screen.getAllByText('(inherited from global)')
    expect(inheritedAnnotations.length).toBeGreaterThan(0)
  })

  it('deep-link via settingsTarget opens correct collection', async () => {
    collections.set([
      { id: 'c1', name: 'My Notes', path: '/tmp/notes' },
      { id: 'c2', name: 'Work Docs', path: '/tmp/work' }
    ])
    settingsTarget.set('c2')
    activeSection.set('embedding')
    render(Settings, { props: { onclose: vi.fn() } })

    expect(screen.getByText('Settings for Work Docs')).toBeTruthy()
  })

  it('shows boost hop depth when link boosting is enabled', () => {
    activeSection.set('search')
    userConfig.set({ MDVDB_SEARCH_BOOST_LINKS: 'true' })
    render(Settings, { props: { onclose: vi.fn() } })

    expect(screen.getByPlaceholderText('1')).toBeTruthy()
    expect(screen.getByText(/How many link hops/)).toBeTruthy()
  })

  it('hides boost hop depth when link boosting is disabled', () => {
    activeSection.set('search')
    userConfig.set({ MDVDB_SEARCH_BOOST_LINKS: 'false' })
    render(Settings, { props: { onclose: vi.fn() } })

    expect(screen.queryByPlaceholderText('1')).toBeNull()
  })

  it('shows graph expansion settings', () => {
    activeSection.set('search')
    render(Settings, { props: { onclose: vi.fn() } })

    expect(screen.getByPlaceholderText('0')).toBeTruthy()
    expect(screen.getByText(/Include context from linked files/)).toBeTruthy()
  })

  it('shows expansion limit when graph expansion is enabled', () => {
    activeSection.set('search')
    userConfig.set({ MDVDB_SEARCH_EXPAND_GRAPH: '2' })
    render(Settings, { props: { onclose: vi.fn() } })

    expect(screen.getByPlaceholderText('3')).toBeTruthy()
    expect(screen.getByText(/Maximum graph context items/)).toBeTruthy()
  })

  it('hides expansion limit when graph expansion is disabled', () => {
    activeSection.set('search')
    userConfig.set({ MDVDB_SEARCH_EXPAND_GRAPH: '0' })
    render(Settings, { props: { onclose: vi.fn() } })

    expect(screen.queryByPlaceholderText('3')).toBeNull()
  })
})
