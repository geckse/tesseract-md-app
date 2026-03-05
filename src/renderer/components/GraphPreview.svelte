<script lang="ts">
  import { onDestroy } from 'svelte'
  import Badge from './ui/Badge.svelte'
  import ResizeHandle from './ResizeHandle.svelte'
  import { graphSelectedNode, graphViewActive } from '../stores/graph'
  import { selectFile } from '../stores/files'
  import { activeCollection } from '../stores/collections'
  import { renderMarkdown, formatFrontmatterValue } from '../lib/markdown-render'
  import type { GraphNode, JsonValue } from '../types/cli'

  // Panel width management with persistence
  const STORAGE_KEY = 'graphPreviewWidth'
  const DEFAULT_WIDTH = 360
  const MIN_WIDTH = 240
  const MAX_WIDTH = 600

  let panelWidth = $state(DEFAULT_WIDTH)

  // Load saved width from localStorage
  $effect(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const parsed = parseInt(saved, 10)
      if (!isNaN(parsed)) {
        panelWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, parsed))
      }
    }
  })

  function handleResize(newWidth: number) {
    panelWidth = newWidth
    localStorage.setItem(STORAGE_KEY, String(newWidth))
  }

  // Store subscriptions
  let currentNode: GraphNode | null = $state(null)
  let currentCollectionPath: string | null = $state(null)

  const unsubs = [
    graphSelectedNode.subscribe((v) => (currentNode = v)),
    activeCollection.subscribe((v) => (currentCollectionPath = v?.path ?? null)),
  ]

  onDestroy(() => unsubs.forEach((u) => u()))

  // File content loading
  let fileContent: string | null = $state(null)
  let frontmatterData: Record<string, JsonValue> | null = $state(null)
  let loading = $state(false)
  let error: string | null = $state(null)

  // Load file content when selected node changes
  let loadGeneration = 0

  $effect(() => {
    const node = currentNode
    const root = currentCollectionPath
    if (!node || !root) {
      fileContent = null
      frontmatterData = null
      error = null
      return
    }
    loadFileContent(node.path, root)
  })

  async function loadFileContent(path: string, root: string): Promise<void> {
    const generation = ++loadGeneration
    loading = true
    error = null

    try {
      const doc = await window.api.getFile(root, path)
      if (generation !== loadGeneration) return

      frontmatterData = doc.frontmatter as Record<string, JsonValue> | null
      // Read file content for markdown rendering (readFile needs absolute path)
      const absolutePath = root.endsWith('/') ? root + path : root + '/' + path
      const content = await window.api.readFile(absolutePath)
      if (generation !== loadGeneration) return

      fileContent = content
    } catch (err) {
      if (generation !== loadGeneration) return
      error = err instanceof Error ? err.message : String(err)
      fileContent = null
      frontmatterData = null
    } finally {
      if (generation === loadGeneration) {
        loading = false
      }
    }
  }

  // Rendered HTML from markdown
  let renderedHtml = $derived(fileContent ? renderMarkdown(fileContent) : '')

  // Filename derivation
  let fileName = $derived.by(() => {
    if (currentNode) {
      const parts = currentNode.path.split('/').filter((s: string) => s.length > 0)
      return parts.length > 0 ? parts[parts.length - 1] : null
    }
    return null
  })

  // Frontmatter tags extraction
  let tags = $derived.by(() => {
    if (!frontmatterData) return []
    const tagValue = frontmatterData['tags'] ?? frontmatterData['Tags']
    if (Array.isArray(tagValue)) return tagValue.map(String)
    return []
  })

  function handleOpenInEditor() {
    if (!currentNode) return
    graphViewActive.set(false)
    graphSelectedNode.set(null)
    selectFile(currentNode.path)
  }
</script>

