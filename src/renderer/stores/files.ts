import { writable, derived, get } from 'svelte/store'
import type { Writable } from 'svelte/store'
import type { FileTree, FileTreeNode, FileState, AssetScanResult, UnifiedTreeNode } from '../types/cli'
import { activeCollection } from './collections'
import { loadProperties, clearProperties, propertiesFileContent } from './properties'
import { editorMode, syncEditorStoresFromTab } from './editor'
import { recordNavigation, syncNavigationStoresFromTab } from './navigation'
import { syncGraphStoresFromTab } from './graph'
import { workspace } from './workspace.svelte'
import { mergeTreeNodes } from '../lib/tree-merge'
import { clearGraphStateCache } from '../components/GraphView.svelte'
// Lazy import to avoid circular dependency (favorites.ts imports selectedFilePath from here)
const lazyTrackRecent = (...args: Parameters<typeof import('./favorites').trackRecent>) =>
  import('./favorites').then((m) => m.trackRecent(...args))

// ─── Tree-related stores (unchanged) ───────────────────────────────────

/** The current file tree for the active collection. */
export const fileTree = writable<FileTree | null>(null)

/** Whether the file tree is currently loading. */
export const fileTreeLoading = writable<boolean>(false)

/** Error message if file tree loading failed. */
export const fileTreeError = writable<string | null>(null)

/** Set of expanded directory paths in the tree UI. */
export const expandedPaths = writable<Set<string>>(new Set())

/** Flat list of all file nodes (non-directory) from the tree. */
export const flatFileList = derived(fileTree, ($fileTree) => {
  if (!$fileTree) return []
  const files: FileTreeNode[] = []
  function walk(node: FileTreeNode): void {
    if (!node.is_dir) {
      files.push(node)
    }
    for (const child of node.children) {
      walk(child)
    }
  }
  for (const child of $fileTree.root.children) {
    walk(child)
  }
  return files
})

/** The asset scan result for the active collection. */
export const assetTree = writable<AssetScanResult | null>(null)

/** Whether to show non-markdown asset files in the tree. */
export const showAssets = writable<boolean>(true)

/** Unified tree merging CLI markdown tree with app-scanned assets. */
export const unifiedTree = derived(
  [fileTree, assetTree, showAssets],
  ([$fileTree, $assetTree, $showAssets]) => {
    return mergeTreeNodes($fileTree, $showAssets ? $assetTree : null)
  }
)

/** Count files by state in the current tree. */
export const fileStateCounts = derived(fileTree, ($fileTree) => {
  const counts: Record<FileState, number> = {
    indexed: 0,
    modified: 0,
    new: 0,
    deleted: 0,
  }
  if (!$fileTree) return counts
  function walk(node: FileTreeNode): void {
    if (!node.is_dir && node.state) {
      counts[node.state]++
    }
    for (const child of node.children) {
      walk(child)
    }
  }
  walk($fileTree.root)
  return counts
})

// ─── Workspace-derived file stores ─────────────────────────────────────
//
// These stores derive their values from the workspace's focused pane's
// active document tab. They use a notification trigger (_workspaceSync)
// rather than Svelte 5 rune reactivity so they work in plain .ts.
//
// Call syncFileStoresFromTab() after any workspace mutation that changes
// the active tab (switchTab, closeTab, tab bar click, etc.).

/**
 * Internal notification trigger. Derived stores re-evaluate when this
 * writable is bumped, pulling fresh values from workspace state.
 */
const _workspaceSync = writable(0)

/**
 * Notify backward-compat derived stores that the workspace focus has changed.
 * Call this after any workspace mutation that changes the active tab
 * (e.g., switchTab, closeTab, tab bar click, workspace.openTab()). Also syncs
 * the propertiesFileContent store with the focused tab's content.
 *
 * Automatically triggers content loading for newly focused tabs that have no
 * content yet (e.g., after workspace.openTab() creates a fresh tab). This
 * enables components to simply call workspace.openTab(path) followed by
 * syncFileStoresFromTab() without needing to handle content loading themselves.
 */
export function syncFileStoresFromTab(): void {
  _workspaceSync.update((n) => n + 1)
  syncEditorStoresFromTab()
  syncNavigationStoresFromTab()
  syncGraphStoresFromTab()
  // Keep propertiesFileContent in sync with the focused tab's content
  const tab = workspace.focusedDocumentTab
  propertiesFileContent.set(tab?.content ?? null)

  // Auto-load content for newly focused tabs that have no content yet.
  // The contentLoading guard prevents re-entrant loading when syncFileStoresFromTab
  // is called again from within _autoLoadTabContent's finally block.
  if (tab && tab.content === null && !tab.contentLoading && !tab.contentError) {
    _autoLoadTabContent(tab.id, tab.filePath)
  }
}

/**
 * Load content for a tab that has not been loaded yet.
 * Called automatically by syncFileStoresFromTab() when a freshly opened tab
 * has no content. Handles generation guard, recent tracking, content fetch,
 * and properties loading.
 */
