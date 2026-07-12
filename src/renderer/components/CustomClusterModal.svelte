<script lang="ts">
  import type { TopicDef } from '../types/cli'

  interface Props {
    existingDef: TopicDef | null
    existingNames: string[]
    onsave: (def: TopicDef) => void
    onclose: () => void
  }

  let { existingDef, existingNames, onsave, onclose }: Props = $props()

  // Intentional capture-on-open: the form is initialized from the prop and stays locally editable.
  // svelte-ignore state_referenced_locally
  let name = $state(existingDef?.name ?? '')
  // svelte-ignore state_referenced_locally
  let seedsText = $state(existingDef?.seeds.join(', ') ?? '')
  // svelte-ignore state_referenced_locally
  let description = $state(existingDef?.description ?? '')
  // svelte-ignore state_referenced_locally
  let thresholdEnabled = $state(existingDef?.threshold != null)
  // svelte-ignore state_referenced_locally
  let threshold = $state(existingDef?.threshold ?? 0.3)
  let error = $state('')

  let isEditing = $derived(existingDef !== null)

  function parseSeeds(): string[] {
    return seedsText
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  }

  function validate(): string {
    const trimmedName = name.trim()
    if (!trimmedName) return 'Name is required.'
    if (trimmedName.includes(':') || trimmedName.includes('|'))
      return 'Name cannot contain ":" or "|".'
    if (existingNames.includes(trimmedName)) return `A topic named "${trimmedName}" already exists.`

    const seeds = parseSeeds()
    if (seeds.length === 0 && description.trim().length === 0)
      return 'Provide at least one seed phrase or a description.'
    if (seeds.some((s) => s.includes('|'))) return 'Seed phrases cannot contain "|".'

    if (thresholdEnabled && (threshold < 0.05 || threshold > 0.95))
      return 'Threshold must be between 0.05 and 0.95.'

    return ''
  }

  function handleSave() {
    const msg = validate()
    if (msg) {
      error = msg
      return
    }

    onsave({
      name: name.trim(),
      seeds: parseSeeds(),
      description: description.trim() ? description.trim() : null,
      threshold: thresholdEnabled ? threshold : null
    })
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
    aria-label={isEditing ? 'Edit Topic' : 'Add Topic'}
  >
    <div class="modal-header">
      <span class="material-symbols-outlined modal-icon">category</span>
      <h2 class="modal-title">{isEditing ? 'Edit Topic' : 'Add Topic'}</h2>
      <button class="modal-close" onclick={onclose} title="Close">
        <span class="material-symbols-outlined">close</span>
      </button>
    </div>

    <div class="modal-body">
      <label class="field-label" for="topic-name-input">Name</label>
      <!-- svelte-ignore a11y_autofocus -->
      <input
        id="topic-name-input"
        class="field-input"
        type="text"
        bind:value={name}
        placeholder="e.g. AI Research"
        autofocus
      />

      <label class="field-label" style="margin-top: 12px;" for="topic-description-input"
        >Description</label
      >
      <textarea
        id="topic-description-input"
        class="field-textarea"
        bind:value={description}
        placeholder="Optional — a sentence describing this topic improves matching accuracy"
        rows="2"
      ></textarea>

      <label class="field-label" style="margin-top: 12px;" for="topic-seeds-input"
        >Seed phrases (comma-separated)</label
      >
      <textarea
        id="topic-seeds-input"
        class="field-textarea"
        bind:value={seedsText}
        placeholder="e.g. machine learning, neural networks, deep learning"
        rows="3"
      ></textarea>

      <p class="field-hint">
        Documents are assigned to this topic by semantic similarity to the description and seed
        phrases. Provide at least one of the two.
      </p>

      <label class="threshold-toggle" style="margin-top: 12px;">
        <input type="checkbox" bind:checked={thresholdEnabled} />
        Custom similarity threshold
      </label>
      {#if thresholdEnabled}
        <div class="threshold-row">
          <input
            class="threshold-slider"
            type="range"
            min="0.05"
            max="0.95"
            step="0.05"
            bind:value={threshold}
            aria-label="Similarity threshold"
          />
          <span class="threshold-value">{Number(threshold).toFixed(2)}</span>
        </div>
        <p class="field-hint">
          Documents below this similarity are not assigned to this topic. Unchecked = the global
          floor applies.
        </p>
      {/if}

      {#if error}
        <p class="field-error">{error}</p>
      {/if}
    </div>

    <div class="modal-footer">
      <button class="btn btn-secondary" onclick={onclose}>Cancel</button>
      <button class="btn btn-primary" onclick={handleSave}>
        {isEditing ? 'Save Changes' : 'Add Topic'}
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
    color: var(--color-text);
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
    color: var(--color-text);
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
    color: var(--color-text);
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
    color: var(--color-text);
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

  .threshold-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: var(--color-text);
    cursor: pointer;
  }

  .threshold-toggle input[type='checkbox'] {
    accent-color: var(--color-primary);
  }

  .threshold-row {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 8px;
  }

  .threshold-slider {
    flex: 1;
    -webkit-appearance: none;
    appearance: none;
    height: 4px;
    background: var(--color-border);
    border-radius: 2px;
    outline: none;
    cursor: pointer;
  }

  .threshold-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--color-primary);
    cursor: pointer;
    border: none;
  }

  .threshold-value {
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: 12px;
    color: var(--color-text);
    min-width: 36px;
    text-align: right;
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
    color: var(--color-text);
    border: 1px solid var(--color-border);
  }

  .btn-secondary:hover {
    background: var(--color-border);
  }
</style>
