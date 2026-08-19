<script lang="ts">
  import type { Schema } from '../../types/cli'
  import type { PropertyTargetType } from '../../../preload/api'
  import { detectedTypeForField } from '../../lib/property-types'
  import AutocompleteDropdown from './AutocompleteDropdown.svelte'
  import TypePickerDropdown from './TypePickerDropdown.svelte'
  import { cliFeatures } from '../../lib/cli-features.svelte'
  import { isComputedFieldType } from '../../lib/computed-fields'

  interface Props {
    schema: Schema | null
    existingKeys: string[]
    onAdd: (key: string, type: PropertyTargetType, options?: { allowedValues?: string[] }) => void
    /** Select/Relation/File properties require collection-backed schema or pickers. */
    collectionFeaturesEnabled?: boolean
    /** Formula is a schema definition, so it follows a separate add flow. */
    onAddFormula?: (key: string) => void
    onAddComputed?: (kind: 'lookup' | 'rollup', key: string) => void
  }

  let {
    schema,
    existingKeys,
    onAdd,
    collectionFeaturesEnabled = true,
    onAddFormula,
    onAddComputed
  }: Props = $props()

  let mode = $state<'idle' | 'naming' | 'typing' | 'select-values'>('idle')
  let nameInput = $state('')
  let inputEl = $state<HTMLInputElement | null>(null)
  let typeAnchorEl = $state<HTMLElement | null>(null)
  let selectValues = $state<string[]>([])
  let selectValueInput = $state('')
  let nameError = $state<string | null>(null)

  /** Schema fields not yet used. */
  function getUnusedFields(): string[] {
    if (!schema?.fields) return []
    const used = new Set(existingKeys.map((k) => k.trim()).filter(Boolean))
    const query = nameInput.trim().toLowerCase()
    return schema.fields
      .filter((field) => !isComputedFieldType(field.field_type))
      .map((field) => field.name)
      .filter((name) => !used.has(name))
      .filter((name) => !query || name.toLowerCase().includes(query))
  }

  /** Type labels for autocomplete secondary display. */
  let fieldTypeLabels = $derived(
    new Map(
      schema?.fields
        ?.filter((field) => !isComputedFieldType(field.field_type))
        .map((field) => [field.name, field.field_type]) ?? []
    )
  )

  function startNaming() {
    mode = 'naming'
    nameInput = ''
    nameError = null
    queueMicrotask(() => inputEl?.focus())
  }

  function duplicateName(name: string): boolean {
    return existingKeys.some((key) => key.trim() === name)
  }

  function handleFieldSelect(name: string) {
    nameInput = name
    // If schema field selected, auto-pick type (allowed_values → select)
    const sf = schema?.fields?.find((f) => f.name === name && !isComputedFieldType(f.field_type))
    if (sf) {
      onAdd(name, detectedTypeForField(sf.field_type, sf.allowed_values))
      mode = 'idle'
      return
    }
    // Otherwise show type picker
    mode = 'typing'
    queueMicrotask(() => {
      typeAnchorEl = inputEl
    })
  }

  function handleNameConfirm() {
    const trimmed = nameInput.trim()
    if (!trimmed) {
      mode = 'idle'
      return
    }
    if (duplicateName(trimmed)) {
      nameError = `A property named "${trimmed}" already exists`
      return
    }
    // Check if it matches a schema field
    const sf = schema?.fields?.find((f) => f.name === trimmed && !isComputedFieldType(f.field_type))
    if (sf) {
      handleFieldSelect(trimmed)
      return
    }
    mode = 'typing'
    queueMicrotask(() => {
      typeAnchorEl = inputEl
    })
  }

  function handleTypeSelect(type: string) {
    const name = nameInput.trim()
    if (duplicateName(name)) {
      nameError = `A property named "${name}" already exists`
      mode = 'naming'
      return
    }
    if (type === 'formula') {
      onAddFormula?.(name)
    } else if (type === 'lookup' || type === 'rollup') {
      onAddComputed?.(type, name)
    } else if (type === 'select') {
      selectValues = []
      selectValueInput = ''
      mode = 'select-values'
      return
    } else {
      onAdd(name, type as PropertyTargetType)
    }
    mode = 'idle'
    nameInput = ''
  }

  function cancel() {
    mode = 'idle'
    nameInput = ''
    selectValues = []
    selectValueInput = ''
    nameError = null
  }

  function addSelectValue(): void {
    const value = selectValueInput.trim()
    if (value && !selectValues.includes(value)) selectValues = [...selectValues, value]
    selectValueInput = ''
  }

  function removeSelectValue(index: number): void {
    selectValues = selectValues.filter((_, candidate) => candidate !== index)
  }

  function finishSelect(): void {
    addSelectValue()
    if (selectValues.length === 0) return
    onAdd(nameInput.trim(), 'select', { allowedValues: [...selectValues] })
    cancel()
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      cancel()
    }
    if (e.key === 'Enter' && mode === 'naming') {
      e.preventDefault()
      handleNameConfirm()
    }
  }