<aside class="graph-preview" style="width: {panelWidth}px; min-width: {panelWidth}px">
  <ResizeHandle
    position="left"
    minWidth={MIN_WIDTH}
    maxWidth={MAX_WIDTH}
    width={panelWidth}
    onresize={handleResize}
  />

  <!-- Header -->
  {#if fileName}
    <div class="preview-header">
      <span class="file-name">{fileName}</span>
      <button
        class="open-button"
        title="Open in Editor"
        onclick={handleOpenInEditor}
      >
        <span class="material-symbols-outlined">open_in_new</span>
        <span class="open-label">Open</span>
      </button>
    </div>
  {/if}

  {#if loading}
    <div class="empty-state">
      <span class="material-symbols-outlined empty-icon spinning">hourglass_empty</span>
      <span class="empty-text">Loading...</span>
    </div>
  {:else if error}
    <div class="empty-state">
      <span class="material-symbols-outlined empty-icon error-icon">error</span>
      <span class="empty-text error-text">{error}</span>
    </div>
  {:else if currentNode}
    <!-- Frontmatter tags -->
    {#if tags.length > 0}
      <div class="tags-row">
        {#each tags as tag}
          <Badge variant="default">{tag}</Badge>
        {/each}
      </div>
    {/if}

    <!-- Rendered Markdown -->
    <div class="markdown-body">
      {@html renderedHtml}
    </div>
  {:else}
    <div class="empty-state">
      <span class="material-symbols-outlined empty-icon">preview</span>
      <span class="empty-text">Select a node to preview</span>
    </div>
  {/if}
</aside>

<style>
  .graph-preview {
    position: relative;
    background: var(--color-surface-dark, #0a0a0a);
    border-left: 1px solid var(--color-border, #27272a);
    overflow-y: auto;
    overflow-x: hidden;
    display: flex;
    flex-direction: column;
    height: 100%;
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.1) transparent;
  }

  .graph-preview::-webkit-scrollbar {
    width: 6px;
  }
  .graph-preview::-webkit-scrollbar-track {
    background: transparent;
  }
  .graph-preview::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.1);
    border-radius: 3px;
  }
  .graph-preview::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.2);
  }

  /* Header */
  .preview-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px 16px;
    border-bottom: 1px solid var(--color-border, #27272a);
    flex-shrink: 0;
  }

  .file-name {
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: 12px;
    font-weight: 600;
    color: var(--color-text, #e4e4e7);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }

  .open-button {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    background: var(--color-surface, #161617);
    border: 1px solid var(--color-border, #27272a);
    border-radius: var(--radius-md, 6px);
    color: var(--color-text-dim, #71717a);
    font-size: var(--text-xs, 10px);
    font-family: inherit;
    cursor: pointer;
    transition: all 0.15s;
    flex-shrink: 0;
  }

  .open-button:hover {
    color: var(--color-primary, #00E5FF);
    border-color: var(--color-primary, #00E5FF);
    background: rgba(0, 229, 255, 0.05);
  }

  .open-button .material-symbols-outlined {
    font-size: 14px;
  }

  .open-label {
    font-weight: var(--weight-medium, 500);
  }

  /* Tags row */
  .tags-row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1, 4px);
    padding: var(--space-3, 12px) var(--space-4, 16px);
    border-bottom: 1px solid var(--color-border, #27272a);
    flex-shrink: 0;
  }

  /* Markdown body */
  .markdown-body {
    padding: var(--space-4, 16px);
    font-size: var(--text-sm, 12px);
    color: var(--color-text, #e4e4e7);
    line-height: 1.6;
    overflow-wrap: break-word;
    flex: 1;
  }

  .markdown-body :global(h1),
  .markdown-body :global(h2),
  .markdown-body :global(h3),
  .markdown-body :global(h4),
  .markdown-body :global(h5),
  .markdown-body :global(h6) {
    color: var(--color-text, #e4e4e7);
    margin-top: 1.5em;
    margin-bottom: 0.5em;
    font-weight: 600;
  }

  .markdown-body :global(h1) { font-size: 1.5em; }
  .markdown-body :global(h2) { font-size: 1.3em; }
  .markdown-body :global(h3) { font-size: 1.1em; }

  .markdown-body :global(p) {
    margin: 0.5em 0;
  }

  .markdown-body :global(a) {
    color: var(--color-primary, #00E5FF);
    text-decoration: none;
  }

  .markdown-body :global(a:hover) {
    text-decoration: underline;
  }

  .markdown-body :global(code) {
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    background: var(--color-surface, #161617);
    padding: 2px 6px;
    border-radius: var(--radius-sm, 4px);
    font-size: 0.9em;
  }

  .markdown-body :global(pre) {
    background: var(--color-surface, #161617);
    border: 1px solid var(--color-border, #27272a);
    border-radius: var(--radius-md, 6px);
    padding: var(--space-3, 12px);
    overflow-x: auto;
    margin: 0.75em 0;
  }

  .markdown-body :global(pre code) {
    background: none;
    padding: 0;
  }

  .markdown-body :global(blockquote) {
    border-left: 3px solid var(--color-border, #27272a);
    margin: 0.75em 0;
    padding: 0.25em 0.75em;
    color: var(--color-text-dim, #71717a);
  }

  .markdown-body :global(ul),
  .markdown-body :global(ol) {
    padding-left: 1.5em;
    margin: 0.5em 0;
  }

  .markdown-body :global(li) {
    margin: 0.25em 0;
  }

  .markdown-body :global(hr) {
    border: none;
    border-top: 1px solid var(--color-border, #27272a);
    margin: 1em 0;
  }

  .markdown-body :global(table) {
    border-collapse: collapse;
    width: 100%;
    margin: 0.75em 0;
  }

  .markdown-body :global(th),
  .markdown-body :global(td) {
    border: 1px solid var(--color-border, #27272a);
    padding: 6px 10px;
    text-align: left;
    font-size: var(--text-xs, 10px);
  }

  .markdown-body :global(th) {
    background: var(--color-surface, #161617);
    font-weight: 600;
  }

  .markdown-body :global(img) {
    max-width: 100%;
    height: auto;
    border-radius: var(--radius-md, 6px);
  }

  /* Empty / loading / error states */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--space-8, 32px) var(--space-4, 16px);
    gap: var(--space-2, 8px);
    flex: 1;
  }

  .empty-icon {
    font-size: 32px;
    color: var(--color-text-dim, #71717a);
    opacity: 0.5;
  }

  .empty-text {
    font-size: var(--text-sm, 12px);
    color: var(--color-text-dim, #71717a);
    text-align: center;
  }

  .error-icon {
    color: var(--color-error, #ef4444);
    opacity: 0.7;
  }

  .error-text {
    color: var(--color-error, #ef4444);
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .spinning {
    animation: spin 1.2s linear infinite;
  }
</style>
