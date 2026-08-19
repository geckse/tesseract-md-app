import { getEditorSnapshots, markEditorSaved } from '../stores/computed-editor-flush'
import { syncEditorStoresFromTab } from '../stores/editor'
import { syncFileStoresFromTab } from '../stores/files'
import { workspace } from '../stores/workspace.svelte'

const savingTabs = new Set<string>()

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * CAS-save one external Markdown generation. The baseline advances only after
 * main confirms the write, while edits made during the await remain dirty.
 */
export async function saveExternalDocumentTab(tabId: string, content: string): Promise<boolean> {
  if (savingTabs.has(tabId)) return false
  const candidate = workspace.tabs[tabId]
  if (
    candidate?.kind !== 'document' ||
    candidate.origin !== 'external' ||
    !candidate.externalId ||
    candidate.savedContent === null
  ) {
    return false
  }

  const externalId = candidate.externalId
  const expectedContent = candidate.savedContent
  savingTabs.add(tabId)
  try {
    await window.api.saveExternalDocument(externalId, expectedContent, content)

    const current = workspace.tabs[tabId]
    if (current?.kind !== 'document' || current.origin !== 'external') return true

    const snapshots = getEditorSnapshots(tabId)
    const distinct = new Set(snapshots.map((snapshot) => snapshot.content))
    const latestContent =
      distinct.size === 1
        ? (snapshots[0]?.content ?? current.content ?? content)
        : (current.content ?? content)
    const clean = latestContent === content

    markEditorSaved(tabId, content, clean)
    current.savedContent = content
    current.content = latestContent
    current.isDirty = !clean
    syncFileStoresFromTab()
    syncEditorStoresFromTab()
    return true
  } catch (error) {
    await window.api
      .showMessage({
        type: 'error',
        title: `Could Not Save ${candidate.title}`,
        message: errorMessage(error)
      })
      .catch(() => {})
    return false
  } finally {
    savingTabs.delete(tabId)
  }
}
