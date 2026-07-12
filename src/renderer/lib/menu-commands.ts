/**
 * Native menu command dispatcher (phase 43).
 *
 * Main sends `menu:command` {id, payload}; this module maps every command
 * id onto the existing store actions. Registered once in App.svelte
 * (after the popup-mode early-return — popup windows never handle menu
 * commands) and torn down alongside the other menu listeners.
 *
 * Commands are state-guarded, not menu-disabled: the menu stays enabled
 * and handlers no-op gracefully when the state doesn't apply (e.g. a
 * Format command with no document tab focused).
 */

import { get } from 'svelte/store'
import type { MenuCommand } from '../../preload/api'
import { workspace } from '../stores/workspace.svelte'
import {
  syncFileStoresFromTab,
  selectedFilePath,
  loadFileTree,
  loadAssetTree
} from '../stores/files'
import {
  closeFocusedTabWithConfirm,
  reopenLastClosedTab,
  cycleTab
} from '../stores/workspace-actions'
import {
  settingsOpen,
  shortcutsModalOpen,
  togglePropertiesPanel,
  toggleSidebar,
  zoomIn,
  zoomOut,
  zoomReset
} from '../stores/ui'
import {
  dispatchEditorCommand,
  requestSave,
  toggleEditorMode,
  type EditorCommandId
} from '../stores/editor'
import { openQuickOpen } from '../stores/quickopen'
import { searchOpen } from '../stores/search'
import { graphViewActive, toggleGraphView } from '../stores/graph'
import { terminalStore } from '../stores/terminal.svelte'
import {
  activeCollection,
  setActiveCollection,
  addAndActivateCollection,
  openDoctorModal
} from '../stores/collections'
import { runIngest, runPreview, rebuildIndex } from '../stores/ingest'
import { toggleWatcher } from '../stores/watcher'
import { openSettingsSection } from '../stores/settings'
import { openNewNotePopup } from './new-note'
import { exportActiveDocument, type ExportFormat } from './export'

const EDITOR_COMMAND_IDS: ReadonlySet<string> = new Set<EditorCommandId>([
  'format.bold',
  'format.italic',
  'format.strike',
  'format.code',
  'format.clear',
  'format.heading',
  'format.paragraph',
  'format.bullet-list',
  'format.ordered-list',
  'format.task-list',
  'format.blockquote',
  'format.code-block',
  'format.link',
  'format.insert-table',
  'format.hr',
  'structure.toc',
  'structure.promote',
  'structure.demote',
  'structure.fix-hierarchy'
])

const EXPORT_FORMATS: ReadonlySet<string> = new Set([
  'html',
  'pdf',
  'text',
  'rtf',
  'docx',
  'odt',
  'epub'
])

/** Reveal a collection-relative file in the OS file manager. */
async function revealCurrentFile(): Promise<void> {
  const filePath = get(selectedFilePath)
  const collection = get(activeCollection)
  if (!filePath || !collection) return
  try {
    await window.api.showItemInFolder(`${collection.path}/${filePath}`)
  } catch (err) {
    console.error('Reveal in folder failed:', err)
  }
}

async function switchCollection(collectionId: string): Promise<void> {
  await setActiveCollection(collectionId)
  await Promise.all([loadFileTree(), loadAssetTree()])
}

/** Command handlers keyed by menu command id (exported for unit tests). */
export const menuCommandHandlers: Record<string, (payload?: unknown) => void> = {
  'app.open-settings': () => settingsOpen.update((v) => !v),

  // File
  'file.new-note': () => {
    openNewNotePopup()
  },
  'file.new-untitled': () => {
    workspace.createUntitledTab()
    syncFileStoresFromTab()
  },
  'file.quick-open': () => openQuickOpen(),
  'file.save': () => requestSave(),
  'file.save-copy': () => {
    void exportActiveDocument('markdown')
  },
  'file.export': (payload) => {
    const format = (payload as { format?: string } | undefined)?.format
    if (format && EXPORT_FORMATS.has(format)) {
      void exportActiveDocument(format as ExportFormat)
    }
  },
  'file.reveal-current': () => {
    void revealCurrentFile()
  },
  'file.close-tab': () => closeFocusedTabWithConfirm(),
  'file.reopen-tab': () => reopenLastClosedTab(),

  // Edit
  'edit.search': () => searchOpen.set(true),

  // View
  'view.toggle-sidebar': () => toggleSidebar(),
  'view.toggle-properties': () => togglePropertiesPanel(),
  'view.toggle-bottom-panel': () => {
    void terminalStore.toggleBottomPanel()
  },
  'view.toggle-editor-mode': () => {
    if (!get(graphViewActive)) toggleEditorMode()
  },
  'view.toggle-graph': () => {
    toggleGraphView()
    syncFileStoresFromTab()
  },
  'view.next-tab': () => cycleTab(1),
  'view.previous-tab': () => cycleTab(-1),
  'view.split-editor': () => {
    workspace.toggleSplit()
    syncFileStoresFromTab()
  },
  'view.zoom-in': () => zoomIn(),
  'view.zoom-out': () => zoomOut(),
  'view.zoom-reset': () => zoomReset(),

  // Collection
  'collection.switch': (payload) => {
    const collectionId = (payload as { collectionId?: string } | undefined)?.collectionId
    if (collectionId) void switchCollection(collectionId)
  },
  'collection.add': () => {
    void addAndActivateCollection().then((collection) => {
      if (collection) return Promise.all([loadFileTree(), loadAssetTree()])
      return undefined
    })
  },
  'collection.sync': () => {
    void runIngest(false)
  },
  'collection.reindex': () => {
    void runIngest(true)
  },
  'collection.rebuild': () => {
    if (window.confirm('Rebuild deletes and re-creates the entire index. Continue?')) {
      void rebuildIndex()
    }
  },
  'collection.preview': () => {
    void runPreview()
  },
  'collection.toggle-watcher': () => {
    void toggleWatcher()
  },
  'collection.doctor': () => openDoctorModal(),
  'collection.reveal': () => {
    const collection = get(activeCollection)
    if (collection) void window.api.showItemInFolder(collection.path)
  },
  'collection.copy-path': () => {
    const collection = get(activeCollection)
    if (collection) void window.api.writeToClipboard(collection.path)
  },
  'collection.open-terminal': () => {
    const collection = get(activeCollection)
    if (collection) {
      void terminalStore.createTerminal({ cwd: collection.path, title: collection.name })
    }
  },

  // Settings deep links
  'settings.open': (payload) => {
    const data = payload as { target?: string; section?: string } | undefined
    if (!data?.section) return
    openSettingsSection(data.target === 'collection' ? 'collection' : 'global', data.section)
  },

  // Help
  'help.shortcuts': () => shortcutsModalOpen.set(true)
}

/** Handle a `menu:command` message from the main process. */
export function handleMenuCommand(command: MenuCommand): void {
  // Formatting/structure commands funnel into the focused editor.
  if (EDITOR_COMMAND_IDS.has(command.id)) {
    // Suppress while the settings modal is open (typing surface is hidden)
    // and when no document tab has focus.
    if (get(settingsOpen) || !workspace.focusedDocumentTab) return
    dispatchEditorCommand(command.id as EditorCommandId, command.payload)
    return
  }

  const handler = menuCommandHandlers[command.id]
  if (!handler) {
    if (import.meta.env.DEV) console.warn(`Unknown menu command: ${command.id}`)
    return
  }
  handler(command.payload)
}
