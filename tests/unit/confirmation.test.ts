import { beforeEach, describe, expect, it, vi } from 'vitest'
import { requestConfirmation } from '@renderer/stores/confirmation'

const showConfirmation = vi.fn()

describe('requestConfirmation', () => {
  beforeEach(() => {
    showConfirmation.mockReset()
    Object.defineProperty(globalThis, 'window', {
      value: { api: { showConfirmation } },
      configurable: true
    })
  })

  it('delegates simple prompts to the native dialog bridge', async () => {
    const options = {
      title: 'Discard unsaved changes?',
      message: 'Your document will return to the last saved version.',
      confirmLabel: 'Discard Changes',
      cancelLabel: 'Keep Editing',
      tone: 'danger' as const
    }
    showConfirmation.mockResolvedValue(true)

    await expect(requestConfirmation(options)).resolves.toBe(true)
    expect(showConfirmation).toHaveBeenCalledWith(options)
  })

  it('preserves a native cancellation result', async () => {
    showConfirmation.mockResolvedValue(false)

    await expect(
      requestConfirmation({ title: 'Close tab?', message: 'Unsaved work remains.' })
    ).resolves.toBe(false)
  })
})
