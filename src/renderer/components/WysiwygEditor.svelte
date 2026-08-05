<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { get } from 'svelte/store'
  import {
    createWysiwygEditor,
    type WysiwygEditor as WysiwygEditorInstance
  } from '../lib/tiptap/editor-factory'
  import { splitFrontmatter, joinFrontmatter } from '../lib/tiptap/markdown-bridge'
  import '../lib/tiptap/wysiwyg-theme.css'
  import 'highlight.js/styles/github-dark.css'
  import { activeCollection } from '../stores/collections'
  import { workspace, type DocumentTab } from '../stores/workspace.svelte'
  import {
    isDirty,
    wordCount,
    tokenCount,
    countWords,
    countTokens,
    saveRequested,
    discardRequested,
    editorCommand,
    editorMode,
    syncEditorStoresFromTab,
    type EditorMode,
    type EditorCommandSignal
  } from '../stores/editor'
  import { computeFixedHeadingLevels, type ParsedHeading } from '../lib/markdown-structure'
  import type { DocumentSchemaMutationContext } from '../lib/property-types'
  import { relativeToCollection } from '../lib/path'
  import { buildTocTiptapJSON } from '../lib/tiptap/toc-content'
  import { loadProperties, propertiesFileContent } from '../stores/properties'
  import ConflictNotification from './ConflictNotification.svelte'
  import ClipboardImageSaveModal from './ClipboardImageSaveModal.svelte'
  import DocumentHeader from './wysiwyg/DocumentHeader.svelte'
  import { dismissConflict } from '../stores/conflict'
  import { requestSaveAs, saveAsTabId } from '../stores/save-as'
  import { schema, fetchSchema } from '../stores/schema'
  import type { Schema } from '../types/cli'
  import BubbleMenu from './wysiwyg/BubbleMenu.svelte'
  import MediaBubbleMenu from './wysiwyg/MediaBubbleMenu.svelte'
  import EditorContextMenu from './wysiwyg/EditorContextMenu.svelte'
  import LinkModal from './wysiwyg/LinkModal.svelte'
  import InsertAssetDialog from './InsertAssetDialog.svelte'
  import { requestConfirmation } from '../stores/confirmation'
  import {
    computeRelativeMediaPath,
    isPublicMediaUrl,
    resolveCollectionMediaPath,
    type MediaEmbed
  } from '../lib/media-embed'
  import LinkHoverPreview from './LinkHoverPreview.svelte'
  import { insertAssetNode, syncFileStoresFromTab } from '../stores/files'
  import {
    clipboardImageData,
    firstClipboardImageItem,
    markdownFileDirectory,
    suggestImageStem,
    type ClipboardImageData,
    type ClipboardImageDestination
  } from '../lib/clipboard-image'
  import { registerComputedEditorAdapter } from '../stores/computed-editor-flush'

  // ── Props ─────────────────────────────────────────────────────────────
  interface WysiwygEditorProps {
    tabId?: string
  }
  let { tabId }: WysiwygEditorProps = $props()

  // ── Constants ─────────────────────────────────────────────────────────
  /** Maximum number of live TipTap editor instances to keep in the pool. */
  const MAX_POOL_SIZE = 10
  /** Large file handling (>1MB). */
  const LARGE_FILE_THRESHOLD = 1024 * 1024

  // ── Instance Pool ─────────────────────────────────────────────────────
  /**
   * Pool of live TipTap editor instances keyed by tab ID.
   * Each entry holds the editor, its container div, scroll position,
   * the lastSavedContent for dirty tracking, and per-tab frontmatter.
   *
   * We show/hide DOM containers instead of calling setContent() which
   * breaks undo history (tiptap#5708).
   */
  interface PoolEntry {
    editor: WysiwygEditorInstance
    container: HTMLDivElement
    scrollTop: number
    lastSavedContent: string
    frontmatter: string | null
  }

  /**
   * Serialized state for evicted pool entries (beyond MAX_POOL_SIZE).
   * Stores the editor JSON so the editor can be reconstructed when re-activated.
   * Note: undo history is lost on eviction — this is an acceptable trade-off
   * for memory management. The show/hide pool preserves undo for active tabs.
   */
  interface SerializedEntry {
    editorJSON: unknown
    scrollTop: number
    lastSavedContent: string
    frontmatter: string | null
  }

  const pool = new Map<string, PoolEntry>()
  const serializedPool = new Map<string, SerializedEntry>()
  /** LRU access order — most recently accessed tab ID is last. */
  const accessOrder: string[] = []
  const unregisterComputedEditorAdapter = registerComputedEditorAdapter({
    snapshot(id) {
      const entry = pool.get(id)
      if (!entry) return undefined
      const content = getFullContentForEntry(entry)
      return { content, isDirty: content !== entry.lastSavedContent }
    },
    markSaved(id, content) {
      const entry = pool.get(id)
      if (entry) entry.lastSavedContent = content
      const serialized = serializedPool.get(id)
      if (serialized) serialized.lastSavedContent = content
    }
  })

  // ── Component State ───────────────────────────────────────────────────
  let editorHost: HTMLDivElement | undefined = $state(undefined)
  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let largeFileWarning = $state(false)
  let composingRetryTimer: ReturnType<typeof setTimeout> | null = null

  // Frontmatter for the currently active tab (reactive for FrontmatterEditor)
  let currentFrontmatter: string | null = $state(null)

  // ── Store Subscriptions ───────────────────────────────────────────────
  let currentActiveCollection: import('../../preload/api').Collection | null = $state(null)
  const unsubCollection = activeCollection.subscribe((v) => (currentActiveCollection = v))

  // Schema for frontmatter awareness
  let currentSchema = $state<Schema | null>(null)
  const unsubSchema = schema.subscribe((v) => (currentSchema = v))

  // Fetch schema when the active document tab or collection changes
  $effect(() => {
    if (currentActiveCollection && activeDocTab) {
      const filePath = activeDocTab.filePath
      const lastSlash = filePath.lastIndexOf('/')
      const pathPrefix = lastSlash > 0 ? filePath.substring(0, lastSlash) : undefined
      fetchSchema(currentActiveCollection.path, pathPrefix)
    }
  })

  let saveCounter = $state(0)
  let lastSaveCounter = 0
  const unsubSave = saveRequested.subscribe((v) => (saveCounter = v))
  $effect(() => {
    if (saveCounter > 0 && saveCounter !== lastSaveCounter) {
      lastSaveCounter = saveCounter
      handleSave()
    }
  })

  let discardCounter = $state(0)
  let lastDiscardCounter = 0
  const unsubDiscard = discardRequested.subscribe((v) => (discardCounter = v))
  $effect(() => {
    if (discardCounter > 0 && discardCounter !== lastDiscardCounter) {
      lastDiscardCounter = discardCounter
      handleDiscard()
    }
  })

  // Native menu Format/Structure commands (phase 43) — same signal pattern
  // as saveRequested. Only the instance hosting the focused document tab in
  // wysiwyg mode executes.
  let commandSignal = $state<EditorCommandSignal | null>(null)
  let lastCommandNonce = 0
  const unsubCommand = editorCommand.subscribe((v) => (commandSignal = v))
  $effect(() => {
    const signal = commandSignal
    if (signal && signal.nonce !== lastCommandNonce) {
      lastCommandNonce = signal.nonce
      executeEditorCommand(signal)
    }
  })

  // Focus editor when switching to wysiwyg mode
  let currentEditorMode = $state<EditorMode>('wysiwyg')
  const unsubEditorMode = editorMode.subscribe((v) => (currentEditorMode = v))
  $effect(() => {
    if (currentEditorMode === 'wysiwyg' && activeTabId) {
      const entry = pool.get(activeTabId)
      if (entry) {
        requestAnimationFrame(() => entry.editor.editor.commands.focus())
      }
    }
  })

  // ── Derived Tab State ─────────────────────────────────────────────────
  /**
   * Resolve the active tab ID: use the explicit tabId prop if provided,
   * otherwise fall back to the workspace's focused document tab.
   */
  const activeTabId = $derived(tabId ?? workspace.focusedDocumentTab?.id ?? null)
  const activeDocTab = $derived.by(() => {
    if (!activeTabId) return null
    const tab = workspace.tabs[activeTabId]
    return tab?.kind === 'document' ? (tab as DocumentTab) : null
  })

  interface PendingClipboardImage {
    awaitingSaveAs: boolean
    collectionPath: string
    from: number
    heading: string | null
    image: ClipboardImageData
    tabId: string
    to: number
  }

  let pendingClipboardImage = $state<PendingClipboardImage | null>(null)
  let currentSaveAsTabId = $state<string | null>(null)
  const unsubSaveAs = saveAsTabId.subscribe((value) => (currentSaveAsTabId = value))

  const pendingClipboardTab = $derived.by(() => {
    if (!pendingClipboardImage) return null
    const pendingTab = workspace.tabs[pendingClipboardImage.tabId]
    return pendingTab?.kind === 'document' ? (pendingTab as DocumentTab) : null
  })
  const pendingClipboardBaseStem = $derived(
    pendingClipboardTab && pendingClipboardImage
      ? suggestImageStem(pendingClipboardTab.filePath, pendingClipboardImage.heading)
      : ''
  )
  const pendingClipboardDirectory = $derived(
    pendingClipboardTab ? markdownFileDirectory(pendingClipboardTab.filePath) : ''
  )

  $effect(() => {
    const pending = pendingClipboardImage
    if (!pending?.awaitingSaveAs) return
    const pendingTab = workspace.tabs[pending.tabId]
    if (pendingTab?.kind === 'document' && !pendingTab.isUntitled) {
      pendingClipboardImage = { ...pending, awaitingSaveAs: false }
    } else if (currentSaveAsTabId === null) {
      pendingClipboardImage = null
    }
  })

  /** The TipTap Editor instance for the active tab (for BubbleMenu/ContextMenu). */
  let activeEditor = $state<import('@tiptap/core').Editor | null>(null)

  // ── Link Modal ─────────────────────────────────────────────────────────
  let linkModalOpen = $state(false)
  let linkModalInitialQuery = $state('')

  function handleOpenLinkModal(e: Event) {
    const detail = (e as CustomEvent).detail
    linkModalInitialQuery = detail?.initialQuery ?? ''
    linkModalOpen = true
  }

  function closeLinkModal() {
    linkModalOpen = false
    linkModalInitialQuery = ''
  }

  // ── Media picker ──────────────────────────────────────────────────────
  let mediaDialogOpen = $state(false)
  let mediaDialogInitial = $state<MediaEmbed | null>(null)

  function openMediaInsert(): void {
    mediaDialogInitial = null
    mediaDialogOpen = true
  }

  function openMediaEditor(media: MediaEmbed): void {
    mediaDialogInitial = media
    mediaDialogOpen = true
  }

  function openMediaInTab(media: MediaEmbed): void {
    if (!activeDocTab) return
    const filePath = resolveCollectionMediaPath(activeDocTab.filePath, media.src)
    if (!filePath) return

    if (workspace.isPopup && currentActiveCollection) {
      void window.api.openPopup({
        kind: 'asset',
        filePath,
        mimeCategory: media.kind,
        collectionId: currentActiveCollection.id,
        collectionPath: currentActiveCollection.path
      })
      return
    }

    workspace.openAssetTab(filePath, media.kind)
    syncFileStoresFromTab()
  }

  function openMediaExternal(media: MediaEmbed): void {
    if (isPublicMediaUrl(media.src)) {
      window.open(media.src, '_blank')
      return
    }
    if (!activeDocTab || !currentActiveCollection) return
    const filePath = resolveCollectionMediaPath(activeDocTab.filePath, media.src)
    if (!filePath) return
    const root = currentActiveCollection.path.replace(/[\\/]+$/, '')
    void window.api.openPath(`${root}/${filePath}`)
  }

  function insertMedia(editor: import('@tiptap/core').Editor, media: MediaEmbed): void {
    editor
      .chain()
      .focus()
      .insertContent(
        media.kind === 'image'
          ? { type: 'image', attrs: { src: media.src, alt: media.alt } }
          : {
              type: 'mediaEmbed',
              attrs: { kind: media.kind, src: media.src, alt: media.alt }
            }
      )
      .run()
  }

  function changeSelectedMedia(media: MediaEmbed): void {
    if (activeEditor) insertMedia(activeEditor, media)
    mediaDialogInitial = null
  }

  function handleOpenMediaDialog(): void {
    openMediaInsert()
  }

  // ── Context Menu (driven by custom DOM event from table-ui-extension) ──
  let contextMenuOpen = $state(false)
  let contextMenuX = $state(0)
  let contextMenuY = $state(0)

  function handleEditorContextMenu(e: Event) {
    if (activeDocTab?.readOnly) return
    const detail = (e as CustomEvent).detail
    contextMenuX = detail.x
    contextMenuY = detail.y
    contextMenuOpen = true
    // Close any open link bubble
    document.querySelector('.link-bubble-popup')?.remove()
  }

  function closeContextMenu() {
    contextMenuOpen = false
  }

  // ── Pool Management ───────────────────────────────────────────────────

  /** Touch a tab ID in the LRU access order (move to end). */
  function touchAccess(id: string): void {
    const idx = accessOrder.indexOf(id)
    if (idx >= 0) accessOrder.splice(idx, 1)
    accessOrder.push(id)
  }

  /** Evict the least recently used pool entries beyond MAX_POOL_SIZE. */
  function evictIfNeeded(): void {
    while (pool.size > MAX_POOL_SIZE) {
      // Find the oldest entry in accessOrder that is NOT the active tab
      let evictId: string | null = null
      for (const id of accessOrder) {
        if (id !== activeTabId && pool.has(id)) {
          evictId = id
          break
        }
      }
      if (!evictId) break

      const entry = pool.get(evictId)!
      // Serialize the editor state (undo history is lost, but content is preserved)
      serializedPool.set(evictId, {
        editorJSON: entry.editor.editor.getJSON(),
        scrollTop: entry.container.querySelector('.ProseMirror')?.scrollTop ?? 0,
        lastSavedContent: entry.lastSavedContent,
        frontmatter: entry.frontmatter
      })

      // Destroy the live editor and remove its container
      entry.editor.destroy()
      entry.container.remove()
      pool.delete(evictId)

      // Remove from access order
      const idx = accessOrder.indexOf(evictId)
      if (idx >= 0) accessOrder.splice(idx, 1)
    }
  }

  // ── Editor Factory ────────────────────────────────────────────────────

  /** Guard flag: true while an editor is being created, to suppress spurious dirty marking. */
  let initializing = false

  /**
   * Get the full markdown content for a pool entry by joining its
   * frontmatter with the editor body.
   */
  function getFullContentForEntry(entry: PoolEntry): string {
    const body = entry.editor.getMarkdown()
    return joinFrontmatter(entry.frontmatter, body)
  }

  /**
   * Handle TipTap content updates for the active tab — debounced sync to stores.
   */
  function handleEditorUpdate() {
    if (initializing) return
    if (!activeTabId) return
    const entry = pool.get(activeTabId)
    if (!entry) return

    const fullContent = getFullContentForEntry(entry)
    // Sync content to tab immediately so mode switches pick up latest edits
    const tab = activeDocTab
    if (tab) tab.content = fullContent
    isDirty.set(fullContent !== entry.lastSavedContent)
    wordCount.set(countWords(fullContent))
    tokenCount.set(countTokens(fullContent))

    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      propertiesFileContent.set(fullContent)
    }, 200)
  }

  /**
   * Get or create a TipTap editor for a given tab. Returns the pool entry.
   * If a serialized state exists, restores it. Otherwise creates a fresh editor
   * from the provided content (splitting frontmatter).
   */
  function getOrCreateEntry(id: string, content: string): PoolEntry {
    // Check if already in the live pool
    const existing = pool.get(id)
    if (existing) {
      touchAccess(id)
      return existing
    }

    // Create a container div for this editor instance
    const container = document.createElement('div')
    container.className = 'wysiwyg-instance'
    container.style.display = 'none'
    container.style.flex = '1'
    container.style.minHeight = '0'
    container.style.flexDirection = 'column'
    container.style.overflow = 'auto'
    container.style.position = 'relative'
    // Attach context menu and link modal handlers to the container
    container.addEventListener('editor-contextmenu', handleEditorContextMenu)
    container.addEventListener('open-link-modal', handleOpenLinkModal)
    container.addEventListener('open-media-dialog', handleOpenMediaDialog)

    let editor: WysiwygEditorInstance
    let scrollTop = 0
    let lastSavedContent = content
    let frontmatter: string | null = null

    // Suppress spurious dirty marking during editor creation
    initializing = true
    try {
      // Check for serialized state (evicted editor)
      const serialized = serializedPool.get(id)
      if (serialized) {
        serializedPool.delete(id)
        scrollTop = serialized.scrollTop
        lastSavedContent = serialized.lastSavedContent
        frontmatter = serialized.frontmatter

        // Reconstruct editor from serialized JSON
        // Note: we create with empty content then set JSON to restore structure
        editor = createWysiwygEditor(container, '', {
          onUpdate: () => handleEditorUpdate(),
          onPaste: handleEditorPaste,
          collectionPath: currentActiveCollection?.path ?? '',
          collectionId: currentActiveCollection?.id ?? '',
          currentFilePath: activeDocTab?.filePath ?? '',
          editable: !activeDocTab?.readOnly
        })
        editor.editor.commands.setContent(serialized.editorJSON)
      } else {
        // Fresh editor — split frontmatter from content
        const split = splitFrontmatter(content)
        frontmatter = split.frontmatter

        editor = createWysiwygEditor(container, split.body, {
          onUpdate: () => handleEditorUpdate(),
          onPaste: handleEditorPaste,
          collectionPath: currentActiveCollection?.path ?? '',
          collectionId: currentActiveCollection?.id ?? '',
          currentFilePath: activeDocTab?.filePath ?? '',
          editable: !activeDocTab?.readOnly
        })
      }
    } finally {
      initializing = false
    }

    const entry: PoolEntry = {
      editor,
      container,
      scrollTop,
      lastSavedContent,
      frontmatter
    }

    pool.set(id, entry)
    touchAccess(id)
    evictIfNeeded()

    return entry
  }

  // ── Show / Hide ───────────────────────────────────────────────────────

  let previousActiveTabId: string | null = null

  /**
   * Main reactive effect: whenever the active tab changes, show its editor
   * and hide the previously active one. Uses show/hide (not setContent) to
   * preserve undo history per tab (tiptap#5708).
   */
  $effect(() => {
    const currentTabId = activeTabId
    const tab = activeDocTab

    if (!editorHost || !currentTabId || !tab) {
      // No active document tab — hide all
      hideEntry(previousActiveTabId)
      previousActiveTabId = null
      currentFrontmatter = null
      activeEditor = null
      return
    }

    // Content still loading — wait
    if (tab.contentLoading || tab.content === null) {
      return
    }

    const isSwitching = previousActiveTabId !== currentTabId

    if (isSwitching) {
      // Save scroll position of previous tab and hide it
      hideEntry(previousActiveTabId)
    }

    // Large file check: >1MB forces Source/Preview mode
    const contentSize = new Blob([tab.content].filter(Boolean)).size
    if (contentSize > LARGE_FILE_THRESHOLD) {
      largeFileWarning = true
      editorMode.set('editor')
      previousActiveTabId = currentTabId
      return
    }

    largeFileWarning = false

    // Get or create the editor for this tab
    const entry = getOrCreateEntry(currentTabId, tab.content)

    // Ensure the container is in the host DOM
    if (!editorHost.contains(entry.container)) {
      editorHost.appendChild(entry.container)
    }

    // Update reactive editor reference for BubbleMenu/ContextMenu
    activeEditor = entry.editor.editor

    if (isSwitching) {
      // Show this editor
      entry.container.style.display = 'flex'

      // Restore scroll position on next frame
      requestAnimationFrame(() => {
        const pm = entry.container.querySelector('.ProseMirror')
        if (pm) pm.scrollTop = entry.scrollTop
      })

      // Sync frontmatter state for FrontmatterEditor
      currentFrontmatter = entry.frontmatter

      // Use savedContent (disk state) for dirty tracking across mode switches
      entry.lastSavedContent = tab.savedContent ?? tab.content!

      // Reconcile hidden pool entries whose tab content moved on while hidden
      // (external live-applies, cross-window saves, serialized restores)
      const fullContent = getFullContentForEntry(entry)
      if (!tab.isDirty && fullContent !== tab.content) {
        applyExternalContent(entry, tab.content!, tab)
      } else {
        isDirty.set(fullContent !== entry.lastSavedContent)
        wordCount.set(countWords(fullContent))
        tokenCount.set(countTokens(fullContent))
      }

      previousActiveTabId = currentTabId
    } else {
      // Same tab — content changed from outside the editor (external live
      // apply, conflict resolution, or cross-window sync)
      const currentBody = entry.editor.getMarkdown()
      const currentFullContent = joinFrontmatter(entry.frontmatter, currentBody)
      if (tab.content !== entry.lastSavedContent && tab.content !== currentFullContent) {
        applyExternalContent(entry, tab.content, tab)
      }
    }
  })

  function hideEntry(id: string | null): void {
    if (!id) return
    const entry = pool.get(id)
    if (!entry) return

    // Save scroll position before hiding
    const pm = entry.container.querySelector('.ProseMirror')
    if (pm) entry.scrollTop = pm.scrollTop
    entry.container.style.display = 'none'
  }

  /**
   * Apply externally-changed content into a live TipTap editor. There is no
   * sane minimal-patch route from markdown into a ProseMirror doc, so this is
   * a whole-doc setContent with best-effort cursor/scroll restoration. It
   * resets this tab's undo history (tiptap#5708 territory) — acceptable
   * because live apply only ever fires on tabs with no unsaved work.
   */
  function applyExternalContent(entry: PoolEntry, content: string, tab: DocumentTab): void {
    const currentFull = joinFrontmatter(entry.frontmatter, entry.editor.getMarkdown())
    if (currentFull === content) {
      entry.lastSavedContent = tab.savedContent ?? content
      return
    }

    // Never replace content mid-IME-composition — retry after it ends
    if (entry.editor.editor.view.composing) {
      scheduleComposingRetry(entry, tab)
      return
    }

    const { frontmatter, body } = splitFrontmatter(content)
    const selection = entry.editor.editor.state.selection.from
    const pm = entry.container.querySelector('.ProseMirror')
    const scrollTop = pm?.scrollTop ?? 0

    entry.frontmatter = frontmatter
    entry.lastSavedContent = tab.savedContent ?? content
    if (activeTabId && pool.get(activeTabId) === entry) {
      currentFrontmatter = frontmatter
    }

    initializing = true
    try {
      entry.editor.setMarkdownContent(body)
    } finally {
      initializing = false
    }

    // Best-effort cursor restore (clamped, without stealing focus) + scroll
    try {
      const size = entry.editor.editor.state.doc.content.size
      entry.editor.editor.commands.setTextSelection(Math.min(selection, size))
    } catch {
      // Selection restore is best-effort only
    }
    requestAnimationFrame(() => {
      const pmAfter = entry.container.querySelector('.ProseMirror')
      if (pmAfter) pmAfter.scrollTop = scrollTop
    })

    // Write tab fields directly (not the focused-tab store shims) — with
    // split panes this component may not host the focused tab.
    tab.content = content
    tab.isDirty = content !== entry.lastSavedContent
    tab.wordCount = countWords(content)
    tab.tokenCount = countTokens(content)
    syncEditorStoresFromTab()
  }

  /** Re-apply the tab's latest content once the IME composition ends. */
  function scheduleComposingRetry(entry: PoolEntry, tab: DocumentTab): void {
    const retry = () => {
      entry.editor.editor.view.dom.removeEventListener('compositionend', retry)
      if (composingRetryTimer) {
        clearTimeout(composingRetryTimer)
        composingRetryTimer = null
      }
      if (tab.content !== null && !tab.isDirty) {
        applyExternalContent(entry, tab.content, tab)
      }
    }
    entry.editor.editor.view.dom.addEventListener('compositionend', retry, { once: true })
    composingRetryTimer = setTimeout(retry, 300)
  }

  // ── Frontmatter Handling ─────────────────────────────────────────────

  /**
   * Handle frontmatter updates from the visual property editor.
   * Updates the per-tab frontmatter in the pool entry.
   */
  function handleFrontmatterUpdate(newYaml: string | null) {
    currentFrontmatter = newYaml

    // Persist frontmatter to the pool entry
    if (activeTabId) {
      const entry = pool.get(activeTabId)
      if (entry) {
        entry.frontmatter = newYaml
        handleEditorUpdate()
      }
    }
  }

  // ── File Rename ────────────────────────────────────────────────────────

  function handleFileRenamed(newPath: string) {
    if (!activeDocTab) return
    // Update the tab's filePath and title. The tree patches itself from the
    // rename's vault event — no full reload needed.
    activeDocTab.filePath = newPath
    activeDocTab.title = newPath.split('/').pop() ?? newPath
  }

  // ── Save ──────────────────────────────────────────────────────────────

  function handleSave(): boolean {
    if (!activeTabId || !currentActiveCollection) return true
    const entry = pool.get(activeTabId)
    if (!entry) return true

    const tab = activeDocTab
    if (!tab) return true
    if (tab.readOnly) return true

    // Skip save if already clean (e.g., SaveAsModal already handled it)
    if (!tab.isDirty && !tab.isUntitled) return true

    // Untitled files need a "Save As" dialog to pick a filename
    if (tab.isUntitled) {
      const content = getFullContentForEntry(entry)
      tab.content = content
      requestSaveAs(activeTabId)
      return true
    }

    const content = getFullContentForEntry(entry)
    const fullPath = `${currentActiveCollection.path}/${tab.filePath}`

    entry.lastSavedContent = content
    tab.content = content
    tab.savedContent = content
    isDirty.set(false)

    const savedPath = tab.filePath
    window.api
      .writeFile(fullPath, content)
      .then(() => {
        dismissConflict(savedPath)
      })
      .catch((err) => {
        console.error('Save failed:', err)
      })
    return true
  }

  /**
   * Schema/module runs can mutate a document's frontmatter on disk. Flush the
   * originating editor and await the write so the CLI never evaluates stale
   * inputs or has its materialized value overwritten by a later editor save.
   */
  async function flushBeforeSchemaMutation(context: DocumentSchemaMutationContext): Promise<void> {
    const entry = pool.get(context.tabId)
    const candidate = workspace.tabs[context.tabId]
    const tab = candidate?.kind === 'document' ? candidate : null
    if (!entry || !tab) throw new Error('No active document')
    if (tab.isUntitled) throw new Error('Save this document before changing its schema')
    if (!tab.isDirty) return

    const content = getFullContentForEntry(entry)
    const fullPath = `${context.collectionPath}/${context.filePath}`
    await window.api.writeFile(fullPath, content)

    entry.lastSavedContent = content
    tab.content = content
    tab.savedContent = content
    if (activeTabId === context.tabId) isDirty.set(false)
    dismissConflict(context.filePath)
  }

  /**
   * A successful Formula mutation may change both the schema definition and
   * this file's materialized value. Re-read both explicitly; schema overlay
   * writes are intentionally watcher-suppressed and therefore cannot be left
   * to an eventual filesystem event.
   */
  async function reconcileAfterSchemaMutation(
    context: DocumentSchemaMutationContext
  ): Promise<void> {
    const entry = pool.get(context.tabId)
    const candidate = workspace.tabs[context.tabId]
    const tab = candidate?.kind === 'document' ? candidate : null
    if (!entry || !tab || tab.isUntitled) return
    if (tab.isDirty) return

    const lastSlash = context.filePath.lastIndexOf('/')
    const pathPrefix = lastSlash > 0 ? context.filePath.substring(0, lastSlash) : undefined
    const fullPath = `${context.collectionPath}/${context.filePath}`
    const refreshActiveStores =
      currentActiveCollection?.id === context.collectionId && activeTabId === context.tabId
    const tasks: Promise<unknown>[] = [window.api.readFile(fullPath)]
    if (refreshActiveStores) {
      tasks.push(fetchSchema(context.collectionPath, pathPrefix), loadProperties(context.filePath))
    }
    const [content] = await Promise.all(tasks)

    tab.content = content as string
    tab.savedContent = content as string
    applyExternalContent(entry, content as string, tab)
    if (activeTabId === context.tabId) isDirty.set(false)
  }

  // ── Discard ───────────────────────────────────────────────────────────

  function handleDiscard(): void {
    if (!activeTabId) return
    const entry = pool.get(activeTabId)
    const tab = activeDocTab
    if (!entry || !tab) return

    // Reload last saved content into the editor
    applyExternalContent(entry, entry.lastSavedContent, tab)
  }

  // ── Native menu Format/Structure commands (phase 43) ─────────────────

  /** Collect headings from the ProseMirror doc (body only — frontmatter is split out). */
  function collectDocHeadings(
    doc: import('@tiptap/pm/model').Node
  ): { pos: number; level: number; text: string }[] {
    const headings: { pos: number; level: number; text: string }[] = []
    doc.descendants((node, pos) => {
      if (node.type.name === 'heading') {
        headings.push({ pos, level: node.attrs.level as number, text: node.textContent })
      }
      return true
    })
    return headings
  }

  function executeEditorCommand(signal: EditorCommandSignal): void {
    // Only the instance hosting the focused document tab in wysiwyg mode acts.
    const tab = activeDocTab
    if (!tab || tab.editorMode !== 'wysiwyg') return
    if (workspace.focusedDocumentTab?.id !== activeTabId) return
    const entry = activeTabId ? pool.get(activeTabId) : null
    if (!entry) return
    const editor = entry.editor.editor

    switch (signal.id) {
      case 'format.bold':
        editor.chain().focus().toggleBold().run()
        break
      case 'format.italic':
        editor.chain().focus().toggleItalic().run()
        break
      case 'format.strike':
        editor.chain().focus().toggleStrike().run()
        break
      case 'format.highlight':
        editor.chain().focus().toggleHighlight().run()
        break
      case 'format.code':
        editor.chain().focus().toggleCode().run()
        break
      case 'format.clear':
        editor.chain().focus().clearNodes().unsetAllMarks().run()
        break
      case 'format.heading': {
        const level = (signal.payload as { level?: number } | undefined)?.level ?? 1
        editor
          .chain()
          .focus()
          .toggleHeading({ level: Math.min(6, Math.max(1, level)) as 1 | 2 | 3 | 4 | 5 | 6 })
          .run()
        break
      }
      case 'format.paragraph':
        editor.chain().focus().setParagraph().run()
        break
      case 'format.bullet-list':
        editor.chain().focus().toggleBulletList().run()
        break
      case 'format.ordered-list':
        editor.chain().focus().toggleOrderedList().run()
        break
      case 'format.task-list':
        editor.chain().focus().toggleTaskList().run()
        break
      case 'format.blockquote':
        editor.chain().focus().toggleBlockquote().run()
        break
      case 'format.code-block':
        editor.chain().focus().toggleCodeBlock().run()
        break
      case 'format.link':
        // Reuse the existing LinkModal flow (same event the context menu fires)
        editor.view.dom.dispatchEvent(new CustomEvent('open-link-modal', { bubbles: true }))
        break
      case 'format.media': {
        const media = signal.payload as MediaEmbed | undefined
        if (!media?.src) break
        insertMedia(editor, media)
        break
      }
      case 'format.insert-table':
        editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
        break
      case 'format.hr':
        editor.chain().focus().setHorizontalRule().run()
        break
      case 'structure.toc': {
        const headings: ParsedHeading[] = collectDocHeadings(editor.state.doc).map((h, i) => ({
          level: h.level,
          text: h.text,
          line: i + 1
        }))
        const toc = buildTocTiptapJSON(headings)
        if (toc) editor.chain().focus().insertContent(toc).run()
        break
      }
      case 'structure.promote':
      case 'structure.demote': {
        const delta = signal.id === 'structure.promote' ? -1 : 1
        if (!editor.isActive('heading')) break
        const current = editor.getAttributes('heading').level as number
        const next = current + delta
        if (next < 1 || next > 6) break
        editor
          .chain()
          .focus()
          .setHeading({ level: next as 1 | 2 | 3 | 4 | 5 | 6 })
          .run()
        break
      }
      case 'structure.fix-hierarchy': {
        const headings = collectDocHeadings(editor.state.doc)
        const fixed = computeFixedHeadingLevels(headings.map((h) => h.level))
        const changed = headings
          .map((h, i) => ({ ...h, fixed: fixed[i] }))
          .filter((h) => h.fixed !== h.level)
        if (changed.length === 0) break
        // One transaction = one undo step; never setMarkdownContent here
        // (it resets undo history — tiptap#5708).
        editor
          .chain()
          .focus()
          .command(({ tr, state }) => {
            for (const heading of changed) {
              const node = state.doc.nodeAt(heading.pos)
              if (node?.type.name === 'heading') {
                tr.setNodeMarkup(heading.pos, undefined, { ...node.attrs, level: heading.fixed })
              }
            }
            return true
          })
          .run()
        break
      }
    }
  }

  // ── Large File Warning ────────────────────────────────────────────────

  function dismissLargeFileWarning() {
    largeFileWarning = false
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────

  onMount(() => {
    // The main $effect handles initial creation
  })

  onDestroy(() => {
    unregisterComputedEditorAdapter()
    if (debounceTimer) clearTimeout(debounceTimer)
    if (composingRetryTimer) clearTimeout(composingRetryTimer)

    // Sync changed entries before destroying. A clean TipTap document may
    // serialize to equivalent but byte-different Markdown (for example list
    // or whitespace normalization). Preserve the exact disk content for clean
    // tabs so merely switching editor modes never creates phantom changes.
    for (const [id, entry] of pool) {
      const tab = workspace.tabs[id]
      if (tab && tab.kind === 'document' && tab.isDirty) {
        tab.content = getFullContentForEntry(entry)
      }
    }

    // Destroy all pooled TipTap editors
    for (const [, entry] of pool) {
      entry.editor.destroy()
      entry.container.remove()
    }
    pool.clear()
    serializedPool.clear()
    accessOrder.length = 0

    unsubCollection()
    unsubSchema()
    unsubSave()
    unsubDiscard()
    unsubCommand()
    unsubEditorMode()
    unsubSaveAs()
  })

  // ── Drag-and-drop (internal tree + external OS) ──────────────────────

  const ASSET_IMAGE_EXTS = new Set([
    'png',
    'jpg',
    'jpeg',
    'gif',
    'svg',
    'webp',
    'bmp',
    'ico',
    'avif'
  ])
  const ASSET_EXTS = new Set([
    ...ASSET_IMAGE_EXTS,
    'pdf',
    'mp4',
    'webm',
    'mov',
    'mp3',
    'wav',
    'ogg'
  ])

  function getRelativePath(fromFile: string, toFile: string): string {
    const fromParts = fromFile.split('/')
    fromParts.pop() // Remove filename to get directory
    const toParts = toFile.split('/')

    // Find common prefix length
    let common = 0
    while (
      common < fromParts.length &&
      common < toParts.length &&
      fromParts[common] === toParts[common]
    ) {
      common++
    }

    const ups = fromParts.length - common
    const rest = toParts.slice(common)
    const prefix = ups > 0 ? Array(ups).fill('..').join('/') : '.'
    return ups > 0 ? `${prefix}/${rest.join('/')}` : rest.join('/')
  }

  function handleEditorDragOver(e: DragEvent) {
    if (activeDocTab?.readOnly) return
    e.preventDefault()
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'link'
    }
  }

  async function handleEditorDrop(e: DragEvent) {
    if (activeDocTab?.readOnly) return
    e.preventDefault()
    if (!e.dataTransfer) return

    const currentEditor = activeEditor
    if (!currentEditor) return

    const currentFile = activeDocTab?.filePath
    if (!currentFile) return
    const collection = get(activeCollection)
    if (!collection) return

    // Case 1: Internal tree drag (application/x-mdvdb-path)
    const mdvdbPath = e.dataTransfer.getData('application/x-mdvdb-path')
    if (mdvdbPath) {
      const ext = mdvdbPath.split('.').pop()?.toLowerCase() ?? ''
      const relPath = getRelativePath(currentFile, mdvdbPath)
      const name = mdvdbPath.split('/').pop() ?? mdvdbPath

      if (ASSET_IMAGE_EXTS.has(ext)) {
        currentEditor.chain().focus().setImage({ src: relPath, alt: name }).run()
      } else {
        currentEditor.chain().focus().insertContent(`[${name}](${relPath})`).run()
      }
      return
    }

    // Case 2: External OS drag (File objects)
    const files = e.dataTransfer.files
    if (files.length > 0) {
      for (const file of files) {
        const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
        if (!ASSET_EXTS.has(ext)) continue

        const absolutePath = window.api.getPathForFile(file)
        if (!absolutePath) continue

        const checkResult = await window.api.isWithinCollection(absolutePath)

        if (checkResult.within && checkResult.collectionPath === collection.path) {
          // File is inside the collection — just link it
          const relToCollection = relativeToCollection(absolutePath, collection.path) ?? file.name
          const relPath = getRelativePath(currentFile, relToCollection)
          const name = file.name

          if (ASSET_IMAGE_EXTS.has(ext)) {
            currentEditor.chain().focus().setImage({ src: relPath, alt: name }).run()
          } else {
            currentEditor.chain().focus().insertContent(`[${name}](${relPath})`).run()
          }
        } else {
          // File is outside the collection — prompt and copy
          const confirmed = await requestConfirmation({
            title: `Copy ${file.name} into this collection?`,
            message:
              'The file is outside your collection. Tesseract can copy it alongside the current document before inserting the link.',
            confirmLabel: 'Copy and Insert'
          })
          if (!confirmed) continue

          // Determine destination path (same directory as current file)
          const currentDir = currentFile.split('/').slice(0, -1).join('/')
          let destName = file.name
          let destRelPath = currentDir ? `${currentDir}/${destName}` : destName
          let destAbsPath = `${collection.path}/${destRelPath}`

          // Auto-suffix if file already exists
          try {
            await window.api.fileInfo(destAbsPath)
            // File exists — add suffix
            const baseName = destName.replace(/\.[^.]+$/, '')
            const extension = destName.includes('.') ? '.' + destName.split('.').pop() : ''
            let suffix = 1
            while (true) {
              destName = `${baseName}-${suffix}${extension}`
              destRelPath = currentDir ? `${currentDir}/${destName}` : destName
              destAbsPath = `${collection.path}/${destRelPath}`
              try {
                await window.api.fileInfo(destAbsPath)
                suffix++
              } catch {
                break
              }
            }
          } catch {
            // File doesn't exist — good
          }

          await window.api.copyFile(absolutePath, destAbsPath)
          const relPath = getRelativePath(currentFile, destRelPath)

          if (ASSET_IMAGE_EXTS.has(ext)) {
            currentEditor.chain().focus().setImage({ src: relPath, alt: destName }).run()
          } else {
            currentEditor.chain().focus().insertContent(`[${destName}](${relPath})`).run()
          }
        }
      }
    }
  }

  // ── Clipboard paste (images) ─────────────────────────────────────────

  function handleEditorPaste(e: ClipboardEvent): boolean {
    if (activeDocTab?.readOnly) return false
    if (!e.clipboardData) return false

    const clipboardImage = firstClipboardImageItem(e.clipboardData.items)
    if (!clipboardImage) return false // Let TipTap handle normal paste

    const sourceTabId = activeTabId
    const sourceTab = activeDocTab
    const entry = sourceTabId ? pool.get(sourceTabId) : null
    const collection = get(activeCollection)
    if (!sourceTabId || !sourceTab || !entry || !collection) return false

    e.preventDefault()
    const selection = entry.editor.editor.state.selection
    const heading =
      collectDocHeadings(entry.editor.editor.state.doc)
        .filter((item) => item.pos <= selection.from)
        .at(-1)?.text ?? null
    void clipboardImageData(clipboardImage.item, clipboardImage.extension)
      .then((image) => {
        if (!image || !pool.has(sourceTabId)) return

        pendingClipboardImage = {
          awaitingSaveAs: sourceTab.isUntitled,
          collectionPath: collection.path,
          from: selection.from,
          heading,
          image,
          tabId: sourceTabId,
          to: selection.to
        }
        if (sourceTab.isUntitled) requestSaveAs(sourceTabId)
      })
      .catch((cause: unknown) => {
        void window.api.showMessage({
          message:
            cause instanceof Error ? cause.message : 'The clipboard image could not be read.',
          title: 'Image Paste Failed',
          type: 'error'
        })
      })
    return true
  }

  async function saveClipboardImage(destination: ClipboardImageDestination): Promise<void> {
    const pending = pendingClipboardImage
    const pendingTab = pendingClipboardTab
    if (!pending || !pendingTab) throw new Error('The source document is no longer open.')
    const entry = pool.get(pending.tabId)
    if (!entry) throw new Error('The source editor is no longer available.')

    const absolutePath = `${pending.collectionPath}/${destination.relativePath}`
    const result = await window.api.createBinary(absolutePath, pending.image.base64Data)

    const src = computeRelativeMediaPath(pendingTab.filePath, destination.relativePath)
    const inserted = entry.editor.editor
      .chain()
      .focus()
      .insertContentAt(
        { from: pending.from, to: pending.to },
        { type: 'image', attrs: { src, alt: destination.filename } }
      )
      .run()
    if (!inserted) {
      await window.api.deleteFile(absolutePath).catch(() => undefined)
      throw new Error('The image could not be inserted into the document.')
    }
    insertAssetNode(destination.relativePath, 'image', result.size)
    pendingClipboardImage = null
  }
