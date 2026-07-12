<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { computePosition, flip, shift, offset } from '@floating-ui/dom'
  import type { CollectionRow, SearchResultFile } from '../types/cli'

  /**
   * Decoupled document picker for relation values (phase 42).
   *
   * Why not LinkAutocomplete: that component is welded to the TipTap
   * Suggestion plugin + its singleton state; this one is anchored to any
   * element (table cell, property row) and returns a PATH — the caller
   * formats the raw value (`formatRelationValue`).
   *
   * Data source:
   *  - `targetFolder` declared → ONE cached `collection(root, folder,
   *    {recursive})` call, filtered client-side (the FK's "table" is small
   *    and this naturally scopes the picker).
   *  - Else → debounced hybrid search (lexical fallback) + recents when the
   *    query is empty + tree fallback.
   */
  interface PickerItem {
    path: string
    title: string
  }

  interface Props {
    anchorEl: HTMLElement
    /** Collection root for CLI calls. */
    root: string
    /** Collection id (recents lookup); optional. */
    collectionId?: string | null
    /** Scoping folder from column.relation_target / schemaField.relation_target. */
    targetFolder?: string | null
    /** Already-linked paths to exclude (multi-value add mode). */
    excludePaths?: string[]
    /** Returns the root-relative path WITH `.md`; the caller formats the raw value. */
    onpick: (path: string) => void
    ondismiss: () => void
  }

  let {
    anchorEl,
    root,
    collectionId = null,
    targetFolder = null,
    excludePaths = [],
    onpick,
    ondismiss
  }: Props = $props()

  let query = $state('')
  let items = $state<PickerItem[]>([])
  let loading = $state(true)
  let selectedIndex = $state(0)
  let emptyState = $state<string | null>(null)

  let pickerEl: HTMLDivElement | undefined = $state(undefined)
  let inputEl: HTMLInputElement | undefined = $state(undefined)

  let debounceTimer: ReturnType<typeof setTimeout> | null = null
  let searchGeneration = 0

  /** Cached scoped-folder rows for the picker's lifetime (one CLI call). */
  let scopedItems: PickerItem[] | null = null

  const excluded = $derived(new Set(excludePaths))

  function fileNameToTitle(filePath: string): string {
    const filename = filePath.split('/').pop() ?? filePath
    return filename.replace(/\.(md|markdown)$/i, '').replace(/[-_]/g, ' ')
  }

  function rowToItem(row: CollectionRow): PickerItem {
    return { path: row.path, title: row.title }
  }

  function extractTitle(file: SearchResultFile): string {
    if (
      file.frontmatter &&
      typeof file.frontmatter === 'object' &&
      !Array.isArray(file.frontmatter)
    ) {
      const title = (file.frontmatter as Record<string, unknown>).title
      if (typeof title === 'string' && title.trim()) return title.trim()
    }
    return fileNameToTitle(file.path)
  }

  function applyExclusions(list: PickerItem[]): PickerItem[] {
    return list.filter((i) => !excluded.has(i.path))
  }

  /** Scoped mode: filter the cached folder rows by title/path substring. */
  function filterScoped(q: string): void {
    if (!scopedItems) return
    const needle = q.trim().toLowerCase()
    const filtered = needle
      ? scopedItems.filter(
          (i) => i.title.toLowerCase().includes(needle) || i.path.toLowerCase().includes(needle)
        )
      : scopedItems
    items = applyExclusions(filtered).slice(0, 50)
    emptyState = scopedItems.length === 0 ? `No documents in \`${targetFolder}/\`` : null
    loading = false
  }

  async function loadScoped(): Promise<void> {
    const generation = ++searchGeneration
    loading = true
    try {
      const output = await window.api.collection(root, targetFolder!, { recursive: true })
      if (generation !== searchGeneration) return
      scopedItems = output.rows.filter((r) => r.state !== 'deleted').map(rowToItem)
      filterScoped(query)
    } catch {
      if (generation !== searchGeneration) return
      scopedItems = []
      items = []
      emptyState = `No documents in \`${targetFolder}/\``
      loading = false
    }
  }

  /** Unscoped, empty query: recents for this collection, tree fallback. */
  async function loadDefaults(): Promise<void> {
    const generation = ++searchGeneration
    loading = true
    try {
      if (collectionId) {
        const recents = await window.api.listRecents()
        if (generation !== searchGeneration) return
        const filtered = recents.filter((r) => r.collectionId === collectionId).slice(0, 8)
        if (filtered.length > 0) {
          items = applyExclusions(
            filtered.map((r) => ({ path: r.filePath, title: fileNameToTitle(r.filePath) }))
          )
          loading = false
          return
        }
      }
      const tree = await window.api.tree(root)
      if (generation !== searchGeneration) return
      const flat: PickerItem[] = []
      const flatten = (node: typeof tree.root): void => {
        if (!node.is_dir && node.path) {
          flat.push({ path: node.path, title: fileNameToTitle(node.path) })
        }
        for (const child of node.children ?? []) {
          if (flat.length >= 10) return
          flatten(child)
        }
      }
      flatten(tree.root)
      items = applyExclusions(flat)
    } catch {
      if (generation !== searchGeneration) return
      items = []
    } finally {
      if (generation === searchGeneration) loading = false
    }
  }

  /** Unscoped search: hybrid with a lexical fallback, deduped by path. */
  async function searchFiles(q: string): Promise<void> {
    const generation = ++searchGeneration
    loading = true
    try {
      let result
      try {
        result = await window.api.search(root, q, { mode: 'hybrid', limit: 10 })
      } catch {
        result = await window.api.search(root, q, { mode: 'lexical', limit: 10 })
      }
      if (generation !== searchGeneration) return
      const seen = new Set<string>()
      const deduped: PickerItem[] = []
      for (const r of result.results) {
        if (!seen.has(r.file.path)) {
          seen.add(r.file.path)
          deduped.push({ path: r.file.path, title: extractTitle(r.file) })
        }
      }
      items = applyExclusions(deduped)
    } catch {
      if (generation !== searchGeneration) return
      items = []
    } finally {
      if (generation === searchGeneration) loading = false
    }
  }

  function onInput(): void {
    selectedIndex = 0
    if (targetFolder) {
      filterScoped(query)
      return
    }
    if (debounceTimer) clearTimeout(debounceTimer)
    debounceTimer = setTimeout(() => {
      if (query.trim() === '') void loadDefaults()
      else void searchFiles(query.trim())
    }, 250)
  }

  function pick(item: PickerItem): void {
    onpick(item.path)
  }

  function handleKeyDown(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      e.stopPropagation()
      if (items.length > 0) selectedIndex = (selectedIndex + 1) % items.length
      scrollSelectedIntoView()
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      e.stopPropagation()
      if (items.length > 0) selectedIndex = (selectedIndex - 1 + items.length) % items.length
      scrollSelectedIntoView()
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      e.stopPropagation()
      if (items[selectedIndex]) pick(items[selectedIndex])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      ondismiss()
    }
  }

  function scrollSelectedIntoView(): void {
    const item = pickerEl?.querySelector('.rp-item.selected')
    item?.scrollIntoView({ block: 'nearest' })
  }

  function handlePointerDown(e: PointerEvent): void {
    const target = e.target as Node | null
    if (!target) return
    if (pickerEl?.contains(target)) return
    if (anchorEl?.contains(target)) return
    ondismiss()
  }

  function position(): void {
    if (!pickerEl || !anchorEl) return
    computePosition(anchorEl, pickerEl, {
      placement: 'bottom-start',
      middleware: [offset(4), flip(), shift({ padding: 8 })]
    }).then(({ x, y }) => {
      if (pickerEl) {
        pickerEl.style.left = `${x}px`
        pickerEl.style.top = `${y}px`
      }
    })
  }

  onMount(() => {
    position()
    inputEl?.focus()
    document.addEventListener('pointerdown', handlePointerDown, true)
    if (targetFolder) void loadScoped()
    else void loadDefaults()
  })

  onDestroy(() => {
    document.removeEventListener('pointerdown', handlePointerDown, true)
    if (debounceTimer) clearTimeout(debounceTimer)
  })

  $effect(() => {
    void anchorEl
    position()
  })
