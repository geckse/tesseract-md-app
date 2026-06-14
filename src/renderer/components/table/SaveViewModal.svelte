<script lang="ts">
  import { activeCollection } from '../../stores/collections'
  import { workspace, type TableTab } from '../../stores/workspace.svelte'
  import { tableStore } from '../../stores/table.svelte'
  import { tableViewsStore } from '../../stores/table-views.svelte'
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
    else if (e.key === 'Enter' && !saving) save()
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
  <div class="modal">
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
      />
      <button class="save-btn" disabled={saving} onclick={save}>Save</button>
    </div>
    {#if error}
      <p class="error" role="alert">{error}</p>
    {/if}

    {#if views.length > 0}
      <div class="existing">
        <h3 class="section-title">Saved views</h3>
        {#each views as v (v.id)}
          <div class="view-row">
            <span class="view-name">{v.name}{v.isDefault ? ' ★' : ''}</span>
            <button class="link" onclick={() => makeDefault(v)} disabled={v.isDefault}>
              Default
            </button>
            <button class="link danger" onclick={() => remove(v)}>Delete</button>
          </div>
        {/each}
      </div>
    {/if}

    <div class="modal-actions">
      <button class="close-btn" onclick={onclose}>Close</button>
    </div>
  </div>
</div>

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    z-index: var(--z-overlay);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .overlay-backdrop {
    position: absolute;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    border: none;
    cursor: default;
  }

  .modal {
    position: relative;
    z-index: 1;
    width: 380px;
    max-width: 90vw;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    padding: var(--space-4);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
  }

  .modal-title {
    margin: 0 0 var(--space-3);
    font-size: var(--text-lg);
    color: var(--color-text);
  }

  .field {
    display: flex;
    gap: var(--space-2);
  }

  .name-input {
    flex: 1;
    background: var(--color-surface-elevated);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    padding: 6px 8px;
    color: var(--color-text);
    font-size: var(--text-base);
  }

  .name-input:focus {
    outline: none;
    border-color: var(--color-primary);
    box-shadow: 0 0 0 2px var(--color-primary-dim);
  }

  .save-btn {
    background: var(--color-primary);
    color: var(--color-surface-dark);
    border: none;
    border-radius: var(--radius-sm);
    padding: 6px 14px;
    font-weight: var(--weight-medium);
    cursor: pointer;
  }

  .save-btn:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .error {
    color: var(--color-error);
    font-size: var(--text-sm);
    margin: var(--space-2) 0 0;
  }

  .existing {
    margin-top: var(--space-4);
  }

  .section-title {
    font-size: var(--text-sm);
    color: var(--color-text-dim);
    margin: 0 0 var(--space-2);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .view-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: 4px 0;
  }

  .view-name {
    flex: 1;
    color: var(--color-text);
    font-size: var(--text-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .link {
    background: none;
    border: none;
    color: var(--color-primary);
    cursor: pointer;
    font-size: var(--text-sm);
    padding: 2px 4px;
  }

  .link:disabled {
    color: var(--color-text-faint);
    cursor: default;
  }

  .link.danger {
    color: var(--color-error);
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    margin-top: var(--space-4);
  }

  .close-btn {
    background: var(--color-surface-elevated);
    color: var(--color-text);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    padding: 6px 14px;
    cursor: pointer;
  }
</style>
