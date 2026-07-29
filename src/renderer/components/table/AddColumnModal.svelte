<script lang="ts">
  import { focusTrap } from '../../lib/focus-trap'
  import { cliFeatures } from '../../lib/cli-features.svelte'
  import { propertyOps } from '../../stores/property-ops.svelte'
  import { workspace, type TableTab } from '../../stores/workspace.svelte'
  import type { PropertyTargetType } from '../../../preload/api'
  import type { CollectionColumn } from '../../types/cli'
  import Button from '../ui/Button.svelte'

  type AddColumnType = PropertyTargetType | 'formula'

  interface ColumnTypeOption {
    value: AddColumnType
    label: string
    description: string
    icon: string
  }

  interface Props {
    tabId: string
    columns: CollectionColumn[]
    onformula: (name: string) => void
    onclose: () => void
  }

  let { tabId, columns, onformula, onclose }: Props = $props()

  const TYPE_OPTIONS: ColumnTypeOption[] = [
    { value: 'text', label: 'Text', description: 'Plain text values', icon: 'notes' },
    { value: 'number', label: 'Number', description: 'Exact numeric values', icon: 'tag' },
    {
      value: 'boolean',
      label: 'Boolean',
      description: 'Checked or unchecked',
      icon: 'check_box'
    },
    { value: 'date', label: 'Date', description: 'Calendar dates', icon: 'calendar_today' },
    { value: 'tags', label: 'Tags / list', description: 'Multiple values', icon: 'sell' },
    {
      value: 'select',
      label: 'Select',
      description: 'One of your allowed values',
      icon: 'arrow_drop_down_circle'
    },
    {
      value: 'relation',
      label: 'Relation',
      description: 'A linked Markdown document',
      icon: 'account_tree'
    },
    { value: 'file', label: 'File', description: 'One or more attachments', icon: 'attach_file' },
    { value: 'complex', label: 'JSON', description: 'Structured JSON data', icon: 'data_object' },
    { value: 'formula', label: 'Formula', description: 'Calculated by the CLI', icon: 'function' }
  ]

  const tab = $derived.by<TableTab | null>(() => {
    const candidate = workspace.tabs[tabId]
    return candidate?.kind === 'table' ? candidate : null
  })
  const availableTypes = $derived(
    TYPE_OPTIONS.filter((option) => option.value !== 'file' || cliFeatures.supportsFileFields)
  )

  let name = $state('')
  let selectedType = $state<AddColumnType>('text')
  let error = $state<string | null>(null)
  let allowedValues = $state<string[]>([])
  let allowedValueInput = $state('')

  function localError(): string | null {
    const field = name.trim()
    if (!field) return 'Enter a column name'
    if (field === 'title' || field === 'path') return `"${field}" is reserved`
    if (columns.some((column) => column.name === field)) {
      return `A column named "${field}" already exists`
    }
    if (
      selectedType === 'select' &&
      allowedValues.length === 0 &&
      allowedValueInput.trim() === ''
    ) {
      return 'Add at least one allowed value'
    }
    if (!tab) return 'This database view is no longer available'
    return null
  }

  function selectType(type: AddColumnType): void {
    selectedType = type
    error = null
  }

  function addAllowedValue(): void {
    const value = allowedValueInput.trim()
    if (value && !allowedValues.includes(value)) allowedValues = [...allowedValues, value]
    allowedValueInput = ''
  }

  function removeAllowedValue(index: number): void {
    allowedValues = allowedValues.filter((_, candidate) => candidate !== index)
  }

  function submit(): void {
    const invalid = localError()
    if (invalid || !tab) {
      error = invalid
      return
    }

    const field = name.trim()
    if (selectedType === 'formula') {
      onclose()
      onformula(field)
      return
    }

    const pendingAllowedValue = allowedValueInput.trim()
    const selectValues =
      selectedType === 'select'
        ? [
            ...allowedValues,
            ...(pendingAllowedValue && !allowedValues.includes(pendingAllowedValue)
              ? [pendingAllowedValue]
              : [])
          ]
        : undefined
    const origin = { kind: 'table' as const, tabId, folderPath: tab.folderPath }
    if (selectedType === 'select') {
      propertyOps.openAdd(origin, field, selectedType, selectValues)
    } else {
      propertyOps.openAdd(origin, field, selectedType)
    }
    onclose()
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') onclose()
  }
</script>

<div
  class="modal-overlay"
  role="dialog"
  aria-modal="true"
  aria-label="Add column"
  tabindex="-1"
  onkeydown={onKeydown}
