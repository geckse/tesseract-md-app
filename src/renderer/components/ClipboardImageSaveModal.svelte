<script lang="ts">
  import { focusTrap } from '../lib/focus-trap'
  import {
    imageRelativePath,
    nextAvailableImageStem,
    normalizeImageDirectory,
    validateImageDirectory,
    validateImageStem,
    type ClipboardImageDestination
  } from '../lib/clipboard-image'
  import { collectionDirectories, flatAssetList } from '../stores/files'

  interface Props {
    baseStem: string
    extension: string
    initialDirectory: string
    onsave: (destination: ClipboardImageDestination) => Promise<void>
    oncancel: () => void
  }

  let { baseStem, extension, initialDirectory, onsave, oncancel }: Props = $props()

  let directory = $state('')
  let stem = $state('')
  let stemEdited = $state(false)
  let saving = $state(false)
  let error = $state<string | null>(null)
  let initialized = false

  const existingPaths = $derived($flatAssetList.map((asset) => asset.path))
  const normalizedDirectory = $derived(normalizeImageDirectory(directory))
  const relativePath = $derived(imageRelativePath(normalizedDirectory, stem, extension))

  $effect(() => {
    if (!initialized) {
      initialized = true
      directory = initialDirectory
    }
    if (!stemEdited) {
      stem = nextAvailableImageStem(baseStem, extension, normalizedDirectory, existingPaths)
    }
  })

  function handleStemInput(): void {
    stemEdited = true
    error = null
  }

  function close(): void {
    if (!saving) oncancel()
  }

  async function handleSubmit(event?: SubmitEvent): Promise<void> {
    event?.preventDefault()
    if (saving) return

    const folderError = validateImageDirectory(directory)
    const filenameError = validateImageStem(stem, extension)
    if (folderError || filenameError) {
      error = folderError ?? filenameError
      return
    }

    const destinationPath = imageRelativePath(normalizedDirectory, stem, extension)
    if (existingPaths.some((path) => path.toLowerCase() === destinationPath.toLowerCase())) {
      error = 'A file with this name already exists in that folder.'
      return
    }

    saving = true
    error = null
    try {
      await onsave({
        directory: normalizedDirectory,
        filename: `${stem.trim()}.${extension}`,
        relativePath: destinationPath,
        stem: stem.trim()
      })
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      error = /EEXIST|already exists/i.test(message)
        ? 'A file with this name already exists in that folder.'
        : message
      saving = false
    }
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      close()
    }
  }

  function handleBackdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) close()
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="modal-overlay" onclick={handleBackdropClick} onkeydown={handleKeydown}>
  <div
    class="modal"
    role="dialog"
    aria-modal="true"
    aria-labelledby="clipboard-image-title"
    aria-describedby="clipboard-image-description"
    use:focusTrap
  >
    <form onsubmit={handleSubmit}>
      <header class="modal-header">
        <span class="material-symbols-outlined" aria-hidden="true">add_photo_alternate</span>
        <div>
          <h2 id="clipboard-image-title">Save pasted image</h2>
          <p id="clipboard-image-description">Choose where this image belongs in the collection.</p>
        </div>
        <button type="button" class="icon-button" aria-label="Cancel image paste" onclick={close}>
          <span class="material-symbols-outlined" aria-hidden="true">close</span>
        </button>
      </header>

      <div class="modal-body">
        <div class="field">
          <label class="field-label" for="clipboard-image-filename">Filename</label>
          <span class="filename-control">
            <input
              id="clipboard-image-filename"
              bind:value={stem}
              data-autofocus
              type="text"
              maxlength="180"
              autocomplete="off"
              spellcheck="false"
              oninput={handleStemInput}
            />
            <span class="extension">.{extension}</span>
          </span>
        </div>

        <div class="field">
          <label class="field-label" for="clipboard-image-folder">Collection folder</label>
          <input
            id="clipboard-image-folder"
            bind:value={directory}
            list="clipboard-image-directories"
            type="text"
            autocomplete="off"
            spellcheck="false"
            placeholder="/ (collection root)"
            oninput={() => (error = null)}
          />
          <datalist id="clipboard-image-directories">
            {#each $collectionDirectories as folder}
              {#if folder}
                <option value={folder}></option>
              {/if}
            {/each}
          </datalist>
          <span class="field-hint">Choose an existing folder or type a new relative path.</span>
        </div>

        <div class="destination-preview">
          <span class="material-symbols-outlined" aria-hidden="true">folder</span>
          <code>/{relativePath}</code>
        </div>

        {#if error}
          <p class="error-message" role="alert">{error}</p>
        {/if}
      </div>

      <footer class="modal-footer">
        <button type="button" class="button secondary" disabled={saving} onclick={close}
          >Cancel</button
        >
        <button type="submit" class="button primary" disabled={saving || !stem.trim()}>
          {saving ? 'Saving…' : 'Save and Insert'}
        </button>
      </footer>
    </form>
  </div>
</div>

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    z-index: 250;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.68);
  }

  .modal {
    width: min(460px, calc(100vw - 32px));
    overflow: hidden;
    border: 1px solid var(--color-border);
    border-radius: 12px;
    background: var(--color-surface);
    box-shadow: var(--shadow-modal, 0 16px 48px rgba(0, 0, 0, 0.55));
    animation: modal-in 150ms ease-out;
  }

  .modal-header {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 12px;
    align-items: start;
    padding: 18px 20px 14px;
    border-bottom: 1px solid var(--color-border);
  }

  .modal-header > .material-symbols-outlined {
    color: var(--color-primary);
  }

  h2,
  p {
    margin: 0;
  }

  h2 {
    color: var(--color-text-main);
    font-size: 15px;
    font-weight: 600;
  }

  .modal-header p {
    margin-top: 3px;
    color: var(--color-text-dim);
    font-size: 12px;
  }

  .icon-button {
    display: grid;
    width: 28px;
    height: 28px;
    padding: 0;
    place-items: center;
    border: 0;
    border-radius: 6px;
    color: var(--color-text-dim);
    background: transparent;
    cursor: pointer;
  }

  .icon-button:hover,
  .icon-button:focus-visible {
    color: var(--color-text-main);
    background: var(--color-surface-dark);
    outline: 1px solid var(--color-primary);
  }

  .icon-button .material-symbols-outlined {
    font-size: 19px;
  }

  .modal-body {
    display: flex;
    flex-direction: column;
    gap: 15px;
    padding: 18px 20px;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .field-label {
    color: var(--color-text-dim);
    font-size: 12px;
    font-weight: 500;
  }

  .filename-control {
    display: flex;
    align-items: center;
    overflow: hidden;
    border: 1px solid var(--color-border);
    border-radius: 7px;
    background: var(--color-surface-dark);
  }

  input {
    width: 100%;
    min-width: 0;
    padding: 9px 10px;
    border: 1px solid var(--color-border);
    border-radius: 7px;
    outline: none;
    color: var(--color-text-main);
    background: var(--color-surface-dark);
    font-family: var(--font-mono);
    font-size: 13px;
  }

  .filename-control input {
    border: 0;
    border-radius: 0;
  }

  input:focus,
  .filename-control:focus-within {
    border-color: var(--color-primary);
  }

  .extension {
    padding-right: 10px;
    color: var(--color-text-dim);
    font-family: var(--font-mono);
    font-size: 13px;
  }

  .field-hint {
    color: var(--color-text-dim);
    font-size: 11px;
  }

  .destination-preview {
    display: flex;
    gap: 8px;
    align-items: center;
    min-width: 0;
    padding: 9px 10px;
    border: 1px solid var(--color-border);
    border-radius: 7px;
    color: var(--color-text-dim);
    background: color-mix(in srgb, var(--color-surface-dark) 75%, transparent);
  }

  .destination-preview .material-symbols-outlined {
    flex: none;
    font-size: 17px;
  }

  .destination-preview code {
    overflow: hidden;
    color: var(--color-text-main);
    font-family: var(--font-mono);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .error-message {
    padding: 9px 10px;
    border: 1px solid color-mix(in srgb, var(--color-error, #ef4444) 30%, transparent);
    border-radius: 7px;
    color: var(--color-error, #ef4444);
    background: color-mix(in srgb, var(--color-error, #ef4444) 10%, transparent);
    font-size: 12px;
  }

  .modal-footer {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    padding: 13px 20px 17px;
    border-top: 1px solid var(--color-border);
  }

  .button {
    padding: 8px 15px;
    border: 1px solid transparent;
    border-radius: 7px;
    font-family: inherit;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
  }

  .button:focus-visible {
    outline: 2px solid var(--color-primary);
    outline-offset: 2px;
  }

  .button:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .secondary {
    border-color: var(--color-border);
    color: var(--color-text-main);
    background: var(--color-surface-dark);
  }

  .primary {
    color: #000;
    background: var(--color-primary);
  }

  @keyframes modal-in {
    from {
      opacity: 0;
      transform: translateY(5px) scale(0.99);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .modal {
      animation: none;
    }
  }
</style>
