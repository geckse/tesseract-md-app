<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { computePosition, flip, shift, offset } from '@floating-ui/dom'
  import { propertyOps } from '../stores/property-ops.svelte'
  import { cliFeatures } from '../lib/cli-features.svelte'
  import { focusTrap } from '../lib/focus-trap'
  import Button from './ui/Button.svelte'

  interface Props {
    anchorEl: HTMLElement
    /** Overlay scope key (folder path, no trailing slash) or null for the global section. */
    scope: string | null
    fieldKey: string
    /** Current annotations to prefill (from the schema field / table column). */
    description?: string | null
    required?: boolean
    allowedValues?: string[] | null
    /** Phase 42: whether the field is a relation (shows the target-folder input). */
    isRelation?: boolean
    /** Phase 42: current overlay-declared target folder to prefill. */
    relationTarget?: string | null
    onclose: () => void
  }

  let {
    anchorEl,
    scope,
    fieldKey,
    description: initialDescription = null,
    required: initialRequired = false,
    allowedValues: initialAllowed = null,
    isRelation = false,
    relationTarget: initialTarget = null,
    onclose
  }: Props = $props()

  // Deliberate initial-value capture: the popover edits a snapshot of the
  // annotations and writes back on Save; live prop updates must not clobber
  // in-progress edits.
  // svelte-ignore state_referenced_locally
  let description = $state(initialDescription ?? '')
  // svelte-ignore state_referenced_locally
  let required = $state(initialRequired)
  // svelte-ignore state_referenced_locally
  let values = $state<string[]>(initialAllowed ? [...initialAllowed] : [])
  // svelte-ignore state_referenced_locally
  let targetFolder = $state(initialTarget ?? '')
  let newValue = $state('')
  let saving = $state(false)
  let error = $state<string | null>(null)

  const showTargetField = $derived(isRelation && cliFeatures.supportsRelations)

  let popEl = $state<HTMLDivElement | undefined>(undefined)

  function addValue(): void {
    const trimmed = newValue.trim()
    if (trimmed && !values.includes(trimmed)) values.push(trimmed)
    newValue = ''
  }

  function removeValue(index: number): void {
    values = values.filter((_, i) => i !== index)
  }

  async function save(): Promise<void> {
    saving = true
    error = null
    try {
      const patch: Parameters<typeof propertyOps.applyOverlayFieldPatch>[2] = {
        description: description.trim() === '' ? null : description.trim(),
        required: required ? true : null,
        allowedValues: values.length > 0 ? values : null
      }
      if (showTargetField) {
        // Folder-key grammar: relative path, NO trailing slash (normalized here;
        // the overlay writer rejects trailing slashes outright).
        const t = targetFolder.trim().replace(/\/+$/, '')
        patch.target = t === '' ? null : t
      }
      await propertyOps.applyOverlayFieldPatch(scope, fieldKey, patch)
      onclose()
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      saving = false
    }
  }

  function positionPopover(): void {
    if (!popEl || !anchorEl) return
    computePosition(anchorEl, popEl, {
      placement: 'bottom-start',
      middleware: [offset(4), flip(), shift({ padding: 8 })]
    }).then(({ x, y }) => {
      if (popEl) {
        popEl.style.left = `${x}px`
        popEl.style.top = `${y}px`
      }
    })
  }

  function handleKeyDown(e: KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onclose()
    }
  }

  function handlePointerDown(e: PointerEvent): void {
    const target = e.target as Node | null
    if (!target) return
    if (popEl?.contains(target)) return
    if (anchorEl?.contains(target)) return
    onclose()
  }

  onMount(() => {
    positionPopover()
    document.addEventListener('keydown', handleKeyDown, true)
    document.addEventListener('pointerdown', handlePointerDown, true)
  })
  onDestroy(() => {
    document.removeEventListener('keydown', handleKeyDown, true)
    document.removeEventListener('pointerdown', handlePointerDown, true)
  })
  $effect(() => {
    void anchorEl
    positionPopover()
  })
</script>

<div
  class="psp"
  bind:this={popEl}
  role="dialog"
  aria-label="Property settings for {fieldKey}"
  use:focusTrap
