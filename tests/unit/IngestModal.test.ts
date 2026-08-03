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
  ingestPreviewLoading,
  ingestProgress,
  ingestProgressErrors
} from '../../src/renderer/stores/ingest'
import { collections, activeCollectionId } from '../../src/renderer/stores/collections'
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
  ingestProgress.set(null)
  ingestProgressErrors.set([])
  collections.set([])
  activeCollectionId.set(null)
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
  it('shows formula module activity in a completed ingest report', () => {
    ingestResult.set({
      files_indexed: 2,
      files_skipped: 0,
      files_removed: 0,
      chunks_created: 2,
      api_calls: 1,
      files_failed: 0,
      errors: [],
      duration_secs: 0.5,
      cancelled: false,
      module_reports: [
        {
          module: 'formula',
          event: 'full_ingest',
          files_evaluated: 2,
          fields_updated: 4,
          diagnostics: [],
          duration_ms: 2
        }
      ]
    })
    ingestModalOpen.set(true)

    const { container } = render(IngestModal)

    expect(screen.getByText('ƒx Formula')).toBeTruthy()
    expect(screen.getByText(/4 fields updated across 2 files/)).toBeTruthy()
    const moduleSection = container.querySelector('.module-section')
    expect(moduleSection).toBeTruthy()
    expect(moduleSection?.querySelector('.errors-title')).toBeNull()
    expect(moduleSection?.querySelector('.error-item')).toBeNull()
  })

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

describe('IngestModal progress and preview', () => {
  it('renders determinate embedding counters and live file errors', () => {
    ingestRunning.set(true)
    ingestIsReindex.set(true)
    ingestModalOpen.set(true)
    ingestProgress.set({
      phase: 'embedding',
      completed_batches: 2,
      total_batches: 4,
      completed_chunks: 6,
      total_chunks: 12,
      estimated_input_tokens: 80,
      total_estimated_input_tokens: 160,
      api_calls: 2,
      elapsed_ms: 1000
    })
    ingestProgressErrors.set([{ path: 'bad.md', message: 'Could not parse file' }])

    const { container } = render(IngestModal)

    expect(screen.getByText('Reindexing Collection')).toBeTruthy()
    expect(screen.getByText('Embedding')).toBeTruthy()
    expect(screen.getByText('50%')).toBeTruthy()
    expect(screen.getByText('2 / 4')).toBeTruthy()
    expect(screen.getByText('6 / 12')).toBeTruthy()
    expect(screen.getByText('80 / 160')).toBeTruthy()
    expect(screen.getByText('bad.md')).toBeTruthy()
    expect(container.querySelector('.progress-bar-determinate')).toBeTruthy()
    expect(screen.getByText('Run in background')).toBeTruthy()
  })

  it('starts the confirmed full reindex from its preview', async () => {
    collections.set([{ id: 'test', name: 'Test', path: '/test', addedAt: 1, lastOpenedAt: 1 }])
    activeCollectionId.set('test')
    ingestIsReindex.set(true)
    ingestModalOpen.set(true)
    ingestPreviewResult.set({
      files: [],
      total_files: 2,
      files_to_process: 2,
      files_unchanged: 0,
      total_chunks: 3,
      estimated_tokens: 100,
      estimated_api_calls: 1
    })
    mockApi.ingest.mockReturnValue(new Promise(() => {}))

    render(IngestModal)
    await fireEvent.click(screen.getByText('Start full reindex'))

    expect(mockApi.ingest).toHaveBeenCalledWith('/test', { reindex: true })
  })
})
