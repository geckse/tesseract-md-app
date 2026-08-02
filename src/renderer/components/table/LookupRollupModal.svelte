<script lang="ts">
  import { untrack } from 'svelte'
  import { focusTrap } from '../../lib/focus-trap'
  import { computedFieldMarker } from '../../lib/computed-fields'
  import { requestConfirmation } from '../../stores/confirmation'
  import type {
    CollectionColumn,
    FileTreeNode,
    FormulaResultType,
    LookupRollupDefinition
  } from '../../types/cli'
  import Button from '../ui/Button.svelte'

  type Kind = 'lookup' | 'rollup'
  type FieldLike = Pick<
    CollectionColumn,
    | 'name'
    | 'field_type'
    | 'relation_target'
    | 'relation_field'
    | 'target_field'
    | 'relation_direction'
    | 'relation_scope'
    | 'formula'
    | 'result_type'
  >

  interface Props {
    collectionId: string
    root: string
    scope: string | null
    kind: Kind
    field?: FieldLike | null
    fields: FieldLike[]
    initialName?: string
    onbeforemutate?: () => void | Promise<void>
    onapplied?: () => void | Promise<void>
    onclose: () => void
  }

  let {
    collectionId,
    root,
    scope,
    kind,
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

  const PRESETS = [
    { label: 'Sum', formula: 'values.reduce((sum, value) => sum + value, 0)' },
    { label: 'Count', formula: 'values.length' },
    {
      label: 'Average',
      formula:
        'values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null'
    },
    {
      label: 'Minimum',
      formula: 'values.length ? values.reduce((minimum, value) => Math.min(minimum, value)) : null'
    },
    {
      label: 'Maximum',
      formula: 'values.length ? values.reduce((maximum, value) => Math.max(maximum, value)) : null'
    }
  ]

  let name = $state(untrack(() => field?.name ?? initialName))
  let relationDirection = $state<'outgoing' | 'incoming'>(
    untrack(() =>
      kind === 'rollup' && field?.relation_direction === 'Incoming' ? 'incoming' : 'outgoing'
    )
  )
  let relationScope = $state(untrack(() => field?.relation_scope ?? ''))
  let relationField = $state(untrack(() => field?.relation_field ?? ''))
  let targetField = $state(untrack(() => field?.target_field ?? ''))
  let formula = $state(
    untrack(() =>
      kind === 'rollup' ? (field?.formula ?? 'values.reduce((sum, value) => sum + value, 0)') : ''
    )
  )
  let resultType = $state<FormulaResultType>(
    untrack(() => (kind === 'rollup' ? (field?.result_type ?? 'Number') : 'Json'))
  )
  let relatedFields = $state<CollectionColumn[]>([])
  let schemaLoading = $state(false)
  let schemaError = $state<string | null>(null)
  let busy = $state(false)
  let error = $state<string | null>(null)
  let validationMessage = $state<string | null>(null)
  let schemaGeneration = 0
  let sourceScopes = $state<string[]>([])
  let scopesLoading = $state(false)
  let scopesError = $state<string | null>(null)
  let scopesGeneration = 0

  const editing = $derived(field?.field_type === 'Lookup' || field?.field_type === 'Rollup')
  const label = $derived(kind === 'lookup' ? 'Lookup' : 'Rollup')
  const normalizedOwnerScope = $derived(normalizeScope(scope))
  const outgoingRelations = $derived(
    fields.filter((candidate) => candidate.field_type === 'Relation' && candidate.relation_target)
  )
  const incomingRelations = $derived(
    relatedFields.filter(
      (candidate) =>
        candidate.field_type === 'Relation' &&
        candidate.relation_target !== null &&
        candidate.relation_target !== undefined &&
        normalizeScope(candidate.relation_target) === normalizedOwnerScope
    )
  )
  const relationOptions = $derived(
    relationDirection === 'outgoing' ? outgoingRelations : incomingRelations
  )
  const selectedOutgoingRelation = $derived(
    outgoingRelations.find((candidate) => candidate.name === relationField) ?? null
  )
  const relatedScope = $derived(
    relationDirection === 'outgoing'
      ? (selectedOutgoingRelation?.relation_target ?? '')
      : relationScope.trim().replace(/^\.\/+|^\/+|\/+$/g, '')
  )

  function normalizeScope(value: string | null | undefined): string {
    const normalized = (value ?? '')
      .trim()
      .replace(/\\/g, '/')
      .replace(/^\.\/+|^\/+|\/+$/g, '')
    return normalized === '.' ? '' : normalized
  }

  function collectFolderScopes(node: FileTreeNode, output: string[]): void {
    if (node.is_dir && normalizeScope(node.path)) output.push(normalizeScope(node.path))
    for (const child of node.children) collectFolderScopes(child, output)
  }

  $effect(() => {
    const requestedRoot = root
    const generation = ++scopesGeneration
    if (!requestedRoot) {
      sourceScopes = []
      scopesLoading = false
      scopesError = null
      return
    }
    scopesLoading = true
    scopesError = null
    void window.api.tree(requestedRoot).then(
      (tree) => {
        if (generation !== scopesGeneration) return
        const scopes: string[] = []
        collectFolderScopes(tree.root, scopes)
        sourceScopes = [...new Set(scopes)].sort((left, right) => left.localeCompare(right))
        scopesLoading = false
      },
      (cause) => {
        if (generation !== scopesGeneration) return
        sourceScopes = []
        scopesLoading = false
        scopesError = cause instanceof Error ? cause.message : String(cause)
      }
    )
  })

  $effect(() => {
    const requestedRoot = root
    const requestedScope = relatedScope
    const generation = ++schemaGeneration
    if (!requestedRoot || !requestedScope) {
      relatedFields = []
      schemaLoading = false
      schemaError = null
      return
    }
    schemaLoading = true
    schemaError = null
    // A Lookup targets exact top-level frontmatter keys, including indexed keys
    // omitted by an incomplete persisted schema. Collection columns are the
    // scoped schema unioned with every key present in matching rows; limit 0
    // transfers no row payload while still computing that full union.
    void window.api.collection(requestedRoot, requestedScope, { recursive: true, limit: 0 }).then(
      (collection) => {
        if (generation !== schemaGeneration) return
        relatedFields = collection.columns
        schemaLoading = false
      },
      (cause) => {
        if (generation !== schemaGeneration) return
        relatedFields = []
        schemaLoading = false
        schemaError = cause instanceof Error ? cause.message : String(cause)
      }
    )
  })

  function changeDirection(direction: 'outgoing' | 'incoming'): void {
    relationDirection = direction
    relationField = ''
    targetField = ''
    error = null
    validationMessage = null
  }

  function localError(): string | null {
    const fieldName = name.trim()
    if (!fieldName) return `Enter a ${label.toLowerCase()} field name`
    if (fieldName === 'title' || fieldName === 'path') return `"${fieldName}" is reserved`
    if (
      fields.some(
        (candidate) => candidate.name === fieldName && (!editing || candidate.name !== field?.name)
      )
    ) {
      return `A column named "${fieldName}" already exists`
    }
    if (relationDirection === 'incoming' && !relationScope.trim()) {
      return 'Select the folder containing incoming relations'
    }
    if (
      relationDirection === 'incoming' &&
      !editing &&
      !sourceScopes.includes(normalizeScope(relationScope))
    ) {
      return 'Select an existing folder'
    }
    if (!relationField) return 'Select a Relation field'
    if (relationDirection === 'outgoing' && !selectedOutgoingRelation?.relation_target) {
      return 'The selected Relation needs a target folder'
    }
    if (
      relationDirection === 'incoming' &&
      !incomingRelations.some((candidate) => candidate.name === relationField)
    ) {
      return `The selected Relation must target ${normalizedOwnerScope || 'the collection root'}`
    }
    if (!targetField) return 'Select a field to retrieve'
    if (schemaLoading) return 'Wait for the related schema to load'
    if (schemaError) return 'The related schema could not be loaded'
    if (kind === 'rollup' && !formula.trim()) return 'Enter a Rollup formula'
    return null
  }

  async function validate(): Promise<boolean> {
    const invalid = localError()
    if (invalid) {
      error = invalid
      validationMessage = null
      return false
    }
    if (kind === 'lookup') {
      error = null
      validationMessage = 'Lookup definition is complete'
      return true
    }
    busy = true
    error = null
    validationMessage = null
    try {
      const result = await window.api.validateRollup(root, formula, resultType)
      if (!result.valid) {
        error =
          result.diagnostics.map((diagnostic) => diagnostic.message).join('\n') ||
          'Rollup formula is not valid'
        return false
      }
      validationMessage = 'Rollup formula is valid'
      return true
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
      return false
    } finally {
      busy = false
    }
  }

  function definition(): LookupRollupDefinition {
    if (kind === 'lookup') {
      return {
        kind: 'lookup',
        relationField,
        targetField,
        relationDirection: 'outgoing'
      }
    }
    const base = { kind: 'rollup' as const, relationField, targetField, formula, resultType }
    return relationDirection === 'incoming'
      ? { ...base, relationDirection, relationScope: relationScope.trim().replace(/\/+$/, '') }
      : { ...base, relationDirection }
  }

  async function save(): Promise<void> {
    const invalid = localError()
    if (invalid) {
      error = invalid
      return
    }
    busy = true
    error = null
    validationMessage = null
    try {
      await onbeforemutate()
      if (editing && field) {
        await window.api.saveLookupRollup(
          collectionId,
          scope,
          name.trim(),
          definition(),
          field.name
        )
      } else {
        await window.api.saveLookupRollup(collectionId, scope, name.trim(), definition())
      }
      await onapplied()
      onclose()
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      busy = false
    }
  }

  async function remove(): Promise<void> {
    if (!field) return
    const confirmed = await requestConfirmation({
      title: `Remove ${label.toLowerCase()} "${field.name}"?`,
      message: 'Its materialized values will be removed from Markdown files in this scope.',
      confirmLabel: 'Remove definition from this scope',
      tone: 'danger'
    })
    if (!confirmed) return
    busy = true
    error = null
    try {
      await onbeforemutate()
      await window.api.removeLookupRollup(collectionId, scope, field.name)
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
  aria-label={editing ? `Edit ${label.toLowerCase()} ${field?.name}` : `Add ${label.toLowerCase()}`}
  tabindex="-1"
  onkeydown={onKeydown}
>
  <button
    class="overlay-backdrop"
    aria-label="Close"
    disabled={busy}
    onclick={() => !busy && onclose()}
  ></button>
  <div class="modal" use:focusTrap>
    <header>
      <span
        class="computed-mark"
        class:lookup={kind === 'lookup'}
        class:material-symbols-outlined={kind === 'lookup'}
        aria-hidden="true">{computedFieldMarker(kind === 'lookup' ? 'Lookup' : 'Rollup')}</span
      >
      <div>
        <h2>{editing ? `Edit ${label}` : `Add ${label}`}</h2>
        <p>Computed by the CLI and safely materialized into Markdown frontmatter.</p>
      </div>
    </header>

    <label>
      <span>Column name</span>
      <!-- svelte-ignore a11y_autofocus -->
      <input
        bind:value={name}
        disabled={busy}
        autofocus
        placeholder="client_domain"
        oninput={() => {
          error = null
          validationMessage = null
        }}
      />
    </label>

    {#if kind === 'rollup'}
      <fieldset>
        <legend>Relation direction</legend>
        <div class="segmented">
          <button
            type="button"
            class:active={relationDirection === 'outgoing'}
            disabled={busy}
            onclick={() => changeDirection('outgoing')}>Outgoing</button
          >
          <button
            type="button"
            class:active={relationDirection === 'incoming'}
            disabled={busy}
            onclick={() => changeDirection('incoming')}>Incoming</button
          >
        </div>
      </fieldset>
    {/if}

    {#if relationDirection === 'incoming'}
      <label>
        <span>Folder</span>
        <select
          bind:value={relationScope}
          disabled={busy || scopesLoading}
          onchange={() => {
            relationField = ''
            targetField = ''
            error = null
          }}
        >
          <option value="">{scopesLoading ? 'Loading folders…' : 'Select a folder…'}</option>
          {#if relationScope && !sourceScopes.includes(normalizeScope(relationScope))}
            <option value={relationScope}>{relationScope} (not found)</option>
          {/if}
          {#each sourceScopes as sourceScope (sourceScope)}
            <option value={sourceScope}>{sourceScope}</option>
          {/each}
        </select>
        <small>Folder containing documents whose Relation points back to the current folder.</small>
        {#if scopesError}<small class="error">{scopesError}</small>{/if}
      </label>
    {/if}

    <label>
      <span>{relationDirection === 'incoming' ? 'Incoming Relation field' : 'Relation field'}</span>
      <select
        bind:value={relationField}
        disabled={busy || (relationDirection === 'incoming' && schemaLoading)}
        onchange={() => {
          targetField = ''
          error = null
        }}
      >
        <option value="">Select a Relation…</option>
        {#if relationField && !relationOptions.some((candidate) => candidate.name === relationField)}
          <option value={relationField}
            >{relationField} ({relationDirection === 'incoming'
              ? 'does not target this folder'
              : 'not in current schema'})</option
          >
        {/if}
        {#each relationOptions as candidate (candidate.name)}
          <option value={candidate.name}>{candidate.name}</option>
        {/each}
      </select>
    </label>

    <label>
      <span>Field to retrieve</span>
      <select bind:value={targetField} disabled={busy || schemaLoading || !relatedScope}>
        <option value="">{schemaLoading ? 'Loading fields…' : 'Select a field…'}</option>
        {#if targetField && !relatedFields.some((candidate) => candidate.name === targetField)}
          <option value={targetField}>{targetField} (not in current schema)</option>
        {/if}
        {#each relatedFields as candidate (candidate.name)}
          <option value={candidate.name}>{candidate.name} · {candidate.field_type}</option>
        {/each}
      </select>
      {#if schemaError}<small class="error">{schemaError}</small>{/if}
    </label>

    {#if kind === 'rollup'}
      <label>
        <span>Result type</span>
        <select bind:value={resultType} disabled={busy}>
          {#each RESULT_TYPES as option (option.value)}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
      </label>

      <label>
        <span>Formula over <code>values</code></span>
        <textarea
          bind:value={formula}
          disabled={busy}
          rows="4"
          spellcheck="false"
          oninput={() => {
            validationMessage = null
            error = null
          }}
        ></textarea>
      </label>
      <div class="presets" aria-label="Rollup formula presets">
        {#each PRESETS as preset (preset.label)}
          <button
            type="button"
            disabled={busy}
            onclick={() => {
              formula = preset.formula
              validationMessage = null
            }}>{preset.label}</button
          >
        {/each}
      </div>
    {/if}

    {#if error}<p class="status error" role="alert">{error}</p>{/if}
    {#if !error && validationMessage}<p class="status valid" role="status">
        {validationMessage}
      </p>{/if}

    <footer>
      <div>
        {#if editing}
          <button class="delete-button" disabled={busy} onclick={() => void remove()}>
            Remove definition from this scope
          </button>
        {/if}
      </div>
      <div class="actions">
        <Button variant="secondary" size="sm" disabled={busy} onclick={onclose}>Cancel</Button>
        <Button variant="secondary" size="sm" disabled={busy} onclick={() => void validate()}>
          Validate
        </Button>
        <Button size="sm" disabled={busy} onclick={() => void save()}>
          {busy ? 'Working…' : `Save ${label}`}
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
    border: 0;
    background: var(--overlay-scrim);
  }
  .modal {
    position: relative;
    z-index: 1;
    box-sizing: border-box;
    width: min(650px, 92vw);
    max-height: 90vh;
    overflow: auto;
    padding: 20px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg, 8px);
    background: var(--color-surface);
    box-shadow: var(--shadow-modal);
  }
  header {
    display: flex;
    gap: 12px;
    margin-bottom: 16px;
  }
  header h2,
  header p {
    margin: 0;
  }
  header p,
  small {
    color: var(--color-text-dim);
    font-size: var(--text-sm, 12px);
  }
  .computed-mark {
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    border-radius: 6px;
    background: var(--color-primary-dim);
    color: var(--color-primary);
    font: 700 15px var(--font-mono);
  }
  .computed-mark.lookup {
    font-family: 'Material Symbols Outlined';
    font-size: 18px;
    font-weight: normal;
    line-height: 1;
  }
  label {
    display: grid;
    gap: 6px;
    margin: 12px 0;
    color: var(--color-text);
    font-size: var(--text-sm, 12px);
  }
  input,
  select,
  textarea {
    box-sizing: border-box;
    width: 100%;
    padding: 8px 10px;
    border: 1px solid var(--color-border);
    border-radius: 5px;
    background: var(--color-bg);
    color: var(--color-text);
    font: inherit;
  }
  textarea,
  code {
    font-family: var(--font-mono);
  }
  fieldset {
    margin: 12px 0;
    padding: 0;
    border: 0;
  }
  legend {
    margin-bottom: 6px;
    font-size: var(--text-sm, 12px);
  }
  .segmented,
  .presets,
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .segmented button,
  .presets button,
  .delete-button {
    padding: 5px 9px;
    border: 1px solid var(--color-border);
    border-radius: 5px;
    background: var(--color-bg);
    color: var(--color-text-dim);
    cursor: pointer;
  }
  .segmented button.active {
    border-color: var(--color-primary);
    background: var(--color-primary-dim);
    color: var(--color-primary);
  }
  .delete-button {
    color: var(--color-error);
  }
  .status {
    white-space: pre-wrap;
    font-size: var(--text-sm, 12px);
  }
  .error {
    color: var(--color-error);
  }
  .valid {
    color: var(--color-success, #22c55e);
  }
  footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin-top: 18px;
  }
  button:disabled,
  input:disabled,
  select:disabled,
  textarea:disabled {
    cursor: default;
    opacity: 0.55;
  }
</style>
