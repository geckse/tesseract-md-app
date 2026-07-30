<script lang="ts">
  import { untrack } from 'svelte'
  import { collectionDirectories } from '../stores/files'
  import {
    addShardDefinition,
    nextShardId,
    normalizeShardDefinitionPath,
    normalizeShardPath,
    shardsByCollection,
    updateShardDefinition
  } from '../stores/shards'
  import { activeCollectionId } from '../stores/collections'
  import { focusTrap } from '../lib/focus-trap'
  import type { ShardInfo } from '../types/cli'
  import ShardIcon from './ShardIcon.svelte'

  interface Props {
    collectionId?: string
    shard?: ShardInfo | null
    initialPath?: string
    onclose: () => void
    onsaved?: (shardId: string) => void
  }

  let { collectionId, shard = null, initialPath = '', onclose, onsaved }: Props = $props()

  let directories: string[] = $state([])
  let currentCollectionId: string | null = $state(untrack(() => collectionId ?? null))
  let definitions: Record<string, ShardInfo[]> = $state({})
  collectionDirectories.subscribe((value) => (directories = value))
  activeCollectionId.subscribe((value) => {
    if (!collectionId) currentCollectionId = value
  })
  shardsByCollection.subscribe((value) => (definitions = value))

  const suggestedName = untrack(
    () => initialPath.split('/').filter(Boolean).pop()?.replace(/[-_]+/g, ' ') ?? ''
  )
  let name = $state(untrack(() => shard?.name ?? suggestedName))
  let folder = $state(untrack(() => shard?.path ?? initialPath))
  let createFolder = $state(false)
  let saving = $state(false)
  let error = $state<string | null>(null)
  let nameInput: HTMLInputElement | null = $state(null)

  let normalizedFolder = $derived(normalizeShardPath(folder))
  let folderExists = $derived(directories.includes(normalizedFolder))
  let existing = $derived(currentCollectionId ? (definitions[currentCollectionId] ?? []) : [])
  let generatedId = $derived(nextShardId(name, existing))
  let editing = $derived(!!shard)

  $effect(() => {
    if (nameInput) {
      nameInput.focus()
      nameInput.select()
    }
  })

  function validate(): string | null {
    if (!name.trim()) return 'Enter a Shard name.'
    try {
      normalizeShardDefinitionPath(folder)
    } catch (caught) {
      return caught instanceof Error ? caught.message : 'Choose a valid collection folder.'
    }
    if (!folderExists && !createFolder) {
      return 'That folder does not exist. Enable “Create folder” to add it.'
    }
    return null
  }

  async function save(): Promise<void> {
    const validation = validate()
    if (validation) {
      error = validation
      return
    }
    error = null
    saving = true
    try {
      const id = shard?.id ?? generatedId
      if (shard) {
        await updateShardDefinition(
          shard.id,
          name.trim(),
          normalizedFolder,
          createFolder,
          currentCollectionId ?? undefined
        )
      } else {
        await addShardDefinition(
          name.trim(),
          normalizedFolder,
          createFolder,
          currentCollectionId ?? undefined
        )
      }
      onsaved?.(id)
      onclose()
    } catch (caught) {
      error = caught instanceof Error ? caught.message : 'Unable to save the Shard.'
    } finally {
      saving = false
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') onclose()
    if (event.key === 'Enter' && !(event.target instanceof HTMLButtonElement)) {
      event.preventDefault()
      void save()
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="modal-backdrop" onclick={(event) => event.target === event.currentTarget && onclose()}>
  <div
    class="modal"
    role="dialog"
    aria-modal="true"
    aria-labelledby="shard-modal-title"
    tabindex="-1"
    use:focusTrap
    onkeydown={handleKeydown}
  >
    <header>
      <span class="modal-shard-icon"><ShardIcon size={22} /></span>
      <div>
        <h2 id="shard-modal-title">{editing ? 'Edit Shard' : 'Create Shard'}</h2>
        <p>
          A named sub-collection scoped to a folder and everything inside it. Files and the shared
          index stay untouched.
        </p>
      </div>
    </header>

    <div class="fields">
      <label>
        <span>Name</span>
        <input bind:this={nameInput} bind:value={name} autocomplete="off" spellcheck="false" />
      </label>

      <label>
        <span>Folder</span>
        <input
          bind:value={folder}
          list="shard-folder-options"
          placeholder="work/research"
          autocomplete="off"
          spellcheck="false"
        />
        <datalist id="shard-folder-options">
          {#each directories.filter(Boolean) as directory}
            <option value={directory}></option>
          {/each}
        </datalist>
        <small>Collection-relative path. Nested Shards are inferred from folder containment.</small>
      </label>

      {#if !folderExists && normalizedFolder}
        <label class="checkbox-row">
          <input type="checkbox" bind:checked={createFolder} />
          <span>Create folder <code>{normalizedFolder}</code></span>
        </label>
      {/if}

      <div class="id-row">
        <span>Stable ID</span>
        <code>{shard?.id ?? generatedId}</code>
        {#if shard}<small>IDs are immutable.</small>{/if}
      </div>

      {#if shard && !shard.exists}
        <div class="warning">
          <span class="material-symbols-outlined">warning</span>
          This Shard’s folder is missing. Choose an existing folder or create it.
        </div>
      {/if}

      {#if error}
        <div class="error" role="alert">{error}</div>
      {/if}
    </div>

    <footer>
      <button class="secondary" onclick={onclose} disabled={saving}>Cancel</button>
      <button class="primary" onclick={() => void save()} disabled={saving}>
        {saving ? 'Saving…' : editing ? 'Save Changes' : 'Create Shard'}
      </button>
    </footer>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: grid;
    place-items: center;
    background: rgba(0, 0, 0, 0.65);
  }

  .modal {
    width: min(460px, calc(100vw - 32px));
    overflow: hidden;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg, 10px);
    background: var(--color-surface);
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.55);
  }

  header {
    display: flex;
    gap: 12px;
    padding: 18px 20px 14px;
    border-bottom: 1px solid var(--color-border);
  }

  .modal-shard-icon {
    display: inline-flex;
    flex-shrink: 0;
    align-items: flex-start;
    color: var(--color-primary);
  }

  h2 {
    margin: 0;
    color: var(--color-text);
    font-size: 15px;
  }

  p {
    margin: 4px 0 0;
    color: var(--color-text-dim);
    font-size: 11px;
    line-height: 1.45;
  }

  .fields {
    display: grid;
    gap: 14px;
    padding: 18px 20px;
  }

  label {
    display: grid;
    gap: 5px;
    color: var(--color-text-muted);
    font-size: 12px;
    font-weight: 600;
  }

  input:not([type='checkbox']) {
    width: 100%;
    box-sizing: border-box;
    padding: 8px 10px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md, 6px);
    outline: none;
    background: var(--color-surface-dark);
    color: var(--color-text);
    font: 13px var(--font-mono);
  }

  input:focus {
    border-color: var(--color-primary);
  }

  small {
    color: var(--color-text-dim);
    font-size: 10px;
    font-weight: 400;
  }

  .checkbox-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-weight: 400;
  }

  code {
    color: var(--color-primary);
    font-family: var(--font-mono);
  }

  .id-row {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--color-text-dim);
    font-size: 11px;
  }

  .id-row small {
    margin-left: auto;
  }

  .warning,
  .error {
    padding: 9px 10px;
    border-radius: var(--radius-md, 6px);
    font-size: 11px;
    line-height: 1.4;
  }

  .warning {
    display: flex;
    gap: 8px;
    border: 1px solid color-mix(in srgb, var(--color-warning) 40%, transparent);
    color: var(--color-warning);
  }

  .warning .material-symbols-outlined {
    font-size: 16px;
  }

  .error {
    border: 1px solid color-mix(in srgb, var(--color-error) 40%, transparent);
    color: var(--color-error);
  }

  footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 20px 16px;
    border-top: 1px solid var(--color-border);
  }

  button {
    padding: 7px 14px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md, 6px);
    font: 600 12px var(--font-sans);
    cursor: pointer;
  }

  button:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
  }

  button:disabled {
    cursor: wait;
    opacity: 0.55;
  }

  .secondary {
    background: var(--color-surface-dark);
    color: var(--color-text-muted);
  }

  .primary {
    border-color: var(--color-primary);
    background: var(--color-primary);
    color: var(--color-surface-dark);
  }
</style>
