import { writable } from 'svelte/store'
import type { UpdateEvent, UpdateCheckResult } from '../../preload/api'

/** Current update state. */
export const updateState = writable<
  'idle' | 'checking' | 'update-available' | 'downloading' | 'ready' | 'error'
>('idle')

/** Version string of the available update, if any. */
export const updateVersion = writable<string | null>(null)

/** Release notes for the available update. */
export const releaseNotes = writable<string | null>(null)

/** Download progress percentage (0–100). */
export const downloadProgress = writable<number>(0)

/** Error message if the updater encountered an error. */
export const updateError = writable<string | null>(null)

/** Whether the user has dismissed the current notification. */
export const updateDismissed = writable<boolean>(false)

/** Handle an incoming update event from the main process. */
function handleUpdateEvent(event: UpdateEvent): void {
  switch (event.type) {
    case 'checking':
      updateState.set('checking')
      updateError.set(null)
      break

    case 'available': {
      const data = event.data as UpdateCheckResult
      updateState.set('update-available')
      updateVersion.set(data?.version ?? null)
      releaseNotes.set(data?.releaseNotes ?? null)
      updateDismissed.set(false)
      break
    }

    case 'not-available':
      updateState.set('idle')
      break

    case 'downloading': {
      const progress = event.data as { percent: number }
      updateState.set('downloading')
      downloadProgress.set(progress?.percent ?? 0)
      break
    }

    case 'downloaded':
      updateState.set('ready')
      downloadProgress.set(100)
      break

    case 'error': {
      const errorData = event.data as { error: string }
      updateState.set('error')
      updateError.set(errorData?.error ?? 'Unknown update error')
      break
    }
  }
}

/** Check for updates. */
export async function checkForUpdates(): Promise<void> {
  updateError.set(null)
  updateState.set('checking')

  try {
    const result = await window.api.checkForUpdates()
    if (!result.updateAvailable) {
      updateState.set('idle')
    }
    // If available, the event listener will handle state transition
  } catch (err) {
    updateError.set(err instanceof Error ? err.message : String(err))
    updateState.set('error')
  }
}

/** Download the available update. */
export async function downloadUpdate(): Promise<void> {
  updateError.set(null)
  updateState.set('downloading')
  downloadProgress.set(0)

  try {
    await window.api.downloadUpdate()
  } catch (err) {
    updateError.set(err instanceof Error ? err.message : String(err))
    updateState.set('error')
  }
}

/** Install the downloaded update (quit and restart). */
export async function installUpdate(): Promise<void> {
  try {
    await window.api.installUpdate()
  } catch (err) {
    updateError.set(err instanceof Error ? err.message : String(err))
    updateState.set('error')
  }
}

/** Skip the current version (dismiss and reset state). */
export function skipVersion(): void {
  updateDismissed.set(true)
  updateState.set('idle')
  updateVersion.set(null)
  releaseNotes.set(null)
}

/** Dismiss the current update notification without skipping. */
export function dismissNotification(): void {
  updateDismissed.set(true)
}

/** Set up the update event listener. Call on app mount. */
export function setupUpdateListener(): void {
  window.api.onUpdateEvent(handleUpdateEvent)
}

/** Remove the update event listener. Call on app unmount. */
export function teardownUpdateListener(): void {
  window.api.removeUpdateEventListener()
}
