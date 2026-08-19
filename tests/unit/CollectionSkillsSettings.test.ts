import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import type { CollectionSkillsStatus, CollectionSkillsTargetId } from '../../src/preload/api'

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

import CollectionSkillsSettings from '../../src/renderer/components/CollectionSkillsSettings.svelte'
import { resetCollectionSkillsStateForTests } from '../../src/renderer/stores/collection-skills'

function status(
  states: Partial<
    Record<CollectionSkillsTargetId, 'missing' | 'outdated' | 'current' | 'blocked'>
  > = {}
): CollectionSkillsStatus {
  const target = (
    id: CollectionSkillsTargetId,
    label: string,
    relativePath: string
  ): CollectionSkillsStatus['targets'][number] => {
    const state = states[id] ?? 'missing'
    return {
      id,
      label,
      relativePath,
      state,
      installedSkillCount: state === 'missing' || state === 'blocked' ? 0 : 9,
      totalSkillCount: 9,
      agentDirectoryPresent: id !== 'gemini'
    }
  }

  const targets = [
    target('claude', 'Claude Code', '.claude/skills'),
    target('agents', 'Codex & compatible agents', '.agents/skills'),
    target('gemini', 'Gemini CLI', '.gemini/skills')
  ]
  return {
    state: targets.some((item) => item.state === 'current')
      ? 'current'
      : targets.some((item) => item.state === 'outdated')
        ? 'outdated'
        : 'missing',
    bundleVersion: '1.2.0',
    bundleFingerprint: 'bundle-hash',
    skillCount: 9,
    targets,
    recommendedTargetId: 'agents',
    dismissedForever: false
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  resetCollectionSkillsStateForTests()
  mockApi.checkCollectionSkills.mockResolvedValue(status())
})

describe('CollectionSkillsSettings', () => {
  it('shows every supported project-local agent destination', async () => {
    render(CollectionSkillsSettings, { props: { collectionId: 'collection-1' } })

    await waitFor(() => expect(screen.getByText('Claude Code')).toBeTruthy())
    expect(screen.getByText('Codex & compatible agents')).toBeTruthy()
    expect(screen.getByText('Gemini CLI')).toBeTruthy()
    expect(screen.getByText('.claude/skills')).toBeTruthy()
    expect(screen.getByText('.agents/skills')).toBeTruthy()
    expect(screen.getByText('.gemini/skills')).toBeTruthy()
  })

  it('installs Claude and Codex in one selected operation', async () => {
    mockApi.installCollectionSkills.mockImplementation(
      async (_collectionId: string, targetId: CollectionSkillsTargetId) =>
        targetId === 'claude'
          ? status({ claude: 'current' })
          : status({ claude: 'current', agents: 'current' })
    )
    render(CollectionSkillsSettings, { props: { collectionId: 'collection-1' } })

    await waitFor(() => expect(screen.getByText('Install / update 2 targets')).toBeTruthy())
    await fireEvent.click(screen.getByText('Install / update 2 targets'))

    await waitFor(() => expect(mockApi.installCollectionSkills).toHaveBeenCalledTimes(2))
    expect(mockApi.installCollectionSkills).toHaveBeenNthCalledWith(1, 'collection-1', 'claude')
    expect(mockApi.installCollectionSkills).toHaveBeenNthCalledWith(2, 'collection-1', 'agents')
  })

  it('offers updates for stale targets without selecting a current target', async () => {
    mockApi.checkCollectionSkills.mockResolvedValue(
      status({ claude: 'current', agents: 'outdated' })
    )
    render(CollectionSkillsSettings, { props: { collectionId: 'collection-1' } })

    await waitFor(() => expect(screen.getByText('Update selected')).toBeTruthy())
    expect(
      (screen.getByLabelText('Claude Code skill destination') as HTMLInputElement).disabled
    ).toBe(true)
    expect(
      (screen.getByLabelText('Codex & compatible agents skill destination') as HTMLInputElement)
        .checked
    ).toBe(true)
    expect(screen.getByText(/Update available/)).toBeTruthy()
  })

  it('can select every missing or outdated destination', async () => {
    mockApi.checkCollectionSkills.mockResolvedValue(
      status({ claude: 'current', agents: 'missing', gemini: 'outdated' })
    )
    render(CollectionSkillsSettings, { props: { collectionId: 'collection-1' } })

    await waitFor(() => expect(screen.getByText('Clear selection')).toBeTruthy())
    await fireEvent.click(screen.getByText('Clear selection'))
    expect(screen.getByText('Select all available')).toBeTruthy()
    await fireEvent.click(screen.getByText('Select all available'))

    expect(
      (screen.getByLabelText('Codex & compatible agents skill destination') as HTMLInputElement)
        .checked
    ).toBe(true)
    expect(
      (screen.getByLabelText('Gemini CLI skill destination') as HTMLInputElement).checked
    ).toBe(true)
    expect(screen.getByText('Install / update 2 targets')).toBeTruthy()
  })

  it('surfaces inspection failures with a retry action', async () => {
    mockApi.checkCollectionSkills.mockRejectedValueOnce(new Error('Bundle unavailable'))
    render(CollectionSkillsSettings, { props: { collectionId: 'collection-1' } })

    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toContain('Bundle unavailable')
    )
    await fireEvent.click(screen.getByText('Refresh'))
    await waitFor(() => expect(screen.getByText('Claude Code')).toBeTruthy())
    expect(mockApi.checkCollectionSkills).toHaveBeenCalledTimes(2)
  })
})