</script>

<div class="apr">
  {#if mode === 'idle'}
    <button class="apr-btn" onclick={startNaming}>
      <span class="material-symbols-outlined apr-icon">add</span>
      <span class="apr-label">Add property</span>
    </button>
  {:else if mode === 'select-values'}
    <div class="apr-select-builder">
      <div class="apr-select-heading">
        <span class="material-symbols-outlined apr-icon-active">arrow_drop_down_circle</span>
        <span>Allowed values for <strong>{nameInput.trim()}</strong></span>
      </div>
      <div class="apr-select-values">
        {#each selectValues as value, index (value)}
          <span class="apr-select-chip">
            {value}
            <button
              type="button"
              aria-label="Remove allowed value {value}"
              onclick={() => removeSelectValue(index)}
            >
              &times;
            </button>
          </span>
        {/each}
        <input
          class="apr-select-input"
          type="text"
          bind:value={selectValueInput}
          aria-label="Allowed value"
          placeholder="Add a value…"
          onkeydown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              addSelectValue()
            } else if (event.key === 'Escape') {
              event.preventDefault()
              cancel()
            }
          }}
        />
      </div>
      <div class="apr-select-actions">
        <button type="button" class="apr-select-cancel" onclick={cancel}>Cancel</button>
        <button
          type="button"
          class="apr-select-create"
          disabled={selectValues.length === 0 && !selectValueInput.trim()}
          onclick={finishSelect}
        >
          Add Select property
        </button>
      </div>
    </div>
  {:else}
    <div class="apr-input-row">
      <span class="material-symbols-outlined apr-icon-active">add</span>
      <input
        class="apr-input"
        type="text"
        placeholder="Property name..."
        bind:this={inputEl}
        bind:value={nameInput}
        oninput={() => (nameError = null)}
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
        excludeTypes={collectionFeaturesEnabled
          ? cliFeatures.supportsFileFields
            ? []
            : ['file']
          : ['select', 'relation', 'file']}
        includeFormula={!!onAddFormula}
        includeLookupRollup={!!onAddComputed && cliFeatures.supportsLookupRollup}
        onSelect={handleTypeSelect}
        onDismiss={cancel}
      />
    {/if}
    {#if nameError}
      <p class="apr-error" role="alert">{nameError}</p>
    {/if}
  {/if}
</div>

<style>
  .apr {
    padding: 2px 0;
  }
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
  .apr-btn:hover {
    color: var(--color-text, #e4e4e7);
  }
  .apr-icon {
    font-size: 16px;
  }
  .apr-label {
    user-select: none;
  }

  .apr-input-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 2px 0;
  }
  .apr-icon-active {
    font-size: 16px;
    color: var(--color-primary, #00e5ff);
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
  .apr-input:focus {
    border-color: var(--color-primary, #00e5ff);
  }
  .apr-input::placeholder {
    color: var(--color-text-faint, #52525b);
  }
  .apr-error {
    margin: 3px 0 0 24px;
    color: var(--color-danger, #ef4444);
    font-family: var(--font-mono, 'JetBrains Mono'), monospace;
    font-size: 11px;
  }
  .apr-select-builder {
    margin: 4px 0 6px 24px;
    padding: 8px;
    border: 1px solid var(--color-border, #27272a);
    border-radius: 6px;
    background: var(--color-surface, #161617);
    font-family: var(--font-mono, 'JetBrains Mono'), monospace;
    font-size: 11px;
  }
  .apr-select-heading {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 7px;
    color: var(--color-text-dim, #a1a1aa);
  }
  .apr-select-values {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
  }
  .apr-select-chip {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 2px 5px;
    border-radius: 4px;
    background: var(--color-border, #27272a);
    color: var(--color-text, #e4e4e7);
  }
  .apr-select-chip button {
    border: 0;
    padding: 0;
    background: none;
    color: var(--color-text-dim, #a1a1aa);
    cursor: pointer;
  }
  .apr-select-input {
    min-width: 120px;
    flex: 1;
    border: 0;
    border-bottom: 1px solid var(--color-border, #27272a);
    padding: 3px 2px;
    outline: none;
    background: transparent;
    color: var(--color-text, #e4e4e7);
    font: inherit;
  }
  .apr-select-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 8px;
  }
  .apr-select-actions button {
    border: 0;
    border-radius: 4px;
    padding: 4px 7px;
    font: inherit;
    cursor: pointer;
  }
  .apr-select-cancel {
    background: transparent;
    color: var(--color-text-dim, #a1a1aa);
  }
  .apr-select-create {
    background: var(--color-primary, #00e5ff);
    color: var(--color-background, #09090b);
  }
  .apr-select-create:disabled {
    opacity: 0.45;
    cursor: default;
  }

  @media (prefers-reduced-motion: reduce) {
    .apr-btn,
    .apr-input {
      transition: none;
    }
  }
</style>
