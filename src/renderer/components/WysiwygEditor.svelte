<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { createWysiwygEditor, type WysiwygEditor as WysiwygEditorInstance } from '../lib/tiptap/editor-factory';
  import { splitFrontmatter, joinFrontmatter } from '../lib/tiptap/markdown-bridge';
  import '../lib/tiptap/wysiwyg-theme.css';
  import 'highlight.js/styles/github-dark.css';
  import { activeCollection } from '../stores/collections';
  import { workspace, type DocumentTab } from '../stores/workspace.svelte';
  import { isDirty, wordCount, tokenCount, countWords, countTokens, saveRequested, discardRequested, editorMode, type EditorMode } from '../stores/editor';
  import { propertiesFileContent } from '../stores/properties';
  import ConflictNotification from './ConflictNotification.svelte';
  import DocumentHeader from './wysiwyg/DocumentHeader.svelte';
  import { showConflict, dismissConflict } from '../stores/conflict';
  import { requestSaveAs } from '../stores/save-as';
  import { schema, fetchSchema } from '../stores/schema';
  import type { Schema } from '../types/cli';
  import BubbleMenu from './wysiwyg/BubbleMenu.svelte';
  import EditorContextMenu from './wysiwyg/EditorContextMenu.svelte';
  import LinkModal from './wysiwyg/LinkModal.svelte';

  // ── Props ─────────────────────────────────────────────────────────────
  interface WysiwygEditorProps {
    tabId?: string
  }
  let { tabId }: WysiwygEditorProps = $props();

  // ── Constants ─────────────────────────────────────────────────────────
  /** Maximum number of live TipTap editor instances to keep in the pool. */
  const MAX_POOL_SIZE = 10;
  /** Large file handling (>1MB). */
  const LARGE_FILE_THRESHOLD = 1024 * 1024;
  /** File change detection interval (ms). */
  const FILE_CHECK_INTERVAL = 2000;

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

  const pool = new Map<string, PoolEntry>();
  const serializedPool = new Map<string, SerializedEntry>();
  /** LRU access order — most recently accessed tab ID is last. */
  const accessOrder: string[] = [];

  // ── Component State ───────────────────────────────────────────────────
  let editorHost: HTMLDivElement | undefined = $state(undefined);
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let fileWatchInterval: ReturnType<typeof setInterval> | null = null;
  let largeFileWarning = $state(false);
  let isSaving = false;
  let saveGraceUntil = 0;

  // Frontmatter for the currently active tab (reactive for FrontmatterEditor)
  let currentFrontmatter: string | null = $state(null);

  // ── Store Subscriptions ───────────────────────────────────────────────
  let currentActiveCollection: import('../../preload/api').Collection | null = $state(null);
  const unsubCollection = activeCollection.subscribe((v) => (currentActiveCollection = v));

  // Schema for frontmatter awareness
  let currentSchema = $state<Schema | null>(null);
  const unsubSchema = schema.subscribe((v) => (currentSchema = v));

  // Fetch schema when the active document tab or collection changes
  $effect(() => {
    if (currentActiveCollection && activeDocTab) {
      const filePath = activeDocTab.filePath;
      const lastSlash = filePath.lastIndexOf('/');
      const pathPrefix = lastSlash > 0 ? filePath.substring(0, lastSlash) : undefined;
      fetchSchema(currentActiveCollection.path, pathPrefix);
    }
  });

  let saveCounter = $state(0);
  let lastSaveCounter = 0;
  const unsubSave = saveRequested.subscribe((v) => (saveCounter = v));
  $effect(() => {
    if (saveCounter > 0 && saveCounter !== lastSaveCounter) {
      lastSaveCounter = saveCounter;
      handleSave();
    }
  });

  let discardCounter = $state(0);
  let lastDiscardCounter = 0;
  const unsubDiscard = discardRequested.subscribe((v) => (discardCounter = v));
  $effect(() => {
    if (discardCounter > 0 && discardCounter !== lastDiscardCounter) {
      lastDiscardCounter = discardCounter;
      handleDiscard();
    }
  });

  // Focus editor when switching to wysiwyg mode
  let currentEditorMode = $state<EditorMode>('wysiwyg');
  const unsubEditorMode = editorMode.subscribe((v) => (currentEditorMode = v));
  $effect(() => {
    if (currentEditorMode === 'wysiwyg' && activeTabId) {
      const entry = pool.get(activeTabId);
      if (entry) {
        requestAnimationFrame(() => entry.editor.editor.commands.focus());
      }
    }
  });

  // ── Derived Tab State ─────────────────────────────────────────────────
  /**
   * Resolve the active tab ID: use the explicit tabId prop if provided,
   * otherwise fall back to the workspace's focused document tab.
   */
  const activeTabId = $derived(tabId ?? workspace.focusedDocumentTab?.id ?? null);
  const activeDocTab = $derived.by(() => {
    if (!activeTabId) return null;
    const tab = workspace.tabs[activeTabId];
    return tab?.kind === 'document' ? tab as DocumentTab : null;
  });

  /** The TipTap Editor instance for the active tab (for BubbleMenu/ContextMenu). */
  let activeEditor = $state<import('@tiptap/core').Editor | null>(null);

  // ── Link Modal ─────────────────────────────────────────────────────────
  let linkModalOpen = $state(false);
  let linkModalInitialQuery = $state('');

  function handleOpenLinkModal(e: Event) {
    const detail = (e as CustomEvent).detail;
    linkModalInitialQuery = detail?.initialQuery ?? '';
    linkModalOpen = true;
  }

  function closeLinkModal() {
    linkModalOpen = false;
    linkModalInitialQuery = '';
  }

  // ── Context Menu (driven by custom DOM event from table-ui-extension) ──
  let contextMenuOpen = $state(false);
  let contextMenuX = $state(0);
  let contextMenuY = $state(0);

  function handleEditorContextMenu(e: Event) {
    const detail = (e as CustomEvent).detail;
    contextMenuX = detail.x;
    contextMenuY = detail.y;
    contextMenuOpen = true;
    // Close any open link bubble
    document.querySelector('.link-bubble-popup')?.remove();
  }

  function closeContextMenu() {
    contextMenuOpen = false;
  }

  // ── Pool Management ───────────────────────────────────────────────────

  /** Touch a tab ID in the LRU access order (move to end). */
  function touchAccess(id: string): void {
    const idx = accessOrder.indexOf(id);
    if (idx >= 0) accessOrder.splice(idx, 1);
    accessOrder.push(id);
  }

  /** Evict the least recently used pool entries beyond MAX_POOL_SIZE. */
  function evictIfNeeded(): void {
    while (pool.size > MAX_POOL_SIZE) {
      // Find the oldest entry in accessOrder that is NOT the active tab
      let evictId: string | null = null;
      for (const id of accessOrder) {
        if (id !== activeTabId && pool.has(id)) {
          evictId = id;
          break;
        }
      }
      if (!evictId) break;

      const entry = pool.get(evictId)!;
      // Serialize the editor state (undo history is lost, but content is preserved)
      serializedPool.set(evictId, {
        editorJSON: entry.editor.editor.getJSON(),
        scrollTop: entry.container.querySelector('.ProseMirror')?.scrollTop ?? 0,
        lastSavedContent: entry.lastSavedContent,
        frontmatter: entry.frontmatter,
      });

      // Destroy the live editor and remove its container
      entry.editor.destroy();
      entry.container.remove();
      pool.delete(evictId);

      // Remove from access order
      const idx = accessOrder.indexOf(evictId);
      if (idx >= 0) accessOrder.splice(idx, 1);
    }
  }

  // ── Editor Factory ────────────────────────────────────────────────────

  /** Guard flag: true while an editor is being created, to suppress spurious dirty marking. */
  let initializing = false;

  /**
   * Get the full markdown content for a pool entry by joining its
   * frontmatter with the editor body.
   */
  function getFullContentForEntry(entry: PoolEntry): string {
    const body = entry.editor.getMarkdown();
    return joinFrontmatter(entry.frontmatter, body);
  }

  /**
   * Handle TipTap content updates for the active tab — debounced sync to stores.
   */
  function handleEditorUpdate() {
    if (initializing) return;
    if (!activeTabId) return;
    const entry = pool.get(activeTabId);
    if (!entry) return;

    const fullContent = getFullContentForEntry(entry);
    // Sync content to tab immediately so mode switches pick up latest edits
    const tab = activeDocTab;
    if (tab) tab.content = fullContent;
    isDirty.set(fullContent !== entry.lastSavedContent);
    wordCount.set(countWords(fullContent));
    tokenCount.set(countTokens(fullContent));

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      propertiesFileContent.set(fullContent);
    }, 200);
  }

  /**
   * Get or create a TipTap editor for a given tab. Returns the pool entry.
   * If a serialized state exists, restores it. Otherwise creates a fresh editor
   * from the provided content (splitting frontmatter).
   */
  function getOrCreateEntry(id: string, content: string): PoolEntry {
    // Check if already in the live pool
    const existing = pool.get(id);
    if (existing) {
      touchAccess(id);
      return existing;
    }

    // Create a container div for this editor instance
    const container = document.createElement('div');
    container.className = 'wysiwyg-instance';
    container.style.display = 'none';
    container.style.flex = '1';
    container.style.minHeight = '0';
    container.style.flexDirection = 'column';
    container.style.overflow = 'auto';
    container.style.position = 'relative';
    // Attach context menu and link modal handlers to the container
    container.addEventListener('editor-contextmenu', handleEditorContextMenu);
    container.addEventListener('open-link-modal', handleOpenLinkModal);

    let editor: WysiwygEditorInstance;
    let scrollTop = 0;
    let lastSavedContent = content;
    let frontmatter: string | null = null;

    // Suppress spurious dirty marking during editor creation
    initializing = true;
    try {

    // Check for serialized state (evicted editor)
    const serialized = serializedPool.get(id);
    if (serialized) {
      serializedPool.delete(id);
      scrollTop = serialized.scrollTop;
      lastSavedContent = serialized.lastSavedContent;
      frontmatter = serialized.frontmatter;

      // Reconstruct editor from serialized JSON
      // Note: we create with empty content then set JSON to restore structure
      editor = createWysiwygEditor(container, '', {
        onUpdate: () => handleEditorUpdate(),
        collectionPath: currentActiveCollection?.path ?? '',
        collectionId: currentActiveCollection?.id ?? '',
        currentFilePath: activeDocTab?.filePath ?? '',
      });
      editor.editor.commands.setContent(serialized.editorJSON);
    } else {
      // Fresh editor — split frontmatter from content
      const split = splitFrontmatter(content);
      frontmatter = split.frontmatter;

      editor = createWysiwygEditor(container, split.body, {
        onUpdate: () => handleEditorUpdate(),
        collectionPath: currentActiveCollection?.path ?? '',
        collectionId: currentActiveCollection?.id ?? '',
        currentFilePath: activeDocTab?.filePath ?? '',
      });
    }

    } finally { initializing = false; }

    const entry: PoolEntry = {
      editor,
      container,
      scrollTop,
      lastSavedContent,
      frontmatter,
    };

    pool.set(id, entry);
    touchAccess(id);
    evictIfNeeded();

    return entry;
  }

  // ── Show / Hide ───────────────────────────────────────────────────────

  let previousActiveTabId: string | null = null;

  /**
   * Main reactive effect: whenever the active tab changes, show its editor
   * and hide the previously active one. Uses show/hide (not setContent) to
   * preserve undo history per tab (tiptap#5708).
   */
  $effect(() => {
    const currentTabId = activeTabId;
    const tab = activeDocTab;

    if (!editorHost || !currentTabId || !tab) {
      // No active document tab — hide all
      hideEntry(previousActiveTabId);
      stopFileWatcher();
      previousActiveTabId = null;
      currentFrontmatter = null;
      activeEditor = null;
      return;
    }

    // Content still loading — wait
    if (tab.contentLoading || tab.content === null) {
      return;
    }

    const isSwitching = previousActiveTabId !== currentTabId;

    if (isSwitching) {
      // Save scroll position of previous tab and hide it
      hideEntry(previousActiveTabId);
      stopFileWatcher();
      dismissConflict();
    }

    // Large file check: >1MB forces Source/Preview mode
    const contentSize = new Blob([tab.content].filter(Boolean)).size;
    if (contentSize > LARGE_FILE_THRESHOLD) {
      largeFileWarning = true;
      editorMode.set('editor');
      previousActiveTabId = currentTabId;
      return;
    }

    largeFileWarning = false;

    // Get or create the editor for this tab
    const entry = getOrCreateEntry(currentTabId, tab.content);

    // Ensure the container is in the host DOM
    if (!editorHost.contains(entry.container)) {
      editorHost.appendChild(entry.container);
    }

    // Update reactive editor reference for BubbleMenu/ContextMenu
    activeEditor = entry.editor.editor;

    if (isSwitching) {
      // Show this editor
      entry.container.style.display = 'flex';

      // Restore scroll position on next frame
      requestAnimationFrame(() => {
        const pm = entry.container.querySelector('.ProseMirror');
        if (pm) pm.scrollTop = entry.scrollTop;
      });

      // Sync frontmatter state for FrontmatterEditor
      currentFrontmatter = entry.frontmatter;

      // Use savedContent (disk state) for dirty tracking across mode switches
      entry.lastSavedContent = tab.savedContent ?? tab.content!;
      const fullContent = getFullContentForEntry(entry);
      isDirty.set(fullContent !== entry.lastSavedContent);
      wordCount.set(countWords(fullContent));
      tokenCount.set(countTokens(fullContent));

      previousActiveTabId = currentTabId;
      startFileWatcher();
    } else {
      // Same tab — check if content was externally reloaded (e.g., conflict resolution)
      const currentBody = entry.editor.getMarkdown();
      const currentFullContent = joinFrontmatter(entry.frontmatter, currentBody);
      if (tab.content !== entry.lastSavedContent && tab.content !== currentFullContent) {
        // External content change — reload in this editor
        reloadContent(entry, tab.content);
      }
    }
  });

  function hideEntry(id: string | null): void {
    if (!id) return;
    const entry = pool.get(id);
    if (!entry) return;

    // Save scroll position before hiding
    const pm = entry.container.querySelector('.ProseMirror');
    if (pm) entry.scrollTop = pm.scrollTop;
    entry.container.style.display = 'none';
  }

  /**
   * Reload content into an editor entry on external change.
   * This uses setContent which breaks undo — acceptable for conflict resolution.
   */
  function reloadContent(entry: PoolEntry, content: string): void {
    const { frontmatter, body } = splitFrontmatter(content);
    entry.frontmatter = frontmatter;
    entry.lastSavedContent = content;
    currentFrontmatter = frontmatter;
    isDirty.set(false);
    initializing = true;
    entry.editor.setMarkdownContent(body);
    initializing = false;
    wordCount.set(countWords(content));
    tokenCount.set(countTokens(content));
  }

  // ── Frontmatter Handling ─────────────────────────────────────────────

  /**
   * Handle frontmatter updates from the visual property editor.
   * Updates the per-tab frontmatter in the pool entry.
   */
  function handleFrontmatterUpdate(newYaml: string | null) {
    currentFrontmatter = newYaml;

    // Persist frontmatter to the pool entry
    if (activeTabId) {
      const entry = pool.get(activeTabId);
      if (entry) {
        entry.frontmatter = newYaml;
        handleEditorUpdate();
      }
    }
  }

  // ── File Rename ────────────────────────────────────────────────────────

  function handleFileRenamed(newPath: string) {
    if (!activeDocTab) return;
    // Update the tab's filePath and title
    activeDocTab.filePath = newPath;
    activeDocTab.title = newPath.split('/').pop() ?? newPath;
    // Only refresh file tree for on-disk files (not untitled)
    if (!activeDocTab.isUntitled) {
      import('../stores/files').then(({ loadFileTree }) => {
        loadFileTree();
      });
    }
  }

  // ── Save ──────────────────────────────────────────────────────────────

  function handleSave(): boolean {
    if (!activeTabId || !currentActiveCollection) return true;
    const entry = pool.get(activeTabId);
    if (!entry) return true;

    const tab = activeDocTab;
    if (!tab) return true;

    // Untitled files need a "Save As" dialog to pick a filename
    if (tab.isUntitled) {
      const content = getFullContentForEntry(entry);
      tab.content = content;
      requestSaveAs(activeTabId);
      return true;
    }

    const content = getFullContentForEntry(entry);
    const fullPath = `${currentActiveCollection.path}/${tab.filePath}`;

    entry.lastSavedContent = content;
    tab.content = content;
    tab.savedContent = content;
    isDirty.set(false);
    isSaving = true;

    window.api.writeFile(fullPath, content).then(() => {
      dismissConflict();
    }).catch((err) => {
      console.error('Save failed:', err);
    }).finally(() => {
      isSaving = false;
      saveGraceUntil = Date.now() + 2000;
    });
    return true;
  }

  // ── Discard ───────────────────────────────────────────────────────────

  function handleDiscard(): void {
    if (!activeTabId) return;
    const entry = pool.get(activeTabId);
    if (!entry) return;

    // Reload last saved content into the editor
    reloadContent(entry, entry.lastSavedContent);
  }

  // ── File Change Detection ─────────────────────────────────────────────

  async function checkForExternalChanges() {
    if (!activeTabId || !currentActiveCollection) return;
    const entry = pool.get(activeTabId);
    if (!entry) return;
    if (isSaving || Date.now() < saveGraceUntil) return;

    const tab = activeDocTab;
    if (!tab || tab.isUntitled) return;

    const fullPath = `${currentActiveCollection.path}/${tab.filePath}`;

    try {
      const diskContent = await window.api.readFile(fullPath);
      if (diskContent !== entry.lastSavedContent) {
        showConflict(tab.filePath);
        stopFileWatcher();
      }
    } catch {
      stopFileWatcher();
    }
  }

  function startFileWatcher() {
    stopFileWatcher();
    fileWatchInterval = setInterval(checkForExternalChanges, FILE_CHECK_INTERVAL);
  }

  function stopFileWatcher() {
    if (fileWatchInterval) {
      clearInterval(fileWatchInterval);
      fileWatchInterval = null;
    }
  }

  // ── Large File Warning ────────────────────────────────────────────────

  function dismissLargeFileWarning() {
    largeFileWarning = false;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────

  onMount(() => {
    // The main $effect handles initial creation
  });

  onDestroy(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    stopFileWatcher();
    dismissConflict();

    // Sync all pool entries' content to workspace tabs before destroying
    for (const [id, entry] of pool) {
      const tab = workspace.tabs[id];
      if (tab && tab.kind === 'document') {
        tab.content = getFullContentForEntry(entry);
      }
    }

    // Destroy all pooled TipTap editors
    for (const [, entry] of pool) {
      entry.editor.destroy();
      entry.container.remove();
    }
    pool.clear();
    serializedPool.clear();
    accessOrder.length = 0;

    isDirty.set(false);
    wordCount.set(0);
    tokenCount.set(0);

    unsubCollection();
    unsubSchema();
    unsubSave();
    unsubDiscard();
    unsubEditorMode();
  });

  // ── Drag-and-drop (internal tree + external OS) ──────────────────────

  const ASSET_IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'])
  const ASSET_EXTS = new Set([...ASSET_IMAGE_EXTS, 'pdf', 'mp4', 'webm', 'mov', 'mp3', 'wav', 'ogg'])

  function getRelativePath(fromFile: string, toFile: string): string {
    const fromParts = fromFile.split('/')
    fromParts.pop() // Remove filename to get directory
    const toParts = toFile.split('/')

    // Find common prefix length
    let common = 0
    while (common < fromParts.length && common < toParts.length && fromParts[common] === toParts[common]) {
      common++
    }

    const ups = fromParts.length - common
    const rest = toParts.slice(common)
    const prefix = ups > 0 ? Array(ups).fill('..').join('/') : '.'
    return ups > 0 ? `${prefix}/${rest.join('/')}` : rest.join('/')
  }

  function handleEditorDragOver(e: DragEvent) {
    e.preventDefault()
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'link'
    }
  }

  async function handleEditorDrop(e: DragEvent) {
    e.preventDefault()
    if (!e.dataTransfer) return

    const currentEditor = currentEntry?.editor
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
          const collPath = collection.path.endsWith('/') ? collection.path : collection.path + '/'
          const relToCollection = absolutePath.startsWith(collPath)
            ? absolutePath.slice(collPath.length)
            : file.name
          const relPath = getRelativePath(currentFile, relToCollection)
          const name = file.name

          if (ASSET_IMAGE_EXTS.has(ext)) {
            currentEditor.chain().focus().setImage({ src: relPath, alt: name }).run()
          } else {
            currentEditor.chain().focus().insertContent(`[${name}](${relPath})`).run()
          }
        } else {
          // File is outside the collection — prompt and copy
          const confirmed = window.confirm(
            `"${file.name}" is outside your collection. Copy it alongside the current file?`
          )
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

  async function handleEditorPaste(e: ClipboardEvent) {
    if (!e.clipboardData) return

    const items = Array.from(e.clipboardData.items)
    const imageItem = items.find((item) => item.type.startsWith('image/'))
    if (!imageItem) return // Let TipTap handle normal paste

    e.preventDefault()

    const currentEditor = currentEntry?.editor
    if (!currentEditor) return
    const currentFile = activeDocTab?.filePath
    if (!currentFile) return
    const collection = get(activeCollection)
    if (!collection) return

    const blob = imageItem.getAsFile()
    if (!blob) return

    // Read as base64
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result as string
        // Strip data URL prefix to get raw base64
        const base64Data = result.split(',')[1]
        resolve(base64Data)
      }
      reader.onerror = reject
      reader.readAsDataURL(blob)
    })

    // Save alongside current file
    const timestamp = Date.now()
    const currentDir = currentFile.split('/').slice(0, -1).join('/')
    const filename = `pasted-${timestamp}.png`
    const relPath = currentDir ? `${currentDir}/${filename}` : filename
    const absPath = `${collection.path}/${relPath}`

    await window.api.writeBinary(absPath, base64)

    // Insert image reference
    currentEditor.chain().focus().setImage({ src: filename, alt: filename }).run()
  }
