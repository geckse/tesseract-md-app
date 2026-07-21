<script lang="ts">
  import { slide } from 'svelte/transition'
  import Self from './FileTreeNode.svelte'
  import type { FileState, UnifiedTreeNode, MimeCategory } from '../types/cli'
  import { toggleExpanded } from '../stores/files'

  interface FileTreeNodeProps {
    node: UnifiedTreeNode
    depth?: number
    onfileselect?: (detail: { path: string; forceNewTab?: boolean }) => void
    onassetselect?: (detail: {
      path: string
      mimeCategory: MimeCategory
      fileSize?: number
    }) => void
    oncontextmenu?: (detail: {
      path: string
      isDir: boolean
      isAsset: boolean
      mimeCategory?: string
      x: number
      y: number
    }) => void
    onfolderclick?: (folderPath: string) => void
    onfolderopen?: (folderPath: string) => void
    onnodefocus?: (path: string) => void
    focusedPath?: string
    itemId?: string
    noRecursiveRender?: boolean // If true, don't render children recursively (for virtual lists)
    currentSelectedFilePath?: string | null
    currentExpandedPaths?: Set<string>
    /** Path of the node currently being renamed inline (phase 43), if any. */
    renamingPath?: string | null
    /** Initial input value for the rename (name without extension for files). */
    renameInitial?: string
    renameError?: string | null
    onrenamecommit?: (value: string) => void
    onrenamecancel?: () => void
  }

  let {
    node,
    depth = 0,
    onfileselect,
    onassetselect,
    oncontextmenu: onctx,
    onfolderclick: onfc,
    onfolderopen: onfo,
    onnodefocus: onnf,
    focusedPath,
    itemId,
    noRecursiveRender = false,
    currentSelectedFilePath = null,
    currentExpandedPaths = new Set<string>(),
    renamingPath = null,
    renameInitial = '',
    renameError = null,
    onrenamecommit,
    onrenamecancel
  }: FileTreeNodeProps = $props()

  const isRenaming = $derived(renamingPath === node.path)

  let renameDraft = $state('')
  $effect(() => {
    if (isRenaming) {
      renameDraft = renameInitial
    }
  })

  function handleRenameKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      onrenamecommit?.(renameDraft)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      onrenamecancel?.()
    }
  }

  /** Open a folder as a table view without toggling expansion. */
  function handleOpenAsTable(event: MouseEvent) {
    event.stopPropagation()
    onnf?.(node.path)
    onfo?.(node.path)
  }

  /** Double-clicking a folder row opens it as a table (redundant with single click, kept as affordance). */
  function handleDblClick() {
    if (node.is_dir) onfo?.(node.path)
  }

  let buttonElement: HTMLButtonElement | null = $state(null)

  function handleContextMenu(event: MouseEvent) {
    event.preventDefault()
    event.stopPropagation()
    onctx?.({
      path: node.path,
      isDir: node.is_dir,
      isAsset: node.isAsset,
      mimeCategory: node.mimeCategory,
      x: event.clientX,
      y: event.clientY
    })
  }

  function handleDragStart(event: DragEvent) {
    if (node.is_dir || !event.dataTransfer) return
    const filename = node.name.replace(/\.[^.]+$/, '')
    event.dataTransfer.setData('text/plain', `[[${filename}]]`)
    event.dataTransfer.setData('application/x-mdvdb-path', node.path)
    if (node.isAsset) {
      event.dataTransfer.setData(
        'application/x-mdvdb-asset',
        JSON.stringify({
          mimeCategory: node.mimeCategory ?? 'other',
          fileSize: node.fileSize
        })
      )
    }
    event.dataTransfer.effectAllowed = 'link'
  }

  let isExpanded = $derived(currentExpandedPaths.has(node.path))
  let isSelected = $derived(!node.is_dir && currentSelectedFilePath === node.path)
  let isFocused = $derived(focusedPath === node.path)

  /** Check if a filename has an asset extension (image, pdf, video, audio). */
  function isAssetByExtension(name: string): MimeCategory | null {
    const ext = name.split('.').pop()?.toLowerCase() ?? ''
    const map: Record<string, MimeCategory> = {
      png: 'image',
      jpg: 'image',
      jpeg: 'image',
      gif: 'image',
      svg: 'image',
      webp: 'image',
      bmp: 'image',
      ico: 'image',
      pdf: 'pdf',
      mp4: 'video',
      webm: 'video',
      mov: 'video',
      avi: 'video',
      mp3: 'audio',
      wav: 'audio',
      ogg: 'audio',
      flac: 'audio'
    }
    return map[ext] ?? null
  }

  function handleClick() {
    onnf?.(node.path)
    if (node.is_dir) {
      toggleExpanded(node.path)
      onfc?.(node.path)
      onfo?.(node.path)
    } else if (node.isAsset || isAssetByExtension(node.name)) {
      // Route to asset preview — use node.mimeCategory if available, otherwise detect from extension
      const mime = node.mimeCategory ?? isAssetByExtension(node.name) ?? 'other'
      onassetselect?.({ path: node.path, mimeCategory: mime, fileSize: node.fileSize })
    } else {
      onfileselect?.({ path: node.path })
    }
  }

  // Scroll into view when focused
  $effect(() => {
    if (isFocused && buttonElement) {
      buttonElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  })

  function stateIcon(state: FileState | null): string {
    switch (state) {
      case 'indexed':
        return 'check_circle'
      case 'modified':
        return 'edit'
      case 'new':
        return 'add_circle'
      case 'deleted':
        return 'remove_circle'
      default:
        return ''
    }
  }

  function stateClass(state: FileState | null): string {
    if (!state) return ''
    return `state-${state}`
  }

  function assetIcon(mime?: MimeCategory): string {
    switch (mime) {
      case 'image':
        return 'image'
      case 'pdf':
        return 'picture_as_pdf'
      case 'video':
        return 'videocam'
      case 'audio':
        return 'audiotrack'
      default:
        return 'attach_file'
    }
  }

  function fileIcon(name: string): string {
    // Asset files use mime-specific icons
    if (node.isAsset) return assetIcon(node.mimeCategory)
    if (name.endsWith('.md') || name.endsWith('.markdown')) return 'description'
    if (name.endsWith('.json')) return 'data_object'
    if (name.endsWith('.yaml') || name.endsWith('.yml')) return 'settings'
    return 'insert_drive_file'
  }
</script>

<div
  id={itemId}
  class="tree-node"
  data-tree-node={node.path}
  role="treeitem"
  aria-label={node.name}
  aria-level={depth + 1}
  aria-expanded={node.is_dir ? isExpanded : undefined}
  aria-selected={isSelected}
>
  {#if isRenaming}
    <div class="tree-row renaming" style="padding-left: {12 + depth * 16}px;">
      {#if node.is_dir}
        <span class="material-symbols-outlined expand-icon" class:expanded={isExpanded}>
          chevron_right
        </span>
        <span class="material-symbols-outlined node-icon">
          {isExpanded ? 'folder_open' : 'folder'}
        </span>
      {:else}
        <span class="expand-spacer"></span>
        <span
          class="material-symbols-outlined node-icon"
          class:file-icon={!node.isAsset}
          class:asset-icon={node.isAsset}
        >
          {fileIcon(node.name)}
        </span>
      {/if}
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="rename-input"
        class:has-error={!!renameError}
        type="text"
        bind:value={renameDraft}
        onkeydown={handleRenameKeydown}
        onblur={() => onrenamecommit?.(renameDraft)}
        autofocus
        aria-label="Rename {node.name}"
      />
      {#if renameError}
        <span class="material-symbols-outlined rename-error-icon" title={renameError}>error</span>
      {/if}
    </div>
  {:else}
    <button
      bind:this={buttonElement}
      class="tree-row"
      class:active={isSelected}
      class:focused={isFocused}
      class:directory={node.is_dir}
      style="padding-left: {12 + depth * 16}px;"
      draggable={!node.is_dir}
      tabindex="-1"
      onclick={handleClick}
      onfocus={() => onnf?.(node.path)}
      ondblclick={handleDblClick}
      oncontextmenu={handleContextMenu}
      ondragstart={handleDragStart}
      title={node.path}
    >
      {#if node.is_dir}
        <span class="material-symbols-outlined expand-icon" class:expanded={isExpanded}>
          chevron_right
        </span>
        <span class="material-symbols-outlined node-icon">
          {isExpanded ? 'folder_open' : 'folder'}
        </span>
      {:else}
        <span class="expand-spacer"></span>
        <span
          class="material-symbols-outlined node-icon"
          class:file-icon={!node.isAsset}
          class:asset-icon={node.isAsset}
        >
          {fileIcon(node.name)}
        </span>
      {/if}

      <span class="node-name">{node.name}</span>

      {#if !node.is_dir && !node.isAsset && node.state}
        <span
          class="material-symbols-outlined state-indicator {stateClass(node.state)}"
          title={node.state}
        >
          {stateIcon(node.state)}
        </span>
      {/if}
    </button>
  {/if}

  {#if node.is_dir}
    <button
      class="table-action"
      title="Open as table"
      aria-label="Open {node.name} as table"
      tabindex="-1"
      onclick={handleOpenAsTable}
    >
      <span class="material-symbols-outlined">table</span>
    </button>
  {/if}

  {#if !noRecursiveRender && node.is_dir && isExpanded}
    <div class="tree-children" role="group" transition:slide={{ duration: 150 }}>
      {#each node.children as child (child.path)}
        <Self
          node={child}
          depth={depth + 1}
          {onfileselect}
          {onassetselect}
          oncontextmenu={onctx}
          onfolderclick={onfc}
          onfolderopen={onfo}
          onnodefocus={onnf}
          {focusedPath}
          {currentSelectedFilePath}
          {currentExpandedPaths}
          {renamingPath}
          {renameInitial}
          {renameError}
          {onrenamecommit}
          {onrenamecancel}
        />
      {/each}
    </div>
  {/if}
</div>

<style>
  .tree-node {
    user-select: none;
    position: relative;
  }

  /* Trailing "open as table" affordance for directory rows (hover-revealed). */
  .table-action {
    position: absolute;
    top: 0;
    right: 4px;
    height: 28px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    border: none;
    background: transparent;
    color: var(--color-text-dim);
    cursor: pointer;
    opacity: 0;
    border-radius: var(--radius-sm);
    transition: opacity var(--transition-fast);
  }

  .tree-node:hover > .table-action {
    opacity: 1;
  }

  .table-action:hover {
    color: var(--color-primary);
    background: var(--color-surface-elevated);
  }

  .table-action:focus-visible {
    opacity: 1;
    outline: 1px solid var(--color-primary);
  }

  .table-action .material-symbols-outlined {
    font-size: 16px;
  }

  @media (prefers-reduced-motion: reduce) {
    .table-action {
      transition: none;
    }
  }

  .tree-row {
    display: flex;
    align-items: center;
    width: 100%;
    height: 28px;
    border: none;
    background: none;
    color: var(--color-text-muted, #a1a1aa);
    font-size: 13px;
    cursor: pointer;
    gap: 4px;
    padding-right: 8px;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
  }

  .tree-row:hover {
    background: var(--overlay-hover, rgba(255, 255, 255, 0.05));
    color: var(--color-text, #fafafa);
  }

  .tree-row.active {
    background: var(--color-primary-dim, rgba(0, 229, 255, 0.1));
    color: var(--color-primary, #00e5ff);
  }

  .tree-row.focused {
    outline: 1px solid var(--color-primary, #00e5ff);
    outline-offset: -1px;
    background: var(--overlay-hover, rgba(255, 255, 255, 0.05));
    color: var(--color-text, #fafafa);
  }

  .tree-row.active.focused {
    background: var(--color-primary-dim, rgba(0, 229, 255, 0.1));
    color: var(--color-primary, #00e5ff);
  }

  .tree-row.directory {
    color: var(--color-text, #fafafa);
  }

  .expand-icon {
    font-size: 16px;
    width: 16px;
    height: 16px;
    transition: transform 0.15s ease;
    flex-shrink: 0;
  }

  .expand-icon.expanded {
    transform: rotate(90deg);
  }

  .expand-spacer {
    width: 16px;
    flex-shrink: 0;
  }

  .node-icon {
    font-size: 16px;
    width: 16px;
    height: 16px;
    flex-shrink: 0;
  }

  .file-icon {
    opacity: 0.7;
  }

  .asset-icon {
    opacity: 0.5;
    color: var(--color-text-dim, #71717a);
  }

  .node-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tree-row.renaming {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
  }

  .rename-input {
    flex: 1;
    min-width: 0;
    background: var(--color-surface-darker, #0a0a0a);
    border: 1px solid var(--color-primary, #00e5ff);
    border-radius: 4px;
    color: var(--color-text, #e4e4e7);
    font: inherit;
    font-size: 13px;
    padding: 1px 6px;
    outline: none;
  }

  .rename-input.has-error {
    border-color: var(--color-error, #ef4444);
  }

  .rename-error-icon {
    font-size: 14px;
    color: var(--color-error, #ef4444);
    flex-shrink: 0;
  }

  .state-indicator {
    font-size: 14px;
    width: 14px;
    height: 14px;
    flex-shrink: 0;
    margin-left: auto;
  }

  .state-indexed {
    color: var(--color-success, #22c55e);
  }

  .state-modified {
    color: var(--color-warning, #eab308);
  }

  .state-new {
    color: var(--color-info, #3b82f6);
  }

  .state-deleted {
    color: var(--color-error, #ef4444);
  }

  .tree-children {
    /* No extra styling needed; depth is handled via padding */
  }

  @media (prefers-reduced-motion: reduce) {
    .expand-icon {
      transition: none;
    }
  }
</style>