>
  <h3 class="psp-title">
    <span class="mono">{fieldKey}</span> settings
    {#if scope}
      <span class="psp-scope mono">{scope}</span>
    {/if}
  </h3>

  <label class="psp-field">
    <span class="psp-label">Description</span>
    <!-- svelte-ignore a11y_autofocus -->
    <input
      class="psp-input"
      type="text"
      placeholder="What this property means"
      autofocus
      bind:value={description}
    />
  </label>

  <label class="psp-check">
    <input type="checkbox" bind:checked={required} />
    <span>Required</span>
  </label>

  {#if showTargetField}
    <label class="psp-field">
      <span class="psp-label">Target folder</span>
      <input
        class="psp-input mono"
        type="text"
        placeholder="e.g. clients"
        bind:value={targetFolder}
      />
    </label>
  {/if}

  <div class="psp-field">
    <span class="psp-label">Allowed values</span>
    <div class="psp-chips">
      {#each values as v, i (v)}
        <span class="psp-chip">
          {v}
          <button
            class="psp-chip-remove"
            onclick={() => removeValue(i)}
            aria-label="Remove allowed value {v}"
          >
            &times;
          </button>
        </span>
      {/each}
      <input
        class="psp-chip-input"
        type="text"
        placeholder="+ value"
        aria-label="Add allowed value"
        bind:value={newValue}
        onkeydown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            addValue()
          }
        }}
        onblur={addValue}
      />
    </div>
  </div>

  {#if error}
    <p class="psp-error" role="alert">{error}</p>
  {/if}

  <div class="psp-actions">
    <Button variant="secondary" size="sm" onclick={onclose}>Cancel</Button>
    <Button size="sm" disabled={saving} onclick={() => void save()}>
      {saving ? 'Saving…' : 'Save'}
    </Button>
  </div>
</div>

<style>
  .psp {
    position: fixed;
    z-index: var(--z-overlay, 40);
    width: 280px;
    background: var(--color-surface, #161617);
    border: 1px solid var(--color-border, #27272a);
    border-radius: var(--radius-md, 6px);
    box-shadow: var(--shadow-popover, 0 8px 24px rgba(0, 0, 0, 0.45));
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .mono {
    font-family: var(--font-mono, 'JetBrains Mono'), monospace;
  }

  .psp-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--color-text, #e4e4e7);
    margin: 0;
    display: flex;
    align-items: baseline;
    gap: 6px;
  }

  .psp-scope {
    font-size: 10px;
    font-weight: 400;
    color: var(--color-text-faint, #52525b);
  }

  .psp-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .psp-label {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-text-dim, #71717a);
  }

  .psp-input {
    background: transparent;
    border: 1px solid var(--color-border, #27272a);
    border-radius: 4px;
    color: var(--color-text, #e4e4e7);
    font-size: 12px;
    padding: 4px 8px;
    outline: none;
    transition: border-color 150ms ease;
  }
  .psp-input:focus {
    border-color: var(--color-primary, #00e5ff);
  }

  .psp-check {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--color-text, #e4e4e7);
    cursor: pointer;
  }
  .psp-check input {
    accent-color: var(--color-primary, #00e5ff);
  }

  .psp-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
  }

  .psp-chip {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 2px 8px;
    border-radius: 9999px;
    border: 1px solid var(--color-primary-glow, rgba(0, 229, 255, 0.25));
    color: var(--color-primary, #00e5ff);
    font-size: 10px;
    font-family: var(--font-mono, 'JetBrains Mono'), monospace;
  }

  .psp-chip-remove {
    background: none;
    border: none;
    color: var(--color-primary, #00e5ff);
    cursor: pointer;
    padding: 0;
    font-size: 12px;
    line-height: 1;
    opacity: 0.5;
    transition: opacity 150ms ease;
  }
  .psp-chip-remove:hover {
    opacity: 1;
  }

  .psp-chip-input {
    background: transparent;
    border: none;
    color: var(--color-text, #e4e4e7);
    font-size: 10px;
    font-family: var(--font-mono, 'JetBrains Mono'), monospace;
    padding: 2px 4px;
    width: 56px;
    outline: none;
  }

  .psp-error {
    font-size: 11px;
    color: var(--color-error, #ef4444);
    margin: 0;
  }

  .psp-actions {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
  }

  @media (prefers-reduced-motion: reduce) {
    .psp-input,
    .psp-chip-remove {
      transition: none;
    }
  }
</style>
