import { writable } from 'svelte/store'

/** Whether the settings panel is open. */
export const settingsOpen = writable<boolean>(false)

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
