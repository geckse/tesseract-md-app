/**
 * Tab actions shared by keyboard shortcuts (App.svelte) and the native
 * menu dispatcher — extracted so the dirty-check/close/reopen behavior
 * has exactly one implementation.
 */

import { workspace } from './workspace.svelte'
import { closedTabs } from './closed-tabs.svelte'
import { syncFileStoresFromTab } from './files'
import { requestConfirmation } from './confirmation'

/**
 * Close the focused tab with the standard dirty-file confirm, pushing
 * closed document tabs onto the reopen stack. When no document tab is
 * focused, deselects the pane's active tab (same semantics as ⌘W).
 */
export async function closeFocusedTabWithConfirm(): Promise<void> {
  const tab = workspace.focusedTab
  if (tab && tab.kind === 'document') {
    if (tab.isDirty) {
      const shouldClose = await requestConfirmation({
        title: `Close ${tab.title}?`,
        message: 'This document has unsaved changes. Discard them and close the tab?',
        confirmLabel: 'Discard and Close',
        cancelLabel: 'Keep Editing',
        tone: 'danger'
      })
      if (!shouldClose) return
    }
    const paneId = workspace.activePaneId
    const closed = workspace.closeTab(tab.id)
    if (closed && closed.kind === 'document') {
      closedTabs.push(closed, paneId)
    }
  } else {
    // No document tab focused — deselect
    const pane = workspace.focusedPane
    if (pane) {
      pane.activeTabId = null
    }
  }
  syncFileStoresFromTab()
}

/** Reopen the most recently closed tab (⌘⇧T). */
export function reopenLastClosedTab(): void {
  const entry = closedTabs.pop()
  if (entry) {
    workspace.openTab(entry.tab.filePath)
    syncFileStoresFromTab()
  }
}

/**
 * Cycle the focused pane's document tabs (⌥⌘←/→ and the View menu).
 * Wraps around at both ends; non-document tabs are skipped.
 */
export function cycleTab(direction: 1 | -1): void {
  const pane = workspace.focusedPane
  if (!pane) return
  const docTabs = pane.tabOrder.filter((id) => workspace.tabs[id]?.kind === 'document')
  if (docTabs.length === 0) return
  const currentIdx = pane.activeTabId ? docTabs.indexOf(pane.activeTabId) : -1
  let nextIdx: number
  if (direction === 1) {
    nextIdx = currentIdx < 0 || currentIdx >= docTabs.length - 1 ? 0 : currentIdx + 1
  } else {
    nextIdx = currentIdx <= 0 ? docTabs.length - 1 : currentIdx - 1
  }
  workspace.switchTab(docTabs[nextIdx])
  syncFileStoresFromTab()
}
