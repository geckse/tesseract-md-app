<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { get } from 'svelte/store';
  import { EditorView, keymap } from '@codemirror/view';
  import { EditorState } from '@codemirror/state';
  import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
  import { history, historyKeymap, historyField } from '@codemirror/commands';
  import { defaultKeymap } from '@codemirror/commands';
  import { search, searchKeymap } from '@codemirror/search';
  import { editorTheme } from '../lib/editor-theme';
  import { softRender } from '../lib/soft-render';
  import { frontmatterDecoration } from '../lib/frontmatter-decoration';
  import { activeCollection } from '../stores/collections';
  import { workspace, type DocumentTab } from '../stores/workspace.svelte';
  import { isDirty, wordCount, tokenCount, countWords, countTokens, saveRequested, discardRequested, scrollToLine, activeHeadingIndex, editorMode, type EditorMode } from '../stores/editor';
  import { propertiesFileContent, outline } from '../stores/properties';
  import ConflictNotification from './ConflictNotification.svelte';
  import { showConflict, dismissConflict } from '../stores/conflict';
  import { requestSaveAs } from '../stores/save-as';

  // ── Props ─────────────────────────────────────────────────────────────
  interface EditorProps {
    tabId?: string
  }
  let { tabId }: EditorProps = $props();

  // ── Constants ─────────────────────────────────────────────────────────
  /** Maximum number of live EditorView instances to keep in the pool. */
  const MAX_POOL_SIZE = 10;
  /** Large file handling (>1MB). */
  const LARGE_FILE_THRESHOLD = 1024 * 1024;
  /** File change detection interval (ms). */
  const FILE_CHECK_INTERVAL = 2000;

  // ── Instance Pool ─────────────────────────────────────────────────────
  /**
   * Pool of live EditorView instances keyed by tab ID.
   * Each entry holds the EditorView, its container div, scroll position,
   * and the lastSavedContent for dirty tracking.
   */
  interface PoolEntry {
    view: EditorView
    container: HTMLDivElement
    scrollTop: number
    lastSavedContent: string
    useBasicMode: boolean
  }

  /**
   * Serialized state for evicted pool entries (beyond MAX_POOL_SIZE).
   * Stores the JSON-serialized EditorState (including undo history)
   * so the editor can be reconstructed when re-activated.
   */
  interface SerializedEntry {
    stateJSON: unknown
    scrollTop: number
    lastSavedContent: string
    useBasicMode: boolean
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

  // ── Store Subscriptions ───────────────────────────────────────────────
  let currentOutline: import('../stores/properties').OutlineHeading[] = [];
  const unsubOutline = outline.subscribe((v) => (currentOutline = v));

  let currentActiveCollection: import('../../preload/api').Collection | null = $state(null);
  const unsubCollection = activeCollection.subscribe((v) => (currentActiveCollection = v));

  let currentScrollToLine: number | null = $state(null);
  const unsubScrollToLine = scrollToLine.subscribe((v) => (currentScrollToLine = v));

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

  let currentEditorMode = $state<EditorMode>('wysiwyg');
  const unsubEditorMode = editorMode.subscribe((v) => (currentEditorMode = v));
  $effect(() => {
    if (currentEditorMode === 'editor') {
      const entry = activeTabId ? pool.get(activeTabId) : null;
      if (entry) {
        requestAnimationFrame(() => entry.view.focus());
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

  // ── Scroll to Line ────────────────────────────────────────────────────
  $effect(() => {
    if (currentScrollToLine !== null && activeTabId) {
      const entry = pool.get(activeTabId);
      if (entry) {
        const doc = entry.view.state.doc;
        const lineNumber = Math.max(1, Math.min(currentScrollToLine, doc.lines));
        const line = doc.line(lineNumber);
        entry.view.dispatch({
          effects: EditorView.scrollIntoView(line.from, { y: 'start' }),
        });
        scrollToLine.set(null);
      }
    }
  });

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
      // Serialize the state (including undo history)
      serializedPool.set(evictId, {
        stateJSON: entry.view.state.toJSON({ history: historyField }),
        scrollTop: entry.view.scrollDOM.scrollTop,
        lastSavedContent: entry.lastSavedContent,
        useBasicMode: entry.useBasicMode,
      });

      // Destroy the live view and remove its container
      entry.view.destroy();
      entry.container.remove();
      pool.delete(evictId);

      // Remove from access order
      const idx = accessOrder.indexOf(evictId);
      if (idx >= 0) accessOrder.splice(idx, 1);
    }
  }

  // ── EditorView Factory ────────────────────────────────────────────────

  /** Guard flag: true while an editor is being created, to suppress spurious dirty marking. */
  let initializing = false;

  function createExtensions(useBasicMode: boolean) {
    const baseExtensions = [
      markdown({ base: markdownLanguage }),
      history(),
      editorTheme(),
      keymap.of([{ key: 'Mod-s', run: () => handleSave() }]),
      search({ top: true }),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
      EditorView.updateListener.of(handleUpdate),
      EditorView.domEventHandlers({
        scroll() { updateActiveHeading(); },
      }),
    ];

    if (!useBasicMode) {
      baseExtensions.push(softRender(), frontmatterDecoration());
    }

    return baseExtensions;
  }

  /**
   * Get or create an EditorView for a given tab. Returns the pool entry.
   * If a serialized state exists, restores it (including undo history).
   * Otherwise creates a fresh editor with the provided content.
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
    container.className = 'editor-instance';
    container.style.display = 'none';
    container.style.flex = '1';
    container.style.minHeight = '0';
    container.style.flexDirection = 'column';
    container.style.overflow = 'hidden';

    // Determine if file is large
    const contentSize = new Blob([content]).size;
    const isLargeFile = contentSize > LARGE_FILE_THRESHOLD;
    const useBasicMode = isLargeFile;

    let view: EditorView;
    let scrollTop = 0;
    let lastSavedContent = content;

    // Suppress spurious dirty marking during editor creation
    initializing = true;
    try {

    // Check for serialized state (evicted editor with preserved undo history)
    const serialized = serializedPool.get(id);
    if (serialized) {
      serializedPool.delete(id);
      scrollTop = serialized.scrollTop;
      lastSavedContent = serialized.lastSavedContent;

      const state = EditorState.fromJSON(
        serialized.stateJSON,
        { extensions: createExtensions(serialized.useBasicMode) },
        { history: historyField }
      );
      view = new EditorView({ state, parent: container });
    } else {
      // Fresh editor
      view = new EditorView({
        state: EditorState.create({
          doc: content,
          extensions: createExtensions(useBasicMode),
        }),
        parent: container,
      });
    }

    } finally { initializing = false; }

    const entry: PoolEntry = {
      view,
      container,
      scrollTop,
      lastSavedContent,
      useBasicMode,
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
   * and hide the previously active one. Handles content loading and
   * initial creation.
   */
  $effect(() => {
    const currentTabId = activeTabId;
    const tab = activeDocTab;

    if (!editorHost || !currentTabId || !tab) {
      // No active document tab — hide all
      hideEntry(previousActiveTabId);
      stopFileWatcher();
      previousActiveTabId = null;
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

    // Get or create the editor for this tab
    const entry = getOrCreateEntry(currentTabId, tab.content);

    // Ensure the container is in the host DOM
    if (!editorHost.contains(entry.container)) {
      editorHost.appendChild(entry.container);
    }

    if (isSwitching) {
      // Show this editor
      entry.container.style.display = 'flex';

      // Restore scroll position on next frame
      requestAnimationFrame(() => {
        if (entry.view.scrollDOM) {
          entry.view.scrollDOM.scrollTop = entry.scrollTop;
        }
      });

      // Use savedContent (disk state) for dirty tracking across mode switches
      entry.lastSavedContent = tab.savedContent ?? tab.content!;
      const content = entry.view.state.doc.toString();
      isDirty.set(content !== entry.lastSavedContent);
      wordCount.set(countWords(content));
      tokenCount.set(countTokens(content));

      // Update large file warning
      const contentSize = new Blob([tab.content!]).size;
      largeFileWarning = contentSize > LARGE_FILE_THRESHOLD;

      previousActiveTabId = currentTabId;
      startFileWatcher();
    } else {
      // Same tab — check if content was externally reloaded (e.g., conflict resolution)
      const viewContent = entry.view.state.doc.toString();
      if (tab.content !== entry.lastSavedContent && tab.content !== viewContent) {
        // External content change — replace content in the editor
        replaceContent(entry, tab.content);
      }
    }
  });

  function hideEntry(id: string | null): void {
    if (!id) return;
    const entry = pool.get(id);
    if (!entry) return;

    // Save scroll position before hiding
    entry.scrollTop = entry.view.scrollDOM.scrollTop;
    entry.container.style.display = 'none';
  }

  function replaceContent(entry: PoolEntry, content: string): void {
    entry.lastSavedContent = content;
    isDirty.set(false);
    initializing = true;
    const doc = entry.view.state.doc;
    entry.view.dispatch({
      changes: { from: 0, to: doc.length, insert: content },
    });
    initializing = false;
    wordCount.set(countWords(content));
    tokenCount.set(countTokens(content));
  }

  // ── Editor Update Handler ─────────────────────────────────────────────

  function handleUpdate(update: import('@codemirror/view').ViewUpdate) {
    if (initializing) return;
    if (update.docChanged) {
      const content = update.state.doc.toString();
      // Sync content to tab immediately so mode switches pick up latest edits
      const tab = activeDocTab;
      if (tab) tab.content = content;
      // Find which pool entry this view belongs to
      const entry = activeTabId ? pool.get(activeTabId) : null;
      const savedContent = entry?.lastSavedContent ?? '';
      isDirty.set(content !== savedContent);
      wordCount.set(countWords(content));
      tokenCount.set(countTokens(content));
      // Debounce metadata store update
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        propertiesFileContent.set(content);
      }, 200);
    }
  }

  /** Update activeHeadingIndex based on the editor's scroll position. */
  function updateActiveHeading() {
    const entry = activeTabId ? pool.get(activeTabId) : null;
    if (!entry || currentOutline.length === 0) {
      activeHeadingIndex.set(-1);
      return;
    }
    const view = entry.view;
    const topPos = view.lineBlockAtHeight(view.scrollDOM.scrollTop);
    const topLine = view.state.doc.lineAt(topPos.from).number;

    let idx = -1;
    for (let i = 0; i < currentOutline.length; i++) {
      if (currentOutline[i].line <= topLine + 1) {
        idx = i;
      } else {
        break;
      }
    }
    activeHeadingIndex.set(idx);
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
      // Update tab content before requesting save-as
      const content = entry.view.state.doc.toString();
      tab.content = content;
      requestSaveAs(activeTabId);
      return true;
    }

    const content = entry.view.state.doc.toString();
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

    // Replace editor content with last saved content
    replaceContent(entry, entry.lastSavedContent);
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
        tab.content = entry.view.state.doc.toString();
      }
    }

    // Destroy all pooled EditorViews
    for (const [, entry] of pool) {
      entry.view.destroy();
      entry.container.remove();
    }
    pool.clear();
    serializedPool.clear();
    accessOrder.length = 0;

    isDirty.set(false);
    wordCount.set(0);
    tokenCount.set(0);

    unsubCollection();
    unsubSave();
    unsubDiscard();
    unsubScrollToLine();
    unsubOutline();
    unsubEditorMode();
  });

  // ── Drag-and-drop (internal tree + external OS) ──────────────────────

  const CM_IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'])
  const CM_ASSET_EXTS = new Set([...CM_IMAGE_EXTS, 'pdf', 'mp4', 'webm', 'mov', 'mp3', 'wav', 'ogg'])

  function cmRelativePath(fromFile: string, toFile: string): string {
    const fromParts = fromFile.split('/')
    fromParts.pop()
    const toParts = toFile.split('/')
    let common = 0
    while (common < fromParts.length && common < toParts.length && fromParts[common] === toParts[common]) common++
    const ups = fromParts.length - common
    const rest = toParts.slice(common)
    return ups > 0 ? `${Array(ups).fill('..').join('/')}/${rest.join('/')}` : rest.join('/')
  }

  function handleCmDragOver(e: DragEvent) {
    e.preventDefault()
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'link'
  }

  async function handleCmDrop(e: DragEvent) {
    e.preventDefault()
    if (!e.dataTransfer) return

    const view = currentEntry?.view
    if (!view) return
    const currentFile = activeDocTab?.filePath
    if (!currentFile) return
    const collection = get(activeCollection)
    if (!collection) return

    // Get drop position in editor
    const pos = view.posAtCoords({ x: e.clientX, y: e.clientY })
    if (pos == null) return

    function insertText(text: string) {
      view!.dispatch({
        changes: { from: pos!, insert: text },
        selection: { anchor: pos! + text.length },
      })
    }

    // Case 1: Internal tree drag
    const mdvdbPath = e.dataTransfer.getData('application/x-mdvdb-path')
    if (mdvdbPath) {
      const ext = mdvdbPath.split('.').pop()?.toLowerCase() ?? ''
      const relPath = cmRelativePath(currentFile, mdvdbPath)
      const name = mdvdbPath.split('/').pop() ?? mdvdbPath

      if (CM_IMAGE_EXTS.has(ext)) {
        insertText(`![${name}](${relPath})`)
      } else {
        insertText(`[${name}](${relPath})`)
      }
      return
    }

    // Case 2: External OS drag
    const files = e.dataTransfer.files
    if (files.length > 0) {
      for (const file of files) {
        const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
        if (!CM_ASSET_EXTS.has(ext)) continue

        const absolutePath = window.api.getPathForFile(file)
        if (!absolutePath) continue

        const checkResult = await window.api.isWithinCollection(absolutePath)

        if (checkResult.within && checkResult.collectionPath === collection.path) {
          const collPath = collection.path.endsWith('/') ? collection.path : collection.path + '/'
          const relToCollection = absolutePath.startsWith(collPath) ? absolutePath.slice(collPath.length) : file.name
          const relPath = cmRelativePath(currentFile, relToCollection)
          const name = file.name

          insertText(CM_IMAGE_EXTS.has(ext) ? `![${name}](${relPath})` : `[${name}](${relPath})`)
        } else {
          const confirmed = window.confirm(`"${file.name}" is outside your collection. Copy it alongside the current file?`)
          if (!confirmed) continue

          const currentDir = currentFile.split('/').slice(0, -1).join('/')
          let destName = file.name
          let destRelPath = currentDir ? `${currentDir}/${destName}` : destName
          let destAbsPath = `${collection.path}/${destRelPath}`

          try {
            await window.api.fileInfo(destAbsPath)
            const baseName = destName.replace(/\.[^.]+$/, '')
            const extension = destName.includes('.') ? '.' + destName.split('.').pop() : ''
            let suffix = 1
            while (true) {
              destName = `${baseName}-${suffix}${extension}`
              destRelPath = currentDir ? `${currentDir}/${destName}` : destName
              destAbsPath = `${collection.path}/${destRelPath}`
              try { await window.api.fileInfo(destAbsPath); suffix++ } catch { break }
            }
          } catch { /* good, doesn't exist */ }

          await window.api.copyFile(absolutePath, destAbsPath)
          const relPath = cmRelativePath(currentFile, destRelPath)
          insertText(CM_IMAGE_EXTS.has(ext) ? `![${destName}](${relPath})` : `[${destName}](${relPath})`)
        }
      }
    }
  }
