<script lang="ts">
  import { onMount } from 'svelte'
  import type { EditorView } from '@tiptap/pm/view'

  interface BlockTypeItem {
    label: string
    icon: string
    action: () => void
  }

  interface Props {
    editor: EditorView
    pos: number
    anchorRect: DOMRect
    onClose: () => void
  }

  let { editor, pos, anchorRect, onClose }: Props = $props()
  let menuEl: HTMLDivElement | undefined = $state(undefined)
  let selectedIndex = $state(0)

  function getBlockTypeItems(): BlockTypeItem[] {
    const view = editor
    return [
      {
        label: 'Paragraph',
        icon: 'notes',
        action: () => {
          const { state, dispatch } = view
          const node = state.doc.nodeAt(pos)
          if (node) {
            const tr = state.tr.setBlockType(pos, pos + node.nodeSize, state.schema.nodes.paragraph)
            dispatch(tr)
          }
          onClose()
        },
      },
      {
        label: 'Heading 1',
        icon: 'format_h1',
        action: () => {
          const { state, dispatch } = view
          const node = state.doc.nodeAt(pos)
          if (node) {
            const tr = state.tr.setBlockType(
              pos,
              pos + node.nodeSize,
              state.schema.nodes.heading,
              { level: 1 }
            )
            dispatch(tr)
          }
          onClose()
        },
      },
      {
        label: 'Heading 2',
        icon: 'format_h2',
        action: () => {
          const { state, dispatch } = view
          const node = state.doc.nodeAt(pos)
          if (node) {
            const tr = state.tr.setBlockType(
              pos,
              pos + node.nodeSize,
              state.schema.nodes.heading,
              { level: 2 }
            )
            dispatch(tr)
          }
          onClose()
        },
      },
      {
        label: 'Heading 3',
        icon: 'format_h3',
        action: () => {
          const { state, dispatch } = view
          const node = state.doc.nodeAt(pos)
          if (node) {
            const tr = state.tr.setBlockType(
              pos,
              pos + node.nodeSize,
              state.schema.nodes.heading,
              { level: 3 }
            )
            dispatch(tr)
          }
          onClose()
        },
      },
      {
        label: 'Code Block',
        icon: 'code_blocks',
        action: () => {
          const { state, dispatch } = view
          const node = state.doc.nodeAt(pos)
          if (node) {
            const tr = state.tr.setBlockType(
              pos,
              pos + node.nodeSize,
              state.schema.nodes.codeBlock
            )
            dispatch(tr)
          }
          onClose()
        },
      },
      {
        label: 'Blockquote',
        icon: 'format_quote',
        action: () => {
          const { state, dispatch } = view
          const node = state.doc.nodeAt(pos)
          if (node && state.schema.nodes.blockquote) {
            const range = state.tr.doc.resolve(pos).blockRange()
            if (!range) {
              onClose()
              return
            }
            const tr = state.tr.wrap(range, [{ type: state.schema.nodes.blockquote }])
            dispatch(tr)
          }
          onClose()
        },
      },
    ]
  }

  const items = getBlockTypeItems()

  function handleKeyDown(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      selectedIndex = (selectedIndex + 1) % items.length
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      selectedIndex = (selectedIndex - 1 + items.length) % items.length
    } else if (e.key === 'Enter') {
      e.preventDefault()
      items[selectedIndex].action()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    }
  }

  onMount(() => {
    if (menuEl) {
      menuEl.style.position = 'fixed'
      menuEl.style.left = `${anchorRect.right + 4}px`
      menuEl.style.top = `${anchorRect.top}px`
      menuEl.focus()
    }
  })
</script>

<div
  bind:this={menuEl}
  class="block-toolbar-menu"
  role="listbox"
  aria-label="Block type"
  tabindex="-1"
  onkeydown={handleKeyDown}
>
  {#each items as item, index}
    <button
      class="block-toolbar-item"
      class:selected={index === selectedIndex}
      role="option"
      aria-selected={index === selectedIndex}
      onmousedown={(e) => {
        e.preventDefault()
        item.action()
      }}
      onmouseenter={() => {
        selectedIndex = index
      }}
    >
      <span class="block-toolbar-item-icon material-symbols-outlined">{item.icon}</span>
      <span class="block-toolbar-item-label">{item.label}</span>
    </button>
  {/each}
</div>

<style>
  .block-toolbar-menu {
    z-index: var(--z-overlay, 40);
    min-width: 180px;
    max-height: 320px;
    overflow-y: auto;
    background: var(--color-surface, #161617);
    border: 1px solid var(--color-border, #27272a);
    border-radius: var(--radius-md, 6px);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
    padding: 4px;
    outline: none;
  }

  .block-toolbar-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 12px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: var(--color-text, #e4e4e7);
    font-size: 13px;
    cursor: pointer;
    text-align: left;
    transition: background-color 150ms ease;
  }

  .block-toolbar-item:hover,
  .block-toolbar-item.selected {
    background: var(--color-border, #27272a);
  }

  .block-toolbar-item-icon {
    font-size: 18px;
    color: var(--color-text-secondary, #a1a1aa);
    width: 20px;
    text-align: center;
  }

  .block-toolbar-item-label {
    flex: 1;
  }

  @media (prefers-reduced-motion: reduce) {
    .block-toolbar-item {
      transition: none;
    }
  }
</style>