</script>

{#if activeDocTab}
  <div class="wysiwyg-editor-container">
    <ConflictNotification />
    {#if largeFileWarning}
      <div class="large-file-warning">
        <span class="material-symbols-outlined warning-icon">warning</span>
        <div class="warning-content">
          <p class="warning-title">Large file detected</p>
          <p class="warning-message">This file is larger than 1MB. WYSIWYG mode is unavailable — switched to Source mode for better performance.</p>
        </div>
        <button class="warning-dismiss" onclick={dismissLargeFileWarning} aria-label="Dismiss warning">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
    {/if}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="wysiwyg-scroll"
      ondragover={handleEditorDragOver}
      ondrop={handleEditorDrop}
      onpaste={handleEditorPaste}
    >
      <DocumentHeader
        frontmatterYaml={currentFrontmatter}
        onFrontmatterUpdate={handleFrontmatterUpdate}
        schema={currentSchema}
        filePath={activeDocTab.filePath}
        collectionPath={currentActiveCollection?.path ?? ''}
        isUntitled={activeDocTab.isUntitled}
        onFileRenamed={handleFileRenamed}
      />
      <div class="wysiwyg-content" bind:this={editorHost}></div>
    </div>
    {#if activeEditor}
      <BubbleMenu editor={activeEditor} />
    {/if}
    {#if linkModalOpen && activeEditor}
      <LinkModal editor={activeEditor} initialQuery={linkModalInitialQuery} onclose={closeLinkModal} />
    {/if}
    {#if contextMenuOpen && activeEditor}
      <EditorContextMenu
        editor={activeEditor}
        x={contextMenuX}
        y={contextMenuY}
        onclose={closeContextMenu}
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
    scrollbar-color: var(--overlay-active, rgba(255, 255, 255, 0.10)) transparent;
  }

  .wysiwyg-scroll::-webkit-scrollbar {
    width: 6px;
  }
  .wysiwyg-scroll::-webkit-scrollbar-track {
    background: transparent;
  }
  .wysiwyg-scroll::-webkit-scrollbar-thumb {
    background: var(--overlay-active, rgba(255, 255, 255, 0.10));
    border-radius: 3px;
  }
  .wysiwyg-scroll::-webkit-scrollbar-thumb:hover {
    background: var(--overlay-active, rgba(255, 255, 255, 0.20));
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
