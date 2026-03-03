<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { EditorView, keymap } from '@codemirror/view';
  import { EditorState } from '@codemirror/state';
  import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
  import { history, historyKeymap } from '@codemirror/commands';
  import { defaultKeymap } from '@codemirror/commands';
  import { editorTheme } from '../lib/editor-theme';
  import { softRender } from '../lib/soft-render';
  import { frontmatterDecoration } from '../lib/frontmatter-decoration';
  import { fileContent, selectedFilePath, loadFileTree } from '../stores/files';
  import { activeCollection } from '../stores/collections';
  import { isDirty, wordCount, countWords, saveRequested, scrollToLine } from '../stores/editor';
  import { propertiesFileContent } from '../stores/properties';

  let editorEl: HTMLDivElement | undefined = $state(undefined);
  let view: EditorView | null = null;
  let lastSavedContent: string = '';

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
      propertiesFileContent.set(content);
    }
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

  function createExtensions() {
    return [
      markdown({ base: markdownLanguage }),
      history(),
      editorTheme(),
      softRender(),
      frontmatterDecoration(),
      keymap.of([{ key: 'Mod-s', run: () => handleSave() }]),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      EditorView.updateListener.of(handleUpdate),
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

  // React to file content changes
  $effect(() => {
    if (currentFileContent !== null && currentSelectedFilePath !== null) {
      if (view) {
        replaceContent(currentFileContent);
      } else if (editorEl) {
        createView(currentFileContent);
      }
    } else {
      destroyView();
      isDirty.set(false);
      wordCount.set(0);
    }
  });

  onMount(() => {
    if (currentFileContent !== null && currentSelectedFilePath !== null && editorEl) {
      createView(currentFileContent);
    }
  });

  onDestroy(() => {
    destroyView();
    isDirty.set(false);
    wordCount.set(0);
    unsubFileContent();
    unsubSelectedFile();
    unsubCollection();
    unsubSave();
    unsubScrollToLine();
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

  .editor-content :global(.cm-scroller) {
    flex: 1;
    min-height: 0;
    overflow: auto !important;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.10) transparent;
  }

  .editor-content :global(.cm-scroller)::-webkit-scrollbar { width: 6px; height: 6px; }
  .editor-content :global(.cm-scroller)::-webkit-scrollbar-track { background: transparent; }
  .editor-content :global(.cm-scroller)::-webkit-scrollbar-thumb { background: rgba(255, 255, 255, 0.10); border-radius: 3px; }
  .editor-content :global(.cm-scroller)::-webkit-scrollbar-thumb:hover { background: rgba(255, 255, 255, 0.20); }
  .editor-content :global(.cm-scroller)::-webkit-scrollbar-corner { background: transparent; }

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
