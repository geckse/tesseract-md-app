<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { EditorView, keymap } from '@codemirror/view';
  import { EditorState } from '@codemirror/state';
  import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
  import { history, historyKeymap } from '@codemirror/commands';
  import { defaultKeymap } from '@codemirror/commands';
  import { search, searchKeymap } from '@codemirror/search';
  import { editorTheme } from '../lib/editor-theme';
  import { softRender } from '../lib/soft-render';
  import { frontmatterDecoration } from '../lib/frontmatter-decoration';
  import { fileContent, fileContentLoading, selectedFilePath } from '../stores/files';
  import { activeCollection } from '../stores/collections';
  import { isDirty, wordCount, tokenCount, countWords, countTokens, saveRequested, scrollToLine, activeHeadingIndex } from '../stores/editor';
  import { propertiesFileContent, outline } from '../stores/properties';
  import { DocumentCache } from '../lib/doc-cache';
  import ConflictNotification from './ConflictNotification.svelte';
  import { showConflict, dismissConflict } from '../stores/conflict';

  let editorEl: HTMLDivElement | undefined = $state(undefined);
  let view: EditorView | null = null;
  let lastSavedContent: string = '';
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let previousFilePath: string | null = null;

  // File change detection
  let fileWatchInterval: ReturnType<typeof setInterval> | null = null;
  const FILE_CHECK_INTERVAL = 2000; // Check every 2 seconds

  // LRU cache for recently opened documents (last 5 files)
  const docCache = new DocumentCache(5);

  // Large file handling (>1MB)
  const LARGE_FILE_THRESHOLD = 1024 * 1024; // 1MB in bytes
  let largeFileWarning = $state(false);
  let useBasicMode = $state(false);

  let currentOutline: import('../stores/properties').OutlineHeading[] = [];
  const unsubOutline = outline.subscribe((v) => (currentOutline = v));

  let currentFileContent: string | null = $state(null);
  let currentSelectedFilePath: string | null = $state(null);
  let currentActiveCollection: import('../../preload/api').Collection | null = $state(null);
  let currentFileContentLoading: boolean = $state(false);
  // Track the last fileContent value we applied to the editor, so the $effect
  // "same file" branch only fires replaceContent when the store actually changed.
  let lastAppliedFileContent: string | null = null;

  const unsubFileContent = fileContent.subscribe((v) => (currentFileContent = v));
  const unsubSelectedFile = selectedFilePath.subscribe((v) => (currentSelectedFilePath = v));
  const unsubCollection = activeCollection.subscribe((v) => (currentActiveCollection = v));
  const unsubLoading = fileContentLoading.subscribe((v) => (currentFileContentLoading = v));

  let currentScrollToLine: number | null = $state(null);
  const unsubScrollToLine = scrollToLine.subscribe((v) => (currentScrollToLine = v));

  let saveCounter = $state(0);
  const unsubSave = saveRequested.subscribe((v) => (saveCounter = v));
  $effect(() => {
    if (saveCounter > 0) handleSave();
  });

  // Scroll editor to a specific line when requested
  $effect(() => {
    if (currentScrollToLine !== null && view) {
      const doc = view.state.doc;
      const lineNumber = Math.max(1, Math.min(currentScrollToLine, doc.lines));
      const line = doc.line(lineNumber);
      view.dispatch({
        effects: EditorView.scrollIntoView(line.from, { y: 'start' }),
      });
      scrollToLine.set(null);
    }
  });

  function handleUpdate(update: import('@codemirror/view').ViewUpdate) {
    if (update.docChanged) {
      const content = update.state.doc.toString();
      isDirty.set(content !== lastSavedContent);
      wordCount.set(countWords(content));
      tokenCount.set(countTokens(content));
      // Debounce metadata store update (200ms) to avoid parsing YAML on every keystroke
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        propertiesFileContent.set(content);
      }, 200);
    }
  }

  /** Update activeHeadingIndex based on the editor's scroll position. */
  function updateActiveHeading() {
    if (!view || currentOutline.length === 0) {
      activeHeadingIndex.set(-1);
      return;
    }
    // Find the topmost visible line
    const rect = view.dom.getBoundingClientRect();
    const topPos = view.lineBlockAtHeight(view.scrollDOM.scrollTop);
    const topLine = view.state.doc.lineAt(topPos.from).number;

    // Find the last heading at or before the topmost visible line
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

  function dismissLargeFileWarning() {
    largeFileWarning = false;
  }

  let isSaving = false;

  function handleSave(): boolean {
    if (!view || !currentActiveCollection || !currentSelectedFilePath) return true;
    const content = view.state.doc.toString();
    const fullPath = `${currentActiveCollection.path}/${currentSelectedFilePath}`;
    // Update lastSavedContent SYNCHRONOUSLY before the async write so the
    // conflict checker never sees a mismatch during the write window.
    lastSavedContent = content;
    isDirty.set(false);
    isSaving = true;
    window.api.writeFile(fullPath, content).then(() => {
      // Dismiss any conflict notification after successful save
      dismissConflict();
    }).catch((err) => {
      console.error('Save failed:', err);
    }).finally(() => {
      isSaving = false;
    });
    return true;
  }

  /**
   * Check if the currently open file has been modified externally.
   * If changes are detected, trigger the conflict notification.
   */
  async function checkForExternalChanges() {
    if (!currentSelectedFilePath || !currentActiveCollection || !view) return;
    // Skip check while a save is in progress to avoid false conflict detection
    if (isSaving) return;

    const fullPath = `${currentActiveCollection.path}/${currentSelectedFilePath}`;

    try {
      // Read the current file content from disk
      const diskContent = await window.api.readFile(fullPath);

      // Compare against what we last read/saved — NOT the editor content.
      // User edits naturally differ from disk; that's not an external change.
      if (diskContent !== lastSavedContent) {
        // Trigger conflict notification
        showConflict(currentSelectedFilePath);
        // Stop checking once conflict is detected to avoid repeated notifications
        stopFileWatcher();
      }
    } catch (err) {
      // File might have been deleted or is inaccessible - stop watching
      stopFileWatcher();
    }
  }

  /**
   * Start watching the current file for external changes.
   */
  function startFileWatcher() {
    stopFileWatcher();
    fileWatchInterval = setInterval(checkForExternalChanges, FILE_CHECK_INTERVAL);
  }

  /**
   * Stop watching for file changes.
   */
  function stopFileWatcher() {
    if (fileWatchInterval) {
      clearInterval(fileWatchInterval);
      fileWatchInterval = null;
    }
  }

  /**
   * Save the current editor state to the document cache.
   * Caches content, cursor position, and scroll position for instant restoration.
   */
  function saveToCacheIfNeeded() {
    if (!view || !previousFilePath) return;

    const content = view.state.doc.toString();
    // Never cache empty content — prevents poisoning the cache with wiped data
    if (content.trim().length === 0) return;
    const cursorPos = view.state.selection.main.head;
    const line = view.state.doc.lineAt(cursorPos);
    const scrollTop = view.scrollDOM.scrollTop;

    docCache.set(previousFilePath, {
      content,
      cursor: {
        line: line.number,
        column: cursorPos - line.from,
      },
      scrollTop,
      cachedAt: Date.now(),
    });
  }

  /**
   * Restore editor state from the document cache if available.
   * Returns true if restored from cache, false if not cached.
   */
  function restoreFromCache(filePath: string): boolean {
    const cached = docCache.get(filePath);
    if (!cached) return false;

    // Check if file is large (>1MB)
    const contentSize = new Blob([cached.content]).size;
    const isLargeFile = contentSize > LARGE_FILE_THRESHOLD;

    if (isLargeFile && !largeFileWarning) {
      largeFileWarning = true;
      useBasicMode = true;
    } else if (!isLargeFile) {
      largeFileWarning = false;
      useBasicMode = false;
    }

    if (view) {
      // Replace content
      lastSavedContent = cached.content;
      isDirty.set(false);
      const doc = view.state.doc;
      view.dispatch({
        changes: { from: 0, to: doc.length, insert: cached.content },
      });
      wordCount.set(countWords(cached.content));
      tokenCount.set(countTokens(cached.content));

      // Restore cursor position
      const newDoc = view.state.doc;
      if (cached.cursor.line <= newDoc.lines) {
        const line = newDoc.line(cached.cursor.line);
        const targetPos = Math.min(line.from + cached.cursor.column, line.to);
        view.dispatch({
          selection: { anchor: targetPos, head: targetPos },
        });
      }

      // Restore scroll position (on next frame to ensure DOM is updated)
      requestAnimationFrame(() => {
        if (view) {
          view.scrollDOM.scrollTop = cached.scrollTop;
        }
      });
    } else if (editorEl) {
      // Create new view with cached content
      lastSavedContent = cached.content;
      isDirty.set(false);
      wordCount.set(countWords(cached.content));
      tokenCount.set(countTokens(cached.content));

      view = new EditorView({
        state: EditorState.create({
          doc: cached.content,
          extensions: createExtensions(),
        }),
        parent: editorEl,
      });

      // Restore cursor position
      const doc = view.state.doc;
      if (cached.cursor.line <= doc.lines) {
        const line = doc.line(cached.cursor.line);
        const targetPos = Math.min(line.from + cached.cursor.column, line.to);
        view.dispatch({
          selection: { anchor: targetPos, head: targetPos },
        });
      }

      // Restore scroll position (on next frame to ensure DOM is updated)
      requestAnimationFrame(() => {
        if (view) {
          view.scrollDOM.scrollTop = cached.scrollTop;
        }
      });
    }

    return true;
  }

  function createExtensions() {
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

    // Add heavy decorations only for normal-sized files
    if (!useBasicMode) {
      baseExtensions.push(
        softRender(),
        frontmatterDecoration()
      );
    }

    return baseExtensions;
  }

  function createView(content: string) {
    if (!editorEl) return;
    destroyView();

    // Check if file is large (>1MB)
    const contentSize = new Blob([content]).size;
    const isLargeFile = contentSize > LARGE_FILE_THRESHOLD;

    if (isLargeFile && !largeFileWarning) {
      largeFileWarning = true;
      useBasicMode = true;
    } else if (!isLargeFile) {
      largeFileWarning = false;
      useBasicMode = false;
    }

    lastSavedContent = content;
    isDirty.set(false);
    wordCount.set(countWords(content));
    tokenCount.set(countTokens(content));

    view = new EditorView({
      state: EditorState.create({
        doc: content,
        extensions: createExtensions(),
      }),
      parent: editorEl,
    });
  }

  function destroyView() {
    if (view) {
      view.destroy();
      view = null;
    }
  }

  function replaceContent(content: string) {
    if (!view) return;

    // Check if file is large (>1MB)
    const contentSize = new Blob([content]).size;
    const isLargeFile = contentSize > LARGE_FILE_THRESHOLD;

    if (isLargeFile && !largeFileWarning) {
      largeFileWarning = true;
      useBasicMode = true;
      // Recreate view with basic mode extensions
      destroyView();
      createView(content);
      return;
    } else if (!isLargeFile && useBasicMode) {
      largeFileWarning = false;
      useBasicMode = false;
      // Recreate view with full extensions
      destroyView();
      createView(content);
      return;
    }

    lastSavedContent = content;
    isDirty.set(false);
    const doc = view.state.doc;
    view.dispatch({
      changes: { from: 0, to: doc.length, insert: content },
    });
    wordCount.set(countWords(content));
    tokenCount.set(countTokens(content));
  }

  // React to file content changes with cache support
  $effect(() => {
    if (currentSelectedFilePath === null) {
      // No file selected — tear down editor
      saveToCacheIfNeeded();
      stopFileWatcher();
      dismissConflict();
      destroyView();
      isDirty.set(false);
      wordCount.set(0);
      tokenCount.set(0);
      previousFilePath = null;
      lastAppliedFileContent = null;
      return;
    }

    // Content still loading for a new file — wait for it to arrive.
    // Don't act on stale content from the previous file.
    if (currentFileContentLoading && previousFilePath !== currentSelectedFilePath) {
      return;
    }

    if (currentFileContent === null) return;

    const isSwitchingFiles = previousFilePath !== currentSelectedFilePath;

    if (isSwitchingFiles) {
      // Save current file to cache before switching
      saveToCacheIfNeeded();
      // Stop watching the previous file
      stopFileWatcher();
      // Dismiss any existing conflict notification
      dismissConflict();

      // Try to restore from cache
      const restored = restoreFromCache(currentSelectedFilePath);

      if (!restored) {
        // Not in cache, load normally from disk
        if (view) {
          replaceContent(currentFileContent);
        } else if (editorEl) {
          createView(currentFileContent);
        }
      }

      lastAppliedFileContent = currentFileContent;
      // Update previous file path
      previousFilePath = currentSelectedFilePath;
      // Start watching the new file for external changes
      startFileWatcher();
    } else {
      // Same file — only update if the store content actually changed
      // (e.g., external reload). This prevents overwriting user edits
      // when the $effect re-runs for unrelated dependency changes.
      if (currentFileContent !== lastAppliedFileContent) {
        lastAppliedFileContent = currentFileContent;
        if (view) {
          replaceContent(currentFileContent);
        } else if (editorEl) {
          createView(currentFileContent);
        }
      }
    }
  });

  onMount(() => {
    if (currentFileContent !== null && currentSelectedFilePath !== null && editorEl) {
      createView(currentFileContent);
    }
  });

  onDestroy(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    stopFileWatcher();
    dismissConflict();
    saveToCacheIfNeeded();
    destroyView();
    isDirty.set(false);
    wordCount.set(0);
    tokenCount.set(0);
    unsubFileContent();
    unsubSelectedFile();
    unsubCollection();
    unsubLoading();
    unsubSave();
    unsubScrollToLine();
    unsubOutline();
  });
</script>

{#if currentSelectedFilePath}
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
    <div class="editor-content" bind:this={editorEl}></div>
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
    background: #0f0f10;
  }

  .editor-content {
    flex: 1;
    min-height: 0;
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
    background: #0f0f10;
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
