import { writable, derived, get } from 'svelte/store'
import type { Writable } from 'svelte/store'
import type {
  FileTree,
  FileTreeNode,
  FileState,
  AssetScanResult,
  AssetFileNode,
  MimeCategory,
  WatchEventReport
} from '../types/cli'
import type { VaultFileEvent } from '../../preload/api'
import { activeCollection } from './collections'
import { loadProperties, clearProperties, propertiesFileContent } from './properties'
import { editorMode, syncEditorStoresFromTab } from './editor'
import { recordNavigation, syncNavigationStoresFromTab } from './navigation'
import { syncGraphStoresFromTab } from './graph'
import { workspace } from './workspace.svelte'
import { mergeTreeNodes } from '../lib/tree-merge'
import { clearLoadedGraphStateCache } from '../lib/graph-view-loader'
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

/** Last-request-wins guards for collection-scoped tree reads. */
let fileTreeGeneration = 0
let assetTreeGeneration = 0

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
    deleted: 0
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
let lastPropertiesContextKey: string | null = null

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
  const collection = get(activeCollection)
  propertiesFileContent.set(tab?.content ?? null)

  const propertiesContextKey =
    tab && collection ? `${collection.id}\0${tab.id}\0${tab.filePath}` : null
  if (propertiesContextKey !== lastPropertiesContextKey) {
    lastPropertiesContextKey = propertiesContextKey
    if (tab && collection && tab.content !== null && !tab.contentError) {
      void loadProperties(tab.filePath)
    } else if (!tab) {
      clearProperties()
    }
  }

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
  }
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
  fileTreeGeneration++
  assetTreeGeneration++
  lastPropertiesContextKey = null
  workspace.reset()
  fileTree.set(null)
  assetTree.set(null)
  fileTreeLoading.set(false)
  fileTreeError.set(null)
  expandedPaths.set(new Set())
  resetVaultTreeRouting()
  clearProperties()
  clearLoadedGraphStateCache()
  syncFileStoresFromTab()
}

// ─── File tree operations (unchanged) ──────────────────────────────────

