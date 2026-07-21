<script lang="ts">
  import { onDestroy } from 'svelte'
  import { BubbleMenuPlugin } from '@tiptap/extension-bubble-menu'
  import type { Editor } from '@tiptap/core'
  import type { Plugin } from '@tiptap/pm/state'
  import type { MediaEmbed } from '../../lib/media-embed'

  interface Props {
    editor: Editor
    onedit: (media: MediaEmbed) => void
  }

  let { editor, onedit }: Props = $props()
  let menuElement: HTMLDivElement | undefined = $state(undefined)
  let pluginInstance: Plugin | null = null
  let registeredEditor: Editor | null = null

  function currentMedia(): MediaEmbed | null {
    if (editor.isActive('image')) {
      const attrs = editor.getAttributes('image')
      return { kind: 'image', src: attrs.src ?? '', alt: attrs.alt ?? '' }
    }
    if (editor.isActive('mediaEmbed')) {
      const attrs = editor.getAttributes('mediaEmbed')
      return {
        kind: attrs.kind === 'audio' ? 'audio' : 'video',
        src: attrs.src ?? '',
        alt: attrs.alt ?? ''
      }
    }
    return null
  }

  function edit(): void {
    const media = currentMedia()
    if (media) onedit(media)
  }

  function remove(): void {
    editor.chain().focus().deleteSelection().run()
  }

  function unregister(): void {
    if (!registeredEditor) return
    try {
      registeredEditor.unregisterPlugin('mediaBubbleMenu')
    } catch {
      // The editor may already be destroyed during tab eviction.
    }
    registeredEditor = null
    pluginInstance = null
  }

  $effect(() => {
    if (!menuElement || !editor) return
    unregister()
    pluginInstance = BubbleMenuPlugin({
      pluginKey: 'mediaBubbleMenu',
      editor,
      element: menuElement,
      shouldShow: ({ editor: currentEditor }) =>
        currentEditor.isActive('image') || currentEditor.isActive('mediaEmbed')
    })
    editor.registerPlugin(pluginInstance)
    registeredEditor = editor
    return unregister
  })

  onDestroy(unregister)
</script>

<div class="media-bubble-menu" bind:this={menuElement} role="toolbar" aria-label="Media options">
  <button onclick={edit} title="Change media">
    <span class="material-symbols-outlined">edit</span>
    Change
  </button>
  <button class="remove" onclick={remove} title="Remove media">
    <span class="material-symbols-outlined">delete</span>
    Remove
  </button>
</div>

<style>
  .media-bubble-menu {
    visibility: hidden;
    position: fixed;
    z-index: var(--z-overlay, 40);
    display: flex;
    gap: 3px;
    padding: 4px;
    background: var(--color-surface, #161617);
    border: 1px solid var(--color-border, #27272a);
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  }

  button {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 5px 7px;
    color: var(--color-text, #e4e4e7);
    background: transparent;
    border: 0;
    border-radius: 4px;
    font: inherit;
    font-size: 11px;
    cursor: pointer;
  }

  button:hover {
    background: var(--color-border, #27272a);
  }

  button.remove:hover {
    color: var(--color-error, #ef4444);
  }

  .material-symbols-outlined {
    font-size: 15px;
  }
</style>
