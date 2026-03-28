<script lang="ts">
  import { activeCollection } from '../stores/collections'
  import { assetTree } from '../stores/files'
  import { get } from 'svelte/store'
  import type { AssetFileNode, MimeCategory } from '../types/cli'

  interface Props {
    visible: boolean
    oninsert?: (markdownSyntax: string) => void
    onclose?: () => void
    currentFilePath?: string
  }

  let { visible = $bindable(false), oninsert, onclose, currentFilePath }: Props = $props()

  let searchQuery = $state('')
  let searchInput: HTMLInputElement | null = $state(null)

  interface FlatAsset {
    name: string
    path: string
    mimeCategory: MimeCategory
    fileSize?: number
  }

  // Flatten asset tree into a searchable list
  function flattenAssets(node: AssetFileNode): FlatAsset[] {
    const result: FlatAsset[] = []
    if (!node.is_dir && node.mimeCategory) {
      result.push({
        name: node.name,
        path: node.path,
        mimeCategory: node.mimeCategory,
        fileSize: node.fileSize,
      })
    }
    for (const child of node.children) {
      result.push(...flattenAssets(child))
    }
    return result
  }

  let allAssets = $derived.by(() => {
    const tree = get(assetTree)
    if (!tree) return []
    return flattenAssets(tree.root)
  })

  let filteredAssets = $derived.by(() => {
    if (!searchQuery.trim()) return allAssets
    const q = searchQuery.toLowerCase()
    return allAssets.filter((a) => a.name.toLowerCase().includes(q) || a.path.toLowerCase().includes(q))
  })

  function mimeIcon(cat: MimeCategory): string {
    switch (cat) {
      case 'image': return 'image'
      case 'pdf': return 'picture_as_pdf'
      case 'video': return 'videocam'
      case 'audio': return 'audiotrack'
      default: return 'attach_file'
    }
  }

  function computeRelativePath(fromFile: string, toFile: string): string {
    const fromParts = fromFile.split('/')
    fromParts.pop()
    const toParts = toFile.split('/')
    let common = 0
    while (common < fromParts.length && common < toParts.length && fromParts[common] === toParts[common]) common++
    const ups = fromParts.length - common
    const rest = toParts.slice(common)
    return ups > 0 ? `${Array(ups).fill('..').join('/')}/${rest.join('/')}` : rest.join('/')
  }

  function handleSelect(asset: FlatAsset) {
    if (!currentFilePath) return

    const relPath = computeRelativePath(currentFilePath, asset.path)
    const imageExts = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico'])
    const ext = asset.name.split('.').pop()?.toLowerCase() ?? ''
    const syntax = imageExts.has(ext) ? `![${asset.name}](${relPath})` : `[${asset.name}](${relPath})`

    oninsert?.(syntax)
    visible = false
    onclose?.()
  }

  function handleClose() {
    visible = false
    searchQuery = ''
    onclose?.()
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') handleClose()
  }

  function formatSize(bytes?: number): string {
    if (bytes == null) return ''
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  $effect(() => {
    if (visible && searchInput) {
      searchInput.focus()
    }
  })
</script>

{#if visible}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="dialog-overlay" onclick={handleClose} onkeydown={handleKeydown}>
    <div class="dialog" onclick={(e) => e.stopPropagation()}>
      <div class="dialog-header">
        <span class="material-symbols-outlined">attach_file</span>
        <h3>Insert Asset</h3>
        <button class="close-btn" onclick={handleClose}>
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>

      <div class="dialog-search">
        <span class="material-symbols-outlined search-icon">search</span>
        <input
          bind:this={searchInput}
          bind:value={searchQuery}
          type="text"
          placeholder="Search assets..."
          class="search-input"
          onkeydown={handleKeydown}
        />
      </div>

      <div class="dialog-list">
        {#if filteredAssets.length === 0}
          <div class="empty">No assets found</div>
        {:else}
          {#each filteredAssets as asset (asset.path)}
            <button class="asset-item" onclick={() => handleSelect(asset)}>
              <span class="material-symbols-outlined item-icon">{mimeIcon(asset.mimeCategory)}</span>
              <div class="item-info">
                <span class="item-name">{asset.name}</span>
                <span class="item-path">{asset.path}</span>
              </div>
              {#if asset.fileSize}
                <span class="item-size">{formatSize(asset.fileSize)}</span>
              {/if}
            </button>
          {/each}
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .dialog-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }

  .dialog {
    width: 480px;
    max-height: 500px;
    background: var(--color-surface, #161617);
    border: 1px solid var(--color-border, #27272a);
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  }

  .dialog-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--color-border, #27272a);
  }

  .dialog-header .material-symbols-outlined {
    font-size: 20px;
    color: var(--color-primary, #00E5FF);
  }

  .dialog-header h3 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--color-text-main, #e4e4e7);
    flex: 1;
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--color-text-dim, #71717a);
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
  }

  .close-btn:hover {
    color: var(--color-text-main, #e4e4e7);
    background: rgba(255, 255, 255, 0.05);
  }

  .dialog-search {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    border-bottom: 1px solid var(--color-border, #27272a);
  }

  .search-icon {
    font-size: 18px;
    color: var(--color-text-dim, #71717a);
  }

  .search-input {
    flex: 1;
    background: none;
    border: none;
    color: var(--color-text-main, #e4e4e7);
    font-size: 13px;
    outline: none;
  }

  .dialog-list {
    flex: 1;
    overflow-y: auto;
    padding: 4px 0;
  }

  .empty {
    padding: 24px;
    text-align: center;
    color: var(--color-text-dim, #71717a);
    font-size: 13px;
  }

  .asset-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 16px;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
    color: var(--color-text-main, #e4e4e7);
  }

  .asset-item:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  .item-icon {
    font-size: 18px;
    color: var(--color-text-dim, #71717a);
    flex-shrink: 0;
  }

  .item-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .item-name {
    font-size: 13px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .item-path {
    font-size: 11px;
    color: var(--color-text-dim, #71717a);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
  }

  .item-size {
    font-size: 11px;
    color: var(--color-text-dim, #71717a);
    flex-shrink: 0;
  }
</style>
