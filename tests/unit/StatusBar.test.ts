import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'

const mockApi = {
  findCli: vi.fn(),
  getCliVersion: vi.fn(),
  installCli: vi.fn(),
  getWatcherStatus: vi.fn().mockResolvedValue({ state: 'stopped' }),
  onWatcherStatus: vi.fn(),
  removeWatcherStatusListener: vi.fn()
}

;(globalThis as typeof globalThis & { window: Window & { api: typeof mockApi } }).window.api =
  mockApi

vi.mock('@renderer/components/WatcherToggle.svelte', () => ({ default: vi.fn() }))

import StatusBar from '@renderer/components/StatusBar.svelte'
import { cliFeatures } from '@renderer/lib/cli-features.svelte'

describe('StatusBar CLI state', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cliFeatures.reset()
    mockApi.installCli.mockResolvedValue({ success: true, path: '/cli', version: '0.2.0' })
  })

  it('shows a green ready state for a supported CLI', async () => {
    mockApi.findCli.mockResolvedValue('/cli')
    mockApi.getCliVersion.mockResolvedValue('0.2.0')
    render(StatusBar)

    await waitFor(() => expect(screen.getByText('mdvdb v0.2.0')).toBeTruthy())
    expect(screen.getByTitle('mdvdb CLI is ready').classList.contains('cli-found')).toBe(true)
  })

  it('shows an amber update-required state and installs on click', async () => {
    mockApi.findCli.mockResolvedValue('/cli')
    mockApi.getCliVersion.mockResolvedValue('0.1.9')
    render(StatusBar)

    const update = await screen.findByTitle('Update mdvdb CLI')
    expect(update.textContent).toContain('update required')
    expect(update.classList.contains('cli-outdated')).toBe(true)
    await fireEvent.click(update)
    expect(mockApi.installCli).toHaveBeenCalledOnce()
    await waitFor(() => expect(screen.getByText('mdvdb v0.2.0')).toBeTruthy())
  })

  it('shows a red missing state and offers installation', async () => {
    mockApi.findCli.mockResolvedValue(null)
    render(StatusBar)

    const install = await screen.findByTitle('Install mdvdb CLI')
    expect(install.textContent).toContain('CLI not found')
    expect(install.classList.contains('cli-missing')).toBe(true)
    await fireEvent.click(install)
    expect(mockApi.installCli).toHaveBeenCalledOnce()
  })
})
