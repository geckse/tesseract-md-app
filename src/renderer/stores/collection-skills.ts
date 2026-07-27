import { get, writable } from 'svelte/store'
import type { CollectionSkillsStatus, CollectionSkillsTargetId } from '../../preload/api'

export interface CollectionSkillsNotice {
  collectionId: string
  phase: 'ready' | 'installing' | 'error'
  status: CollectionSkillsStatus | null
  error: string | null
}

/** Missing/outdated skills notice for the active collection, or null when hidden/current. */
export const collectionSkillsNotice = writable<CollectionSkillsNotice | null>(null)

const sessionDismissed = new Set<string>()
let requestGeneration = 0

/** Check the app-bundled Tesseract skills against one collection's agent folders. */
export async function refreshCollectionSkills(collectionId: string): Promise<void> {
  const generation = ++requestGeneration
  if (sessionDismissed.has(collectionId)) {
    collectionSkillsNotice.set(null)
    return
  }

  try {
    const status = await window.api.checkCollectionSkills(collectionId)
    if (generation !== requestGeneration) return
    if (status.dismissedForever || status.state === 'current') {
      collectionSkillsNotice.set(null)
      return
    }
    collectionSkillsNotice.set({
      collectionId,
      phase: 'ready',
      status,
      error: null
    })
  } catch (error) {
    if (generation !== requestGeneration) return
    collectionSkillsNotice.set({
      collectionId,
      phase: 'error',
      status: null,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

/** Install or refresh the bundled skills in the selected project-local agent folder. */
export async function installCollectionSkillsForAgent(
  collectionId: string,
  targetId: CollectionSkillsTargetId
): Promise<void> {
  const generation = ++requestGeneration
  const current = get(collectionSkillsNotice)
  collectionSkillsNotice.set({
    collectionId,
    phase: 'installing',
    status: current?.collectionId === collectionId ? current.status : null,
    error: null
  })

  try {
    const status = await window.api.installCollectionSkills(collectionId, targetId)
    if (generation !== requestGeneration) return
    const installedTarget = status.targets.find((target) => target.id === targetId)
    if (installedTarget?.state !== 'current') {
      throw new Error(
        `Tesseract skills could not be verified in ${installedTarget?.relativePath ?? targetId}`
      )
    }
    if (status.state === 'current') {
      collectionSkillsNotice.set(null)
    } else {
      collectionSkillsNotice.set({
        collectionId,
        phase: 'ready',
        status,
        error: null
      })
    }
  } catch (error) {
    if (generation !== requestGeneration) return
    collectionSkillsNotice.set({
      collectionId,
      phase: 'error',
      status: current?.collectionId === collectionId ? current.status : null,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

/** Hide the notice until the app is restarted. */
export function dismissCollectionSkillsForSession(collectionId: string): void {
  requestGeneration++
  sessionDismissed.add(collectionId)
  collectionSkillsNotice.set(null)
}

/** Permanently hide the notice for this stored collection. */
export async function dismissCollectionSkillsForever(collectionId: string): Promise<void> {
  const generation = ++requestGeneration
  try {
    await window.api.setCollectionSkillsDismissed(collectionId, true)
    if (generation !== requestGeneration) return
    sessionDismissed.add(collectionId)
    collectionSkillsNotice.set(null)
  } catch (error) {
    if (generation !== requestGeneration) return
    const current = get(collectionSkillsNotice)
    collectionSkillsNotice.set({
      collectionId,
      phase: 'error',
      status: current?.collectionId === collectionId ? current.status : null,
      error: error instanceof Error ? error.message : String(error)
    })
  }
}

/** Clear collection-scoped state when there is no active collection. */
export function clearCollectionSkillsNotice(): void {
  requestGeneration++
  collectionSkillsNotice.set(null)
}

/** Test isolation helper; app code should preserve session dismissals. */
export function resetCollectionSkillsStateForTests(): void {
  requestGeneration++
  sessionDismissed.clear()
  collectionSkillsNotice.set(null)
}
