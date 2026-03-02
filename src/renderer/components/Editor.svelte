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
  import { fileContent, selectedFilePath } from '../stores/files';
  import { activeCollection } from '../stores/collections';
  import { isDirty, wordCount, countWords } from '../stores/editor';

  let editorEl: HTMLDivElement | undefined = $state(undefined);
  let view: EditorView | null = null;
  let lastSavedContent: string = '';

  let $fileContent: string | null = $state(null);
  let $selectedFilePath: string | null = $state(null);
  let $activeCollection: import('../../preload/api').Collection | null = $state(null);

  const unsubFileContent = fileContent.subscribe((v) => ($fileContent = v));
  const unsubSelectedFile = selectedFilePath.subscribe((v) => ($selectedFilePath = v));
  const unsubCollection = activeCollection.subscribe((v) => ($activeCollection = v));

  function handleUpdate(update: import('@codemirror/view').ViewUpdate) {
    if (update.docChanged) {
      const content = update.state.doc.toString();
      isDirty.set(content !== lastSavedContent);
      wordCount.set(countWords(content));
    }
  }

  function handleSave(): boolean {
    if (!view || !$activeCollection || !$selectedFilePath) return true;
    const content = view.state.doc.toString();
    const fullPath = `${$activeCollection.path}/${$selectedFilePath}`;
    window.api.writeFile(fullPath, content).then(() => {
      lastSavedContent = content;
      isDirty.set(false);
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
    if ($fileContent !== null && $selectedFilePath !== null) {
      if (view) {
        replaceContent($fileContent);
      } else if (editorEl) {
        createView($fileContent);
      }
    } else {
      destroyView();
      isDirty.set(false);
      wordCount.set(0);
    }
  });

  onMount(() => {
    if ($fileContent !== null && $selectedFilePath !== null && editorEl) {
      createView($fileContent);
    }
  });

  onDestroy(() => {
    destroyView();
    isDirty.set(false);
    wordCount.set(0);
    unsubFileContent();
    unsubSelectedFile();
    unsubCollection();
  });
</script>

{#if $selectedFilePath}
  <div class="editor-container">
    <div class="editor-scroll">
      <div class="editor-content" bind:this={editorEl}></div>
    </div>
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
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: #0f0f10;
  }

  .editor-scroll {
    flex: 1;
    overflow-y: auto;
    display: flex;
    justify-content: center;
  }

  .editor-content {
    width: 100%;
    max-width: 768px;
    padding: 48px 24px;
  }

  .editor-content :global(.cm-editor) {
    height: 100%;
  }

  .editor-content :global(.cm-focused) {
    outline: none;
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
</style>
