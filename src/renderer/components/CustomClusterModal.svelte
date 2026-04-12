<script lang="ts">
  import type { CustomClusterDef } from '../types/cli'

  interface Props {
    existingDef: CustomClusterDef | null
    existingNames: string[]
    onsave: (def: CustomClusterDef) => void
    onclose: () => void
  }

  let { existingDef, existingNames, onsave, onclose }: Props = $props()

  let name = $state(existingDef?.name ?? '')
  let seedsText = $state(existingDef?.seeds.join(', ') ?? '')
  let error = $state('')

  let isEditing = $derived(existingDef !== null)

  function validate(): string {
    const trimmedName = name.trim()
    if (!trimmedName) return 'Name is required.'
    if (trimmedName.includes(':') || trimmedName.includes('|'))
      return 'Name cannot contain ":" or "|".'
    if (existingNames.includes(trimmedName))
      return `A cluster named "${trimmedName}" already exists.`

    const seeds = seedsText
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    if (seeds.length === 0) return 'At least one seed phrase is required.'
    if (seeds.some((s) => s.includes('|'))) return 'Seed phrases cannot contain "|".'

    return ''
  }

  function handleSave() {
    const msg = validate()
    if (msg) {
      error = msg
      return
    }

    const seeds = seedsText
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)

    onsave({ name: name.trim(), seeds })
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      onclose()
    }
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      onclose()
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-backdrop" onclick={handleBackdropClick}>
  <div
    class="modal-content"
    role="dialog"
    aria-modal="true"
    aria-label={isEditing ? 'Edit Custom Cluster' : 'Add Custom Cluster'}
  >
    <div class="modal-header">
      <span class="material-symbols-outlined modal-icon">category</span>
      <h2 class="modal-title">{isEditing ? 'Edit Custom Cluster' : 'Add Custom Cluster'}</h2>
      <button class="modal-close" onclick={onclose} title="Close">
        <span class="material-symbols-outlined">close</span>
      </button>
    </div>

    <div class="modal-body">
      <label class="field-label">Name</label>
      <input
        class="field-input"
        type="text"
        bind:value={name}
        placeholder="e.g. AI Research"
        autofocus
      />

      <label class="field-label" style="margin-top: 12px;">Seed phrases (comma-separated)</label>
      <textarea
        class="field-textarea"
        bind:value={seedsText}
        placeholder="e.g. machine learning, neural networks, deep learning"
        rows="3"
      ></textarea>

      <p class="field-hint">
        Describe what this cluster is about. Documents will be assigned by semantic similarity to
        these phrases.
      </p>

      {#if error}
        <p class="field-error">{error}</p>
      {/if}
    </div>

    <div class="modal-footer">
      <button class="btn btn-secondary" onclick={onclose}>Cancel</button>
      <button class="btn btn-primary" onclick={handleSave}>
        {isEditing ? 'Save Changes' : 'Add Cluster'}
      </button>
    </div>
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: var(--z-overlay, 40);
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 32px;
  }

  .modal-content {
    background: var(--color-bg);
    border: 1px solid var(--color-border);
    border-radius: 12px;
    width: 440px;
    max-width: 100%;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    display: flex;
    flex-direction: column;
  }

  .modal-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 16px 20px;
    border-bottom: 1px solid var(--color-border);
  }

  .modal-icon {
    font-size: 20px;
    color: var(--color-primary);
  }

  .modal-title {
    flex: 1;
    font-size: 15px;
    font-weight: 600;
    color: var(--color-text-main);
    margin: 0;
  }

  .modal-close {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--color-text-dim);
    padding: 4px;
    border-radius: 4px;
    display: flex;
  }

  .modal-close:hover {
    color: var(--color-text-main);
    background: var(--color-surface);
  }

  .modal-body {
    padding: 16px 20px;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 20px;
    border-top: 1px solid var(--color-border);
  }

  .field-label {
    display: block;
    font-size: 12px;
    font-weight: 500;
    color: var(--color-text-dim);
    margin-bottom: 4px;
  }

  .field-input {
    width: 100%;
    padding: 8px 10px;
    font-size: 13px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 6px;
    color: var(--color-text-main);
    outline: none;
    box-sizing: border-box;
  }

  .field-input:focus {
    border-color: var(--color-primary);
    box-shadow: 0 0 0 2px rgba(0, 229, 255, 0.15);
  }

  .field-textarea {
    width: 100%;
    padding: 8px 10px;
    font-size: 13px;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    border-radius: 6px;
    color: var(--color-text-main);
    outline: none;
    resize: vertical;
    font-family: inherit;
    box-sizing: border-box;
  }

  .field-textarea:focus {
    border-color: var(--color-primary);
    box-shadow: 0 0 0 2px rgba(0, 229, 255, 0.15);
  }

  .field-hint {
    font-size: 11px;
    color: var(--color-text-dim);
    margin-top: 8px;
    line-height: 1.4;
  }

  .field-error {
    font-size: 12px;
    color: #ef4444;
    margin-top: 8px;
  }

  .btn {
    padding: 6px 16px;
    font-size: 13px;
    border-radius: 6px;
    cursor: pointer;
    border: none;
    font-weight: 500;
  }

  .btn-primary {
    background: var(--color-primary);
    color: #000;
  }

  .btn-primary:hover {
    filter: brightness(1.1);
  }

  .btn-secondary {
    background: var(--color-surface);
    color: var(--color-text-main);
    border: 1px solid var(--color-border);
  }

  .btn-secondary:hover {
    background: var(--color-border);
  }
</style>
