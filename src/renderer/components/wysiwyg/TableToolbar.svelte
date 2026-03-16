<script lang="ts">
  import { onDestroy } from 'svelte'
  import { computePosition, flip, shift, offset } from '@floating-ui/dom'
  import type { Editor } from '@tiptap/core'

  interface Props {
    editor: Editor
    tableEl: HTMLElement | null
  }

  let { editor, tableEl }: Props = $props()

  let toolbarEl: HTMLDivElement | undefined = $state(undefined)

  let _tick = $state(0)

  function handleTransaction() {
    _tick++
  }

  editor.on('transaction', handleTransaction)

  onDestroy(() => {
    editor.off('transaction', handleTransaction)
  })

  function positionToolbar() {
    if (!toolbarEl || !tableEl) return
    computePosition(tableEl, toolbarEl, {
      placement: 'top-start',
      middleware: [offset(8), flip(), shift({ padding: 8 })]
    }).then(({ x, y }) => {
      if (toolbarEl) {
        toolbarEl.style.left = `${x}px`
        toolbarEl.style.top = `${y}px`
        toolbarEl.style.visibility = 'visible'
      }
    })
  }

  $effect(() => {
    void tableEl
    void _tick
    positionToolbar()
  })

  function run(cmd: string) {
    return () => {
      switch (cmd) {
        case 'addRowAfter':
          editor.chain().focus().addRowAfter().run()
          break
        case 'addColumnAfter':
          editor.chain().focus().addColumnAfter().run()
          break
        case 'toggleHeaderRow':
          editor.chain().focus().toggleHeaderRow().run()
          break
        case 'deleteTable':
          editor.chain().focus().deleteTable().run()
          break
      }
    }
  }

  function isHeaderActive(): boolean {
    void _tick
    // Check if the first row contains header cells
    const { state } = editor
    const { selection } = state
    const table = editor.isActive('table')
    if (!table) return false
    // Use the editor's isActive to check for tableHeader in the first row
    const pos = selection.$anchor
    // Walk up to find table node and check first row
    for (let d = pos.depth; d > 0; d--) {
      const node = pos.node(d)
      if (node.type.name === 'table') {
        const firstRow = node.firstChild
        if (firstRow && firstRow.firstChild) {
          return firstRow.firstChild.type.name === 'tableHeader'
        }
        break
      }
    }
    return false
  }
</script>

{#if tableEl}
  <div
    class="table-toolbar"
    bind:this={toolbarEl}
    role="toolbar"
    aria-label="Table options"
  >
    <button
      class="toolbar-btn"
      onclick={run('addRowAfter')}
      title="Add row below"
      aria-label="Add row below"
    >
      <span class="material-symbols-outlined">add</span>
    </button>
    <button
      class="toolbar-btn"
      onclick={run('addColumnAfter')}
      title="Add column right"
      aria-label="Add column right"
    >
      <span class="material-symbols-outlined">playlist_add</span>
    </button>

    <div class="separator"></div>

    <button
      class="toolbar-btn"
      class:active={isHeaderActive()}
      onclick={run('toggleHeaderRow')}
      title="Toggle header row"
      aria-label="Toggle header row"
      aria-pressed={isHeaderActive()}
    >
      <span class="material-symbols-outlined">table_rows</span>
    </button>
    <button
      class="toolbar-btn destructive"
      onclick={run('deleteTable')}
      title="Delete table"
      aria-label="Delete table"
    >
      <span class="material-symbols-outlined">delete_forever</span>
    </button>
  </div>
{/if}

<style>
  .table-toolbar {
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

  .toolbar-btn {
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
    cursor: pointer;
    transition: background-color var(--transition-fast, 150ms ease),
                color var(--transition-fast, 150ms ease);
  }

  .toolbar-btn :global(.material-symbols-outlined) {
    font-size: 18px;
  }

  .toolbar-btn:hover {
    background: var(--color-border, #27272a);
  }

  .toolbar-btn.active {
    background: var(--color-primary-dim, rgba(0, 229, 255, 0.1));
    color: var(--color-primary, #00E5FF);
  }

  .toolbar-btn.destructive:hover {
    background: rgba(239, 68, 68, 0.15);
    color: #ef4444;
  }

  .toolbar-btn:focus-visible {
    outline: 2px solid var(--color-primary, #00E5FF);
    outline-offset: 1px;
  }

  .separator {
    width: 1px;
    height: 18px;
    background: var(--color-border, #27272a);
    margin: 0 var(--space-1, 4px);
  }

  @media (prefers-reduced-motion: reduce) {
    .table-toolbar {
      transition: none;
    }

    .toolbar-btn {
      transition: none;
    }
  }
</style>
