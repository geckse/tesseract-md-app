import { writable, derived, get } from 'svelte/store'
import type { Collection } from '../../preload/api'
import type { IndexStatus, DoctorResult } from '../types/cli'

/** All collections managed by the app. */
export const collections = writable<Collection[]>([])

/** ID of the currently active collection. */
export const activeCollectionId = writable<string | null>(null)

/** Derived store resolving the active collection object. */
export const activeCollection = derived(
  [collections, activeCollectionId],
  ([$collections, $activeCollectionId]) =>
    $collections.find((c) => c.id === $activeCollectionId) ?? null
)

/** Index status for the active collection (fetched on demand). */
export const collectionStatus = writable<IndexStatus | null>(null)

/** Doctor diagnostic result for the active collection. */
export const collectionDoctorResult = writable<DoctorResult | null>(null)

/** Whether collections are currently loading. */
export const collectionsLoading = writable<boolean>(false)

/** Load all collections from the main process store. */
export async function loadCollections(): Promise<void> {
  collectionsLoading.set(true)
  try {
    const list = await window.api.listCollections()
    collections.set(list)
    const active = await window.api.getActiveCollection()
    activeCollectionId.set(active?.id ?? null)
    if (active?.id) {
      // Fire status/doctor in the background — don't block app startup
      fetchCollectionStatus(active.id).catch(() => {})
      fetchCollectionDoctorStatus(active.id).catch(() => {})
    }
  } finally {
    collectionsLoading.set(false)
  }
}

/** Open native folder picker and add a new collection. */
export async function addCollection(): Promise<Collection | null> {
  const collection = await window.api.addCollection()
  if (collection) {
    collections.update((list) => [...list, collection])
  }
  return collection
}

/** Remove a collection by ID (does not delete files on disk). */
export async function removeCollection(id: string): Promise<void> {
  await window.api.removeCollection(id)
  collections.update((list) => list.filter((c) => c.id !== id))
  activeCollectionId.update((current) => (current === id ? null : current))
  collectionStatus.set(null)
  collectionDoctorResult.set(null)
}

/** Set the active collection and fetch its status. */
export async function setActiveCollection(id: string): Promise<void> {
  await window.api.setActiveCollection(id)
  activeCollectionId.set(id)
  collectionStatus.set(null)
  collectionDoctorResult.set(null)
  // Fire status/doctor fetches in the background — don't block callers
  fetchCollectionStatus(id).catch(() => {})
  fetchCollectionDoctorStatus(id).catch(() => {})
}

/** Fetch index status for a collection by ID. */
async function fetchCollectionStatus(id: string): Promise<void> {
  const collection = get(collections).find((c) => c.id === id)
  if (!collection) return
  const path = collection.path

  try {
    const status = await window.api.status(path)
    collectionStatus.set(status)
  } catch {
    collectionStatus.set(null)
  }
}

/** Fetch doctor diagnostic results for a collection by ID. */
async function fetchCollectionDoctorStatus(id: string): Promise<void> {
  const collection = get(collections).find((c) => c.id === id)
  if (!collection) return
  const path = collection.path

  try {
    const result = await window.api.doctor(path)
    collectionDoctorResult.set(result)
  } catch {
    collectionDoctorResult.set(null)
  }
}
