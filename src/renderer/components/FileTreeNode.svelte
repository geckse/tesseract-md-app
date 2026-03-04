<script lang="ts">
  import { slide } from 'svelte/transition'
  import type { FileTreeNode, FileState } from '../types/cli'
  import { selectedFilePath, expandedPaths, toggleExpanded, selectFile } from '../stores/files'

  interface FileTreeNodeProps {
    node: FileTreeNode
    depth?: number
    onfileselect?: (detail: { path: string }) => void
    oncontextmenu?: (detail: { path: string; isDir: boolean; x: number; y: number }) => void
    focusedPath?: string
  }

  let { node, depth = 0, onfileselect, oncontextmenu: onctx, focusedPath }: FileTreeNodeProps = $props()

  let buttonElement: HTMLButtonElement | null = $state(null)

  function handleContextMenu(event: MouseEvent) {
    event.preventDefault()
    onctx?.({ path: node.path, isDir: node.is_dir, x: event.clientX, y: event.clientY })
  }

  // Reactive subscriptions
  let currentSelectedFilePath: string | null = $state(null)
  let currentExpandedPaths: Set<string> = $state(new Set())

  selectedFilePath.subscribe((v) => (currentSelectedFilePath = v))
  expandedPaths.subscribe((v) => (currentExpandedPaths = v))

  let isExpanded = $derived(currentExpandedPaths.has(node.path))
  let isSelected = $derived(!node.is_dir && currentSelectedFilePath === node.path)
  let isFocused = $derived(focusedPath === node.path)

  function handleClick() {
    if (node.is_dir) {
      toggleExpanded(node.path)
    } else {
      selectFile(node.path)
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

  function fileIcon(name: string): string {
    if (name.endsWith('.md') || name.endsWith('.markdown')) return 'description'
    if (name.endsWith('.json')) return 'data_object'
    if (name.endsWith('.yaml') || name.endsWith('.yml')) return 'settings'
    return 'insert_drive_file'
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="tree-node">
  <button
    bind:this={buttonElement}
    class="tree-row"
    class:active={isSelected}
    class:focused={isFocused}
    class:directory={node.is_dir}
    style="padding-left: {12 + depth * 16}px;"
    onclick={handleClick}
    oncontextmenu={handleContextMenu}
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
      <span class="material-symbols-outlined node-icon file-icon">
        {fileIcon(node.name)}
      </span>
    {/if}

    <span class="node-name">{node.name}</span>

    {#if !node.is_dir && node.state}
      <span class="material-symbols-outlined state-indicator {stateClass(node.state)}" title={node.state}>
        {stateIcon(node.state)}
      </span>
    {/if}
  </button>

  {#if node.is_dir && isExpanded}
    <div class="tree-children" transition:slide={{ duration: 150 }}>
      {#each node.children as child (child.path)}
        <svelte:self node={child} depth={depth + 1} {onfileselect} oncontextmenu={onctx} {focusedPath} />
      {/each}
    </div>
  {/if}
</div>

<style>
  .tree-node {
    user-select: none;
  }

  .tree-row {
    display: flex;
    align-items: center;
    width: 100%;
    height: 28px;
    border: none;
    background: none;
    color: var(--color-text-secondary, #a1a1aa);
    font-size: 13px;
    cursor: pointer;
    gap: 4px;
    padding-right: 8px;
    text-align: left;
    white-space: nowrap;
    overflow: hidden;
  }

  .tree-row:hover {
    background: var(--color-surface-hover, rgba(255, 255, 255, 0.05));
    color: var(--color-text, #fafafa);
  }

  .tree-row.active {
    background: var(--color-primary-alpha, rgba(0, 229, 255, 0.1));
    color: var(--color-primary, #00E5FF);
  }

  .tree-row.focused {
    outline: 2px solid var(--color-primary, #00E5FF);
    outline-offset: -2px;
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

  .node-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
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
</style>
