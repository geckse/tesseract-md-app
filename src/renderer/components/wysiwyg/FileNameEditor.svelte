<script lang="ts">
  import { workspace } from '../../stores/workspace.svelte'
  import { syncFileStoresFromTab } from '../../stores/files'

  interface Props {
    filePath: string
    collectionPath: string
    isUntitled?: boolean
    onFileRenamed: (newPath: string) => void
  }

  let { filePath, collectionPath, isUntitled = false, onFileRenamed }: Props = $props()

  let error = $state<string | null>(null)
  let isEditing = $state(false)
  let editValue = $state('')

  /** Extract just the filename without extension from a full path. */
  function getFileName(path: string): string {
    const parts = path.split('/')
    const name = parts[parts.length - 1] ?? ''
    return name.endsWith('.md') ? name.slice(0, -3) : name
  }

  /** Get the directory portion of the path. */
  function getDir(path: string): string {
    const lastSlash = path.lastIndexOf('/')
    return lastSlash >= 0 ? path.substring(0, lastSlash) : ''
  }

  /** Get the file extension. */
  function getExt(path: string): string {
    const name = path.split('/').pop() ?? ''
    const dot = name.lastIndexOf('.')
    return dot >= 0 ? name.substring(dot) : ''
  }

  let displayName = $derived(getFileName(filePath))

  /** Folder segments of the path, each with its cumulative path for navigation. */
  let breadcrumbSegments = $derived.by(() => {
    const dir = getDir(filePath)
    if (!dir) return []
    const parts = dir.split('/').filter(Boolean)
    return parts.map((name, i) => ({
      name,
      path: parts.slice(0, i + 1).join('/')
    }))
  })

  /** Open a breadcrumb folder as a database/table tab (same as opening it from the sidebar). */
  function openFolder(folderPath: string) {
    workspace.openTableTab(folderPath)
    syncFileStoresFromTab()
  }

  function startEdit() {
    editValue = displayName
    isEditing = true
    error = null
  }

  async function confirmRename() {
    isEditing = false
    const trimmed = editValue.trim()

    if (!trimmed || trimmed === displayName) {
      error = null
      return
    }

    // Validate
    if (trimmed.includes('/') || trimmed.includes('\\')) {
      error = 'Name cannot contain path separators'
      return
    }
    // eslint-disable-next-line no-control-regex
    const invalidChars = /[<>:"|?*\x00-\x1f]/
    if (invalidChars.test(trimmed)) {
      error = 'Name contains invalid characters'
      return
    }

    const dir = getDir(filePath)
    const ext = getExt(filePath) || '.md'
    const newPath = dir ? `${dir}/${trimmed}${ext}` : `${trimmed}${ext}`

    if (isUntitled) {
      // Untitled files don't exist on disk yet — just update the in-memory name
      error = null
      onFileRenamed(newPath)
      return
    }

    try {
      // Build absolute paths for the IPC call
      const oldAbs = collectionPath ? `${collectionPath}/${filePath}` : filePath
      const newAbs = collectionPath ? `${collectionPath}/${newPath}` : newPath
      await window.api.renameFile(oldAbs, newAbs)
      error = null
      onFileRenamed(newPath)
    } catch (e) {
      error = e instanceof Error ? e.message : 'Rename failed'
    }
  }

  function cancelEdit() {
    isEditing = false
    editValue = displayName
    error = null
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      confirmRename()
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      cancelEdit()
    }
  }
</script>

<div class="fne">
  <span class="material-symbols-outlined fne-icon">description</span>
  {#if breadcrumbSegments.length > 0}
    <nav class="fne-breadcrumb" aria-label="Folder path">
      {#each breadcrumbSegments as segment (segment.path)}
        <button
          class="fne-crumb"
          type="button"
          title="Open {segment.path} as table"
          onclick={() => openFolder(segment.path)}
        >
          {segment.name}
        </button>
        <span class="fne-crumb-sep" aria-hidden="true">/</span>
      {/each}
    </nav>
  {/if}
  {#if isEditing}
    <!-- svelte-ignore a11y_autofocus -->
    <input
      class="fne-input"
      type="text"
      bind:value={editValue}
      onblur={confirmRename}
      onkeydown={handleKeydown}
      autofocus
    />
    <span class="fne-ext">.md</span>
  {:else}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <span class="fne-name" role="button" tabindex="0" onclick={startEdit}>
      {displayName}
    </span>
    <span class="fne-ext">.md</span>
  {/if}
  {#if error}
    <span class="fne-error">{error}</span>
  {/if}
</div>

<style>
  .fne {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 0 8px;
    flex-wrap: wrap;
  }
  .fne-icon {
    font-size: 20px;
    color: var(--color-text-dim, #71717a);
    flex-shrink: 0;
  }
  .fne-breadcrumb {
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
    flex-shrink: 1;
    overflow: hidden;
  }
  .fne-crumb {
    font-family: var(--font-display, 'Space Grotesk'), sans-serif;
    font-size: 13px;
    font-weight: 500;
    color: var(--color-text-dim, #71717a);
    background: transparent;
    border: none;
    border-radius: 4px;
    padding: 2px 4px;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition:
      color 150ms ease,
      background 150ms ease;
  }
  .fne-crumb:hover {
    color: var(--color-text, #e4e4e7);
    background: var(--color-surface, #161617);
  }
  .fne-crumb-sep {
    font-size: 13px;
    color: var(--color-text-dim, #71717a);
    opacity: 0.6;
    user-select: none;
    flex-shrink: 0;
  }
  .fne-name {
    font-family: var(--font-display, 'Space Grotesk'), sans-serif;
    font-size: 20px;
    font-weight: 600;
    color: var(--color-text, #e4e4e7);
    cursor: text;
    padding: 2px 4px;
    border: 1px solid transparent;
    border-radius: 4px;
    transition: border-color 150ms ease;
  }
  .fne-name:hover {
    border-color: var(--color-border, #27272a);
  }
  .fne-input {
    font-family: var(--font-display, 'Space Grotesk'), sans-serif;
    font-size: 20px;
    font-weight: 600;
    color: var(--color-text, #e4e4e7);
    background: transparent;
    border: 1px solid var(--color-primary, #00e5ff);
    border-radius: 4px;
    padding: 2px 4px;
    outline: none;
    min-width: 100px;
  }
  .fne-ext {
    font-family: var(--font-mono, 'JetBrains Mono'), monospace;
    font-size: 14px;
    color: var(--color-text-dim, #71717a);
    user-select: none;
  }
  .fne-error {
    width: 100%;
    font-size: 11px;
    color: var(--color-error, #ef4444);
    padding: 0 0 0 28px;
  }
  @media (prefers-reduced-motion: reduce) {
    .fne-name {
      transition: none;
    }
    .fne-crumb {
      transition: none;
    }
  }
</style>
