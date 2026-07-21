<script lang="ts">
  import { tick } from 'svelte'
  import { get } from 'svelte/store'
  import { assetTree } from '../stores/files'
  import type { AssetFileNode, MimeCategory } from '../types/cli'
  import {
    computeRelativeMediaPath,
    inferMediaKind,
    isPublicMediaUrl,
    mediaKindFromMimeCategory,
    type MediaEmbed,
    type MediaKind
  } from '../lib/media-embed'
  import { focusTrap } from '../lib/focus-trap'

  interface Props {
    visible: boolean
    currentFilePath?: string
    initialMedia?: MediaEmbed | null
    onselect?: (media: MediaEmbed) => void
    onclose?: () => void
  }

  let {
    visible = $bindable(false),
    currentFilePath,
    initialMedia = null,
    onselect,
    onclose
  }: Props = $props()

  type SourceTab = 'collection' | 'url'
  const MEDIA_KINDS: readonly MediaKind[] = ['image', 'video', 'audio']

  interface FlatAsset {
    name: string
    path: string
    mimeCategory: MimeCategory
    fileSize?: number
  }

  let sourceTab = $state<SourceTab>('collection')
  let searchQuery = $state('')
  let selectedAssetPath = $state('')
  let url = $state('')
  let kind = $state<MediaKind>('image')
  let alt = $state('')

  function flattenAssets(node: AssetFileNode): FlatAsset[] {
    const result: FlatAsset[] = []
    if (!node.is_dir && node.mimeCategory && mediaKindFromMimeCategory(node.mimeCategory)) {
      result.push({
        name: node.name,
        path: node.path,
        mimeCategory: node.mimeCategory,
        fileSize: node.fileSize
      })
    }
    for (const child of node.children) result.push(...flattenAssets(child))
    return result
  }

  const allAssets = $derived.by(() => {
    const tree = get(assetTree)
    return tree ? flattenAssets(tree.root) : []
  })

  const filteredAssets = $derived.by(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return allAssets
    return allAssets.filter(
      (asset) =>
        asset.name.toLowerCase().includes(query) || asset.path.toLowerCase().includes(query)
    )
  })

  const selectedAsset = $derived(allAssets.find((asset) => asset.path === selectedAssetPath))
  const urlIsValid = $derived(isPublicMediaUrl(url.trim()))
  const canSubmit = $derived(
    sourceTab === 'collection' ? Boolean(selectedAsset && currentFilePath) : urlIsValid
  )

  $effect(() => {
    if (!visible) return
    sourceTab = initialMedia && isPublicMediaUrl(initialMedia.src) ? 'url' : 'collection'
    searchQuery = ''
    selectedAssetPath = ''
    url = initialMedia && isPublicMediaUrl(initialMedia.src) ? initialMedia.src : ''
    kind = initialMedia?.kind ?? 'image'
    alt = initialMedia?.alt ?? ''
  })

  function selectAsset(asset: FlatAsset): void {
    selectedAssetPath = asset.path
    kind = mediaKindFromMimeCategory(asset.mimeCategory) ?? 'image'
    if (!alt.trim()) alt = asset.name
  }

  async function selectAssetAndSubmit(asset: FlatAsset): Promise<void> {
    selectAsset(asset)
    await tick()
    handleSubmit()
  }

  function handleUrlInput(): void {
    const inferred = inferMediaKind(url)
    if (inferred) kind = inferred
  }

  function handleSubmit(): void {
    if (!canSubmit) return

    const src =
      sourceTab === 'collection' && selectedAsset && currentFilePath
        ? computeRelativeMediaPath(currentFilePath, selectedAsset.path)
        : url.trim()

    onselect?.({ kind, src, alt: alt.trim() })
    close()
  }

  function close(): void {
    visible = false
    onclose?.()
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    }
  }

  function mimeIcon(category: MimeCategory): string {
    if (category === 'video') return 'videocam'
    if (category === 'audio') return 'audiotrack'
    return 'image'
  }

  function formatSize(bytes?: number): string {
    if (bytes == null) return ''
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }
</script>

