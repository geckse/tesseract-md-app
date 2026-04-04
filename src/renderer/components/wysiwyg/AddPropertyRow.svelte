<script lang="ts">
  import type { Schema } from '../../types/cli'
  import AutocompleteDropdown from './AutocompleteDropdown.svelte'
  import TypePickerDropdown from './TypePickerDropdown.svelte'

  interface Props {
    schema: Schema | null
    existingKeys: string[]
    onAdd: (key: string, type: string) => void
  }

  let { schema, existingKeys, onAdd }: Props = $props()

  let mode = $state<'idle' | 'naming' | 'typing'>('idle')
  let nameInput = $state('')
  let inputEl = $state<HTMLInputElement | null>(null)
  let typeAnchorEl = $state<HTMLElement | null>(null)

  /** Schema fields not yet used. */
  function getUnusedFields(): string[] {
    if (!schema?.fields) return []
    const used = new Set(existingKeys.map((k) => k.trim()).filter(Boolean))
    return schema.fields.map((f) => f.name).filter((n) => !used.has(n))
  }

  /** Type labels for autocomplete secondary display. */
  let fieldTypeLabels = $derived(new Map(
    schema?.fields?.map((f) => [f.name, f.field_type]) ?? []
  ))

  function startNaming() {
    mode = 'naming'
    nameInput = ''
    queueMicrotask(() => inputEl?.focus())
  }

  function handleFieldSelect(name: string) {
    nameInput = name
    // If schema field selected, auto-pick type
    const sf = schema?.fields?.find((f) => f.name === name)
    if (sf) {
      const typeMap: Record<string, string> = {
        String: 'text', Number: 'number', Boolean: 'boolean',
        Date: 'date', List: 'tags', Mixed: 'text',
      }
      const t = typeMap[sf.field_type] ?? 'text'
      // If it has allowed_values, use select
      if (sf.allowed_values?.length) {
        onAdd(name, 'select')
      } else {
        onAdd(name, t)
      }
      mode = 'idle'
      return
    }
    // Otherwise show type picker
    mode = 'typing'
    queueMicrotask(() => { typeAnchorEl = inputEl })
  }

  function handleNameConfirm() {
    const trimmed = nameInput.trim()
    if (!trimmed) { mode = 'idle'; return }
    // Check if it matches a schema field
    const sf = schema?.fields?.find((f) => f.name === trimmed)
    if (sf) {
      handleFieldSelect(trimmed)
      return
    }
    mode = 'typing'
    queueMicrotask(() => { typeAnchorEl = inputEl })
  }

  function handleTypeSelect(type: string) {
    onAdd(nameInput.trim(), type)
    mode = 'idle'
    nameInput = ''
  }

  function cancel() {
    mode = 'idle'
    nameInput = ''
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); cancel() }
    if (e.key === 'Enter' && mode === 'naming') { e.preventDefault(); handleNameConfirm() }
  }
</script>

<div class="apr">
  {#if mode === 'idle'}
    <button class="apr-btn" onclick={startNaming}>
      <span class="material-symbols-outlined apr-icon">add</span>
      <span class="apr-label">Add property</span>
    </button>
  {:else}
    <div class="apr-input-row">
      <span class="material-symbols-outlined apr-icon-active">add</span>
      <input
        class="apr-input"
        type="text"
        placeholder="Property name..."
        bind:this={inputEl}
        bind:value={nameInput}
        onkeydown={handleKeydown}
        onblur={(e: FocusEvent) => {
          const related = e.relatedTarget as HTMLElement | null
          if (related?.closest?.('.autocomplete-dropdown') || related?.closest?.('.tp')) return
          if (mode === 'naming' && !nameInput.trim()) cancel()
        }}
      />
    </div>

    {#if mode === 'naming' && inputEl}
      <AutocompleteDropdown
        suggestions={getUnusedFields()}
        onSelect={handleFieldSelect}
        anchorEl={inputEl}
        secondaryLabels={fieldTypeLabels}
        onDismiss={cancel}
      />
    {/if}

    {#if mode === 'typing' && typeAnchorEl}
      <TypePickerDropdown
        anchorEl={typeAnchorEl}
        onSelect={handleTypeSelect}
        onDismiss={cancel}
      />
    {/if}
  {/if}
</div>

<style>
  .apr { padding: 2px 0; }
  .apr-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    background: none;
    border: none;
    color: var(--color-text-dim, #71717a);
    font-family: var(--font-mono, 'JetBrains Mono'), monospace;
    font-size: 11px;
    cursor: pointer;
    padding: 4px 6px;
    border-radius: 4px;
    transition: color 150ms ease;
  }
  .apr-btn:hover { color: var(--color-text, #e4e4e7); }
  .apr-icon { font-size: 16px; }
  .apr-label { user-select: none; }

  .apr-input-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 2px 0;
  }
  .apr-icon-active {
    font-size: 16px;
    color: var(--color-primary, #00E5FF);
    width: 24px;
    text-align: center;
  }
  .apr-input {
    flex: 1;
    background: transparent;
    border: 1px solid var(--color-border, #27272a);
    border-radius: 4px;
    color: var(--color-text, #e4e4e7);
    font-family: var(--font-mono, 'JetBrains Mono'), monospace;
    font-size: 12px;
    padding: 4px 8px;
    outline: none;
    transition: border-color 150ms ease;
  }
  .apr-input:focus { border-color: var(--color-primary, #00E5FF); }
  .apr-input::placeholder { color: #52525b; }

  @media (prefers-reduced-motion: reduce) {
    .apr-btn, .apr-input { transition: none; }
  }
</style>
