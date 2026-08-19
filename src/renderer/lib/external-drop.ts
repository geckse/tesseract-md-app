import { get } from 'svelte/store'
import type { ExternalDroppedFileDescriptor } from '../../preload/api'
import { activeCollectionId } from '../stores/collections'
import { syncFileStoresFromTab } from '../stores/files'
import { workspace } from '../stores/workspace.svelte'

const INTERNAL_PATH_MIME = 'application/x-mdvdb-path'

/** True only for an OS file drag, never for Tesseract's internal tree payload. */
export function isExternalFileDrag(dataTransfer: DataTransfer | null): boolean {
  if (!dataTransfer) return false
  const types = Array.from(dataTransfer.types ?? [])
  return types.includes('Files') && !types.includes(INTERNAL_PATH_MIME)
}

function createObjectUrl(file: File): string | null {
  try {
    return URL.createObjectURL(file)
  } catch {
    return null
  }
}

function revokeObjectUrl(url: string | null): void {
  if (!url) return
  try {
    URL.revokeObjectURL(url)
  } catch {
    // Best-effort cleanup in test/legacy environments.
  }
}

async function releaseGrant(id: string): Promise<void> {
  await window.api.releaseExternalFile(id).catch(() => {
    // Main also clears sender-bound grants when the renderer closes.
  })
}

async function openDescriptor(
  descriptor: ExternalDroppedFileDescriptor,
  objectUrl: string | null,
  paneId: string
): Promise<string> {
  const currentCollectionId = get(activeCollectionId)
  if (
    descriptor.collectionId &&
    descriptor.collectionId === currentCollectionId &&
    descriptor.relativePath
  ) {
    revokeObjectUrl(objectUrl)
    await releaseGrant(descriptor.id)
    if (descriptor.kind === 'markdown') {
      return workspace.openFile(descriptor.relativePath, { forceNewTab: true, paneId })
    }
    return workspace.openAssetTab(
      descriptor.relativePath,
      descriptor.mimeCategory,
      descriptor.size,
      paneId
    )
  }

  const existingTabId = workspace.findExternalTabByPath(descriptor.path)
  if (existingTabId) {
    revokeObjectUrl(objectUrl)
    const existingTab = workspace.tabs[existingTabId]
    const existingGrant =
      existingTab?.kind === 'document' || existingTab?.kind === 'asset'
        ? existingTab.externalId
        : null
    if (existingGrant !== descriptor.id) await releaseGrant(descriptor.id)
    const existingPaneId = workspace.findPaneForTab(existingTabId)
    if (existingPaneId) {
      workspace.switchTab(existingTabId, existingPaneId)
      workspace.activePaneId = existingPaneId
    }
    return existingTabId
  }

  if (descriptor.kind === 'markdown') {
    revokeObjectUrl(objectUrl)
    const content = descriptor.content ?? (await window.api.readExternalDocument(descriptor.id))
    return workspace.openExternalDocumentTab(
      {
        id: descriptor.id,
        path: descriptor.path,
        name: descriptor.name,
        content
      },
      paneId
    )
  }

  const sourceUrl =
    descriptor.mimeCategory === 'image' ||
    descriptor.mimeCategory === 'pdf' ||
    descriptor.mimeCategory === 'video' ||
    descriptor.mimeCategory === 'audio'
      ? objectUrl
      : null
  if (!sourceUrl) revokeObjectUrl(objectUrl)
  return workspace.openExternalAssetTab(
    {
      id: descriptor.id,
      path: descriptor.path,
      name: descriptor.name,
      mimeCategory: descriptor.mimeCategory,
      fileSize: descriptor.size,
      objectUrl: sourceUrl
    },
    paneId
  )
}

/**
 * Grant and open every OS-backed file in one pane. Calls into preload for all
 * files before the first await so Electron can resolve each native path while
 * the original drag payload is still live.
 */
export async function openExternalDroppedFiles(files: File[], paneId: string): Promise<string[]> {
  if (files.length === 0) return []

  const prepared = files.map((file) => ({ file, objectUrl: createObjectUrl(file) }))
  const opened = prepared.map(({ file }) => window.api.openDroppedFile(file))
  const descriptors = await Promise.allSettled(opened)
  const tabIds: string[] = []
  const failures: string[] = []

  for (let index = 0; index < descriptors.length; index++) {
    const result = descriptors[index]
    const { file, objectUrl } = prepared[index]
    if (result.status === 'rejected') {
      revokeObjectUrl(objectUrl)
      failures.push(
        `${file.name}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`
      )
      continue
    }

    try {
      const tabId = await openDescriptor(result.value, objectUrl, paneId)
      if (!tabId) {
        revokeObjectUrl(objectUrl)
        await releaseGrant(result.value.id)
        failures.push(`${file.name}: no target pane is available`)
      } else {
        tabIds.push(tabId)
      }
    } catch (error) {
      revokeObjectUrl(objectUrl)
      await releaseGrant(result.value.id)
      failures.push(`${file.name}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  if (tabIds.length > 0) syncFileStoresFromTab()
  if (failures.length > 0) {
    await window.api.showMessage({
      type: 'error',
      title: 'Could Not Open Dropped File',
      message: failures.join('\n')
    })
  }
  return tabIds
}