</script>

{#if activeDocTab}
  <div class="editor-container">
    <ConflictNotification />
    {#if largeFileWarning}
      <div class="large-file-warning">
        <span class="material-symbols-outlined warning-icon">warning</span>
        <div class="warning-content">
          <p class="warning-title">Large file detected</p>
          <p class="warning-message">This file is larger than 1MB. Some advanced features like frontmatter highlighting and outline parsing have been disabled for better performance.</p>
        </div>
        <button class="warning-dismiss" onclick={dismissLargeFileWarning} aria-label="Dismiss warning">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
    {/if}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="editor-content" bind:this={editorHost} ondragover={handleCmDragOver} ondrop={handleCmDrop}></div>
  </div>
{:else}
  <div class="empty-state">
    <span class="material-symbols-outlined empty-icon">description</span>
    <p class="empty-text">Select a file from the sidebar</p>
  </div>
{/if}

<style>
  .editor-container {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--color-canvas, #0a0a0a);
  }

  .editor-content {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .editor-content :global(.editor-instance) {
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .editor-content :global(.cm-editor) {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }

  .editor-content :global(.cm-focused) {
    outline: none;
  }

  .editor-content :global(.cm-content) {
    padding: 24px 32px 24px 48px;
  }

  .editor-content :global(.cm-gutters) {
    display: none;
  }

  .editor-content :global(.cm-editor .cm-content .cm-line.cm-fm-line),
  .editor-content :global(.cm-editor .cm-content .cm-line.cm-fm-line) :global(span) {
    font-size: 12.5px;
    line-height: 22px;
  }

  .editor-content :global(.cm-scroller) {
    flex: 1;
    min-height: 0;
    overflow: auto !important;
    scrollbar-width: thin;
    scrollbar-color: var(--scrollbar-thumb, rgba(255, 255, 255, 0.10)) var(--scrollbar-track, transparent);
  }

  .editor-content :global(.cm-scroller)::-webkit-scrollbar { width: var(--scrollbar-width, 6px); height: var(--scrollbar-width, 6px); }
  .editor-content :global(.cm-scroller)::-webkit-scrollbar-track { background: var(--scrollbar-track, transparent); }
  .editor-content :global(.cm-scroller)::-webkit-scrollbar-thumb { background: var(--scrollbar-thumb, rgba(255, 255, 255, 0.10)); border-radius: 3px; }
  .editor-content :global(.cm-scroller)::-webkit-scrollbar-thumb:hover { background: var(--scrollbar-thumb-hover, rgba(255, 255, 255, 0.20)); }
  .editor-content :global(.cm-scroller)::-webkit-scrollbar-corner { background: var(--scrollbar-track, transparent); }

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
</style>
