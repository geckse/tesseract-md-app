import { writable } from 'svelte/store'
import { createImageEditDraft, type ImageEditResult } from '../../shared/image-edit'
import { workspace } from './workspace.svelte'

/** Focused-image save signal, mirroring the document editor save counter. */
export const imageSaveRequested = writable<{ counter: number; tabId: string | null }>({
  counter: 0,
  tabId: null
})

export function requestImageSave(tabId: string | null = null): void {
  imageSaveRequested.update(({ counter }) => ({ counter: counter + 1, tabId }))
}

function imageTabsForPath(filePath: string) {
  return Object.values(workspace.tabs).filter(
    (tab) => tab.kind === 'asset' && tab.mimeCategory === 'image' && tab.filePath === filePath
  )
}

/** Apply a successful save to this window's source tab and sibling previews. */
export function markImageSaved(
  filePath: string,
  sourceTabId: string,
  result: ImageEditResult
): void {
  for (const tab of imageTabsForPath(filePath)) {
    tab.fileSize = result.size
    if (tab.id === sourceTabId) {
      tab.isDirty = false
      tab.diskChanged = false
      tab.imageEditDraft = createImageEditDraft()
    } else if (tab.isDirty) {
      tab.diskChanged = true
    } else {
      tab.imageRevision += 1
    }
  }
}

/**
 * Route an external/app-other-window image change. Clean viewers reload;
 * dirty viewers keep their recipe but must explicitly rebase or discard it.
 */
export function markImageChanged(filePath: string, size?: number): void {
  for (const tab of imageTabsForPath(filePath)) {
    if (size !== undefined) tab.fileSize = size
    if (tab.isDirty) {
      tab.diskChanged = true
    } else {
      tab.imageRevision += 1
    }
  }
}

export function discardImageEdits(tabId: string): void {
  const tab = workspace.tabs[tabId]
  if (!tab || tab.kind !== 'asset' || tab.mimeCategory !== 'image') return
  tab.imageEditDraft = createImageEditDraft()
  tab.isDirty = false
  tab.diskChanged = false
  tab.imageRevision += 1
}
