import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'
import { get } from 'svelte/store'

const mockApi = {
  listCollections: vi.fn(),
  getActiveCollection: vi.fn(),
  addCollection: vi.fn(),
  removeCollection: vi.fn(),
  setActiveCollection: vi.fn(),
  status: vi.fn().mockResolvedValue({}),
  search: vi.fn(),
  fileTree: vi.fn().mockResolvedValue(null),
  ingest: vi.fn(),
  ingestPreview: vi.fn(),
  cancelIngest: vi.fn(),
  resetIndex: vi.fn()
}

// Attach mockApi to existing window to preserve DOM methods (addEventListener etc.)
// needed because IngestModal uses svelte:window
;(globalThis as unknown as { window: unknown }).window = Object.assign(globalThis.window ?? {}, {
  api: mockApi
})

import {
  ingestState,
  ingestRunning,
  ingestIsReindex,
  ingestElapsed,
  ingestResult,
  ingestError,
  ingestModalOpen,
  ingestPreviewResult,
  ingestPreviewLoading
} from '../../src/renderer/stores/ingest'
import { activeSection } from '../../src/renderer/stores/settings'
import { settingsOpen } from '../../src/renderer/stores/ui'
import { classifyCliError } from '../../src/renderer/lib/cli-errors'
import IngestModal from '@renderer/components/IngestModal.svelte'

function resetStores() {
  ingestState.set('idle')
  ingestRunning.set(false)
  ingestIsReindex.set(false)
  ingestElapsed.set(0)
  ingestResult.set(null)
  ingestError.set(null)
  ingestModalOpen.set(false)
  ingestPreviewResult.set(null)
  ingestPreviewLoading.set(false)
  settingsOpen.set(false)
  activeSection.set('cli')
}

function openWithError(rawMessage: string) {
  ingestError.set(classifyCliError(new Error(rawMessage)))
  ingestState.set('error')
  ingestModalOpen.set(true)
}

beforeEach(() => {
  resetStores()
  vi.clearAllMocks()
})

describe('IngestModal error states', () => {
  it('preserves the corrupted-index branch for index-corrupted errors', () => {
    openWithError("CLI command 'ingest' failed after 3 attempts: index corrupted: bad header")

    render(IngestModal)

    expect(screen.getByText('Index Corrupted')).toBeTruthy()
    expect(screen.getByText('Rebuild Index')).toBeTruthy()
    expect(screen.queryByText('Open Embedding Settings')).toBeNull()
  })

  it('shows settings CTA for a missing-key error and hides the rebuild button', () => {
    // Verbatim Rust message from src/embedding/provider.rs (see cli-errors.test.ts)
    openWithError('embedding provider error: OpenAI provider requires OPENAI_API_KEY to be set')

    render(IngestModal)

    expect(screen.getByText('API key missing')).toBeTruthy()
    expect(screen.getByText(/No OpenAI API key is configured/)).toBeTruthy()
    expect(screen.getByText('Open Embedding Settings')).toBeTruthy()
    expect(screen.queryByText('Delete Index & Rebuild')).toBeNull()
  })

  it('shows settings CTA for a bad-key error', () => {
    openWithError('embedding provider error: authentication failed (401): invalid API key')

    render(IngestModal)

    expect(screen.getByText('Invalid API key')).toBeTruthy()
    expect(screen.getByText('Open Embedding Settings')).toBeTruthy()
  })

  it('does NOT show a settings CTA for a rate-limit error', () => {
    openWithError('embedding provider error: rate limited (429)')

    render(IngestModal)

    expect(screen.getByText('Rate limited')).toBeTruthy()
    expect(screen.queryByText('Open Embedding Settings')).toBeNull()
    expect(screen.queryByText('Open CLI Settings')).toBeNull()
    // Generic fallback actions remain available
    expect(screen.getByText('Delete Index & Rebuild')).toBeTruthy()
  })

  it('keeps the "Indexing Failed" title for unknown errors', () => {
    openWithError('something exploded')

    render(IngestModal)

    expect(screen.getByText('Indexing Failed')).toBeTruthy()
    expect(screen.getByText('something exploded')).toBeTruthy()
    expect(screen.queryByText('Open Embedding Settings')).toBeNull()
  })

  it('clicking the CTA closes the modal and opens embedding settings', async () => {
    openWithError('embedding provider error: OpenAI provider requires OPENAI_API_KEY to be set')

    render(IngestModal)

    await fireEvent.click(screen.getByText('Open Embedding Settings'))

    expect(get(ingestModalOpen)).toBe(false)
    expect(get(settingsOpen)).toBe(true)
    expect(get(activeSection)).toBe('embedding')
  })
})
