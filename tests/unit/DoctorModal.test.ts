import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'
import { tick } from 'svelte'

const mockOpenSettingsSection = vi.fn()
vi.mock('@renderer/stores/settings', () => ({
  openSettingsSection: (...args: unknown[]) => mockOpenSettingsSection(...args)
}))

const mockRunIngest = vi.fn()
vi.mock('@renderer/stores/ingest', () => ({
  runIngest: (...args: unknown[]) => mockRunIngest(...args)
}))

const mockApi = {
  doctor: vi.fn(),
  showItemInFolder: vi.fn().mockResolvedValue(undefined),
  listCollections: vi.fn().mockResolvedValue([]),
  getActiveCollection: vi.fn().mockResolvedValue(null),
  status: vi.fn()
}
Object.defineProperty(globalThis, 'window', {
  value: Object.assign(globalThis.window ?? {}, { api: mockApi }),
  writable: true
})

import DoctorModal from '@renderer/components/DoctorModal.svelte'
import {
  doctorModalOpen,
  doctorRunning,
  collectionDoctorResult,
  collections,
  activeCollectionId
} from '@renderer/stores/collections'
import type { DoctorResult } from '@renderer/types/cli'

const passingResult: DoctorResult = {
  checks: [
    { name: 'Config loaded', status: 'Pass', detail: 'provider=mock model=test dims=8' },
    { name: 'Index', status: 'Pass', detail: '10 docs, 42 chunks' }
  ],
  passed: 2,
  total: 2
}

const failingResult: DoctorResult = {
  checks: [
    { name: 'Config loaded', status: 'Pass', detail: 'ok' },
    { name: 'API key', status: 'Fail', detail: 'OPENAI_API_KEY not set' },
    { name: 'Index', status: 'Warn', detail: 'index is empty' },
    { name: 'Source directories', status: 'Fail', detail: 'missing dir' },
    { name: 'Some Future Check', status: 'Warn', detail: 'unknown to the app' }
  ],
  passed: 1,
  total: 5
}

describe('DoctorModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    collections.set([{ id: 'col-1', name: 'Notes', path: '/vault', addedAt: 0, lastOpenedAt: 0 }])
    activeCollectionId.set('col-1')
    collectionDoctorResult.set(null)
    doctorRunning.set(false)
    doctorModalOpen.set(false)
  })

  it('renders nothing while closed', () => {
    collectionDoctorResult.set(passingResult)
    render(DoctorModal)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows the checks with a passed summary', async () => {
    collectionDoctorResult.set(passingResult)
    doctorModalOpen.set(true)
    render(DoctorModal)
    await tick()

    expect(screen.getByRole('dialog', { name: 'Collection Doctor' })).toBeTruthy()
    expect(screen.getByText('2/2 checks passed', { exact: false })).toBeTruthy()
    expect(screen.getByText('Config loaded')).toBeTruthy()
    expect(screen.getByText('10 docs, 42 chunks')).toBeTruthy()
    // All-pass → no CTA buttons
    expect(screen.queryByText('Open Settings')).toBeNull()
  })

  it('offers contextual fix actions per failing check name', async () => {
    collectionDoctorResult.set(failingResult)
    doctorModalOpen.set(true)
    render(DoctorModal)
    await tick()

    // API key fail → embedding settings deep link
    const openSettings = screen.getByText('Open Settings')
    await fireEvent.click(openSettings)
    expect(mockOpenSettingsSection).toHaveBeenCalledWith('global', 'embedding')

    // Index warn → reindex CTA
    doctorModalOpen.set(true)
    await tick()
    const reindex = screen.getByText('Reindex')
    await fireEvent.click(reindex)
    expect(mockRunIngest).toHaveBeenCalledWith(true)

    // Source directories fail → reveal collection
    doctorModalOpen.set(true)
    await tick()
    const reveal = screen.getByText('Reveal Collection')
    await fireEvent.click(reveal)
    expect(mockApi.showItemInFolder).toHaveBeenCalledWith('/vault')

    // Unknown check name → no CTA rendered for it (only known ones exist)
    expect(screen.getByText('Some Future Check')).toBeTruthy()
  })

  it('shows the CLI fallback when doctor produced no result', async () => {
    collectionDoctorResult.set(null)
    doctorModalOpen.set(true)
    render(DoctorModal)
    await tick()

    expect(screen.getByText('Doctor could not run', { exact: false })).toBeTruthy()
    const cta = screen.getByText('CLI Settings')
    await fireEvent.click(cta)
    expect(mockOpenSettingsSection).toHaveBeenCalledWith('global', 'cli')
  })

  it('disables Run Again while a run is in flight and re-runs doctor on click', async () => {
    collectionDoctorResult.set(passingResult)
    doctorModalOpen.set(true)
    doctorRunning.set(true)
    render(DoctorModal)
    await tick()

    const runAgain = screen.getByText('Run Again').closest('button')!
    expect(runAgain.disabled).toBe(true)

    doctorRunning.set(false)
    await tick()
    expect(runAgain.disabled).toBe(false)

    mockApi.doctor.mockResolvedValue(passingResult)
    await fireEvent.click(runAgain)
    expect(mockApi.doctor).toHaveBeenCalledWith('/vault')
  })

  it('closes on the Close button', async () => {
    collectionDoctorResult.set(passingResult)
    doctorModalOpen.set(true)
    render(DoctorModal)
    await tick()

    await fireEvent.click(screen.getByText('Close'))
    await tick()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
