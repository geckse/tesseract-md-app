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
  import { fileContent, selectedFilePath, loadFileTree } from '../stores/files';
  import { activeCollection } from '../stores/collections';
  import { isDirty, wordCount, countWords, saveRequested, scrollToLine, activeHeadingIndex } from '../stores/editor';
  import { propertiesFileContent, outline } from '../stores/properties';
  import { DocumentCache } from '../lib/doc-cache';

  let editorEl: HTMLDivElement | undefined = $state(undefined);
  let view: EditorView | null = null;
  let lastSavedContent: string = '';
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let previousFilePath: string | null = null;

  // LRU cache for recently opened documents (last 5 files)
  const docCache = new DocumentCache(5);

  let currentOutline: import('../stores/properties').OutlineHeading[] = [];
  const unsubOutline = outline.subscribe((v) => (currentOutline = v));

  let currentFileContent: string | null = $state(null);
  let currentSelectedFilePath: string | null = $state(null);
  let currentActiveCollection: import('../../preload/api').Collection | null = $state(null);

  const unsubFileContent = fileContent.subscribe((v) => (currentFileContent = v));
  const unsubSelectedFile = selectedFilePath.subscribe((v) => (currentSelectedFilePath = v));
  const unsubCollection = activeCollection.subscribe((v) => (currentActiveCollection = v));

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

  function handleSave(): boolean {
    if (!view || !currentActiveCollection || !currentSelectedFilePath) return true;
    const content = view.state.doc.toString();
    const fullPath = `${currentActiveCollection.path}/${currentSelectedFilePath}`;
    window.api.writeFile(fullPath, content).then(() => {
      lastSavedContent = content;
      isDirty.set(false);
      loadFileTree();
    }).catch((err) => {
      console.error('Save failed:', err);
    });
    return true;
  }

  /**
   * Save the current editor state to the document cache.
   * Caches content, cursor position, and scroll position for instant restoration.
   */
  function saveToCacheIfNeeded() {
    if (!view || !previousFilePath) return;

    const content = view.state.doc.toString();
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

    if (view) {
      // Replace content
      lastSavedContent = cached.content;
      isDirty.set(false);
      const doc = view.state.doc;
      view.dispatch({
        changes: { from: 0, to: doc.length, insert: cached.content },
      });
      wordCount.set(countWords(cached.content));

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
    return [
      markdown({ base: markdownLanguage }),
      history(),
      editorTheme(),
      softRender(),
      frontmatterDecoration(),
      keymap.of([{ key: 'Mod-s', run: () => handleSave() }]),
      search({ top: true }),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
      EditorView.updateListener.of(handleUpdate),
      EditorView.domEventHandler('scroll', () => {
        updateActiveHeading();
      }),
    ];
  }

  function createView(content: string) {
    if (!editorEl) return;
    destroyView();
    lastSavedContent = content;
    isDirty.set(false);
    wordCount.set(countWords(content));

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
    lastSavedContent = content;
    isDirty.set(false);
    const doc = view.state.doc;
    view.dispatch({
      changes: { from: 0, to: doc.length, insert: content },
    });
    wordCount.set(countWords(content));
  }

  // React to file content changes with cache support
  $effect(() => {
    if (currentFileContent !== null && currentSelectedFilePath !== null) {
      // Check if we're switching files
      const isSwitchingFiles = previousFilePath !== currentSelectedFilePath;

      if (isSwitchingFiles) {
        // Save current file to cache before switching
        saveToCacheIfNeeded();

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

        // Update previous file path
        previousFilePath = currentSelectedFilePath;
      } else {
        // Same file, just update content (e.g., external changes)
        if (view) {
          replaceContent(currentFileContent);
        } else if (editorEl) {
          createView(currentFileContent);
        }
      }
    } else {
      // No file selected, save to cache and destroy view
      saveToCacheIfNeeded();
      destroyView();
      isDirty.set(false);
      wordCount.set(0);
      previousFilePath = null;
    }
  });

  onMount(() => {
    if (currentFileContent !== null && currentSelectedFilePath !== null && editorEl) {
      createView(currentFileContent);
    }
  });

  onDestroy(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    saveToCacheIfNeeded();
    destroyView();
    isDirty.set(false);
    wordCount.set(0);
    unsubFileContent();
    unsubSelectedFile();
    unsubCollection();
    unsubSave();
    unsubScrollToLine();
    unsubOutline();
  });
</script>

{#if currentSelectedFilePath}
  <div class="editor-container">
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
</style>
