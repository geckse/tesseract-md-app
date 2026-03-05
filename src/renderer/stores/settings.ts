import { writable } from 'svelte/store'

/** User-level config key-value pairs (~/.mdvdb/config). */
export const userConfig = writable<Record<string, string>>({})

/** Collection-level config key-value pairs (.markdownvdb/.config). */
export const collectionConfig = writable<Record<string, string>>({})

/** Whether a config load/save operation is in progress. */
export const configLoading = writable<boolean>(false)

/** Currently active settings section. */
export const activeSection = writable<string>('cli')

// Debounce timers for save operations
let userSaveTimer: ReturnType<typeof setTimeout> | null = null
let collectionSaveTimer: ReturnType<typeof setTimeout> | null = null

const DEBOUNCE_MS = 300

/** Load user-level config from main process. */
export async function loadUserConfig(): Promise<void> {
  configLoading.set(true)
  try {
    const config = await window.api.getUserConfig()
    userConfig.set(config)
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
  } finally {
    configLoading.set(false)
  }
}

/** Save a user-level config key-value pair (debounced). */
export async function saveUserConfig(key: string, value: string): Promise<void> {
  userConfig.update((cfg) => ({ ...cfg, [key]: value }))
  if (userSaveTimer) clearTimeout(userSaveTimer)
  return new Promise((resolve, reject) => {
    userSaveTimer = setTimeout(async () => {
      try {
        await window.api.setUserConfig(key, value)
        resolve()
      } catch (err) {
        reject(err)
      }
    }, DEBOUNCE_MS)
  })
}

/** Save a collection-level config key-value pair (debounced). */
export async function saveCollectionConfig(
  root: string,
  key: string,
  value: string
): Promise<void> {
  collectionConfig.update((cfg) => ({ ...cfg, [key]: value }))
  if (collectionSaveTimer) clearTimeout(collectionSaveTimer)
  return new Promise((resolve, reject) => {
    collectionSaveTimer = setTimeout(async () => {
      try {
        await window.api.setCollectionConfig(root, key, value)
        resolve()
      } catch (err) {
        reject(err)
      }
    }, DEBOUNCE_MS)
  })
}

/** Delete a user-level config key. */
export async function deleteUserConfigKey(key: string): Promise<void> {
  await window.api.deleteUserConfig(key)
  userConfig.update((cfg) => {
    const next = { ...cfg }
    delete next[key]
    return next
  })
}

/** Delete a collection-level config key. */
export async function deleteCollectionConfigKey(root: string, key: string): Promise<void> {
  await window.api.deleteCollectionConfig(root, key)
  collectionConfig.update((cfg) => {
    const next = { ...cfg }
    delete next[key]
    return next
  })
}
