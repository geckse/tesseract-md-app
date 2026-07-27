import { beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
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

import {
  collectionSkillsNotice,
  dismissCollectionSkillsForever,
  dismissCollectionSkillsForSession,
  installCollectionSkillsForAgent,
  refreshCollectionSkills,
  resetCollectionSkillsStateForTests
} from '../../src/renderer/stores/collection-skills'

function status(
  state: CollectionSkillsStatus['state'] = 'missing',
  dismissedForever = false
): CollectionSkillsStatus {
  return {
    state,
    bundleVersion: '1.0.0',
    bundleFingerprint: 'bundle-hash',
    skillCount: 2,
    targets: [
      {
        id: 'agents',
        label: 'Codex & compatible agents',
        relativePath: '.agents/skills',
        state,
        installedSkillCount: state === 'missing' ? 0 : 2,
        totalSkillCount: 2,
        agentDirectoryPresent: false
      }
    ],
    recommendedTargetId: 'agents',
    dismissedForever
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  resetCollectionSkillsStateForTests()
})

describe('collection skills renderer store', () => {
  it('shows a missing or outdated bundle for the active collection', async () => {
    mockApi.checkCollectionSkills.mockResolvedValue(status('missing'))

    await refreshCollectionSkills('collection-1')

    expect(get(collectionSkillsNotice)).toEqual({
      collectionId: 'collection-1',
      phase: 'ready',
      status: status('missing'),
      error: null
    })
  })

  it('stays hidden for a current or permanently dismissed bundle', async () => {
    mockApi.checkCollectionSkills.mockResolvedValueOnce(status('current'))
    await refreshCollectionSkills('collection-1')
    expect(get(collectionSkillsNotice)).toBeNull()

    mockApi.checkCollectionSkills.mockResolvedValueOnce(status('missing', true))
    await refreshCollectionSkills('collection-2')
    expect(get(collectionSkillsNotice)).toBeNull()
  })

  it('keeps a session dismissal hidden on later refreshes', async () => {
    mockApi.checkCollectionSkills.mockResolvedValue(status('missing'))
    await refreshCollectionSkills('collection-1')

    dismissCollectionSkillsForSession('collection-1')
    await refreshCollectionSkills('collection-1')

    expect(get(collectionSkillsNotice)).toBeNull()
    expect(mockApi.checkCollectionSkills).toHaveBeenCalledTimes(1)
  })

  it('installs the selected target and hides the notice once current', async () => {
    mockApi.checkCollectionSkills.mockResolvedValue(status('missing'))
    mockApi.installCollectionSkills.mockResolvedValue(status('current'))
    await refreshCollectionSkills('collection-1')

    await installCollectionSkillsForAgent('collection-1', 'agents')

    expect(mockApi.installCollectionSkills).toHaveBeenCalledWith('collection-1', 'agents')
    expect(get(collectionSkillsNotice)).toBeNull()
  })

  it('keeps the banner visible when the selected target was not verified', async () => {
    mockApi.checkCollectionSkills.mockResolvedValue(status('missing'))
    const falseSuccess = status('current')
    falseSuccess.targets[0] = {
      ...falseSuccess.targets[0],
      state: 'missing',
      installedSkillCount: 0
    }
    mockApi.installCollectionSkills.mockResolvedValue(falseSuccess)
    await refreshCollectionSkills('collection-1')

    await installCollectionSkillsForAgent('collection-1', 'agents')

    expect(get(collectionSkillsNotice)).toEqual({
      collectionId: 'collection-1',
      phase: 'error',
      status: status('missing'),
      error: 'Tesseract skills could not be verified in .agents/skills'
    })
  })

  it('surfaces a check failure without throwing from lifecycle hooks', async () => {
    mockApi.checkCollectionSkills.mockRejectedValue(new Error('bundle unavailable'))

    await refreshCollectionSkills('collection-1')

    expect(get(collectionSkillsNotice)).toEqual({
      collectionId: 'collection-1',
      phase: 'error',
      status: null,
      error: 'bundle unavailable'
    })
  })

  it('persists a permanent collection dismissal before hiding', async () => {
    mockApi.checkCollectionSkills.mockResolvedValue(status('missing'))
    mockApi.setCollectionSkillsDismissed.mockResolvedValue(undefined)
    await refreshCollectionSkills('collection-1')

    await dismissCollectionSkillsForever('collection-1')

    expect(mockApi.setCollectionSkillsDismissed).toHaveBeenCalledWith('collection-1', true)
    expect(get(collectionSkillsNotice)).toBeNull()
  })
})
