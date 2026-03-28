<script lang="ts">
  import { activeCollection } from '../stores/collections'
  import { get } from 'svelte/store'
  import type { MimeCategory } from '../types/cli'

  interface Props {
    filePath: string
    mimeCategory: MimeCategory
    fileSize?: number
  }

  let { filePath, mimeCategory, fileSize }: Props = $props()

  function mimeIcon(cat: MimeCategory): string {
    switch (cat) {
      case 'image': return 'image'
      case 'pdf': return 'picture_as_pdf'
      case 'video': return 'videocam'
      case 'audio': return 'audiotrack'
      default: return 'attach_file'
    }
  }

  function formatSize(bytes?: number): string {
    if (bytes == null) return 'Unknown'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  function fileExtension(): string {
    const parts = filePath.split('.')
    return parts.length > 1 ? `.${parts.pop()?.toUpperCase()}` : 'Unknown'
  }

  function fileName(): string {
    return filePath.split('/').pop() ?? filePath
  }

  async function openInDefaultApp() {
    const collection = get(activeCollection)
    if (!collection) return
    await window.api.openPath(`${collection.path}/${filePath}`)
  }

  async function copyMarkdownReference() {
    const name = fileName()
    const isImage = mimeCategory === 'image'
    const ref = isImage ? `![${name}](${filePath})` : `[${name}](${filePath})`
    await window.api.writeToClipboard(ref)
  }
</script>

<div class="asset-card">
  <div class="card-content">
    <span class="material-symbols-outlined icon">{mimeIcon(mimeCategory)}</span>
    <h2 class="filename">{fileName()}</h2>

    <div class="meta-grid">
      <div class="meta-item">
        <span class="meta-label">Type</span>
        <span class="meta-value">{fileExtension()}</span>
      </div>
      <div class="meta-item">
        <span class="meta-label">Size</span>
        <span class="meta-value">{formatSize(fileSize)}</span>
      </div>
      <div class="meta-item full-width">
        <span class="meta-label">Path</span>
        <span class="meta-value path">{filePath}</span>
      </div>
    </div>

    <div class="actions">
      <button class="action-btn" onclick={openInDefaultApp}>
        <span class="material-symbols-outlined">open_in_new</span>
        Open in Default App
      </button>
      <button class="action-btn" onclick={copyMarkdownReference}>
        <span class="material-symbols-outlined">content_copy</span>
        Copy Markdown Reference
      </button>
    </div>
  </div>
</div>

<style>
  .asset-card {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    background: var(--color-surface-dark, #0a0a0a);
    padding: 48px;
  }

  .card-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
    max-width: 400px;
    width: 100%;
  }

  .icon {
    font-size: 64px;
    color: var(--color-text-dim, #71717a);
    opacity: 0.6;
  }

  .filename {
    font-size: 18px;
    font-weight: 500;
    color: var(--color-text-main, #e4e4e7);
    word-break: break-all;
    text-align: center;
    margin: 0;
  }

  .meta-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    width: 100%;
    padding: 16px;
    background: var(--color-surface, #161617);
    border-radius: 8px;
    border: 1px solid var(--color-border, #27272a);
  }

  .meta-item {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .meta-item.full-width {
    grid-column: span 2;
  }

  .meta-label {
    font-size: 11px;
    color: var(--color-text-dim, #71717a);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .meta-value {
    font-size: 13px;
    color: var(--color-text-main, #e4e4e7);
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
  }

  .meta-value.path {
    word-break: break-all;
    font-size: 12px;
    opacity: 0.8;
  }

  .actions {
    display: flex;
    gap: 8px;
    width: 100%;
  }

  .action-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 8px 12px;
    background: var(--color-surface, #161617);
    border: 1px solid var(--color-border, #27272a);
    border-radius: 6px;
    color: var(--color-text-main, #e4e4e7);
    font-size: 12px;
    cursor: pointer;
    transition: border-color 0.15s ease;
  }

  .action-btn:hover {
    border-color: var(--color-primary, #00E5FF);
    color: var(--color-primary, #00E5FF);
  }

  .action-btn .material-symbols-outlined {
    font-size: 16px;
  }

  @media (prefers-reduced-motion: reduce) {
    .action-btn { transition: none; }
  }
</style>