</script>

{#if activeDocTab}
  <div class="wysiwyg-editor-container">
    {#if activeDocTab.origin === 'collection'}
      <ConflictNotification filePath={activeDocTab.filePath} />
    {/if}
    {#if largeFileWarning}
      <div class="large-file-warning">
        <span class="material-symbols-outlined warning-icon">warning</span>
        <div class="warning-content">
          <p class="warning-title">Large file detected</p>
          <p class="warning-message">
            This file is larger than 1MB. WYSIWYG mode is unavailable — switched to Source mode for
            better performance.
          </p>
        </div>
        <button
          class="warning-dismiss"
          onclick={dismissLargeFileWarning}
          aria-label="Dismiss warning"
        >
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
    {/if}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="wysiwyg-scroll" ondragover={handleEditorDragOver} ondrop={handleEditorDrop}>
      {#if activeDocTab.readOnly}
        <div class="readonly-document-header">
          <span class="material-symbols-outlined">lock</span>
          <span>{activeDocTab.title}</span>
          <span class="readonly-label">Read only</span>
        </div>
      {:else}
        <DocumentHeader
          frontmatterYaml={currentFrontmatter}
          onFrontmatterUpdate={handleFrontmatterUpdate}
          schema={currentSchema}
          filePath={activeDocTab.filePath}
          collectionPath={currentActiveCollection?.path ?? ''}
          collectionId={currentActiveCollection?.id ?? null}
          documentTabId={activeTabId}
          isUntitled={activeDocTab.isUntitled}
          onFileRenamed={handleFileRenamed}
          onBeforeSchemaMutate={flushBeforeSchemaMutation}
          onSchemaApplied={reconcileAfterSchemaMutation}
        />
      {/if}
      <div class="wysiwyg-content" bind:this={editorHost}></div>
    </div>
    {#if activeEditor && !activeDocTab.readOnly}
      <BubbleMenu editor={activeEditor} />
      <MediaBubbleMenu
        editor={activeEditor}
        onedit={openMediaEditor}
        onopenintab={openMediaInTab}
        onopenexternal={openMediaExternal}
      />
    {/if}
    {#if !activeDocTab.readOnly}
      <LinkHoverPreview
        container={editorHost}
        collectionPath={currentActiveCollection?.path ?? ''}
      />
      <InsertAssetDialog
        bind:visible={mediaDialogOpen}
        currentFilePath={activeDocTab.filePath}
        initialMedia={mediaDialogInitial}
        onselect={changeSelectedMedia}
        onclose={() => (mediaDialogInitial = null)}
      />
    {/if}
    {#if pendingClipboardImage && !pendingClipboardImage.awaitingSaveAs && pendingClipboardTab}
      <ClipboardImageSaveModal
        baseStem={pendingClipboardBaseStem}
        extension={pendingClipboardImage.image.extension}
        initialDirectory={pendingClipboardDirectory}
        onsave={saveClipboardImage}
        oncancel={() => (pendingClipboardImage = null)}
      />
    {/if}
    {#if linkModalOpen && activeEditor}
      <LinkModal
        editor={activeEditor}
        initialQuery={linkModalInitialQuery}
        onclose={closeLinkModal}
      />
    {/if}
    {#if contextMenuOpen && activeEditor}
      <EditorContextMenu
        editor={activeEditor}
        x={contextMenuX}
        y={contextMenuY}
        onclose={closeContextMenu}
        oneditmedia={openMediaEditor}
        onopenmediaintab={openMediaInTab}
        onopenmediaexternal={openMediaExternal}
      />
    {/if}
  </div>
{:else}
  <div class="empty-state">
    <span class="material-symbols-outlined empty-icon">description</span>
    <p class="empty-text">Select a file from the sidebar</p>
  </div>
{/if}

<style>
  .wysiwyg-editor-container {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--color-canvas, #0a0a0a);
  }

  .wysiwyg-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    position: relative;
    scrollbar-width: thin;
    scrollbar-color: var(--overlay-active, rgba(255, 255, 255, 0.1)) transparent;
  }

  .readonly-document-header {
    display: flex;
    width: min(860px, calc(100% - 48px));
    align-items: center;
    gap: 8px;
    margin: 18px auto 0;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--color-border, #27272a);
    color: var(--color-text-muted, #a1a1aa);
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: 11px;
  }

  .readonly-document-header .material-symbols-outlined {
    color: var(--color-primary, #00e5ff);
    font-size: 14px;
  }

  .readonly-label {
    margin-left: auto;
    color: var(--color-text-dim, #71717a);
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .wysiwyg-scroll::-webkit-scrollbar {
    width: 6px;
  }
  .wysiwyg-scroll::-webkit-scrollbar-track {
    background: transparent;
  }
  .wysiwyg-scroll::-webkit-scrollbar-thumb {
    background: var(--overlay-active, rgba(255, 255, 255, 0.1));
    border-radius: 3px;
  }
  .wysiwyg-scroll::-webkit-scrollbar-thumb:hover {
    background: var(--overlay-active, rgba(255, 255, 255, 0.2));
  }

  .wysiwyg-content {
    display: flex;
    flex-direction: column;
    width: 100%;
    flex: 1;
    min-height: 0;
  }

  .wysiwyg-content :global(.wysiwyg-instance) {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
  }

  .wysiwyg-content :global(.ProseMirror) {
    flex: 1;
    min-height: 0;
    outline: none;
  }

  .empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    background: var(--color-canvas, #0a0a0a);
  }

  .empty-icon {
    font-size: 48px;
    color: var(--color-text-dim, #71717a);
    opacity: 0.4;
  }

  .empty-text {
    font-size: 14px;
    color: var(--color-text-dim, #71717a);
    margin: 0;
  }

  .large-file-warning {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    padding: 12px 16px;
    background: rgba(234, 179, 8, 0.1);
    border-bottom: 1px solid rgba(234, 179, 8, 0.2);
    color: #fbbf24;
  }

  .warning-icon {
    font-size: 20px;
    flex-shrink: 0;
    margin-top: 2px;
  }

  .warning-content {
    flex: 1;
    min-width: 0;
  }

  .warning-title {
    font-size: 13px;
    font-weight: 600;
    margin: 0 0 4px 0;
    color: #fbbf24;
  }

  .warning-message {
    font-size: 12px;
    margin: 0;
    color: #fde047;
    line-height: 1.5;
  }

  .warning-dismiss {
    flex-shrink: 0;
    background: none;
    border: none;
    color: #fbbf24;
    cursor: pointer;
    padding: 0;
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    transition: background-color 150ms ease;
  }

  .warning-dismiss:hover {
    background: rgba(234, 179, 8, 0.1);
  }

  .warning-dismiss:focus {
    outline: 2px solid #fbbf24;
    outline-offset: 2px;
  }

  .warning-dismiss .material-symbols-outlined {
    font-size: 16px;
  }

  @media (prefers-reduced-motion: reduce) {
    .warning-dismiss {
      transition: none;
    }
  }
</style>
