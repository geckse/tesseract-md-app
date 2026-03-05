<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { BubbleMenuPlugin } from '@tiptap/extension-bubble-menu';
  import type { Editor } from '@tiptap/core';
  import type { Plugin } from '@tiptap/pm/state';

  interface Props {
    editor: Editor;
  }

  let { editor }: Props = $props();

  let menuEl: HTMLDivElement | undefined = $state(undefined);
  let pluginInstance: Plugin | null = null;

  // Force re-render on selection/transaction changes
  let _tick = $state(0);

  function handleTransaction() {
    _tick++;
  }

  onMount(() => {
    if (!menuEl) return;

    pluginInstance = BubbleMenuPlugin({
      pluginKey: 'bubbleMenu',
      editor,
      element: menuEl,
      shouldShow: ({ editor: e, state: _state, from, to }) => {
        // Don't show for empty selections or node selections (images, etc.)
        if (from === to) return false;
        if (e.isActive('image')) return false;
        if (e.isActive('codeBlock')) return false;
        return true;
      },
    });

    editor.registerPlugin(pluginInstance);
    editor.on('transaction', handleTransaction);
  });

  onDestroy(() => {
    editor.off('transaction', handleTransaction);
    if (pluginInstance) {
      editor.unregisterPlugin('bubbleMenu');
    }
  });

  function toggle(command: string) {
    return () => {
      switch (command) {
        case 'bold':
          editor.chain().focus().toggleBold().run();
          break;
        case 'italic':
          editor.chain().focus().toggleItalic().run();
          break;
        case 'code':
          editor.chain().focus().toggleCode().run();
          break;
        case 'strike':
          editor.chain().focus().toggleStrike().run();
          break;
        case 'link': {
          if (editor.isActive('link')) {
            editor.chain().focus().unsetLink().run();
          } else {
            const url = window.prompt('Enter URL:');
            if (url) {
              editor.chain().focus().setLink({ href: url }).run();
            }
          }
          break;
        }
      }
    };
  }

  function isActive(mark: string): boolean {
    // Reference _tick to trigger reactivity
    void _tick;
    return editor.isActive(mark);
  }
</script>

<div
  class="bubble-menu"
  bind:this={menuEl}
  role="toolbar"
  aria-label="Formatting options"
>
  <button
    class="bubble-btn"
    class:active={isActive('bold')}
    onclick={toggle('bold')}
    title="Bold (⌘B)"
    aria-label="Bold"
    aria-pressed={isActive('bold')}
  >
    <strong>B</strong>
  </button>
  <button
    class="bubble-btn"
    class:active={isActive('italic')}
    onclick={toggle('italic')}
    title="Italic (⌘I)"
    aria-label="Italic"
    aria-pressed={isActive('italic')}
  >
    <em>I</em>
  </button>
  <button
    class="bubble-btn"
    class:active={isActive('code')}
    onclick={toggle('code')}
    title="Inline Code"
    aria-label="Code"
    aria-pressed={isActive('code')}
  >
    <code>&lt;/&gt;</code>
  </button>
  <button
    class="bubble-btn"
    class:active={isActive('strike')}
    onclick={toggle('strike')}
    title="Strikethrough"
    aria-label="Strikethrough"
    aria-pressed={isActive('strike')}
  >
    <s>S</s>
  </button>
  <button
    class="bubble-btn"
    class:active={isActive('link')}
    onclick={toggle('link')}
    title="Link"
    aria-label="Link"
    aria-pressed={isActive('link')}
  >
    🔗
  </button>
</div>

<style>
  .bubble-menu {
    visibility: hidden;
    position: fixed;
    display: flex;
    align-items: center;
    gap: var(--space-1, 4px);
    padding: var(--space-1, 4px);
    background: var(--color-surface, #161617);
    border: 1px solid var(--color-border, #27272a);
    border-radius: var(--radius-md, 6px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    z-index: var(--z-overlay, 40);
    transition: opacity var(--transition-fast, 150ms ease);
  }

  .bubble-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: none;
    border-radius: var(--radius-sm, 4px);
    background: transparent;
    color: var(--color-text, #e4e4e7);
    font-size: var(--text-sm, 12px);
    font-family: var(--font-mono, monospace);
    cursor: pointer;
    transition: background-color var(--transition-fast, 150ms ease),
                color var(--transition-fast, 150ms ease);
  }

  .bubble-btn:hover {
    background: var(--color-border, #27272a);
  }

  .bubble-btn.active {
    background: var(--color-primary-dim, rgba(0, 229, 255, 0.1));
    color: var(--color-primary, #00E5FF);
  }

  .bubble-btn:focus-visible {
    outline: 2px solid var(--color-primary, #00E5FF);
    outline-offset: 1px;
  }

  .bubble-btn code {
    font-size: 10px;
    font-family: inherit;
    background: none;
    padding: 0;
  }

  @media (prefers-reduced-motion: reduce) {
    .bubble-menu {
      transition: none;
    }
    .bubble-btn {
      transition: none;
    }
  }
</style>
