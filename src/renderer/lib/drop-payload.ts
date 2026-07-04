/**
 * Shared routing for file-tree drag payloads dropped onto tab surfaces
 * (tab bars, split edges, the bottom panel).
 *
 * File-tree drags carry `application/x-mdvdb-path` (the relative path) and,
 * for asset files, `application/x-mdvdb-asset` (JSON: mimeCategory+fileSize).
 * Tab drags carry `text/plain` (the tab id).
 */

import type { MimeCategory } from '../types/cli'
import { workspace } from '../stores/workspace.svelte'

/** Whether a drag carries a tab id or a file-tree path. */
export function isTabOrPathDrag(dt: DataTransfer | null): boolean {
  const types = dt?.types ?? []
  return types.includes('text/plain') || types.includes('application/x-mdvdb-path')
}

/**
 * Open a dropped file-tree path in the given pane, routing to the right tab
 * kind: explicit asset payload → asset tab; otherwise `openFile` detects
 * asset extensions itself and falls back to a document tab.
 * Returns the tab id, or '' when the drag carried no path.
 */
export function openDroppedPath(dt: DataTransfer, paneId: string): string {
  const filePath = dt.getData('application/x-mdvdb-path')
  if (!filePath) return ''

  const assetData = dt.getData('application/x-mdvdb-asset')
  if (assetData) {
    try {
      const { mimeCategory, fileSize } = JSON.parse(assetData) as {
        mimeCategory: MimeCategory
        fileSize?: number
      }
      return workspace.openAssetTab(filePath, mimeCategory, fileSize, paneId)
    } catch {
      // Malformed payload — fall through to extension-based routing
    }
  }

  // forceNewTab preserves drop semantics: switch to an existing tab for the
  // same path, otherwise open a new one (never replace the current tab).
  return workspace.openFile(filePath, { forceNewTab: true, paneId })
}