async function _autoLoadTabContent(tabId: string, filePath: string): Promise<void> {
  const gen = ++selectGeneration

  const collection = get(activeCollection)
  if (!collection) return

  // Track this file as recently opened
  lazyTrackRecent(collection.id, filePath)

  // Reset to wysiwyg mode when opening a new file
  editorMode.set('wysiwyg')

  // Mark tab as loading (update directly, then bump sync trigger without recursion)
  const tab = workspace.tabs[tabId]
  if (tab && tab.kind === 'document') {
    tab.contentLoading = true
    tab.contentError = null
  }
  _workspaceSync.update((n) => n + 1)

  const fullPath = `${collection.path}/${filePath}`
  try {
    const content = await window.api.readFile(fullPath)
    if (gen !== selectGeneration) return

    const currentTab = workspace.tabs[tabId]
    if (currentTab && currentTab.kind === 'document') {
      currentTab.content = content
      currentTab.savedContent = content
      currentTab.contentError = null
    }
    propertiesFileContent.set(content)
  } catch (err) {
    if (gen !== selectGeneration) return
    const errorMsg = err instanceof Error ? err.message : String(err)

    const currentTab = workspace.tabs[tabId]
    if (currentTab && currentTab.kind === 'document') {
      currentTab.contentError = errorMsg
    }
  } finally {
    if (gen === selectGeneration) {
      const currentTab = workspace.tabs[tabId]
      if (currentTab && currentTab.kind === 'document') {
        currentTab.contentLoading = false
      }
      syncFileStoresFromTab()
    }
  }

  // Load properties panel data (document info + backlinks) in parallel
  if (gen === selectGeneration) {
    loadProperties(filePath)
  }
}

/** Currently selected file path — derived from focused pane's active document tab. */
export const selectedFilePath = derived(_workspaceSync, () => {
  return workspace.focusedDocumentTab?.filePath ?? null
})

/**
 * Content of the currently selected file — derived from focused tab.
 * Retains .set()/.update() for backward compat (used by ConflictNotification).
 * Calling .set() updates the workspace tab's content and notifies subscribers.
 */
export const fileContent: Writable<string | null> = {
  subscribe: derived(_workspaceSync, () => {
    return workspace.focusedDocumentTab?.content ?? null
  }).subscribe,
  set(value: string | null) {
    const tab = workspace.focusedDocumentTab
    if (tab) {
      tab.content = value
    }
    _workspaceSync.update((n) => n + 1)
  },
  update(fn: (value: string | null) => string | null) {
    const tab = workspace.focusedDocumentTab
    const current = tab?.content ?? null
    const newValue = fn(current)
    if (tab) {
      tab.content = newValue
    }
    _workspaceSync.update((n) => n + 1)
  },
}

/** Whether file content is currently loading — derived from focused tab. */
export const fileContentLoading = derived(_workspaceSync, () => {
  return workspace.focusedDocumentTab?.contentLoading ?? false
})

/** Error message if file content loading failed — derived from focused tab. */
export const fileContentError = derived(_workspaceSync, () => {
  return workspace.focusedDocumentTab?.contentError ?? null
})

// ─── File selection ────────────────────────────────────────────────────

/** Generation counter to discard stale async results. */
let selectGeneration = 0

/**
 * Select a file path in the tree and load its content.
 * Opens (or switches to) a workspace tab, loads content from disk if not
 * already cached, and syncs backward-compat stores.
 */
export async function selectFile(path: string | null): Promise<void> {
  const gen = ++selectGeneration
  recordNavigation(path)

  if (!path) {
    // Deselect: set focused pane's active tab to null (no document selected)
    const pane = workspace.focusedPane
    if (pane) {
      pane.activeTabId = null
    }
    syncFileStoresFromTab()
    clearProperties()
    return
  }

  // Open (or switch to) a tab in the workspace
  const tabId = workspace.openTab(path)

  const collection = get(activeCollection)
  if (!collection) {
    syncFileStoresFromTab()
    return
  }

  // Track this file as recently opened
  lazyTrackRecent(collection.id, path)

  const tab = workspace.tabs[tabId]

  // If the tab already has content loaded, just sync and return
  if (tab && tab.kind === 'document' && tab.content !== null) {
    propertiesFileContent.set(tab.content)
    syncFileStoresFromTab()
    loadProperties(path)
    return
  }

  // Reset to wysiwyg mode when opening a new file
  editorMode.set('wysiwyg')

  // Mark tab as loading
  if (tab && tab.kind === 'document') {
    tab.contentLoading = true
    tab.contentError = null
  }
  syncFileStoresFromTab()

  const fullPath = `${collection.path}/${path}`
  try {
    const content = await window.api.readFile(fullPath)
    // Discard if user already clicked a different file
    if (gen !== selectGeneration) return

    // Update workspace tab state
    const currentTab = workspace.tabs[tabId]
    if (currentTab && currentTab.kind === 'document') {
      currentTab.content = content
      currentTab.savedContent = content
      currentTab.contentError = null
    }
    propertiesFileContent.set(content)
  } catch (err) {
    if (gen !== selectGeneration) return
    const errorMsg = err instanceof Error ? err.message : String(err)

    // Update workspace tab state
    const currentTab = workspace.tabs[tabId]
    if (currentTab && currentTab.kind === 'document') {
      currentTab.contentError = errorMsg
    }
  } finally {
    if (gen === selectGeneration) {
      const currentTab = workspace.tabs[tabId]
      if (currentTab && currentTab.kind === 'document') {
        currentTab.contentLoading = false
      }
      syncFileStoresFromTab()
    }
  }

  // Load properties panel data (document info + backlinks) in parallel
  if (gen === selectGeneration) {
    loadProperties(path)
  }
}

