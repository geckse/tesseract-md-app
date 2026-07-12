/**
 * Native application menu template (phase 43).
 *
 * buildTemplate is a pure function of (MenuState, MenuActions) — no
 * electron-store or Menu APIs — so unit tests can assert the whole tree
 * (ids, accelerators, platform matrix) without mocking Electron.
 *
 * Accelerator rule: items always declare `accelerator` for display.
 * Keys the RENDERER already owns (shortcutManager in App.svelte, or
 * editor-internal keymaps like ⌘B in ProseMirror) additionally get
 * `registerAccelerator: false` on Windows/Linux — there, menu accelerators
 * fire BEFORE the page sees the keydown and would double-trigger or steal
 * the key. On macOS the page gets first crack and preventDefault wins, so
 * the accelerator can register (it still fires when no renderer handler
 * consumes it). Menu-owned keys (⌥⌘B sidebar, ⌘+/−/0 zoom) register on
 * all platforms. Never attach an accelerator to any Z binding — the
 * table-undo shortcut registers with preventDefault: false by design.
 */

import type { MenuItemConstructorOptions } from 'electron'
import type { MenuState, MenuRecentEntry } from './menu-state'

/** Callbacks the template dispatches into (injected for testability). */
export interface MenuActions {
  /** Send a `menu:command` {id, payload} to the focused (non-popup) window. */
  sendCommand: (id: string, payload?: unknown) => void
  /** Open a recent file (existing `menu:open-recent` channel). */
  openRecent: (entry: { collectionId: string; filePath: string }) => void
  /** Clear the recent-files list and refresh the menu. */
  clearRecents: () => void
  /** Open a new full app window. */
  newWindow: () => void
  /** Trigger an updater check (main-side). */
  checkForUpdates: () => void
  /** Show the native about panel. */
  showAbout: () => void
  /** Open an external URL in the default browser. */
  openExternal: (url: string) => void
}

/** External links surfaced in the Help menu. */
export const DOCS_URL = 'https://github.com/geckse/tesseract-md-app#readme'
export const ISSUES_URL = 'https://github.com/geckse/tesseract-md-app/issues'

/** Settings sections offered in the Collection Settings submenu. */
const COLLECTION_SETTINGS_SECTIONS: { id: string; section: string; label: string }[] = [
  { id: 'collection.settings.embedding', section: 'embedding', label: 'Embedding Provider' },
  { id: 'collection.settings.search', section: 'search', label: 'Search Defaults' },
  { id: 'collection.settings.chunking', section: 'chunking', label: 'Chunking' },
  { id: 'collection.settings.clusters', section: 'clusters', label: 'Topics' },
  { id: 'collection.settings.appearance', section: 'appearance', label: 'Appearance' }
]

