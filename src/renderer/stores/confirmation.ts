import type { NativeConfirmationOptions } from '../../preload/api'

export type ConfirmationOptions = NativeConfirmationOptions

/**
 * Show a simple operating-system confirmation dialog. Rich workflows with
 * forms, previews, or multiple steps continue to use renderer modals.
 */
export function requestConfirmation(options: ConfirmationOptions): Promise<boolean> {
  return window.api.showConfirmation(options)
}