// ─── State management ──────────────────────────────────────────────────

/** Reset all file-related state (e.g. on collection switch). */
export function resetFileState(): void {
  selectGeneration++
  workspace.reset()
  fileTree.set(null)
  assetTree.set(null)
  fileTreeLoading.set(false)
  fileTreeError.set(null)
  expandedPaths.set(new Set())
  clearProperties()
  clearGraphStateCache()
  syncFileStoresFromTab()
}

// ─── File tree operations (unchanged) ──────────────────────────────────

/** Load the file tree for the active collection. */
export async function loadFileTree(subPath?: string): Promise<void> {
  const collection = get(activeCollection)
  if (!collection) {
    fileTree.set(null)
    return
  }

  fileTreeLoading.set(true)
  fileTreeError.set(null)
  try {
    const tree = await window.api.tree(collection.path, subPath)
    fileTree.set(tree)
  } catch (err) {
    fileTreeError.set(err instanceof Error ? err.message : String(err))
    fileTree.set(null)
  } finally {
    fileTreeLoading.set(false)
  }
}

/** Toggle a directory's expanded state. */
export function toggleExpanded(path: string): void {
  expandedPaths.update((set) => {
    const next = new Set(set)
    if (next.has(path)) {
      next.delete(path)
    } else {
      next.add(path)
    }
    return next
  })
}

/** Expand all directories in the tree. */
export function expandAll(): void {
  const tree = get(fileTree)
  if (!tree) return
  const paths = new Set<string>()
  function walk(node: FileTreeNode): void {
    if (node.is_dir) {
      paths.add(node.path)
    }
    for (const child of node.children) {
      walk(child)
    }
  }
  walk(tree.root)
  expandedPaths.set(paths)
}

/** Collapse all directories in the tree. */
export function collapseAll(): void {
  expandedPaths.set(new Set())
}

// ─── Asset tree operations ──────────────────────────────────────────────

/** Load the asset tree for the active collection. */
export async function loadAssetTree(): Promise<void> {
  const collection = get(activeCollection)
  if (!collection) {
    assetTree.set(null)
    return
  }

  try {
    const result = await window.api.scanAssets(collection.path)
    assetTree.set(result)
  } catch {
    assetTree.set(null)
  }
}

// ─── File creation ──────────────────────────────────────────────────────

/**
 * Create a new markdown file in the active collection.
 * @param dirPath - Relative directory path within the collection (e.g., "docs" or "").
 * @param filename - Filename (auto-appends .md if no extension).
 * @param withFrontmatter - Whether to include frontmatter template.
 * @returns The relative path of the created file, or null on failure.
 */
export async function createNewFile(
  dirPath: string,
  filename: string,
  withFrontmatter = false
): Promise<string | null> {
  const collection = get(activeCollection)
  if (!collection) return null

  // Auto-append .md if no extension
  if (!filename.includes('.')) {
    filename = filename + '.md'
  }

  const relativePath = dirPath ? `${dirPath}/${filename}` : filename
  const absolutePath = `${collection.path}/${relativePath}`

  let content = ''
  if (withFrontmatter) {
    const title = filename.replace(/\.[^.]+$/, '')
    content = `---\ntitle: ${title}\n---\n\n`
  }

  try {
    await window.api.createFile(absolutePath, content)
    // Refresh tree and open the new file
    await loadFileTree()
    await loadAssetTree()
    await selectFile(relativePath)
    return relativePath
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(msg)
  }
}

/**
 * Create a new directory in the active collection.
 * @param dirPath - Relative directory path within the collection.
 * @param name - Directory name.
 * @returns The relative path of the created directory, or null on failure.
 */
export async function createNewDirectory(dirPath: string, name: string): Promise<string | null> {
  const collection = get(activeCollection)
  if (!collection) return null

  const relativePath = dirPath ? `${dirPath}/${name}` : name
  const absolutePath = `${collection.path}/${relativePath}`

  try {
    await window.api.createDirectory(absolutePath)
    await loadFileTree()
    await loadAssetTree()
    // Expand the parent directory
    if (dirPath) {
      expandedPaths.update((set) => {
        const next = new Set(set)
        next.add(dirPath)
        return next
      })
    }
    return relativePath
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(msg)
  }
}