/** Build the full application menu template. */
export function buildTemplate(
  state: MenuState,
  actions: MenuActions
): MenuItemConstructorOptions[] {
  const isMac = state.platform === 'darwin'

  /** Accelerator for a renderer-owned key (see module doc). */
  const rendererOwned = (
    accelerator: string
  ): Pick<MenuItemConstructorOptions, 'accelerator' | 'registerAccelerator'> =>
    isMac ? { accelerator } : { accelerator, registerAccelerator: false }

  const cmd = (id: string, payload?: unknown) => (): void => actions.sendCommand(id, payload)

  const template: MenuItemConstructorOptions[] = []

  // ─── App menu (macOS only) ───────────────────────────────────────────
  if (isMac) {
    template.push({
      label: state.appName,
      submenu: [
        { id: 'app.about', label: `About ${state.appName}`, click: () => actions.showAbout() },
        {
          id: 'app.check-updates',
          label: 'Check for Updates…',
          click: () => actions.checkForUpdates()
        },
        { type: 'separator' },
        {
          id: 'app.settings',
          label: 'Settings…',
          ...rendererOwned('CmdOrCtrl+,'),
          click: cmd('app.open-settings')
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    })
  }

  // ─── File ────────────────────────────────────────────────────────────
  const fileSubmenu: MenuItemConstructorOptions[] = [
    {
      id: 'file.new-note',
      label: 'New Note',
      ...rendererOwned('CmdOrCtrl+N'),
      click: cmd('file.new-note')
    },
    { id: 'file.new-untitled', label: 'New Untitled File', click: cmd('file.new-untitled') },
    {
      id: 'file.new-tab',
      label: 'New Tab',
      ...rendererOwned('CmdOrCtrl+T'),
      click: cmd('file.quick-open')
    },
    {
      id: 'file.new-window',
      label: 'New Window',
      ...rendererOwned('Shift+CmdOrCtrl+N'),
      click: () => actions.newWindow()
    },
    { type: 'separator' },
    {
      id: 'file.quick-open',
      label: 'Quick Open…',
      ...rendererOwned('CmdOrCtrl+O'),
      click: cmd('file.quick-open')
    },
    {
      id: 'file.open-recent',
      label: 'Open Recent',
      submenu: buildRecentSubmenu(state.recents, actions)
    },
    { type: 'separator' },
    { id: 'file.save', label: 'Save', ...rendererOwned('CmdOrCtrl+S'), click: cmd('file.save') },
    { id: 'file.save-copy', label: 'Save a Copy…', click: cmd('file.save-copy') },
    {
      id: 'file.export',
      label: 'Export',
      submenu: [
        {
          id: 'file.export-html',
          label: 'Export as HTML…',
          click: cmd('file.export', { format: 'html' })
        },
        {
          id: 'file.export-pdf',
          label: 'Export as PDF…',
          click: cmd('file.export', { format: 'pdf' })
        },
        {
          id: 'file.export-docx',
          label: 'Export as Word (.docx)…',
          click: cmd('file.export', { format: 'docx' })
        },
        {
          id: 'file.export-odt',
          label: 'Export as OpenDocument (.odt)…',
          click: cmd('file.export', { format: 'odt' })
        },
        {
          id: 'file.export-epub',
          label: 'Export as EPUB…',
          click: cmd('file.export', { format: 'epub' })
        },
        {
          id: 'file.export-text',
          label: 'Export as Plain Text…',
          click: cmd('file.export', { format: 'text' })
        },
        {
          id: 'file.export-rtf',
          label: 'Export as RTF…',
          click: cmd('file.export', { format: 'rtf' })
        }
      ]
    },
    { type: 'separator' },
    {
      id: 'file.reveal-current',
      label: isMac ? 'Reveal Current File in Finder' : 'Show Current File in Folder',
      click: cmd('file.reveal-current')
    },
    { type: 'separator' },
    {
      id: 'file.close-tab',
      label: 'Close Tab',
      ...rendererOwned('CmdOrCtrl+W'),
      click: cmd('file.close-tab')
    },
    {
      id: 'file.reopen-tab',
      label: 'Reopen Closed Tab',
      ...rendererOwned('Shift+CmdOrCtrl+T'),
      click: cmd('file.reopen-tab')
    },
    { type: 'separator' },
    // ⌘W is taken by Close Tab; the window keeps the standard mac chord
    isMac ? { role: 'close', accelerator: 'Shift+CmdOrCtrl+W' } : { role: 'quit' }
  ]
  template.push({ label: 'File', submenu: fileSubmenu })

  // ─── Edit ────────────────────────────────────────────────────────────
  // macOS: standard roles (renderer gets keys first — see module doc).
  // Win/Linux: undo/redo without accelerators so Ctrl+Z reaches the page.
  const searchItem: MenuItemConstructorOptions = {
    id: 'edit.search',
    label: 'Search Collection…',
    ...rendererOwned('CmdOrCtrl+K'),
    click: cmd('edit.search')
  }
  if (isMac) {
    template.push({
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'delete' },
        { role: 'selectAll' },
        { type: 'separator' },
        searchItem
      ]
    })
  } else {
    template.push({
      label: 'Edit',
      submenu: [
        { role: 'undo', registerAccelerator: false },
        { role: 'redo', registerAccelerator: false },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { type: 'separator' },
        { role: 'selectAll' },
        { type: 'separator' },
        searchItem
      ]
    })
  }

  // ─── Format (dispatches into the focused editor; no-ops elsewhere) ───
  const headingItems: MenuItemConstructorOptions[] = [1, 2, 3, 4, 5, 6].map((level) => ({
    id: `format.heading-${level}`,
    label: `Heading ${level}`,
    click: cmd('format.heading', { level })
  }))
  template.push({
    label: 'Format',
    submenu: [
      {
        id: 'format.bold',
        label: 'Bold',
        ...rendererOwned('CmdOrCtrl+B'),
        click: cmd('format.bold')
      },
      {
        id: 'format.italic',
        label: 'Italic',
        ...rendererOwned('CmdOrCtrl+I'),
        click: cmd('format.italic')
      },
      { id: 'format.strike', label: 'Strikethrough', click: cmd('format.strike') },
      { id: 'format.code', label: 'Inline Code', click: cmd('format.code') },
      { id: 'format.clear', label: 'Clear Formatting', click: cmd('format.clear') },
      { type: 'separator' },
      {
        id: 'format.heading-menu',
        label: 'Heading',
        submenu: [
          ...headingItems,
          { type: 'separator' },
          { id: 'format.paragraph', label: 'Paragraph', click: cmd('format.paragraph') }
        ]
      },
      { id: 'format.bullet-list', label: 'Bullet List', click: cmd('format.bullet-list') },
      { id: 'format.ordered-list', label: 'Numbered List', click: cmd('format.ordered-list') },
      { id: 'format.task-list', label: 'Task List', click: cmd('format.task-list') },
      { id: 'format.blockquote', label: 'Blockquote', click: cmd('format.blockquote') },
      { id: 'format.code-block', label: 'Code Block', click: cmd('format.code-block') },
      { type: 'separator' },
      { id: 'format.link', label: 'Insert Link…', click: cmd('format.link') },
      { id: 'format.insert-table', label: 'Insert Table', click: cmd('format.insert-table') },
      { id: 'format.hr', label: 'Insert Horizontal Rule', click: cmd('format.hr') },
      { type: 'separator' },
      { id: 'structure.toc', label: 'Insert Table of Contents', click: cmd('structure.toc') },
      { id: 'structure.promote', label: 'Promote Heading', click: cmd('structure.promote') },
      { id: 'structure.demote', label: 'Demote Heading', click: cmd('structure.demote') },
      {
        id: 'structure.fix-hierarchy',
        label: 'Fix Heading Hierarchy',
        click: cmd('structure.fix-hierarchy')
      }
    ]
  })

  // ─── View ────────────────────────────────────────────────────────────
  const viewSubmenu: MenuItemConstructorOptions[] = []
  if (state.isDev) {
    viewSubmenu.push(
      { role: 'reload' },
      { role: 'forceReload' },
      { role: 'toggleDevTools' },
      { type: 'separator' }
    )
  }
  viewSubmenu.push(
    {
      id: 'view.toggle-sidebar',
      label: 'Toggle Sidebar',
      accelerator: 'Alt+CmdOrCtrl+B',
      click: cmd('view.toggle-sidebar')
    },
    {
      id: 'view.toggle-properties',
      label: 'Toggle Properties Panel',
      ...rendererOwned('Shift+CmdOrCtrl+B'),
      click: cmd('view.toggle-properties')
    },
    {
      id: 'view.toggle-bottom-panel',
      label: 'Toggle Bottom Panel',
      ...rendererOwned('CmdOrCtrl+`'),
      click: cmd('view.toggle-bottom-panel')
    },
    { type: 'separator' },
    {
      id: 'view.toggle-editor-mode',
      label: 'Toggle Editor/Raw Mode',
      ...rendererOwned('CmdOrCtrl+E'),
      click: cmd('view.toggle-editor-mode')
    },
    {
      id: 'view.toggle-graph',
      label: 'Toggle Graph',
      ...rendererOwned('CmdOrCtrl+G'),
      click: cmd('view.toggle-graph')
    },
    { type: 'separator' },
    {
      id: 'view.next-tab',
      label: 'Next Tab',
      ...rendererOwned('Alt+CmdOrCtrl+Right'),
      click: cmd('view.next-tab')
    },
    {
      id: 'view.previous-tab',
      label: 'Previous Tab',
      ...rendererOwned('Alt+CmdOrCtrl+Left'),
      click: cmd('view.previous-tab')
    },
    {
      id: 'view.split-editor',
      label: 'Split Editor',
      ...rendererOwned('CmdOrCtrl+\\'),
      click: cmd('view.split-editor')
    },
    { type: 'separator' },
    {
      id: 'view.zoom-in',
      label: 'Zoom In',
      accelerator: 'CmdOrCtrl+Plus',
      click: cmd('view.zoom-in')
    },
    {
      id: 'view.zoom-out',
      label: 'Zoom Out',
      accelerator: 'CmdOrCtrl+-',
      click: cmd('view.zoom-out')
    },
    {
      id: 'view.zoom-reset',
      label: 'Reset Zoom',
      accelerator: 'CmdOrCtrl+0',
      click: cmd('view.zoom-reset')
    },
    { type: 'separator' },
    { role: 'togglefullscreen' }
  )
  template.push({ label: 'View', submenu: viewSubmenu })

  // ─── Collection ──────────────────────────────────────────────────────
  const hasActive = state.activeCollectionId !== null
  const switchSubmenu: MenuItemConstructorOptions[] = state.collections.map((collection) => ({
    id: `collection.switch.${collection.id}`,
    label: collection.name,
    type: 'radio' as const,
    checked: collection.id === state.activeCollectionId,
    click: cmd('collection.switch', { collectionId: collection.id })
  }))
  if (switchSubmenu.length > 0) switchSubmenu.push({ type: 'separator' })
  switchSubmenu.push({
    id: 'collection.add',
    label: 'Add Collection…',
    click: cmd('collection.add')
  })

  template.push({
    label: 'Collection',
    submenu: [
      {
        id: 'collection.active-name',
        label: state.activeCollectionName ?? 'No Active Collection',
        enabled: false
      },
      { id: 'collection.switch-menu', label: 'Switch Collection', submenu: switchSubmenu },
      { type: 'separator' },
      {
        id: 'collection.sync',
        label: 'Sync (Incremental)',
        enabled: hasActive,
        click: cmd('collection.sync')
      },
      {
        id: 'collection.reindex',
        label: 'Reindex',
        enabled: hasActive,
        click: cmd('collection.reindex')
      },
      {
        id: 'collection.rebuild',
        label: 'Rebuild Index…',
        enabled: hasActive,
        click: cmd('collection.rebuild')
      },
      {
        id: 'collection.preview',
        label: 'Ingest Preview',
        enabled: hasActive,
        click: cmd('collection.preview')
      },
      { type: 'separator' },
      {
        id: 'collection.toggle-watcher',
        label: 'Watch for Changes',
        type: 'checkbox',
        checked: state.watcherEnabled,
        enabled: hasActive,
        click: cmd('collection.toggle-watcher')
      },
      {
        id: 'collection.doctor',
        label: 'Run Doctor…',
        enabled: hasActive,
        click: cmd('collection.doctor')
      },
      { type: 'separator' },
      {
        id: 'collection.reveal',
        label: isMac ? 'Reveal in Finder' : 'Show in Folder',
        enabled: hasActive,
        click: cmd('collection.reveal')
      },
      {
        id: 'collection.copy-path',
        label: 'Copy Path',
        enabled: hasActive,
        click: cmd('collection.copy-path')
      },
      {
        id: 'collection.open-terminal',
        label: 'Open in Terminal',
        enabled: hasActive,
        click: cmd('collection.open-terminal')
      },
      { type: 'separator' },
      {
        id: 'collection.settings-menu',
        label: 'Collection Settings',
        enabled: hasActive,
        submenu: COLLECTION_SETTINGS_SECTIONS.map(({ id, section, label }) => ({
          id,
          label,
          enabled: hasActive,
          click: cmd('settings.open', { target: 'collection', section })
        }))
      }
    ]
  })

  // ─── Window ──────────────────────────────────────────────────────────
  template.push({ role: 'windowMenu' })

  // ─── Help ────────────────────────────────────────────────────────────
  const helpSubmenu: MenuItemConstructorOptions[] = [
    { id: 'help.shortcuts', label: 'Keyboard Shortcuts', click: cmd('help.shortcuts') },
    { type: 'separator' },
    { id: 'help.docs', label: 'Documentation', click: () => actions.openExternal(DOCS_URL) },
    {
      id: 'help.report-issue',
      label: 'Report an Issue',
      click: () => actions.openExternal(ISSUES_URL)
    }
  ]
  if (!isMac) {
    helpSubmenu.push(
      { type: 'separator' },
      {
        id: 'help.check-updates',
        label: 'Check for Updates…',
        click: () => actions.checkForUpdates()
      },
      { id: 'help.about', label: `About ${state.appName}`, click: () => actions.showAbout() }
    )
  }
  template.push({ label: 'Help', role: 'help', submenu: helpSubmenu })

  return template
}

/** Build the Open Recent submenu items. */
function buildRecentSubmenu(
  recents: MenuRecentEntry[],
  actions: MenuActions
): MenuItemConstructorOptions[] {
  const items: MenuItemConstructorOptions[] = recents.map((recent, index) => ({
    id: `file.open-recent.${index}`,
    label: `${recent.fileName} — ${recent.collectionName}`,
    click: () =>
      actions.openRecent({ collectionId: recent.collectionId, filePath: recent.filePath })
  }))

  if (items.length > 0) {
    items.push({ type: 'separator' })
  }

  items.push({
    id: 'file.clear-recents',
    label: 'Clear Recent Files',
    enabled: recents.length > 0,
    click: () => actions.clearRecents()
  })

  return items
}
