<script lang="ts">
  import type { Editor } from '@tiptap/core'

  interface Props {
    editor: Editor
    tableEl: HTMLElement | null
  }

  let { editor, tableEl }: Props = $props()

  let toolbarEl: HTMLDivElement | undefined = $state(undefined)
  let copyDropdownOpen = $state(false)
  let copyFeedback = $state<string | null>(null)

  let _tick = $state(0)

  function handleTransaction() {
    _tick++
  }

  $effect(() => {
    const ed = editor
    ed.on('transaction', handleTransaction)
    return () => {
      ed.off('transaction', handleTransaction)
    }
  })

  function positionToolbar() {
    if (!toolbarEl || !tableEl) return
    const parentEl = toolbarEl.parentElement
    if (!parentEl) return

    const tableRect = tableEl.getBoundingClientRect()
    const parentRect = parentEl.getBoundingClientRect()
    const scrollTop = parentEl.scrollTop

    const top = tableRect.top - parentRect.top + scrollTop - toolbarEl.offsetHeight - 8
    const left = tableRect.left - parentRect.left

    toolbarEl.style.top = `${Math.max(0, top)}px`
    toolbarEl.style.left = `${left}px`
    toolbarEl.style.visibility = 'visible'
  }

  $effect(() => {
    void tableEl
    void _tick
    positionToolbar()
  })

  // Close copy dropdown on outside click
  function handleOutsideClick(e: MouseEvent) {
    const target = e.target as HTMLElement
    if (!target.closest('.copy-split-wrapper')) {
      copyDropdownOpen = false
    }
  }

  $effect(() => {
    if (copyDropdownOpen) {
      document.addEventListener('mousedown', handleOutsideClick)
      return () => document.removeEventListener('mousedown', handleOutsideClick)
    }
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
    const { state } = editor
    const { selection } = state
    const table = editor.isActive('table')
    if (!table) return false
    const pos = selection.$anchor
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

  /** Get the table's markdown as a pipe table */
  function getTableMarkdown(): string {
    const rows = getTableRows()
    if (rows.length === 0) return ''

    const hasHeader = isHeaderActive()
    const lines: string[] = []
    lines.push('| ' + rows[0].join(' | ') + ' |')
    if (hasHeader || rows.length > 1) {
      lines.push('| ' + rows[0].map(() => '---').join(' | ') + ' |')
    }
    for (let i = 1; i < rows.length; i++) {
      lines.push('| ' + rows[i].join(' | ') + ' |')
    }
    return lines.join('\n')
  }

  /** Get the table's outer HTML */
  function getTableHtml(): string {
    if (!tableEl) return ''
    return tableEl.outerHTML
  }

  async function copyAsMarkdown() {
    const md = getTableMarkdown()
    if (!md) return
    await navigator.clipboard.writeText(md)
    copyFeedback = 'Copied!'
    copyDropdownOpen = false
    setTimeout(() => (copyFeedback = null), 1500)
  }

  async function copyAsHtml() {
    const html = getTableHtml()
    if (!html) return
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([html], { type: 'text/plain' }),
      }),
    ])
    copyFeedback = 'Copied!'
    copyDropdownOpen = false
    setTimeout(() => (copyFeedback = null), 1500)
  }

  /** Get table as tab-separated values for Excel/Numbers */
  function getTableTsv(): string {
    const rows = getTableRows()
    if (rows.length === 0) return ''
    return rows.map((row) => row.join('\t')).join('\n')
  }

  /** Shared helper: extract rows as string[][] from the ProseMirror table node */
  function getTableRows(): string[][] {
    const { state } = editor
    const { selection } = state
    const pos = selection.$anchor
    for (let d = pos.depth; d > 0; d--) {
      const node = pos.node(d)
      if (node.type.name === 'table') {
        const rows: string[][] = []
        node.forEach((row: any) => {
          const cells: string[] = []
          row.forEach((cell: any) => cells.push(cell.textContent.trim()))
          rows.push(cells)
        })
        return rows
      }
    }
    return []
  }

  async function copyForSpreadsheet() {
    const tsv = getTableTsv()
    const html = getTableHtml()
    if (!tsv) return
    // Write both TSV (text/plain) and HTML so Excel/Numbers get rich paste
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([tsv], { type: 'text/plain' }),
      }),
    ])
    copyFeedback = 'Copied!'
    copyDropdownOpen = false
    setTimeout(() => (copyFeedback = null), 1500)
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

    <div class="separator"></div>

    <button
      class="toolbar-btn destructive"
      onclick={run('deleteTable')}
      title="Delete table"
      aria-label="Delete table"
    >
      <span class="material-symbols-outlined">delete_forever</span>
    </button>

    <div class="separator"></div>

    <div class="copy-split-wrapper">
      <button
        class="toolbar-btn copy-btn"
        onclick={copyAsMarkdown}
        title="Copy table as Markdown"
        aria-label="Copy table as Markdown"
      >
        {#if copyFeedback}
          <span class="material-symbols-outlined">check</span>
        {:else}
          <span class="material-symbols-outlined">content_copy</span>
        {/if}
      </button>
      <button
        class="toolbar-btn copy-chevron"
        onclick={(e) => { e.stopPropagation(); copyDropdownOpen = !copyDropdownOpen; }}
        aria-haspopup="true"
        aria-expanded={copyDropdownOpen}
        title="Copy options"
        aria-label="Copy options"
      >
        <span class="material-symbols-outlined">expand_more</span>
      </button>
      {#if copyDropdownOpen}
        <div class="copy-dropdown" role="menu">
          <button class="copy-dropdown-item" role="menuitem" onmousedown={(e) => { e.preventDefault(); copyAsMarkdown(); }}>
            <span class="material-symbols-outlined item-icon">markdown</span>
            Copy as Markdown
          </button>
          <button class="copy-dropdown-item" role="menuitem" onmousedown={(e) => { e.preventDefault(); copyAsHtml(); }}>
            <span class="material-symbols-outlined item-icon">code</span>
            Copy as HTML
          </button>
          <button class="copy-dropdown-item" role="menuitem" onmousedown={(e) => { e.preventDefault(); copyForSpreadsheet(); }}>
            <span class="material-symbols-outlined item-icon">table_chart</span>
            Copy for Excel
          </button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .table-toolbar {
    visibility: hidden;
    position: absolute;
    display: flex;
    align-items: center;
    gap: var(--space-1, 4px);
    padding: var(--space-1, 4px);
    background: var(--color-surface, #161617);
    border: 1px solid var(--color-border, #27272a);
    border-radius: var(--radius-md, 6px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    z-index: 10;
    transition: opacity var(--transition-fast, 150ms ease);
    pointer-events: auto;
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

  /* Copy split button */
  .copy-split-wrapper {
    position: relative;
    display: flex;
    align-items: center;
  }

  .copy-btn {
    border-radius: var(--radius-sm, 4px) 0 0 var(--radius-sm, 4px);
  }

  .copy-chevron {
    width: 20px;
    border-radius: 0 var(--radius-sm, 4px) var(--radius-sm, 4px) 0;
    border-left: 1px solid var(--color-border, #27272a);
  }

  .copy-chevron :global(.material-symbols-outlined) {
    font-size: 16px;
  }

  /* Copy dropdown menu */
  .copy-dropdown {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    min-width: 180px;
    background: var(--color-surface, #161617);
    border: 1px solid var(--color-border, #27272a);
    border-radius: var(--radius-md, 6px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    padding: var(--space-1, 4px);
    z-index: 20;
  }

  .copy-dropdown-item {
    display: flex;
    align-items: center;
    gap: var(--space-2, 8px);
    width: 100%;
    padding: var(--space-2, 8px) var(--space-3, 12px);
    border: none;
    border-radius: var(--radius-sm, 4px);
    background: transparent;
    color: var(--color-text, #e4e4e7);
    font-size: var(--text-sm, 13px);
    cursor: pointer;
    text-align: left;
    transition: background-color var(--transition-fast, 150ms ease);
  }

  .copy-dropdown-item:hover {
    background: var(--color-border, #27272a);
  }

  .item-icon {
    font-size: 16px;
    color: var(--color-text-secondary, #a1a1aa);
  }

  @media (prefers-reduced-motion: reduce) {
    .table-toolbar {
      transition: none;
    }

    .toolbar-btn {
      transition: none;
    }

    .copy-dropdown-item {
      transition: none;
    }
  }
</style>
