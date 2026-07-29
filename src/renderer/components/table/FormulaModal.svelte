<script lang="ts">
  import { untrack } from 'svelte'
  import { focusTrap } from '../../lib/focus-trap'
  import { requestConfirmation } from '../../stores/confirmation'
  import Button from '../ui/Button.svelte'
  import type { FormulaResultType } from '../../types/cli'

  interface FormulaFieldLike {
    name: string
    field_type: string
    formula?: string | null
    result_type?: FormulaResultType | null
  }

  interface Props {
    collectionId: string
    root: string
    scope: string | null
    field?: FormulaFieldLike | null
    fields: FormulaFieldLike[]
    initialName?: string
    onbeforemutate?: () => void | Promise<void>
    onapplied?: () => void | Promise<void>
    onclose: () => void
  }

  let {
    collectionId,
    root,
    scope,
    field = null,
    fields,
    initialName = '',
    onbeforemutate = () => {},
    onapplied = () => {},
    onclose
  }: Props = $props()

  const RESULT_TYPES: { value: FormulaResultType; label: string }[] = [
    { value: 'String', label: 'Text' },
    { value: 'Number', label: 'Number' },
    { value: 'Boolean', label: 'Checkbox' },
    { value: 'Date', label: 'Date' },
    { value: 'DateTime', label: 'Date & time' },
    { value: 'List', label: 'List' },
    { value: 'Json', label: 'JSON' }
  ]

  const RESERVED_IDENTIFIERS = new Set([
    'await',
    'break',
    'case',
    'catch',
    'class',
    'const',
    'continue',
    'debugger',
    'default',
    'delete',
    'do',
    'else',
    'enum',
    'export',
    'extends',
    'false',
    'finally',
    'for',
    'function',
    'if',
    'import',
    'in',
    'instanceof',
    'let',
    'new',
    'null',
    'return',
    'super',
    'switch',
    'this',
    'throw',
    'true',
    'try',
    'typeof',
    'var',
    'void',
    'while',
    'with',
    'yield',
    'fields',
    'undefined',
    'eval',
    'Function',
    'AsyncFunction',
    'GeneratorFunction',
    'WebAssembly',
    'globalThis',
    'window',
    'process',
    'require',
    'Math',
    'Number',
    'String',
    'Array',
    'Object',
    'JSON',
    'Date',
    'parseInt',
    'parseFloat',
    'isFinite',
    'isInteger',
    'encodeURIComponent',
    'decodeURIComponent'
  ])

  let name = $state(untrack(() => field?.name ?? initialName))
  let formula = $state(untrack(() => field?.formula ?? ''))
  let resultType = $state<FormulaResultType>(untrack(() => field?.result_type ?? 'Number'))
  let expressionEl: HTMLTextAreaElement | null = $state(null)
  let busy = $state(false)
  let error = $state<string | null>(null)
  let validationMessage = $state<string | null>(null)

  const editing = $derived(field?.field_type === 'Formula')
  const insertableFields = $derived(fields.filter((candidate) => candidate.name !== field?.name))

  function identifierFor(field: string): string {
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(field) && !RESERVED_IDENTIFIERS.has(field)
      ? field
      : `fields[${JSON.stringify(field)}]`
  }

  function insertField(field: string): void {
    const insertion = identifierFor(field)
    const start = expressionEl?.selectionStart ?? formula.length
    const end = expressionEl?.selectionEnd ?? start
    formula = `${formula.slice(0, start)}${insertion}${formula.slice(end)}`
    validationMessage = null
    queueMicrotask(() => {
      expressionEl?.focus()
      expressionEl?.setSelectionRange(start + insertion.length, start + insertion.length)
    })
  }

  function localError(): string | null {
    const field = name.trim()
    if (!field) return 'Enter a formula field name'
    if (field === 'title' || field === 'path') return `"${field}" is reserved`
    if (!formula.trim()) return 'Enter a formula expression'
    if (!editing && fields.some((candidate) => candidate.name === field)) {
      return `A column named "${field}" already exists`
    }
    return null
  }

  async function validate(): Promise<boolean> {
    const invalid = localError()
    if (invalid || !root) {
      error = invalid ?? 'No collection root'
      validationMessage = null
      return false
    }
    busy = true
    error = null
    validationMessage = null
    try {
      const result = await window.api.validateFormula(root, formula, resultType)
      if (!result.valid) {
        error =
          result.diagnostics.map((diagnostic) => diagnostic.message).join('\n') ||
          'Formula is not valid'
        return false
      }
      validationMessage = 'Formula is valid'
      return true
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
      return false
    } finally {
      busy = false
    }
  }

  async function save(): Promise<void> {
    const invalid = localError()
    if (invalid || !collectionId) {
      error = invalid ?? 'No active collection'
      return
    }
    busy = true
    error = null
    validationMessage = null
    try {
      await onbeforemutate()
      await window.api.saveFormula(collectionId, scope, name.trim(), formula, resultType)
      await onapplied()
      onclose()
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      busy = false
    }
  }

  async function remove(): Promise<void> {
    if (!field || !collectionId) return
    const confirmed = await requestConfirmation({
      title: `Remove formula "${field.name}"?`,
      message: 'Its materialized values will be removed from Markdown files in this scope.',
      confirmLabel: 'Remove formula',
      tone: 'danger'
    })
    if (!confirmed) return
    busy = true
    error = null
    try {
      await onbeforemutate()
      await window.api.removeFormula(collectionId, scope, field.name)
      await onapplied()
      onclose()
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      busy = false
    }
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && !busy) onclose()
  }
