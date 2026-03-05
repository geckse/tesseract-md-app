<script lang="ts">
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
            const tr = state.tr.setBlockType(pos, pos + node.nodeSize, state.schema.nodes.heading, { level: 1 })
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
            const tr = state.tr.setBlockType(pos, pos + node.nodeSize, state.schema.nodes.heading, { level: 2 })
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
            const tr = state.tr.setBlockType(pos, pos + node.nodeSize, state.schema.nodes.heading, { level: 3 })
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
            const tr = state.tr.setBlockType(pos, pos + node.nodeSize, state.schema.nodes.codeBlock)
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
            const tr = state.tr.wrap(state.tr.doc.resolve(pos).blockRange()!, [{ type: state.schema.nodes.blockquote }])
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

  $effect(() => {
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
  role="toolbar"
  aria-label="Block type"
  tabindex="0"
  onkeydown={handleKeyDown}
>
  {#each items as item, index}
    <button
      class="block-toolbar-item"
      class:selected={index === selectedIndex}
      role="option"
      aria-selected={index === selectedIndex}
      onclick={() => item.action()}
      onmouseenter={() => { selectedIndex = index }}
    >
      <span class="block-toolbar-item-icon">{item.icon}</span>
      <span class="block-toolbar-item-label">{item.label}</span>
    </button>
  {/each}
</div>
