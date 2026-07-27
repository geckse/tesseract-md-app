import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/svelte'
import type { CollectionSkillsStatus } from '../../src/preload/api'

const mockApi = {
  checkCollectionSkills: vi.fn(),
  installCollectionSkills: vi.fn(),
  setCollectionSkillsDismissed: vi.fn()
}

Object.defineProperty(window, 'api', {
  value: mockApi,
  writable: true,
  configurable: true
})

import CollectionSkillsNotification from '../../src/renderer/components/CollectionSkillsNotification.svelte'
import {
  collectionSkillsNotice,
  resetCollectionSkillsStateForTests
} from '../../src/renderer/stores/collection-skills'

function status(state: CollectionSkillsStatus['state']): CollectionSkillsStatus {
  return {
    state,
    bundleVersion: '1.0.0',
    bundleFingerprint: 'bundle-hash',
    skillCount: 9,
    targets: [
      {
        id: 'claude',
        label: 'Claude Code',
        relativePath: '.claude/skills',
        state: 'missing',
        installedSkillCount: 0,
        totalSkillCount: 9,
        agentDirectoryPresent: true
      },
      {
        id: 'agents',
        label: 'Codex & compatible agents',
        relativePath: '.agents/skills',
        state,
        installedSkillCount: state === 'outdated' ? 9 : 0,
        totalSkillCount: 9,
        agentDirectoryPresent: false
      }
    ],
    recommendedTargetId: state === 'outdated' ? 'agents' : 'claude',
    dismissedForever: false
  }
}

function show(state: CollectionSkillsStatus['state']): void {
  collectionSkillsNotice.set({
    collectionId: 'collection-1',
    phase: 'ready',
    status: status(state),
    error: null
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  resetCollectionSkillsStateForTests()
})

describe('CollectionSkillsNotification', () => {
  it('renders nothing when the skills are current or no notice exists', () => {
    const { container } = render(CollectionSkillsNotification)
    expect(container.querySelector('.skills-banner')).toBeNull()
  })

  it('offers the detected agent folders and defaults to the recommended target', () => {
    show('missing')
    render(CollectionSkillsNotification)

    expect(
      screen.getByText('Add Tesseract skills so AI agents understand this collection.')
    ).toBeTruthy()
    const picker = screen.getByLabelText('Install Tesseract skills for') as HTMLSelectElement
    expect(picker.value).toBe('claude')
    expect(picker.options).toHaveLength(2)
    expect(screen.getByText('Install skills')).toBeTruthy()
  })

  it('labels a stale installation as an update', () => {
    show('outdated')
    render(CollectionSkillsNotification)

    expect(
      screen.getByText('Updated Tesseract skills are available for this collection.')
    ).toBeTruthy()
    expect(screen.getByText('Update skills')).toBeTruthy()
  })

  it('installs into the selected project-local agent folder', async () => {
    show('missing')
    mockApi.installCollectionSkills.mockResolvedValue(status('current'))
    render(CollectionSkillsNotification)

    await fireEvent.change(screen.getByLabelText('Install Tesseract skills for'), {
      target: { value: 'agents' }
    })
    await fireEvent.click(screen.getByText('Install skills'))

    await vi.waitFor(() =>
      expect(mockApi.installCollectionSkills).toHaveBeenCalledWith('collection-1', 'agents')
    )
  })

  it('supports both temporary and permanent dismissal', async () => {
    show('missing')
    const temporary = render(CollectionSkillsNotification)
    await fireEvent.click(screen.getByText('Not now'))
    expect(temporary.container.querySelector('.skills-banner')).toBeNull()
    temporary.unmount()

    resetCollectionSkillsStateForTests()
    show('missing')
    mockApi.setCollectionSkillsDismissed.mockResolvedValue(undefined)
    render(CollectionSkillsNotification)
    await fireEvent.click(screen.getByText('Never for this collection'))

    await vi.waitFor(() =>
      expect(mockApi.setCollectionSkillsDismissed).toHaveBeenCalledWith('collection-1', true)
    )
  })

  it('offers a retry if the bundle check itself failed', async () => {
    collectionSkillsNotice.set({
      collectionId: 'collection-1',
      phase: 'error',
      status: null,
      error: 'bundle unavailable'
    })
    mockApi.checkCollectionSkills.mockResolvedValue(status('missing'))
    render(CollectionSkillsNotification)

    expect(screen.getByText(/Tesseract skills check failed: bundle unavailable/)).toBeTruthy()
    await fireEvent.click(screen.getByText('Check again'))
    await vi.waitFor(() =>
      expect(mockApi.checkCollectionSkills).toHaveBeenCalledWith('collection-1')
    )
  })
})
