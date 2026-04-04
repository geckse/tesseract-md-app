<script lang="ts">
  interface Props {
    filePath: string
    collectionPath: string
    onFileRenamed: (newPath: string) => void
  }

  let { filePath, collectionPath, onFileRenamed }: Props = $props()

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
    const invalidChars = /[<>:"|?*\x00-\x1f]/
    if (invalidChars.test(trimmed)) {
      error = 'Name contains invalid characters'
      return
    }

    const dir = getDir(filePath)
    const ext = getExt(filePath) || '.md'
    const newPath = dir ? `${dir}/${trimmed}${ext}` : `${trimmed}${ext}`

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
    if (e.key === 'Enter') { e.preventDefault(); confirmRename() }
    if (e.key === 'Escape') { e.preventDefault(); cancelEdit() }
  }
</script>

<div class="fne">
  <span class="material-symbols-outlined fne-icon">description</span>
  {#if isEditing}
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
    border: 1px solid var(--color-primary, #00E5FF);
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
    .fne-name { transition: none; }
  }
</style>
