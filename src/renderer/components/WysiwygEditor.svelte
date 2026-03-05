<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { fileContent, selectedFilePath } from '../stores/files';
  import { editorMode, type EditorMode } from '../stores/editor';

  let editorEl: HTMLDivElement | undefined = $state(undefined);

  let currentFileContent: string | null = $state(null);
  let currentSelectedFilePath: string | null = $state(null);
  let currentEditorMode = $state<EditorMode>('preview');

  const unsubFileContent = fileContent.subscribe((v) => (currentFileContent = v));
  const unsubSelectedFile = selectedFilePath.subscribe((v) => (currentSelectedFilePath = v));
  const unsubEditorMode = editorMode.subscribe((v) => (currentEditorMode = v));

  onMount(() => {
    // TipTap editor initialization will go here
  });

  onDestroy(() => {
    unsubFileContent();
    unsubSelectedFile();
    unsubEditorMode();
    // TipTap editor cleanup will go here
  });
</script>

<div class="wysiwyg-editor" bind:this={editorEl}>
  <p class="loading-message">WYSIWYG editor loading...</p>
</div>

<style>
  .wysiwyg-editor {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .loading-message {
    color: var(--text-secondary, #888);
    font-size: 14px;
  }
</style>