</script>

<div class="rp" bind:this={pickerEl} role="dialog" aria-label="Pick a document">
  <input
    class="rp-input"
    type="text"
    placeholder={targetFolder ? `Search ${targetFolder}/…` : 'Search documents…'}
    aria-label="Search documents"
    bind:this={inputEl}
    bind:value={query}
    oninput={onInput}
    onkeydown={handleKeyDown}
  />

  <div class="rp-list" role="listbox" aria-label="Documents">
    {#if loading}
      <div class="rp-status">Searching…</div>
    {:else if emptyState}
      <div class="rp-status">{emptyState}</div>
    {:else if items.length === 0}
      <div class="rp-status">No matches</div>
    {:else}
      {#each items as item, index (item.path)}
        <button
          class="rp-item"
          class:selected={index === selectedIndex}
          role="option"
          aria-selected={index === selectedIndex}
          onmousedown={(e) => {
            e.preventDefault()
            pick(item)
          }}
          onmouseenter={() => (selectedIndex = index)}
        >
          <span class="rp-title">{item.title}</span>
          <span class="rp-path">{item.path}</span>
        </button>
      {/each}
    {/if}
  </div>
</div>

<style>
  .rp {
    position: fixed;
    z-index: var(--z-overlay, 40);
    width: 280px;
    background: var(--color-surface, #161617);
    border: 1px solid var(--color-border, #27272a);
    border-radius: var(--radius-md, 6px);
    box-shadow: var(--shadow-popover, 0 8px 24px rgba(0, 0, 0, 0.45));
    padding: var(--space-1, 4px);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .rp-input {
    background: transparent;
    border: 1px solid var(--color-border, #27272a);
    border-radius: 4px;
    color: var(--color-text, #e4e4e7);
    font-size: var(--text-sm, 13px);
    padding: 4px 8px;
    outline: none;
    transition: border-color var(--transition-fast, 150ms ease);
  }

  .rp-input:focus {
    border-color: var(--color-primary, #00e5ff);
  }

  .rp-list {
    max-height: calc(6 * 40px);
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }

  .rp-status {
    padding: var(--space-2, 8px) var(--space-3, 12px);
    color: var(--color-text-dim, #71717a);
    font-size: var(--text-xs, 11px);
  }

  .rp-item {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 1px;
    width: 100%;
    padding: 6px var(--space-3, 12px);
    border: none;
    border-radius: var(--radius-sm, 4px);
    background: transparent;
    cursor: pointer;
    text-align: left;
    transition: background-color var(--transition-fast, 150ms ease);
  }

  .rp-item:hover,
  .rp-item.selected {
    background: var(--color-border, #27272a);
  }

  .rp-title {
    color: var(--color-text, #e4e4e7);
    font-size: var(--text-sm, 13px);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }

  .rp-path {
    color: var(--color-text-dim, #71717a);
    font-size: var(--text-xs, 10px);
    font-family: var(--font-mono, 'JetBrains Mono', ui-monospace, monospace);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
  }

  @media (prefers-reduced-motion: reduce) {
    .rp-input,
    .rp-item {
      transition: none;
    }
  }
</style>
