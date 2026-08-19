<script lang="ts">
  import { onDestroy } from 'svelte'
  import { BubbleMenuPlugin } from '@tiptap/extension-bubble-menu'
  import type { Editor } from '@tiptap/core'
  import type { Plugin } from '@tiptap/pm/state'
  import type { MediaEmbed } from '../../lib/media-embed'
  import { getSelectedMedia, shouldShowMediaBubbleMenu } from '../../lib/tiptap/media-selection'

  const PLUGIN_KEY = 'mediaBubbleMenu'

  interface Props {
    editor: Editor
    onedit: (media: MediaEmbed) => void
    onopenintab: (media: MediaEmbed) => void
    onopenexternal: (media: MediaEmbed) => void
  }

  let { editor, onedit, onopenintab, onopenexternal }: Props = $props()
  let menuElement: HTMLDivElement | undefined = $state(undefined)
  let pluginInstance: Plugin | null = null
  let registeredEditor: Editor | null = null

  function currentMedia(): MediaEmbed | null {
    return getSelectedMedia(editor)
  }

  function hide(): void {
    if (editor.isDestroyed) return
    editor.view.dispatch(editor.state.tr.setMeta(PLUGIN_KEY, 'hide'))
  }

  function edit(): void {
    const media = currentMedia()
    hide()
    if (media) onedit(media)
  }

  function openInTab(): void {
    const media = currentMedia()
    hide()
    if (media) onopenintab(media)
  }

  function openExternal(): void {
    const media = currentMedia()
    hide()
    if (media) onopenexternal(media)
  }

  function remove(): void {
    editor.chain().focus().deleteSelection().run()
  }

  function unregister(): void {
    if (!registeredEditor) return
    try {
      registeredEditor.unregisterPlugin(PLUGIN_KEY)
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
      pluginKey: PLUGIN_KEY,
      editor,
      element: menuElement,
      shouldShow: shouldShowMediaBubbleMenu
    })
    editor.registerPlugin(pluginInstance)
    registeredEditor = editor

    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && currentMedia()) hide()
    }
    window.addEventListener('keydown', dismissOnEscape)

    const cleanup = () => {
      window.removeEventListener('keydown', dismissOnEscape)
      unregister()
    }
    return cleanup
  })

  onDestroy(unregister)
</script>

<div class="media-bubble-menu" bind:this={menuElement} role="toolbar" aria-label="Media options">
  <button onclick={edit} title="Change media source">
    <span class="material-symbols-outlined">edit</span>
    Change Source
  </button>
  <button onclick={openInTab} title="Open media in tab">
    <span class="material-symbols-outlined">tab</span>
    Open in Tab
  </button>
  <button onclick={openExternal} title="Open media externally">
    <span class="material-symbols-outlined">open_in_new</span>
    Open in External
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