</script>

<div
  class="modal-overlay"
  role="dialog"
  aria-modal="true"
  aria-label={editing ? `Edit formula ${field?.name}` : 'Add formula'}
  tabindex="-1"
  onkeydown={onKeydown}
>
  <button
    class="overlay-backdrop"
    aria-label="Close"
    disabled={busy}
    onclick={() => {
      if (!busy) onclose()
    }}
  ></button>
  <div class="modal" use:focusTrap>
    <header>
      <span class="formula-mark" aria-hidden="true">ƒx</span>
      <div>
        <h2>{editing ? 'Edit formula' : 'Add formula'}</h2>
        <p>Calculated by the CLI and written to Markdown frontmatter.</p>
      </div>
    </header>

    <label>
      <span>Column name</span>
      <!-- svelte-ignore a11y_autofocus -->
      <input
        type="text"
        bind:value={name}
        disabled={editing || busy}
        autofocus
        placeholder="total"
      />
    </label>

    <label>
      <span>Result type</span>
      <select bind:value={resultType} disabled={busy}>
        {#each RESULT_TYPES as option (option.value)}
          <option value={option.value}>{option.label}</option>
        {/each}
      </select>
    </label>

    <label>
      <span>JavaScript expression</span>
      <textarea
        bind:this={expressionEl}
        bind:value={formula}
        disabled={busy}
        rows="5"
        spellcheck="false"
        placeholder="price * quantity"
        oninput={() => {
          validationMessage = null
          error = null
        }}
      ></textarea>
    </label>

    <div class="fields">
      <span class="fields-label">Insert field</span>
      <div class="field-list">
        {#each insertableFields as candidate (candidate.name)}
          <button type="button" onclick={() => insertField(candidate.name)}>
            {candidate.field_type === 'Formula' ? 'ƒx ' : ''}{candidate.name}
          </button>
        {/each}
        {#if insertableFields.length === 0}<span class="empty-fields">No other fields</span>{/if}
      </div>
    </div>

    <p class="hint">
      Use strict JavaScript expressions, for example
      <code>price * quantity</code> or
      <code>tags.filter(tag =&gt; tag.startsWith("priority:")).length</code>.
    </p>

    {#if error}
      <p class="status error" role="alert">{error}</p>
    {:else if validationMessage}
      <p class="status valid" role="status">{validationMessage}</p>
    {/if}

    <footer>
      <div>
        {#if editing}
          <button class="delete-button" disabled={busy} onclick={() => void remove()}>
            Remove formula
          </button>
        {/if}
      </div>
      <div class="actions">
        <Button variant="secondary" size="sm" disabled={busy} onclick={onclose}>Cancel</Button>
        <Button variant="secondary" size="sm" disabled={busy} onclick={() => void validate()}>
          Validate
        </Button>
        <Button size="sm" disabled={busy} onclick={() => void save()}>
          {busy ? 'Working…' : 'Save formula'}
        </Button>
      </div>
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

  .formula-mark {
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    flex-shrink: 0;
    border-radius: var(--radius-md, 6px);
    background: var(--color-primary-dim);
    color: var(--color-primary);
    font: 700 13px var(--font-mono, 'JetBrains Mono', ui-monospace, monospace);
  }

  h2 {
    margin: 0;
    color: var(--color-text);
    font-size: var(--text-lg, 1.125rem);
  }

  header p,
  .hint {
    margin: 4px 0 0;
    color: var(--color-text-dim);
    font-size: var(--text-sm, 0.75rem);
  }

  label {
    display: grid;
    gap: 5px;
    margin-top: var(--space-3, 12px);
    color: var(--color-text-dim);
    font-size: var(--text-sm, 0.75rem);
  }

  input,
  select,
  textarea {
    box-sizing: border-box;
    width: 100%;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm, 4px);
    background: var(--color-surface-elevated);
    color: var(--color-text);
    padding: 7px 9px;
    font: inherit;
    transition:
      border-color var(--transition-fast, 150ms ease),
      box-shadow var(--transition-fast, 150ms ease);
  }

  textarea {
    resize: vertical;
    min-height: 104px;
    font-family: var(--font-mono, 'JetBrains Mono', ui-monospace, monospace);
    line-height: 1.5;
  }

  input:focus,
  select:focus,
  textarea:focus {
    outline: none;
    border-color: var(--color-primary);
    box-shadow: 0 0 0 2px var(--color-primary-dim);
  }

  input:disabled,
  select:disabled,
  textarea:disabled {
    opacity: 0.65;
  }

  .fields {
    margin-top: var(--space-3, 12px);
  }

  .fields-label {
    display: block;
    margin-bottom: 5px;
    color: var(--color-text-dim);
    font-size: var(--text-sm, 0.75rem);
  }

  .field-list {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
    max-height: 84px;
    overflow: auto;
  }

  .field-list button {
    border: 1px solid var(--color-border);
    border-radius: 999px;
    background: var(--color-surface-elevated);
    color: var(--color-text-muted);
    padding: 3px 8px;
    cursor: pointer;
    font: 10px var(--font-mono, 'JetBrains Mono', ui-monospace, monospace);
  }

  .field-list button:hover,
  .field-list button:focus-visible {
    border-color: var(--color-primary);
    color: var(--color-primary);
    outline: none;
  }

  .empty-fields {
    color: var(--color-text-faint);
    font-size: var(--text-sm, 0.75rem);
  }

  code {
    color: var(--color-text-muted);
    font-family: var(--font-mono, 'JetBrains Mono', ui-monospace, monospace);
  }

  .status {
    margin: var(--space-3, 12px) 0 0;
    white-space: pre-line;
    font-size: var(--text-sm, 0.75rem);
  }

  .error {
    color: var(--color-error);
  }

  .valid {
    color: var(--color-success);
  }

  footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3, 12px);
    margin-top: var(--space-5, 20px);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2, 8px);
  }

  .delete-button {
    border: none;
    background: transparent;
    color: var(--color-error);
    padding: 5px 0;
    cursor: pointer;
    font-size: var(--text-sm, 0.75rem);
  }

  .delete-button:disabled {
    opacity: 0.5;
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

  @media (prefers-reduced-motion: reduce) {
    .overlay-backdrop,
    .modal {
      animation: none;
    }

    input,
    select,
    textarea {
      transition: none;
    }
  }
</style>
