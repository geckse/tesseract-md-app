<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { createWysiwygEditor, type WysiwygEditor as WysiwygEditorInstance } from '../lib/tiptap/editor-factory';
  import { splitFrontmatter, joinFrontmatter } from '../lib/tiptap/markdown-bridge';
  import '../lib/tiptap/wysiwyg-theme.css';
  import 'highlight.js/styles/github-dark.css';
  import { fileContent, fileContentLoading, selectedFilePath } from '../stores/files';
  import { activeCollection } from '../stores/collections';
  import { isDirty, wordCount, tokenCount, countWords, countTokens, saveRequested, editorMode, type EditorMode } from '../stores/editor';
  import { propertiesFileContent } from '../stores/properties';
  import { DocumentCache } from '../lib/doc-cache';
  import ConflictNotification from './ConflictNotification.svelte';
  import FrontmatterEditor from './wysiwyg/FrontmatterEditor.svelte';
  import { showConflict, dismissConflict } from '../stores/conflict';
  import { handleLinkClick } from '../lib/link-navigation';

  let editorEl: HTMLDivElement | undefined = $state(undefined);
  let wysiwygEditor: WysiwygEditorInstance | null = null;
  let lastSavedContent: string = '';
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let previousFilePath: string | null = null;

  // Frontmatter preserved across edits (WYSIWYG only edits the body)
  let currentFrontmatter: string | null = $state(null);

  // File change detection
  let fileWatchInterval: ReturnType<typeof setInterval> | null = null;
  const FILE_CHECK_INTERVAL = 2000;

  // LRU cache for recently opened documents (last 5 files)
  // Caches full markdown strings (frontmatter + body), not TipTap JSON
  const docCache = new DocumentCache(5);

  // Large file handling (>1MB)
  const LARGE_FILE_THRESHOLD = 1024 * 1024;
  let largeFileWarning = $state(false);
  let _forcedSourceMode = $state(false);

  let currentFileContent: string | null = $state(null);
  let currentSelectedFilePath: string | null = $state(null);
  let currentActiveCollection: import('../../preload/api').Collection | null = $state(null);
  let currentFileContentLoading: boolean = $state(false);
  let lastAppliedFileContent: string | null = null;

  const unsubFileContent = fileContent.subscribe((v) => (currentFileContent = v));
  const unsubSelectedFile = selectedFilePath.subscribe((v) => (currentSelectedFilePath = v));
  const unsubCollection = activeCollection.subscribe((v) => (currentActiveCollection = v));
  const unsubLoading = fileContentLoading.subscribe((v) => (currentFileContentLoading = v));

  let saveCounter = $state(0);
  const unsubSave = saveRequested.subscribe((v) => (saveCounter = v));
  $effect(() => {
    if (saveCounter > 0) handleSave();
  });

  // Focus editor when switching to wysiwyg mode
  let currentEditorMode = $state<EditorMode>('wysiwyg');
  const unsubEditorMode = editorMode.subscribe((v) => (currentEditorMode = v));
  $effect(() => {
    if (currentEditorMode === 'wysiwyg' && wysiwygEditor) {
      requestAnimationFrame(() => wysiwygEditor?.editor.commands.focus());
    }
  });

  /**
   * Get full markdown content by joining frontmatter with editor body.
   */
  function getFullContent(): string {
    if (!wysiwygEditor) return '';
    const body = wysiwygEditor.getMarkdown();
    return joinFrontmatter(currentFrontmatter, body);
  }

  /**
   * Handle TipTap content updates — debounced sync to stores.
   */
  function handleEditorUpdate() {
    const fullContent = getFullContent();
    isDirty.set(fullContent !== lastSavedContent);
    wordCount.set(countWords(fullContent));
    tokenCount.set(countTokens(fullContent));

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      propertiesFileContent.set(fullContent);
    }, 200);
  }

  function dismissLargeFileWarning() {
    largeFileWarning = false;
  }

  let isSaving = false;

  function handleSave(): boolean {
    if (!wysiwygEditor || !currentActiveCollection || !currentSelectedFilePath) return true;
    const content = getFullContent();
    const fullPath = `${currentActiveCollection.path}/${currentSelectedFilePath}`;
    lastSavedContent = content;
    isDirty.set(false);
    isSaving = true;
    window.api.writeFile(fullPath, content).then(() => {
      dismissConflict();
    }).catch((err) => {
      console.error('Save failed:', err);
    }).finally(() => {
      isSaving = false;
    });
    return true;
  }

  async function checkForExternalChanges() {
    if (!currentSelectedFilePath || !currentActiveCollection || !wysiwygEditor) return;
    if (isSaving) return;

    const fullPath = `${currentActiveCollection.path}/${currentSelectedFilePath}`;

    try {
      const diskContent = await window.api.readFile(fullPath);
      if (diskContent !== lastSavedContent) {
        showConflict(currentSelectedFilePath);
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

  /**
   * Save current editor state to document cache.
   * Caches full markdown (frontmatter + body), not TipTap JSON.
   */
  function saveToCacheIfNeeded() {
    if (!wysiwygEditor || !previousFilePath) return;

    const content = getFullContent();
    if (content.trim().length === 0) return;

    docCache.set(previousFilePath, {
      content,
      cursor: { line: 1, column: 0 },
      scrollTop: editorEl?.querySelector('.ProseMirror')?.scrollTop ?? 0,
      cachedAt: Date.now(),
    });
  }

  /**
   * Restore editor state from cache. Returns true if restored.
   */
  function restoreFromCache(filePath: string): boolean {
    const cached = docCache.get(filePath);
    if (!cached) return false;

    const contentSize = new Blob([cached.content]).size;
    if (contentSize > LARGE_FILE_THRESHOLD) {
      largeFileWarning = true;
      _forcedSourceMode = true;
      editorMode.set('editor');
      return false;
    }

    largeFileWarning = false;
    _forcedSourceMode = false;
    loadContentIntoEditor(cached.content);

    // Restore scroll position
    requestAnimationFrame(() => {
      const pm = editorEl?.querySelector('.ProseMirror');
      if (pm) pm.scrollTop = cached.scrollTop;
    });

    return true;
  }

  /**
   * Load full markdown content into the editor, splitting frontmatter.
   */
  function loadContentIntoEditor(content: string) {
    const { frontmatter, body } = splitFrontmatter(content);
    currentFrontmatter = frontmatter;
    lastSavedContent = content;
    isDirty.set(false);
    wordCount.set(countWords(content));
    tokenCount.set(countTokens(content));

    if (wysiwygEditor) {
      wysiwygEditor.setMarkdownContent(body);
    } else if (editorEl) {
      createEditor(body);
    }
  }

  /**
   * Handle frontmatter updates from the visual property editor.
   */
  function handleFrontmatterUpdate(newYaml: string | null) {
    currentFrontmatter = newYaml;
    handleEditorUpdate();
  }

  function createEditor(body: string) {
    if (!editorEl) return;
    destroyEditor();

    wysiwygEditor = createWysiwygEditor(editorEl, body, {
      onUpdate: () => handleEditorUpdate(),
      collectionPath: currentActiveCollection?.path ?? '',
      collectionId: currentActiveCollection?.id ?? '',
    });
  }

  function destroyEditor() {
    if (wysiwygEditor) {
      wysiwygEditor.destroy();
      wysiwygEditor = null;
    }
  }

  // React to file content changes with cache support
  $effect(() => {
    if (currentSelectedFilePath === null) {
      saveToCacheIfNeeded();
      stopFileWatcher();
      dismissConflict();
      destroyEditor();
      isDirty.set(false);
      wordCount.set(0);
      tokenCount.set(0);
      previousFilePath = null;
      lastAppliedFileContent = null;
      return;
    }

    if (currentFileContentLoading && previousFilePath !== currentSelectedFilePath) {
      return;
    }

    if (currentFileContent === null) return;

    // Large file check: >1MB forces Source/Preview mode
    const contentSize = new Blob([currentFileContent]).size;
    if (contentSize > LARGE_FILE_THRESHOLD) {
      largeFileWarning = true;
      _forcedSourceMode = true;
      editorMode.set('editor');
      previousFilePath = currentSelectedFilePath;
      lastAppliedFileContent = currentFileContent;
      return;
    }

    largeFileWarning = false;
    _forcedSourceMode = false;

    const isSwitchingFiles = previousFilePath !== currentSelectedFilePath;

    if (isSwitchingFiles) {
      saveToCacheIfNeeded();
      stopFileWatcher();
      dismissConflict();

      const restored = restoreFromCache(currentSelectedFilePath);

      if (!restored) {
        loadContentIntoEditor(currentFileContent);
      }

      lastAppliedFileContent = currentFileContent;
      previousFilePath = currentSelectedFilePath;
      startFileWatcher();
    } else {
      if (currentFileContent !== lastAppliedFileContent) {
        lastAppliedFileContent = currentFileContent;
        loadContentIntoEditor(currentFileContent);
      }
    }
  });

  onMount(() => {
    if (currentFileContent !== null && currentSelectedFilePath !== null && editorEl) {
      const contentSize = new Blob([currentFileContent]).size;
      if (contentSize > LARGE_FILE_THRESHOLD) {
        largeFileWarning = true;
        _forcedSourceMode = true;
        editorMode.set('editor');
        return;
      }

      const { frontmatter, body } = splitFrontmatter(currentFileContent);
      currentFrontmatter = frontmatter;
      lastSavedContent = currentFileContent;
      wordCount.set(countWords(currentFileContent));
      tokenCount.set(countTokens(currentFileContent));
      createEditor(body);
      previousFilePath = currentSelectedFilePath;
      startFileWatcher();
    }
  });

  onDestroy(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    stopFileWatcher();
    dismissConflict();
    saveToCacheIfNeeded();
    destroyEditor();
    isDirty.set(false);
    wordCount.set(0);
    tokenCount.set(0);
    unsubFileContent();
    unsubSelectedFile();
    unsubCollection();
    unsubLoading();
    unsubSave();
    unsubEditorMode();
  });
</script>

{#if currentSelectedFilePath}
  <div class="wysiwyg-editor-container">
    <ConflictNotification />
    <FrontmatterEditor frontmatterYaml={currentFrontmatter} onUpdate={handleFrontmatterUpdate} />
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
    <div
      class="wysiwyg-content"
      bind:this={editorEl}
      onclick={handleLinkClick}
    ></div>
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
    background: #0f0f10;
  }

  .wysiwyg-content {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    overflow: auto;
    position: relative;
  }

  .wysiwyg-content :global(.ProseMirror) {
    flex: 1;
    min-height: 0;
    outline: none;
    overflow-y: auto;
  }

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

  @media (prefers-reduced-motion: reduce) {
    .warning-dismiss {
      transition: none;
    }
  }
</style>