>
  <button class="overlay-backdrop" aria-label="Close" onclick={onclose}></button>
  <div class="modal" use:focusTrap>
    <header>
      <span class="material-symbols-outlined modal-mark" aria-hidden="true">view_column</span>
      <div>
        <h2>Add column</h2>
        <p>Add a durable frontmatter property to this database.</p>
      </div>
    </header>

    <label class="name-label">
      <span>Column name</span>
      <!-- svelte-ignore a11y_autofocus -->
      <input
        type="text"
        bind:value={name}
        autofocus
        placeholder="status"
        oninput={() => (error = null)}
      />
    </label>

    <fieldset>
      <legend>Property type</legend>
      <div class="type-grid">
        {#each availableTypes as option (option.value)}
          <button
            type="button"
            class="type-option"
            class:selected={selectedType === option.value}
            role="radio"
            aria-checked={selectedType === option.value}
            onclick={() => selectType(option.value)}
          >
            <span class="material-symbols-outlined type-icon" aria-hidden="true">{option.icon}</span
            >
            <span class="type-copy">
              <span class="type-label">{option.label}</span>
              <span class="type-description">{option.description}</span>
            </span>
          </button>
        {/each}
      </div>
    </fieldset>

    {#if selectedType === 'select'}
      <div class="allowed-values">
        <span class="allowed-label">Allowed values</span>
        <div class="chips">
          {#each allowedValues as value, index (value)}
            <span class="chip">
              {value}
              <button
                type="button"
                aria-label="Remove allowed value {value}"
                onclick={() => removeAllowedValue(index)}
              >
                &times;
              </button>
            </span>
          {/each}
          <input
            type="text"
            bind:value={allowedValueInput}
            aria-label="Add allowed value"
            placeholder="+ value"
            onkeydown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                addAllowedValue()
              }
            }}
            onblur={addAllowedValue}
          />
        </div>
      </div>
    {/if}

    {#if error}
      <p class="error" role="alert">{error}</p>
    {/if}

    <footer>
      <Button variant="secondary" size="sm" onclick={onclose}>Cancel</Button>
      <Button size="sm" onclick={submit}>
        {selectedType === 'formula' ? 'Continue to formula' : 'Continue'}
      </Button>
    </footer>
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
    border: none;
    background: var(--overlay-scrim);
    animation: backdrop-in 120ms ease-out;
  }

  .modal {
    position: relative;
    z-index: 1;
    box-sizing: border-box;
    width: min(620px, 92vw);
    max-height: 88vh;
    overflow: auto;
    padding: var(--space-5, 20px);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg, 8px);
    background: var(--color-surface);
    box-shadow: var(--shadow-modal, 0 12px 40px rgba(0, 0, 0, 0.5));
    animation: modal-in 150ms ease-out;
  }

  header {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3, 12px);
    margin-bottom: var(--space-4, 16px);
  }

  .modal-mark {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    flex-shrink: 0;
    border-radius: var(--radius-md, 6px);
    background: var(--color-primary-dim);
    color: var(--color-primary);
    font-size: 19px;
  }

  h2 {
    margin: 0;
    color: var(--color-text);
    font-size: var(--text-lg, 1.125rem);
  }

  header p {
    margin: 4px 0 0;
    color: var(--color-text-dim);
    font-size: var(--text-sm, 0.75rem);
  }

  .name-label {
    display: grid;
    gap: 5px;
    color: var(--color-text-dim);
    font-size: var(--text-sm, 0.75rem);
  }

  .name-label input,
  .chips input {
    box-sizing: border-box;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm, 4px);
    background: var(--color-surface-elevated);
    color: var(--color-text);
    font: inherit;
    outline: none;
  }

  .name-label input {
    width: 100%;
    padding: 7px 9px;
  }

  .name-label input:focus,
  .chips input:focus {
    border-color: var(--color-primary);
    box-shadow: 0 0 0 2px var(--color-primary-dim);
  }

  fieldset {
    margin: var(--space-4, 16px) 0 0;
    padding: 0;
    border: 0;
  }

  legend,
  .allowed-label {
    margin-bottom: 6px;
    color: var(--color-text-dim);
    font-size: var(--text-sm, 0.75rem);
  }

  .type-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--space-2, 8px);
  }

  .type-option {
    display: flex;
    align-items: center;
    gap: var(--space-2, 8px);
    min-width: 0;
    padding: 8px 10px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-md, 6px);
    background: var(--color-surface-elevated);
    color: var(--color-text);
    text-align: left;
    cursor: pointer;
    transition:
      border-color var(--transition-fast, 150ms ease),
      background var(--transition-fast, 150ms ease);
  }

  .type-option:hover {
    border-color: var(--color-border-hover);
  }

  .type-option.selected {
    border-color: var(--color-primary);
    background: var(--color-primary-dim);
  }

  .type-option:focus-visible {
    outline: 1px solid var(--color-primary);
    outline-offset: 2px;
  }

  .type-icon {
    flex-shrink: 0;
    color: var(--color-text-dim);
    font-size: 18px;
  }

  .selected .type-icon {
    color: var(--color-primary);
  }

  .type-copy {
    display: grid;
    min-width: 0;
  }

  .type-label {
    font-size: var(--text-sm, 0.75rem);
    font-weight: var(--weight-medium, 500);
  }

  .type-description {
    overflow: hidden;
    color: var(--color-text-dim);
    font-size: var(--text-xs, 0.625rem);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .allowed-values {
    display: grid;
    gap: 5px;
    margin-top: var(--space-4, 16px);
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    min-height: 34px;
    padding: 5px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm, 4px);
    background: var(--color-surface-elevated);
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 6px;
    border-radius: var(--radius-full, 9999px);
    background: var(--color-primary-dim);
    color: var(--color-text);
    font-size: var(--text-xs, 0.625rem);
  }

  .chip button {
    border: 0;
    background: transparent;
    color: var(--color-text-dim);
    cursor: pointer;
    line-height: 1;
  }

  .chips input {
    min-width: 100px;
    flex: 1;
    padding: 3px 5px;
    border-color: transparent;
  }

  .error {
    margin: var(--space-3, 12px) 0 0;
    color: var(--color-error);
    font-size: var(--text-sm, 0.75rem);
    white-space: pre-wrap;
  }

  footer {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2, 8px);
    margin-top: var(--space-5, 20px);
  }

  @keyframes backdrop-in {
    from {
      opacity: 0;
    }
  }

  @keyframes modal-in {
    from {
      opacity: 0;
      transform: translateY(6px) scale(0.99);
    }
  }

  @media (max-width: 520px) {
    .type-grid {
      grid-template-columns: 1fr;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .overlay-backdrop,
    .modal {
      animation: none;
    }

    .type-option {
      transition: none;
    }
  }
</style>
