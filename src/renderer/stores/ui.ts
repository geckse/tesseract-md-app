import { writable } from 'svelte/store'

/** Whether the settings panel is open. */
export const settingsOpen = writable<boolean>(false)

/** Whether the keyboard-shortcuts reference modal is open. */
export const shortcutsModalOpen = writable<boolean>(false)

/** Create a boolean store persisted to localStorage. */
function persistedBoolean(key: string, defaultValue: boolean) {
  let initial = defaultValue
  try {
    const stored = localStorage.getItem(key)
    if (stored !== null) initial = stored === 'true'
  } catch {
    // localStorage unavailable (tests) — keep default
  }
  const store = writable<boolean>(initial)
  store.subscribe((value) => {
    try {
      localStorage.setItem(key, String(value))
    } catch {
      // ignore persistence failures
    }
  })
  return store
}

/** Whether the properties panel is open (persisted; shared by Titlebar, Header, menu). */
export const propertiesOpen = persistedBoolean('mdvdb-properties-open', false)

/** Toggle the properties panel. */
export function togglePropertiesPanel(): void {
  propertiesOpen.update((v) => !v)
}

/** Whether the sidebar is visible (persisted; View > Toggle Sidebar). */
export const sidebarVisible = persistedBoolean('mdvdb-sidebar-visible', true)

/** Toggle sidebar visibility. */
export function toggleSidebar(): void {
  sidebarVisible.update((v) => !v)
}

/** Whether the user has completed onboarding. */
export const onboardingComplete = writable<boolean>(true)

/** Load onboarding state from the main process store. */
export async function loadOnboardingState(): Promise<void> {
  const complete = await window.api.getOnboardingComplete()
  onboardingComplete.set(complete)
}

/** Mark onboarding as complete. */
export async function completeOnboarding(): Promise<void> {
  await window.api.setOnboardingComplete(true)
  onboardingComplete.set(true)
}

/** Editor font size in pixels. */
export const editorFontSize = writable<number>(17)

/** Load editor font size from the main process store. */
export async function loadEditorFontSize(): Promise<void> {
  const size = await window.api.getEditorFontSize()
  editorFontSize.set(size)
}

/** UI zoom level (1.0 = 100%). */
export const zoomLevel = writable<number>(1.0)

const ZOOM_MIN = 0.5
const ZOOM_MAX = 2.0
const ZOOM_STEP = 0.1

/** Load zoom level from the main process store. */
export async function loadZoomLevel(): Promise<void> {
  const level = await window.api.getZoomLevel()
  zoomLevel.set(level)
}

/** Zoom in by one step. */
export function zoomIn(): void {
  zoomLevel.update((z) => {
    const next = Math.min(ZOOM_MAX, Math.round((z + ZOOM_STEP) * 10) / 10)
    window.api.setZoomLevel(next)
    return next
  })
}

/** Zoom out by one step. */
export function zoomOut(): void {
  zoomLevel.update((z) => {
    const next = Math.max(ZOOM_MIN, Math.round((z - ZOOM_STEP) * 10) / 10)
    window.api.setZoomLevel(next)
    return next
  })
}

/** Reset zoom to 100%. */
export function zoomReset(): void {
  zoomLevel.set(1.0)
  window.api.setZoomLevel(1.0)
}
