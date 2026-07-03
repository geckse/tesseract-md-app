<script lang="ts">
  import { activeCollection } from '../../stores/collections'
  import { workspace, type TableTab } from '../../stores/workspace.svelte'
  import { tableStore } from '../../stores/table.svelte'
  import { tableViewsStore } from '../../stores/table-views.svelte'
  import { focusTrap } from '../../lib/focus-trap'
  import Button from '../ui/Button.svelte'
  import IconButton from '../ui/IconButton.svelte'
  import type { SavedTableView } from '../../../preload/api'

  interface Props {
    tabId: string
    onclose: () => void
  }
  let { tabId, onclose }: Props = $props()

  let name = $state('')
  let saving = $state(false)
  let error = $state<string | null>(null)

  const tab = $derived(
    (() => {
      const t = workspace.tabs[tabId]
      return t && t.kind === 'table' ? (t as TableTab) : null
    })()
  )
  const collectionId = $derived($activeCollection?.id ?? null)
  const folderPath = $derived(tab?.folderPath ?? '')
  const views = $derived(collectionId ? tableViewsStore.getViews(collectionId, folderPath) : [])

  async function save(): Promise<void> {
    if (!collectionId || !tab) return
    const trimmed = name.trim()
    if (trimmed === '') {
      error = 'Please enter a name'
      return
    }
    saving = true
    error = null
    try {
      const now = Date.now()
      const view: SavedTableView = {
        id: crypto.randomUUID(),
        name: trimmed,
        version: 1,
        config: tableStore.mergedConfig(tabId),
        recursive: tab.recursive,
        isDefault: false,
        createdAt: now,
        updatedAt: now
      }
      await tableViewsStore.save(collectionId, folderPath, view)
      workspace.setTableActiveView(tabId, view.id)
      onclose()
    } catch (e) {
      error = e instanceof Error ? e.message : String(e)
    } finally {
      saving = false
    }
  }

  async function remove(view: SavedTableView): Promise<void> {
    if (!collectionId) return
    await tableViewsStore.remove(collectionId, folderPath, view.id)
    if (tab?.activeViewId === view.id) workspace.setTableActiveView(tabId, null)
  }

  async function makeDefault(view: SavedTableView): Promise<void> {
    if (!collectionId) return
    await tableViewsStore.setDefault(collectionId, folderPath, view.id)
  }

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape') onclose()
  }

  function onNameKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !saving) {
      e.preventDefault()
      void save()
    }
  }
</script>

<div
  class="modal-overlay"
  role="dialog"
  aria-modal="true"
  aria-label="Save table view"
  tabindex="-1"
  onkeydown={onKeydown}
>
  <button class="overlay-backdrop" aria-label="Close" onclick={onclose}></button>
  <div class="modal" use:focusTrap>
    <h2 class="modal-title">Save view</h2>

    <div class="field">
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="name-input"
        type="text"
        placeholder="View name"
        bind:value={name}
        autofocus
        aria-label="View name"
        onkeydown={onNameKeydown}
      />
      <Button size="sm" disabled={saving} onclick={() => void save()}>Save</Button>
    </div>
    {#if error}
      <p class="error" role="alert">{error}</p>
    {/if}

    {#if views.length > 0}
      <div class="existing">
        <h3 class="section-title">Saved views</h3>
        {#each views as v (v.id)}
          <div class="view-row">
            {#if v.isDefault}
              <span class="material-symbols-outlined default-star" title="Default view">star</span>
            {/if}
            <span class="view-name">{v.name}</span>
            <span class="view-actions">
              <IconButton
                icon="star"
                title="Make default"
                size="sm"
                disabled={v.isDefault}
                onclick={() => void makeDefault(v)}
              />
              <IconButton
                icon="delete"
                title="Delete view"
                size="sm"
                onclick={() => void remove(v)}
              />
            </span>
          </div>
        {/each}
      </div>
    {/if}

    <div class="modal-actions">
      <Button variant="secondary" size="sm" onclick={onclose}>Close</Button>
    </div>
  </div>
</div>

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    z-index: var(--z-overlay, 40);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .overlay-backdrop {
    position: absolute;
    inset: 0;
    background: var(--overlay-scrim);
    border: none;
    cursor: default;
    animation: backdrop-in 120ms ease-out;
  }

  .modal {
    position: relative;
    z-index: 1;
    width: 380px;
    max-width: 90vw;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg, 8px);
    padding: var(--space-4, 16px);
    box-shadow: var(--shadow-modal, 0 12px 40px rgba(0, 0, 0, 0.5));
    animation: modal-in 150ms ease-out;
  }

  @keyframes backdrop-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @keyframes modal-in {
    from {
      opacity: 0;
      transform: scale(0.97);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  .modal-title {
    margin: 0 0 var(--space-3, 12px);
    font-size: var(--text-lg, 1.125rem);
    color: var(--color-text);
  }

  .field {
    display: flex;
    gap: var(--space-2, 8px);
  }

  .name-input {
    flex: 1;
    min-width: 0;
    background: var(--color-surface-elevated);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm, 4px);
    padding: 6px 8px;
    color: var(--color-text);
    font-size: var(--text-base, 0.875rem);
    transition:
      border-color var(--transition-fast, 150ms ease),
      box-shadow var(--transition-fast, 150ms ease);
  }

  .name-input:focus {
    outline: none;
    border-color: var(--color-primary);
    box-shadow: 0 0 0 2px var(--color-primary-dim);
  }

  .error {
    color: var(--color-error);
    font-size: var(--text-sm, 0.75rem);
    margin: var(--space-2, 8px) 0 0;
  }

  .existing {
    margin-top: var(--space-4, 16px);
  }

  .section-title {
    font-size: var(--text-sm, 0.75rem);
    color: var(--color-text-dim);
    margin: 0 0 var(--space-2, 8px);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .view-row {
    display: flex;
    align-items: center;
    gap: var(--space-2, 8px);
    padding: 2px var(--space-1, 4px);
    border-radius: var(--radius-sm, 4px);
    transition: background var(--transition-fast, 150ms ease);
  }

  .view-row:hover {
    background: var(--overlay-hover);
  }

  .default-star {
    font-size: 14px;
    color: var(--color-primary);
    flex-shrink: 0;
  }

  .view-name {
    flex: 1;
    color: var(--color-text);
    font-size: var(--text-sm, 0.75rem);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .view-actions {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    opacity: 0;
    transition: opacity var(--transition-fast, 150ms ease);
  }

  .view-row:hover .view-actions,
  .view-actions:focus-within {
    opacity: 1;
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    margin-top: var(--space-4, 16px);
  }

  @media (prefers-reduced-motion: reduce) {
    .overlay-backdrop,
    .modal {
      animation: none;
    }
    .name-input,
    .view-row,
    .view-actions {
      transition: none;
    }
  }
</style>