/** Load the file tree for the active collection. */
export async function loadFileTree(subPath?: string): Promise<void> {
  const collection = get(activeCollection)
  const generation = ++fileTreeGeneration
  if (!collection) {
    fileTree.set(null)
    fileTreeLoading.set(false)
    return
  }

  const collectionId = collection.id

  fileTreeLoading.set(true)
  fileTreeError.set(null)
  try {
    const tree = await window.api.tree(collection.path, subPath)
    if (generation !== fileTreeGeneration || get(activeCollection)?.id !== collectionId) return
    fileTree.set(tree)
  } catch (err) {
    if (generation !== fileTreeGeneration || get(activeCollection)?.id !== collectionId) return
    fileTreeError.set(err instanceof Error ? err.message : String(err))
    fileTree.set(null)
  } finally {
    if (generation === fileTreeGeneration && get(activeCollection)?.id === collectionId) {
      fileTreeLoading.set(false)
    }
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
  const generation = ++assetTreeGeneration
  if (!collection) {
    assetTree.set(null)
    return
  }

  const collectionId = collection.id

  try {
    const result = await window.api.scanAssets(collection.path)
    if (generation !== assetTreeGeneration || get(activeCollection)?.id !== collectionId) return
    assetTree.set(result)
  } catch {
    if (generation !== assetTreeGeneration || get(activeCollection)?.id !== collectionId) return
    assetTree.set(null)
  }
}

// ─── Local tree mutations ──────────────────────────────────────────────
//
// These mutate the in-memory tree stores directly, avoiding a full CLI
// round-trip + asset rescan for simple add/remove operations.

/**
 * Insert a file node into the file tree at the given relative path.
 * Creates intermediate directory nodes as needed.
 */
export function insertFileNode(relativePath: string, state: FileState | null = 'new'): void {
  fileTree.update((tree) => {
    if (!tree) return tree
    const parts = relativePath.split('/')
    const fileName = parts.pop()!
    let parent = tree.root

    // Walk / create intermediate directories
    for (const dirName of parts) {
      const dirPath = parent.path ? `${parent.path}/${dirName}` : dirName
      let child = parent.children.find((c) => c.is_dir && c.name === dirName)
      if (!child) {
        child = { name: dirName, path: dirPath, is_dir: true, state: null, children: [] }
        parent.children.push(child)
        parent.children.sort((a, b) => {
          if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1
          return a.name.localeCompare(b.name)
        })
      }
      parent = child
    }

    // Insert the file node (skip if it already exists)
    if (!parent.children.some((c) => c.name === fileName && !c.is_dir)) {
      parent.children.push({
        name: fileName,
        path: relativePath,
        is_dir: false,
        state,
        children: []
      })
      parent.children.sort((a, b) => {
        if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1
        return a.name.localeCompare(b.name)
      })
      tree.total_files++
      bumpStateCount(tree, state, +1)
    }

    return { ...tree, root: { ...tree.root } }
  })
}

/** Adjust the per-state counter buckets on a FileTree. */
function bumpStateCount(tree: FileTree, state: FileState | null, delta: number): void {
  if (state === 'new') tree.new_count += delta
  else if (state === 'modified') tree.modified_count += delta
  else if (state === 'indexed') tree.indexed_count += delta
  else if (state === 'deleted') tree.deleted_count += delta
}

/** Find a node by relative path via segment walk. */
function findTreeNode(root: FileTreeNode, relativePath: string): FileTreeNode | null {
  const parts = relativePath.split('/')
  let node: FileTreeNode = root
  for (const part of parts) {
    const child = node.children.find((c) => c.name === part)
    if (!child) return null
    node = child
  }
  return node
}

/** Current state of a file node, or undefined when the node doesn't exist. */
function getFileNodeState(relativePath: string): FileState | null | undefined {
  const tree = get(fileTree)
  if (!tree) return undefined
  const node = findTreeNode(tree.root, relativePath)
  if (!node || node.is_dir) return undefined
  return node.state
}

/**
 * Flip a file node's sync state in place, keeping the count buckets balanced.
 * A `modified` flip never downgrades a not-yet-indexed (`new`) file.
 * Returns false when the node doesn't exist (caller may insert instead).
 */
export function setFileNodeState(relativePath: string, state: FileState): boolean {
  let found = false
  fileTree.update((tree) => {
    if (!tree) return tree
    const node = findTreeNode(tree.root, relativePath)
    if (!node || node.is_dir) return tree
    found = true
    if (node.state === state) return tree
    if (state === 'modified' && node.state === 'new') return tree
    bumpStateCount(tree, node.state, -1)
    bumpStateCount(tree, state, +1)
    node.state = state
    return { ...tree, root: { ...tree.root } }
  })
  return found
}

/**
 * Insert an asset node into the asset tree (mirror of insertFileNode).
 * Updates fileSize in place when the node already exists.
 */
export function insertAssetNode(
  relativePath: string,
  mimeCategory?: MimeCategory,
  fileSize?: number
): void {
  assetTree.update((tree) => {
    if (!tree) return tree
    const parts = relativePath.split('/')
    const fileName = parts.pop()!
    let parent = tree.root

    for (const dirName of parts) {
      const dirPath = parent.path ? `${parent.path}/${dirName}` : dirName
      let child = parent.children.find((c) => c.is_dir && c.name === dirName)
      if (!child) {
        child = { name: dirName, path: dirPath, is_dir: true, children: [] }
        parent.children.push(child)
        parent.children.sort((a, b) => {
          if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1
          return a.name.localeCompare(b.name)
        })
      }
      parent = child
    }

    const existing = parent.children.find((c) => c.name === fileName && !c.is_dir)
    if (existing) {
      if (fileSize !== undefined) existing.fileSize = fileSize
    } else {
      parent.children.push({
        name: fileName,
        path: relativePath,
        is_dir: false,
        children: [],
        ...(fileSize !== undefined ? { fileSize } : {}),
        ...(mimeCategory !== undefined ? { mimeCategory } : {})
      })
      parent.children.sort((a, b) => {
        if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1
        return a.name.localeCompare(b.name)
      })
      tree.totalAssets++
    }

    return { ...tree, root: { ...tree.root } }
  })
}

/**
 * Insert a directory node into the file tree at the given relative path.
 */
export function insertDirNode(relativePath: string): void {
  fileTree.update((tree) => {
    if (!tree) return tree
    const parts = relativePath.split('/')
    let parent = tree.root

    for (const dirName of parts) {
      const dirPath = parent.path ? `${parent.path}/${dirName}` : dirName
      let child = parent.children.find((c) => c.is_dir && c.name === dirName)
      if (!child) {
        child = { name: dirName, path: dirPath, is_dir: true, state: null, children: [] }
        parent.children.push(child)
        parent.children.sort((a, b) => {
          if (a.is_dir !== b.is_dir) return a.is_dir ? -1 : 1
          return a.name.localeCompare(b.name)
        })
      }
      parent = child
    }

    return { ...tree, root: { ...tree.root } }
  })
}

/**
 * Remove a node (file or directory) from the file tree by relative path.
 */
export function removeTreeNode(relativePath: string): void {
  fileTree.update((tree) => {
    if (!tree) return tree

    function remove(parent: FileTreeNode): boolean {
      const idx = parent.children.findIndex((c) => c.path === relativePath)
      if (idx >= 0) {
        const removed = parent.children[idx]
        parent.children.splice(idx, 1)
        // Update counts
        if (!removed.is_dir) {
          tree!.total_files--
          if (removed.state === 'new') tree!.new_count--
          else if (removed.state === 'modified') tree!.modified_count--
          else if (removed.state === 'indexed') tree!.indexed_count--
        } else {
          // For directories, subtract all contained files
          const subtract = (node: FileTreeNode) => {
            for (const child of node.children) {
              if (!child.is_dir) {
                tree!.total_files--
                if (child.state === 'new') tree!.new_count--
                else if (child.state === 'modified') tree!.modified_count--
                else if (child.state === 'indexed') tree!.indexed_count--
              } else {
                subtract(child)
              }
            }
          }
          subtract(removed)
        }
        return true
      }
      for (const child of parent.children) {
        if (child.is_dir && remove(child)) return true
      }
      return false
    }

    remove(tree.root)
    return { ...tree, root: { ...tree.root } }
  })
}

/**
 * Remove an asset node from the asset tree by relative path.
 */
export function removeAssetNode(relativePath: string): void {
  assetTree.update((tree) => {
    if (!tree) return tree

    function remove(parent: AssetFileNode): boolean {
      const idx = parent.children.findIndex((c) => c.path === relativePath)
      if (idx >= 0) {
        const removed = parent.children[idx]
        parent.children.splice(idx, 1)
        if (!removed.is_dir) tree!.totalAssets--
        else {
          const countAssets = (node: AssetFileNode): number => {
            let n = 0
            for (const c of node.children) {
              n += c.is_dir ? countAssets(c) : 1
            }
            return n
          }
          tree!.totalAssets -= countAssets(removed)
        }
        return true
      }
      for (const child of parent.children) {
        if (child.is_dir && remove(child)) return true
      }
      return false
    }

    remove(tree.root)
    return { ...tree, root: { ...tree.root } }
  })
}

// ─── Vault/watch event routing (incremental tree patching) ─────────────
//
// Tier-1 (raw fs events from the vault watcher) and Tier-2 (post-reindex
// reports from `mdvdb watch`) both patch the in-memory trees per path
// instead of triggering full reloads. Full reloads remain only as explicit
// fallbacks: event bursts over the threshold, and unresolvable renames.

/** Events applied per flush window before falling back to one full reload. */
const TREE_FULL_RELOAD_THRESHOLD = 150

/** Micro-batch window for tree patching (one store update per flush). */
const TREE_BATCH_MS = 100

/** Debounce for the full-reload resync fallback. */
const TREE_RESYNC_DEBOUNCE_MS = 1_000

let vaultTreeQueue: VaultFileEvent[] = []
let vaultTreeFlushTimer: ReturnType<typeof setTimeout> | null = null
let treeResyncTimer: ReturnType<typeof setTimeout> | null = null

/**
 * Entry point for Tier-1 vault file events (called by the vault-events
 * dispatcher for EVERY event, including origin 'app' — mutators are
 * idempotent, and this covers app writes whose optimistic update was missed).
 */
export function routeVaultEventToTree(event: VaultFileEvent): void {
  vaultTreeQueue.push(event)
  if (!vaultTreeFlushTimer) {
    vaultTreeFlushTimer = setTimeout(() => {
      vaultTreeFlushTimer = null
      flushVaultTreeQueue()
    }, TREE_BATCH_MS)
  }
}

function flushVaultTreeQueue(): void {
  const queue = vaultTreeQueue
  vaultTreeQueue = []
  if (queue.length === 0) return

  // Agent rewrote the vault wholesale — one data reload beats per-node surgery.
  // (View state like expandedPaths/scroll lives separately, so no view reset.)
  if (queue.length > TREE_FULL_RELOAD_THRESHOLD) {
    scheduleTreeResync()
    return
  }

  for (const event of queue) {
    applyVaultEventToTree(event)
  }
}

function applyVaultEventToTree(event: VaultFileEvent): void {
  if (event.isDirectory) {
    switch (event.kind) {
      case 'created':
        insertDirNode(event.path)
        break
      case 'deleted':
        removeTreeNode(event.path)
        removeAssetNode(event.path)
        break
      case 'renamed':
        // Children would have to move too — resync instead of guessing.
        scheduleTreeResync()
        break
    }
    return
  }

  if (event.fileKind === 'markdown') {
    switch (event.kind) {
      case 'created': {
        const state = getFileNodeState(event.path)
        if (state === undefined) insertFileNode(event.path, 'new')
        else if (state === 'deleted') setFileNodeState(event.path, 'modified')
        break
      }
      case 'modified':
        if (!setFileNodeState(event.path, 'modified')) {
          insertFileNode(event.path, 'new')
        }
        break
      case 'deleted':
        // A never-indexed file simply disappears; indexed files keep a
        // 'deleted' badge until the index catches up (Tier-2 removes the row).
        if (getFileNodeState(event.path) === 'new') removeTreeNode(event.path)
        else setFileNodeState(event.path, 'deleted')
        break
      case 'renamed': {
        if (event.oldPath) {
          const prevState = getFileNodeState(event.oldPath)
          removeTreeNode(event.oldPath)
          insertFileNode(event.path, prevState ?? 'new')
        } else {
          insertFileNode(event.path, 'new')
          scheduleTreeResync()
        }
        break
      }
    }
    return
  }

  // Assets have no index lifecycle — insert/remove immediately
  switch (event.kind) {
    case 'created':
    case 'modified':
      insertAssetNode(event.path, event.mimeCategory ?? undefined, event.size ?? undefined)
      break
    case 'deleted':
      removeAssetNode(event.path)
      break
    case 'renamed':
      if (event.oldPath) removeAssetNode(event.oldPath)
      insertAssetNode(event.path, event.mimeCategory ?? undefined, event.size ?? undefined)
      break
  }
}

/**
 * Apply a Tier-2 post-reindex report to the tree: flips state to 'indexed'
 * once the index has caught up with a disk change.
 */
export function applyWatchReportToTree(report: WatchEventReport): void {
  if (!report.success) return

  switch (report.event_type) {
    case 'Created':
    case 'Modified':
      if (!setFileNodeState(report.path, 'indexed')) {
        insertFileNode(report.path, 'indexed')
      }
      break
    case 'Deleted':
      removeTreeNode(report.path)
      break
    case 'Renamed':
      // The CLI report only carries the new path — the stale old row can
      // only be cleaned up by a resync (or a paired Tier-1 app rename).
      if (!setFileNodeState(report.path, 'indexed')) {
        insertFileNode(report.path, 'indexed')
      }
      scheduleTreeResync()
      break
  }
}

/** Debounced full tree+asset reload — the explicit resync fallback. */
export function scheduleTreeResync(): void {
  if (treeResyncTimer) clearTimeout(treeResyncTimer)
  treeResyncTimer = setTimeout(() => {
    treeResyncTimer = null
    Promise.all([loadFileTree(), loadAssetTree()]).catch(() => {})
  }, TREE_RESYNC_DEBOUNCE_MS)
}

/** Drop queued vault events and pending timers (collection switch). */
export function resetVaultTreeRouting(): void {
  vaultTreeQueue = []
  if (vaultTreeFlushTimer) {
    clearTimeout(vaultTreeFlushTimer)
    vaultTreeFlushTimer = null
  }
  if (treeResyncTimer) {
    clearTimeout(treeResyncTimer)
    treeResyncTimer = null
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
    // Insert into tree locally instead of full reload
    insertFileNode(relativePath, 'new')
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
    // Insert into tree locally instead of full reload
    insertDirNode(relativePath)
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