{#if visible}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="dialog-overlay" onclick={close} onkeydown={handleKeydown}>
    <div
      class="dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="media-dialog-title"
      tabindex="-1"
      use:focusTrap
      onclick={(event) => event.stopPropagation()}
    >
      <div class="dialog-header">
        <span class="material-symbols-outlined">perm_media</span>
        <h3 id="media-dialog-title">{initialMedia ? 'Change Media' : 'Insert Media'}</h3>
        <button class="icon-button" onclick={close} aria-label="Close media dialog">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>

      <div class="source-tabs" role="tablist" aria-label="Media source">
        <button
          role="tab"
          aria-selected={sourceTab === 'collection'}
          class:active={sourceTab === 'collection'}
          onclick={() => (sourceTab = 'collection')}
        >
          Collection
        </button>
        <button
          role="tab"
          aria-selected={sourceTab === 'url'}
          class:active={sourceTab === 'url'}
          onclick={() => (sourceTab = 'url')}
        >
          Public URL
        </button>
      </div>

      {#if sourceTab === 'collection'}
        <label class="search-field">
          <span class="material-symbols-outlined">search</span>
          <input
            bind:value={searchQuery}
            data-autofocus
            type="search"
            placeholder="Search media..."
          />
        </label>

        <div class="asset-list" role="listbox" aria-label="Collection media">
          {#if filteredAssets.length === 0}
            <div class="empty">No images, video, or audio found in this collection.</div>
          {:else}
            {#each filteredAssets as asset (asset.path)}
              <button
                class="asset-item"
                class:selected={selectedAssetPath === asset.path}
                role="option"
                aria-selected={selectedAssetPath === asset.path}
                onclick={() => selectAsset(asset)}
                ondblclick={() => selectAssetAndSubmit(asset)}
              >
                <span class="material-symbols-outlined item-icon"
                  >{mimeIcon(asset.mimeCategory)}</span
                >
                <span class="item-info">
                  <span class="item-name">{asset.name}</span>
                  <span class="item-path">{asset.path}</span>
                </span>
                <span class="item-size">{formatSize(asset.fileSize)}</span>
              </button>
            {/each}
          {/if}
        </div>
      {:else}
        <div class="url-form">
          <label>
            <span>Media URL</span>
            <input
              bind:value={url}
              oninput={handleUrlInput}
              data-autofocus
              type="url"
              placeholder="https://example.com/image.jpg"
              aria-describedby="url-help"
            />
          </label>
          <p id="url-help" class:error={url.length > 0 && !urlIsValid}>
            {url.length > 0 && !urlIsValid
              ? 'Enter a public http:// or https:// URL.'
              : 'The URL must be publicly reachable when the document is viewed.'}
          </p>
          <fieldset>
            <legend>Media type</legend>
            <div class="kind-options">
              {#each MEDIA_KINDS as option}
                <label>
                  <input type="radio" bind:group={kind} value={option} />
                  <span>{option}</span>
                </label>
              {/each}
            </div>
          </fieldset>
        </div>
      {/if}

      <label class="text-field">
        <span>{kind === 'image' ? 'Alt text' : 'Title'}</span>
        <input
          bind:value={alt}
          placeholder={kind === 'image' ? 'Describe the image' : 'Media title'}
        />
      </label>

      <div class="dialog-actions">
        <button class="secondary-button" onclick={close}>Cancel</button>
        <button class="primary-button" disabled={!canSubmit} onclick={handleSubmit}>
          {initialMedia ? 'Change Media' : 'Insert Media'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .dialog-overlay {
    position: fixed;
    inset: 0;
    z-index: 200;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: rgba(0, 0, 0, 0.58);
  }

  .dialog {
    width: min(560px, 100%);
    max-height: min(680px, calc(100vh - 48px));
    display: flex;
    flex-direction: column;
    overflow: hidden;
    color: var(--color-text, #e4e4e7);
    background: var(--color-surface, #161617);
    border: 1px solid var(--color-border, #27272a);
    border-radius: 10px;
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.55);
  }

  .dialog-header,
  .dialog-actions {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
  }

  .dialog-header {
    border-bottom: 1px solid var(--color-border, #27272a);
  }

  .dialog-header > .material-symbols-outlined {
    color: var(--color-primary, #00e5ff);
    font-size: 20px;
  }

  h3 {
    flex: 1;
    margin: 0;
    font-size: 14px;
  }

  button,
  input {
    font: inherit;
  }

  button {
    cursor: pointer;
  }

  .icon-button {
    display: grid;
    place-items: center;
    padding: 4px;
    color: var(--color-text-dim, #71717a);
    background: transparent;
    border: 0;
    border-radius: 4px;
  }

  .icon-button:hover {
    color: var(--color-text, #e4e4e7);
    background: var(--overlay-hover, rgba(255, 255, 255, 0.05));
  }

  .source-tabs {
    display: flex;
    gap: 4px;
    padding: 10px 16px 0;
  }

  .source-tabs button {
    padding: 6px 10px;
    color: var(--color-text-dim, #71717a);
    background: transparent;
    border: 0;
    border-bottom: 2px solid transparent;
    font-size: 12px;
    font-weight: 600;
  }

  .source-tabs button.active {
    color: var(--color-primary, #00e5ff);
    border-bottom-color: currentColor;
  }

  .search-field {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 10px 16px 8px;
    padding: 7px 10px;
    background: var(--color-surface-dark, #0a0a0a);
    border: 1px solid var(--color-border, #27272a);
    border-radius: 6px;
  }

  .search-field .material-symbols-outlined {
    color: var(--color-text-dim, #71717a);
    font-size: 18px;
  }

  .search-field input {
    flex: 1;
    min-width: 0;
    color: var(--color-text, #e4e4e7);
    background: transparent;
    border: 0;
    outline: 0;
  }

  .asset-list {
    min-height: 180px;
    max-height: 290px;
    overflow-y: auto;
    padding: 0 8px;
  }

  .empty {
    padding: 36px 16px;
    color: var(--color-text-dim, #71717a);
    text-align: center;
    font-size: 12px;
  }

  .asset-item {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 8px;
    color: var(--color-text, #e4e4e7);
    text-align: left;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 6px;
  }

  .asset-item:hover,
  .asset-item.selected {
    background: var(--overlay-hover, rgba(255, 255, 255, 0.05));
  }

  .asset-item.selected {
    border-color: var(--color-primary, #00e5ff);
  }

  .item-icon {
    color: var(--color-text-dim, #71717a);
    font-size: 19px;
  }

  .item-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .item-name,
  .item-path {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .item-name {
    font-size: 13px;
  }

  .item-path,
  .item-size {
    color: var(--color-text-dim, #71717a);
    font-size: 10px;
  }

  .item-path {
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
  }

  .url-form {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 18px 16px 10px;
  }

  .url-form label,
  .text-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    color: var(--color-text-muted, #a1a1aa);
    font-size: 11px;
    font-weight: 600;
  }

  .url-form input[type='url'],
  .text-field input {
    padding: 8px 10px;
    color: var(--color-text, #e4e4e7);
    background: var(--color-surface-dark, #0a0a0a);
    border: 1px solid var(--color-border, #27272a);
    border-radius: 6px;
    outline: 0;
  }

  .url-form input:focus,
  .text-field input:focus {
    border-color: var(--color-primary, #00e5ff);
  }

  .url-form p {
    margin: -4px 0 0;
    color: var(--color-text-dim, #71717a);
    font-size: 10px;
  }

  .url-form p.error {
    color: var(--color-error, #ef4444);
  }

  fieldset {
    margin: 2px 0 0;
    padding: 0;
    border: 0;
  }

  legend {
    margin-bottom: 6px;
    color: var(--color-text-muted, #a1a1aa);
    font-size: 11px;
    font-weight: 600;
  }

  .kind-options {
    display: flex;
    gap: 8px;
  }

  .kind-options label {
    flex-direction: row;
    align-items: center;
    padding: 6px 9px;
    color: var(--color-text-muted, #a1a1aa);
    background: var(--color-surface-dark, #0a0a0a);
    border: 1px solid var(--color-border, #27272a);
    border-radius: 6px;
    text-transform: capitalize;
  }

  .text-field {
    padding: 10px 16px;
    border-top: 1px solid var(--color-border, #27272a);
  }

  .dialog-actions {
    justify-content: flex-end;
    border-top: 1px solid var(--color-border, #27272a);
  }

  .secondary-button,
  .primary-button {
    padding: 7px 12px;
    border-radius: 5px;
    font-size: 11px;
    font-weight: 700;
  }

  .secondary-button {
    color: var(--color-text-muted, #a1a1aa);
    background: transparent;
    border: 1px solid var(--color-border, #27272a);
  }

  .primary-button {
    color: var(--color-surface-darker, #0a0a0a);
    background: var(--color-primary, #00e5ff);
    border: 1px solid transparent;
  }

  .primary-button:disabled {
    cursor: not-allowed;
    opacity: 0.4;
  }
</style>
