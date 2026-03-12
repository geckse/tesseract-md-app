<script lang="ts">
  import { onMount } from 'svelte'
  import { computePosition, flip, shift, offset } from '@floating-ui/dom'

  interface Props {
    url: string
    text: string
    onUpdateLink: (url: string, text: string) => void
    onRemoveLink: () => void
    onClose: () => void
    anchorEl: Element
  }

  let { url, text, onUpdateLink, onRemoveLink, onClose, anchorEl }: Props = $props()

  let menuEl: HTMLDivElement | undefined = $state(undefined)
  let editing = $state(false)
  let editUrl = $state(url)
  let editText = $state(text)
  let urlInputEl: HTMLInputElement | undefined = $state(undefined)

  function startEdit() {
    editUrl = url
    editText = text
    editing = true
    requestAnimationFrame(() => urlInputEl?.focus())
  }

  function saveEdit() {
    if (editUrl.trim()) {
      onUpdateLink(editUrl.trim(), editText.trim() || editUrl.trim())
    }
    editing = false
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      saveEdit()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      if (editing) {
        editing = false
      } else {
        onClose()
      }
    }
  }

  function positionMenu() {
    if (!menuEl || !anchorEl) return

    computePosition(anchorEl, menuEl, {
      placement: 'bottom-start',
      middleware: [offset(6), flip(), shift({ padding: 8 })]
    }).then(({ x, y }) => {
      if (menuEl) {
        menuEl.style.left = `${x}px`
        menuEl.style.top = `${y}px`
      }
    })
  }

  onMount(() => {
    positionMenu()
  })
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="link-bubble"
  bind:this={menuEl}
  onkeydown={handleKeyDown}
>
  {#if editing}
    <div class="link-bubble-form">
      <label class="link-bubble-label">
        <span class="label-text">URL</span>
        <input
          bind:this={urlInputEl}
          bind:value={editUrl}
          class="link-bubble-input"
          type="text"
          placeholder="https://..."
          spellcheck="false"
        />
      </label>
      <label class="link-bubble-label">
        <span class="label-text">Text</span>
        <input
          bind:value={editText}
          class="link-bubble-input"
          type="text"
          placeholder="Link text"
          spellcheck="false"
        />
      </label>
      <div class="link-bubble-actions">
        <button class="link-bubble-btn save" onmousedown={(e) => { e.preventDefault(); saveEdit() }}>
          <span class="material-symbols-outlined">check</span>
          Save
        </button>
        <button class="link-bubble-btn" onmousedown={(e) => { e.preventDefault(); editing = false }}>
          Cancel
        </button>
      </div>
    </div>
  {:else}
    <div class="link-bubble-preview">
      <a
        class="link-bubble-url"
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        title={url}
      >{url.length > 50 ? url.slice(0, 50) + '...' : url}</a>
      <div class="link-bubble-btns">
        <button
          class="link-bubble-icon-btn"
          title="Edit link"
          onmousedown={(e) => { e.preventDefault(); startEdit() }}
        >
          <span class="material-symbols-outlined">edit</span>
        </button>
        <button
          class="link-bubble-icon-btn"
          title="Copy link"
          onmousedown={(e) => { e.preventDefault(); navigator.clipboard.writeText(url) }}
        >
          <span class="material-symbols-outlined">content_copy</span>
        </button>
        <button
          class="link-bubble-icon-btn remove"
          title="Remove link"
          onmousedown={(e) => { e.preventDefault(); onRemoveLink() }}
        >
          <span class="material-symbols-outlined">link_off</span>
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  .link-bubble {
    position: fixed;
    z-index: var(--z-overlay, 40);
    background: var(--color-surface, #161617);
    border: 1px solid var(--color-border, #27272a);
    border-radius: var(--radius-md, 6px);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
    padding: 8px;
    min-width: 240px;
    max-width: 400px;
  }

  .link-bubble-preview {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .link-bubble-url {
    flex: 1;
    min-width: 0;
    color: var(--color-primary, #00e5ff);
    font-size: 13px;
    text-decoration: none;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .link-bubble-url:hover {
    text-decoration: underline;
  }

  .link-bubble-btns {
    display: flex;
    gap: 2px;
    flex-shrink: 0;
  }

  .link-bubble-icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border: none;
    border-radius: 4px;
    background: transparent;
    color: #a1a1aa;
    cursor: pointer;
    transition: color 150ms ease, background-color 150ms ease;
  }

  .link-bubble-icon-btn .material-symbols-outlined {
    font-size: 18px;
  }

  .link-bubble-icon-btn:hover {
    color: #e4e4e7;
    background: rgba(255, 255, 255, 0.08);
  }

  .link-bubble-icon-btn.remove:hover {
    color: #ef4444;
  }

  .link-bubble-form {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .link-bubble-label {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .label-text {
    font-size: 11px;
    color: #71717a;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .link-bubble-input {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--color-border, #27272a);
    border-radius: 4px;
    color: var(--color-text, #e4e4e7);
    font-size: 13px;
    padding: 6px 8px;
    outline: none;
    width: 100%;
  }

  .link-bubble-input:focus {
    border-color: var(--color-primary, #00e5ff);
  }

  .link-bubble-actions {
    display: flex;
    gap: 6px;
    justify-content: flex-end;
  }

  .link-bubble-btn {
    padding: 4px 12px;
    border: 1px solid var(--color-border, #27272a);
    border-radius: 4px;
    background: transparent;
    color: #a1a1aa;
    font-size: 12px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 4px;
    transition: color 150ms ease, background-color 150ms ease;
  }

  .link-bubble-btn .material-symbols-outlined {
    font-size: 14px;
  }

  .link-bubble-btn:hover {
    color: #e4e4e7;
    background: rgba(255, 255, 255, 0.06);
  }

  .link-bubble-btn.save {
    background: var(--color-primary, #00e5ff);
    color: #0a0a0a;
    border-color: var(--color-primary, #00e5ff);
  }

  .link-bubble-btn.save:hover {
    opacity: 0.9;
  }

  @media (prefers-reduced-motion: reduce) {
    .link-bubble-icon-btn,
    .link-bubble-btn {
      transition: none;
    }
  }
</style>
