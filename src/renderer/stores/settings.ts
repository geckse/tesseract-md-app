import { writable, derived, get } from 'svelte/store'

/** User-level config key-value pairs (~/.mdvdb/config) — last saved state. */
export const userConfig = writable<Record<string, string>>({})

/** Collection-level config key-value pairs (.markdownvdb/.config) — last saved state. */
export const collectionConfig = writable<Record<string, string>>({})

/** Draft edits not yet persisted. Key → new value. */
export const userDraft = writable<Record<string, string>>({})
export const collectionDraft = writable<Record<string, string>>({})

/** Keys scheduled for deletion (collection overrides reset to inherited). */
export const collectionDeletions = writable<Set<string>>(new Set())

/** Whether a config load/save operation is in progress. */
export const configLoading = writable<boolean>(false)

/** Whether the draft has unsaved changes. */
export const isDirty = derived(
  [userDraft, collectionDraft, collectionDeletions],
  ([$ud, $cd, $dels]) =>
    Object.keys($ud).length > 0 || Object.keys($cd).length > 0 || $dels.size > 0
)

/** Save status feedback: null = idle, 'saved' = success, 'error' = failure. Auto-clears after timeout. */
export const saveStatus = writable<'saved' | 'error' | null>(null)

let saveStatusTimer: ReturnType<typeof setTimeout> | null = null

function showSaveStatus(status: 'saved' | 'error'): void {
  if (saveStatusTimer) clearTimeout(saveStatusTimer)
  saveStatus.set(status)
  saveStatusTimer = setTimeout(() => saveStatus.set(null), 2000)
}

/** Currently active settings section. */
export const activeSection = writable<string>('cli')

/** Settings target: 'global' for user-level config, or a collection ID for collection overrides. */
export const settingsTarget = writable<string>('global')

/** Open settings panel targeting a specific collection. */
export function openCollectionSettings(collectionId: string): void {
  settingsTarget.set(collectionId)
  activeSection.set('embedding')
}

/** Load user-level config from main process. */
export async function loadUserConfig(): Promise<void> {
  configLoading.set(true)
  try {
    const config = await window.api.getUserConfig()
    userConfig.set(config)
    userDraft.set({})
  } finally {
    configLoading.set(false)
  }
}

/** Load collection-level config for a given root path. */
export async function loadCollectionConfig(root: string): Promise<void> {
  configLoading.set(true)
  try {
    const config = await window.api.getCollectionConfig(root)
    collectionConfig.set(config)
    collectionDraft.set({})
    collectionDeletions.set(new Set())
  } finally {
    configLoading.set(false)
  }
}

/** Stage a user-level config edit (local draft only, not persisted). */
export function stageUserConfig(key: string, value: string): void {
  userDraft.update((d) => ({ ...d, [key]: value }))
}

/** Stage a collection-level config edit (local draft only, not persisted). */
export function stageCollectionConfig(key: string, value: string): void {
  // If it was scheduled for deletion, un-delete it
  collectionDeletions.update((s) => {
    const next = new Set(s)
    next.delete(key)
    return next
  })
  collectionDraft.update((d) => ({ ...d, [key]: value }))
}

/** Stage a collection key for deletion (reset to inherited). */
export function stageCollectionDelete(key: string): void {
  collectionDraft.update((d) => {
    const next = { ...d }
    delete next[key]
    return next
  })
  collectionDeletions.update((s) => {
    const next = new Set(s)
    next.add(key)
    return next
  })
}

/** Persist all staged changes to disk. */
export async function saveAllSettings(collectionRoot?: string): Promise<void> {
  const ud = get(userDraft)
  const cd = get(collectionDraft)
  const dels = get(collectionDeletions)

  try {
    // Save user-level changes
    for (const [key, value] of Object.entries(ud)) {
      await window.api.setUserConfig(key, value)
    }

    // Save collection-level changes
    if (collectionRoot) {
      for (const [key, value] of Object.entries(cd)) {
        await window.api.setCollectionConfig(collectionRoot, key, value)
      }
      for (const key of dels) {
        await window.api.deleteCollectionConfig(collectionRoot, key)
      }
    }

    // Merge drafts into saved state
    if (Object.keys(ud).length > 0) {
      userConfig.update((cfg) => ({ ...cfg, ...ud }))
    }
    if (collectionRoot && Object.keys(cd).length > 0) {
      collectionConfig.update((cfg) => ({ ...cfg, ...cd }))
    }
    if (collectionRoot && dels.size > 0) {
      collectionConfig.update((cfg) => {
        const next = { ...cfg }
        for (const key of dels) delete next[key]
        return next
      })
    }

    // Clear drafts
    userDraft.set({})
    collectionDraft.set({})
    collectionDeletions.set(new Set())

    showSaveStatus('saved')
  } catch {
    showSaveStatus('error')
  }
}

/** Discard all unsaved draft changes. */
export function discardDraft(): void {
  userDraft.set({})
  collectionDraft.set({})
  collectionDeletions.set(new Set())
}

/** Delete a user-level config key (immediate, no draft). */
export async function deleteUserConfigKey(key: string): Promise<void> {
  await window.api.deleteUserConfig(key)
  userConfig.update((cfg) => {
    const next = { ...cfg }
    delete next[key]
    return next
  })
}
