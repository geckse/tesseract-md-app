import { writable, derived, get } from 'svelte/store'
import type { Collection } from '../../preload/api'
import type { IndexStatus, DoctorResult, VaultInfo } from '../types/cli'

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

/** Whether the doctor modal is open. */
export const doctorModalOpen = writable<boolean>(false)

/** Whether a doctor run is currently in flight. */
export const doctorRunning = writable<boolean>(false)

/** Information snapshot for the active collection and current scope. */
export const collectionInfo = writable<VaultInfo | null>(null)

/** Whether the collection information modal is open. */
export const infoModalOpen = writable<boolean>(false)

/** Whether an information request is currently in flight. */
export const infoLoading = writable<boolean>(false)

/** User-facing information request error. */
export const infoError = writable<string | null>(null)

/** Relative folder scope, or null for the whole vault. */
export const infoScope = writable<string | null>(null)

/** Whether collections are currently loading. */
export const collectionsLoading = writable<boolean>(false)

// Async collection metadata is fetched in the background. These generations
// make every channel last-request-wins so a slow response from the previously
// active collection cannot overwrite the current collection's UI.
let statusRequestGeneration = 0
let doctorRequestGeneration = 0
let infoRequestGeneration = 0

function invalidateCollectionMetadataRequests(): void {
  statusRequestGeneration++
  doctorRequestGeneration++
  infoRequestGeneration++
  doctorRunning.set(false)
}

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

/**
 * Add a collection via the native picker and activate it on success.
 * Shared by the sidebar "+" button and the Collection > Add Collection… menu.
 */
export async function addAndActivateCollection(): Promise<Collection | null> {
  const collection = await addCollection()
  if (collection) {
    await setActiveCollection(collection.id)
  }
  return collection
}

/** Create (or reuse) the guided example collection and make it active. */
export async function createAndActivateExampleCollection(): Promise<Collection> {
  const collection = await window.api.createExampleCollection()
  collections.update((list) => {
    const existingIndex = list.findIndex((item) => item.id === collection.id)
    if (existingIndex === -1) return [...list, collection]
    return list.map((item, index) => (index === existingIndex ? collection : item))
  })
  await setActiveCollection(collection.id)
  return collection
}

/** Remove a collection by ID (does not delete files on disk). */
export async function removeCollection(id: string): Promise<void> {
  await window.api.removeCollection(id)
  invalidateCollectionMetadataRequests()
  collections.update((list) => list.filter((c) => c.id !== id))
  activeCollectionId.update((current) => (current === id ? null : current))
  collectionStatus.set(null)
  collectionDoctorResult.set(null)
  resetCollectionInfo()
}

/** Set the active collection and fetch its status. */
export async function setActiveCollection(id: string): Promise<void> {
  await window.api.setActiveCollection(id)
  invalidateCollectionMetadataRequests()
  activeCollectionId.set(id)
  collectionStatus.set(null)
  collectionDoctorResult.set(null)
  resetCollectionInfo()
  // Fire status/doctor fetches in the background — don't block callers
  fetchCollectionStatus(id).catch(() => {})
  fetchCollectionDoctorStatus(id).catch(() => {})
}

/** Fetch index status for a collection by ID. */
async function fetchCollectionStatus(id: string): Promise<void> {
  const requestGeneration = ++statusRequestGeneration
  const collection = get(collections).find((c) => c.id === id)
  if (!collection) return
  const path = collection.path

  try {
    const status = await window.api.status(path)
    if (requestGeneration !== statusRequestGeneration || get(activeCollectionId) !== id) return
    collectionStatus.set(status)
  } catch {
    if (requestGeneration !== statusRequestGeneration || get(activeCollectionId) !== id) return
    collectionStatus.set(null)
  }
}

/** Fetch doctor diagnostic results for a collection by ID. */
export async function fetchCollectionDoctorStatus(id: string): Promise<void> {
  const requestGeneration = ++doctorRequestGeneration
  await fetchCollectionDoctorStatusForGeneration(id, requestGeneration)
}

async function fetchCollectionDoctorStatusForGeneration(
  id: string,
  requestGeneration: number
): Promise<void> {
  const collection = get(collections).find((c) => c.id === id)
  if (!collection) return
  const path = collection.path

  try {
    const result = await window.api.doctor(path)
    if (requestGeneration !== doctorRequestGeneration || get(activeCollectionId) !== id) return
    collectionDoctorResult.set(result)
  } catch {
    if (requestGeneration !== doctorRequestGeneration || get(activeCollectionId) !== id) return
    collectionDoctorResult.set(null)
  }
}

/** Re-run doctor for the active collection (drives the modal's Run Again). */
export async function runDoctor(): Promise<void> {
  const id = get(activeCollectionId)
  if (!id) return
  const requestGeneration = ++doctorRequestGeneration
  doctorRunning.set(true)
  try {
    await fetchCollectionDoctorStatusForGeneration(id, requestGeneration)
  } finally {
    if (requestGeneration === doctorRequestGeneration && get(activeCollectionId) === id) {
      doctorRunning.set(false)
    }
  }
}

/** Open the doctor modal and kick off a fresh run. */
export function openDoctorModal(): void {
  doctorModalOpen.set(true)
  void runDoctor()
}

/** Fetch information for the active collection and selected scope. */
export async function fetchCollectionInfo(): Promise<void> {
  const collection = get(activeCollection)
  if (!collection) return

  const requestGeneration = ++infoRequestGeneration
  const collectionId = collection.id
  const scope = get(infoScope)
  infoLoading.set(true)
  infoError.set(null)
  try {
    const result = await window.api.info(collection.path, scope ?? undefined)
    if (
      requestGeneration !== infoRequestGeneration ||
      get(activeCollectionId) !== collectionId ||
      get(infoScope) !== scope
    )
      return
    collectionInfo.set(result)
  } catch (error) {
    if (
      requestGeneration !== infoRequestGeneration ||
      get(activeCollectionId) !== collectionId ||
      get(infoScope) !== scope
    )
      return
    collectionInfo.set(null)
    infoError.set(error instanceof Error ? error.message : 'Unable to load collection information.')
  } finally {
    if (requestGeneration === infoRequestGeneration) infoLoading.set(false)
  }
}

/** Open collection information for the whole vault or a relative folder scope. */
export function openInfoModal(scopePath?: string): void {
  infoScope.set(scopePath ?? null)
  collectionInfo.set(null)
  infoError.set(null)
  infoModalOpen.set(true)
  void fetchCollectionInfo()
}

/** Close the collection information modal. */
export function closeInfoModal(): void {
  infoModalOpen.set(false)
}

function resetCollectionInfo(): void {
  infoRequestGeneration++
  collectionInfo.set(null)
  infoModalOpen.set(false)
  infoLoading.set(false)
  infoError.set(null)
  infoScope.set(null)
}
