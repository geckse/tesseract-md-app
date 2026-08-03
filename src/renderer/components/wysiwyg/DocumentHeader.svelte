<script lang="ts">
  import { untrack } from 'svelte'
  import type { JsonValue, RelationValue, Schema, SchemaField } from '../../types/cli'
  import type { PropertyTargetType } from '../../../preload/api'
  import {
    parseFrontmatterData,
    serializeFrontmatterPreservingFields
  } from '../../lib/tiptap/markdown-bridge'
  import { isRelationValue } from '../../lib/relation-format'
  import { isFileReferenceValue } from '../../../shared/file-reference'
  import { propertyOps, scopeForPanelFile } from '../../stores/property-ops.svelte'
  import {
    schemaPatchForPropertyTarget,
    type DocumentSchemaMutationContext
  } from '../../lib/property-types'
  import { documentInfo } from '../../stores/properties'
  import FileNameEditor from './FileNameEditor.svelte'
  import PropertyRow, { type DetectedType } from './PropertyRow.svelte'
  import AddPropertyRow from './AddPropertyRow.svelte'
  import FormulaModal from '../table/FormulaModal.svelte'
  import LookupRollupModal from '../table/LookupRollupModal.svelte'
  import {
    isComputedFieldType,
    isLookupRollupFieldType,
    type ComputedFieldType
  } from '../../lib/computed-fields'
  import { cliFeatures } from '../../lib/cli-features.svelte'
  import { exactNumberText } from '../../../shared/exact-number'
  import { workspace } from '../../stores/workspace.svelte'
  import { tableStore } from '../../stores/table.svelte'
  import { tableViewsStore } from '../../stores/table-views.svelte'
  import type { TableColumnLayout } from '../../../preload/api'

  interface Props {
    frontmatterYaml: string | null
    onFrontmatterUpdate: (newYaml: string | null) => void
    schema: Schema | null
    filePath: string
    collectionPath: string
    collectionId?: string | null
    documentTabId?: string | null
    isUntitled?: boolean
    onFileRenamed: (newPath: string) => void
    /** Flush pending document edits before a schema mutation can run the CLI. */
    onBeforeSchemaMutate?: (context: DocumentSchemaMutationContext) => void | Promise<void>
    /** Refresh the editor after schema/module mutations may have rewritten frontmatter. */
    onSchemaApplied?: (context: DocumentSchemaMutationContext) => void | Promise<void>
  }

  let {
    frontmatterYaml,
    onFrontmatterUpdate,
    schema,
    filePath,
    collectionPath,
    collectionId = null,
    documentTabId = null,
    isUntitled = false,
    onFileRenamed,
    onBeforeSchemaMutate,
    onSchemaApplied
  }: Props = $props()

  interface FrontmatterRow {
    key: string
    value: JsonValue
    id: number
    /** Keeps a newly-created empty File list rendered as File until schema refresh. */
    typeHint?: DetectedType
  }

  let rows = $state<FrontmatterRow[]>([])
  let nextId = 0
  let lastEmittedYaml: string | null = null
  /** Latest YAML backing `rows`, including our own not-yet-reflected emit. */
  let workingYaml: string | null = null
  interface FormulaDialogState {
    field: SchemaField | null
    initialName: string
    fields: SchemaField[]
    context: DocumentSchemaMutationContext
  }

  interface LookupRollupDialogState extends FormulaDialogState {
    kind: 'lookup' | 'rollup'
  }

  interface SchemaWriteRequest {
    rowId: number
    key: string
    target: PropertyTargetType
    allowedValues?: string[]
    context: DocumentSchemaMutationContext
  }

  let formulaDialog = $state<FormulaDialogState | null>(null)
  let lookupRollupDialog = $state<LookupRollupDialogState | null>(null)
  let schemaWritesPending = $state(0)
  let schemaWriteError = $state<(SchemaWriteRequest & { message: string }) | null>(null)
  let schemaWriteQueue: Promise<void> = Promise.resolve()
  const SAVE_BEFORE_SCHEMA_MESSAGE = 'Save this document, then retry the schema update.'

  $effect(() => {
    const deferred = schemaWriteError
    if (isUntitled || deferred?.message !== SAVE_BEFORE_SCHEMA_MESSAGE) return
    const context = mutationContext()
    if (!context) return
    const { message: _message, ...request } = deferred
    queueSchemaWrite({ ...request, context })
  })

  $effect(() => {
    if (collectionPath) void cliFeatures.initModules(collectionPath)
  })

  // Sync rows from frontmatterYaml prop (only on external changes)
  $effect(() => {
    const emittedYaml = untrack(() => lastEmittedYaml)
    if (frontmatterYaml === null) {
      if (emittedYaml === null && untrack(() => rows.length) === 0) return
      rows = []
      lastEmittedYaml = null
      workingYaml = null
      return
    }
    if (frontmatterYaml === emittedYaml) return
    workingYaml = frontmatterYaml
    const data = parseFrontmatterData(frontmatterYaml)
    rows = Object.entries(data).map(([key, value]) => ({
      key,
      value,
      id: nextId++
    }))
  })

  function emitUpdate() {
    if (rows.length === 0) {
      lastEmittedYaml = null
      onFrontmatterUpdate(null)
      return
    }
    const data: Record<string, JsonValue> = {}
    for (const row of rows) {
      if (row.key.trim()) {
        data[row.key.trim()] = row.value
      }
    }
    // The live schema is the preferred ownership source, but it can lag a
    // just-completed module run. Persisted provenance/diagnostics keep the
    // exact YAML pair protected during that window. Invalid/missing overlay
    // tombstones deliberately do not claim ownership: the same key may have
    // become an ordinary user field after its definition was removed.
    const computedKeys = new Set(
      schema?.fields
        .filter((field) => isComputedFieldType(field.field_type))
        .map((field) => field.name) ?? []
    )
    const indexedDocument = $documentInfo
    for (const key of Object.keys(indexedDocument?.computed_fields ?? {})) computedKeys.add(key)
    for (const [key, diagnostic] of Object.entries(indexedDocument?.computed_field_errors ?? {})) {
      if (diagnostic.code !== 'invalid_schema' && diagnostic.code !== 'schema_overlay_missing') {
        computedKeys.add(key)
      }
    }
    const yaml =
      Object.keys(data).length > 0
        ? serializeFrontmatterPreservingFields(workingYaml, data, [...computedKeys])
        : null
    workingYaml = yaml
    lastEmittedYaml = yaml
    onFrontmatterUpdate(yaml)
  }

  function getSchemaField(key: string): SchemaField | null {
    if (!schema?.fields) return null
    return schema.fields.find((f) => f.name === key) ?? null
  }

  /** Lookup has no declared result_type: it preserves the target value's shape. */
  function detectLookupType(value: JsonValue): DetectedType {
    if (exactNumberText(value) !== null || typeof value === 'number') return 'number'
    if (typeof value === 'boolean') return 'boolean'
    if (Array.isArray(value)) return 'tags'
    if (value !== null && typeof value === 'object') return 'complex'
    if (typeof value !== 'string') return 'text'
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return 'datetime'
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'date'
    if (/^https?:\/\//.test(value)) return 'url'
    if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) return 'email'
    return 'text'
  }

  /** Detect the type of a value, with schema override. */
  function detectType(key: string, value: JsonValue): DetectedType {
    const sf = getSchemaField(key)
    if (sf?.field_type === 'Formula' || sf?.field_type === 'Rollup') {
      switch (sf.result_type) {
        case 'Number':
          return 'number'
        case 'Boolean':
          return 'boolean'
        case 'Date':
          return 'date'
        case 'DateTime':
          return 'datetime'
        case 'List':
          return 'tags'
        case 'Json':
          return 'complex'
        default:
          return 'text'
      }
    }
    // Computed values that happen to look like links remain computed output;
    // classify Lookup by JSON shape before File/Relation heuristics run.
    if (sf?.field_type === 'Lookup') return detectLookupType(value)

    // Explicit File schema pins support empty and extensionless values. An
    // unambiguous File value then wins over a stale legacy Relation label so
    // the editor and read-only properties panel classify the same data alike.
    if (sf?.field_type === 'File') return 'file'
    if (sf?.field_type === 'Json') return 'complex'
    const typeHint = rows.find((candidate) => candidate.key === key)?.typeHint
    if (typeHint === 'file' && Array.isArray(value)) return 'file'
    if (isFileReferenceValue(value)) return 'file'
    if (sf?.field_type === 'Relation') return 'relation'
    // Value-shape fallback keeps ad-hoc fields and pre-refresh schemas usable.
    // This includes homogeneous lists of plain `.md` filenames.
    if (isRelationValue(value)) return 'relation'
    if (sf?.allowed_values?.length) return 'select'
    if (sf?.field_type === 'Boolean' || typeof value === 'boolean') return 'boolean'
    if (sf?.field_type === 'Number' || typeof value === 'number') return 'number'
    if (sf?.field_type === 'List' || Array.isArray(value)) return 'tags'

    if (typeof value === 'string') {
      // Datetime before date (more specific)
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return 'datetime'
      if (sf?.field_type === 'Date') return 'date'
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'date'
      if (/^https?:\/\//.test(value)) return 'url'
      if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) return 'email'
    }

    if (sf?.field_type === 'Date') return 'date'
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) return 'complex'
    if (typeHint) return typeHint
    return 'text'
  }

  /**
   * Phase 42: server-resolved relations from the properties store's populated
   * `get` — only trusted when it describes THIS file (the store follows the
   * selected file, which normally matches the open document).
   */
  function relationValuesFor(key: string): RelationValue[] | undefined {
    if (!$documentInfo || $documentInfo.path !== filePath) return undefined
    return $documentInfo.relations?.[key]
  }

  function getDefaultValue(type: string): JsonValue {
    switch (type) {
      case 'boolean':
        return false
      case 'number':
        return 0
      case 'date':
        return new Date().toISOString().slice(0, 10)
      case 'datetime': {
        const now = new Date()
        return `${now.toISOString().slice(0, 10)}T${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`
      }
      case 'url':
        return 'https://'
      case 'email':
        return ''
      case 'tags':
        return []
      case 'select':
        return ''
      case 'relation':
        return ''
      case 'file':
        return []
      case 'complex':
        return {}
      default:
        return ''
    }
  }

  function mutationContext(): DocumentSchemaMutationContext | null {
    if (!collectionId || !documentTabId) return null
    return {
      tabId: documentTabId,
      filePath,
      collectionPath,
      collectionId,
      scope: panelScope
    }
  }

  function handleAdd(
    key: string,
    type: PropertyTargetType,
    options?: { allowedValues?: string[] }
  ) {
    const alreadyInSchema = getSchemaField(key) !== null
    const row = {
      key,
      value: getDefaultValue(type),
      id: nextId++,
      typeHint: type as DetectedType
    }
    rows.push(row)
    emitUpdate()
    if (alreadyInSchema) return

    const context = mutationContext()
    const request: SchemaWriteRequest | null = context
      ? {
          rowId: row.id,
          key,
          target: type,
          allowedValues: options?.allowedValues,
          context
        }
      : null
    if (isUntitled || !request) {
      schemaWriteError = {
        rowId: row.id,
        key,
        target: type,
        allowedValues: options?.allowedValues,
        context: request?.context ?? {
          tabId: documentTabId ?? '',
          filePath,
          collectionPath,
          collectionId: collectionId ?? '',
          scope: panelScope
        },
        message: SAVE_BEFORE_SCHEMA_MESSAGE
      }
      return
    }
    queueSchemaWrite(request)
  }

  async function persistSchemaField(request: SchemaWriteRequest): Promise<void> {
    schemaWritesPending += 1
    schemaWriteError = null
    try {
      await onBeforeSchemaMutate?.(request.context)
      const row = rows.find((candidate) => candidate.id === request.rowId)
      if (!row || row.key.trim() !== request.key) return

      const patch = schemaPatchForPropertyTarget(request.target)
      if (request.target === 'select') patch.allowedValues = request.allowedValues
      await propertyOps.applyOverlayFieldPatch(request.context.scope, request.key, patch, {
        id: request.context.collectionId,
        path: request.context.collectionPath
      })
      await onSchemaApplied?.(request.context)
    } catch (error) {
      schemaWriteError = {
        ...request,
        message: error instanceof Error ? error.message : String(error)
      }
    } finally {
      schemaWritesPending -= 1
    }
  }

  function queueSchemaWrite(request: SchemaWriteRequest): void {
    schemaWriteError = null
    schemaWriteQueue = schemaWriteQueue.then(
      () => persistSchemaField(request),
      () => persistSchemaField(request)
    )
  }

  function openNewFormula(key: string): void {
    const context = mutationContext()
    if (!context) return
    formulaDialog = {
      field: null,
      initialName: key,
      fields: [...formulaDialogFields],
      context
    }
  }

  function openFormulaEditor(field: SchemaField): void {
    const context = mutationContext()
    if (!context) return
    formulaDialog = {
      field,
      initialName: '',
      fields: [...formulaDialogFields],
      context
    }
  }

  function closeFormulaModal(): void {
    formulaDialog = null
  }

  function openNewLookupRollup(kind: 'lookup' | 'rollup', key: string): void {
    const context = mutationContext()
    if (!context || !cliFeatures.supportsLookupRollup) return
    lookupRollupDialog = {
      kind,
      field: null,
      initialName: key,
      fields: [...formulaDialogFields],
      context
    }
  }

  function openLookupRollupEditor(field: SchemaField): void {
    const context = mutationContext()
    if (
      !context ||
      !isLookupRollupFieldType(field.field_type) ||
      !cliFeatures.supportsLookupRollup
    ) {
      return
    }
    lookupRollupDialog = {
      kind: field.field_type === 'Lookup' ? 'lookup' : 'rollup',
      field,
      initialName: '',
      fields: [...formulaDialogFields],
      context
    }
  }

  function handleKeyChange(id: number, newKey: string) {
    const row = rows.find((r) => r.id === id)
    if (row) {
      row.key = newKey
      emitUpdate()
    }
  }

  function handleValueChange(id: number, newValue: JsonValue) {
    const row = rows.find((r) => r.id === id)
    if (row) {
      row.value = newValue
      emitUpdate()
    }
  }

  function handleRemove(id: number) {
    rows = rows.filter((r) => r.id !== id)
    emitUpdate()
  }

  // Phase 41: recursive type conversion / rename. The header does NOT mutate
  // the row locally — the change flows disk → file-sync → editor reload, so
  // the triggering file is never double-applied.
  function handleTypeChangeRequest(key: string, value: JsonValue, target: DetectedType) {
    propertyOps.openConvert({ kind: 'panel', filePath }, key, target, detectType(key, value))
  }

  function handleRenameRequest(key: string) {
    propertyOps.openRename({ kind: 'panel', filePath }, key)
  }

  let panelScope = $derived(scopeForPanelFile(filePath))
  let existingKeys = $derived(rows.map((r) => r.key))

  // The database layout is presentation state only. Keep `rows` in parsed YAML
  // order so emitUpdate() preserves the document's actual frontmatter ordering.
  let propertyColumnLayout = $derived.by<TableColumnLayout[]>(() => {
    if (!collectionId) return []
    const folderPath = panelScope ?? ''
    const matchingTabs = Object.values(workspace.tabs).filter(
      (candidate) =>
        candidate.kind === 'table' &&
        candidate.folderPath.replace(/^\.\/+/, '').replace(/^\/+|\/+$/g, '') === folderPath
    )
    // Prefer the most recently-created matching table tab: it reflects the
    // named/default view the user was actually working in this window.
    for (let index = matchingTabs.length - 1; index >= 0; index -= 1) {
      const candidate = matchingTabs[index]
      if (candidate.kind !== 'table') continue
      const current = tableStore.mergedConfig(candidate.id).columns
      if (current.length > 0) return current
      if (candidate.activeViewId) {
        const saved = tableViewsStore.getById(collectionId, folderPath, candidate.activeViewId)
        if (saved?.config.columns.length) return saved.config.columns
      }
    }
    return (
      tableViewsStore.getDefaultColumns(collectionId, folderPath) ??
      tableViewsStore.getDefault(collectionId, folderPath)?.config.columns ??
      []
    )
  })

  function orderForDisplay<T>(items: T[], keyOf: (item: T) => string): T[] {
    if (propertyColumnLayout.length === 0) return items
    const order = new Map(propertyColumnLayout.map((column) => [column.name, column.order]))
    return items
      .map((item, sourceIndex) => ({ item, sourceIndex }))
      .sort((left, right) => {
        const leftOrder = order.get(keyOf(left.item)) ?? Number.MAX_SAFE_INTEGER
        const rightOrder = order.get(keyOf(right.item)) ?? Number.MAX_SAFE_INTEGER
        return leftOrder - rightOrder || left.sourceIndex - right.sourceIndex
      })
      .map(({ item }) => item)
  }

  let displayRows = $derived(orderForDisplay(rows, (row) => row.key))
  let missingComputedFields = $derived.by(() => {
    const materialized = new Set(rows.map((row) => row.key))
    return orderForDisplay(
      (schema?.fields ?? []).filter(
        (field) => isComputedFieldType(field.field_type) && !materialized.has(field.name)
      ),
      (field) => field.name
    )
  })
  let formulaDialogFields = $derived.by<SchemaField[]>(() => {
    const fields = new Map((schema?.fields ?? []).map((field) => [field.name, field]))
    for (const row of rows) {
      if (!row.key.trim() || fields.has(row.key)) continue
      fields.set(row.key, {
        name: row.key,
        field_type: 'Mixed',
        description: null,
        occurrence_count: 1,
        sample_values: [],
        allowed_values: null,
        required: false,
        relation_target: null,
        formula: null,
        result_type: null
      })
    }
    return [...fields.values()]
  })

  $effect(() => {
    const id = collectionId
    const folderPath = panelScope ?? ''
    if (!id || typeof window.api?.listTableViews !== 'function') return
    untrack(() => {
      void tableViewsStore.load(id, folderPath)
    })
  })
</script>

<div class="dh">
  <FileNameEditor {filePath} {collectionPath} {isUntitled} {onFileRenamed} />

  {#if rows.length > 0 || missingComputedFields.length > 0}
    <div class="dh-divider"></div>
    <div class="dh-properties">
      {#each displayRows as row (row.id)}
        {@const schemaField = getSchemaField(row.key)}
        <PropertyRow
          rowKey={row.key}
          value={row.value}
          fieldType={detectType(row.key, row.value)}
          {schemaField}
          computedType={schemaField && isComputedFieldType(schemaField.field_type)
            ? (schemaField.field_type as ComputedFieldType)
            : null}
          computedError={$documentInfo?.path === filePath
            ? $documentInfo.computed_field_errors?.[row.key]
            : undefined}
          onKeyChange={(k) => handleKeyChange(row.id, k)}
          onValueChange={(v) => handleValueChange(row.id, v)}
          onRemove={() => handleRemove(row.id)}
          onTypeChange={(t) => handleTypeChangeRequest(row.key, row.value, t)}
          onRename={() => handleRenameRequest(row.key)}
          onEditFormula={schemaField?.field_type === 'Formula' && collectionId
            ? () => openFormulaEditor(schemaField)
            : undefined}
          onEditComputed={schemaField &&
          isLookupRollupFieldType(schemaField.field_type) &&
          collectionId &&
          cliFeatures.supportsLookupRollup
            ? () => openLookupRollupEditor(schemaField)
            : undefined}
          settingsScope={panelScope}
          relationValues={relationValuesFor(row.key)}
          {collectionPath}
          {collectionId}
        />
      {/each}
      {#each missingComputedFields as schemaField (schemaField.name)}
        <PropertyRow
          rowKey={schemaField.name}
          value={null}
          fieldType={detectType(schemaField.name, null)}
          {schemaField}
          computedType={schemaField.field_type as ComputedFieldType}
          computedError={$documentInfo?.path === filePath
            ? $documentInfo.computed_field_errors?.[schemaField.name]
            : undefined}
          onKeyChange={() => undefined}
          onValueChange={() => undefined}
          onRemove={() => undefined}
          onEditFormula={collectionId && schemaField.field_type === 'Formula'
            ? () => openFormulaEditor(schemaField)
            : undefined}
          onEditComputed={collectionId &&
          isLookupRollupFieldType(schemaField.field_type) &&
          cliFeatures.supportsLookupRollup
            ? () => openLookupRollupEditor(schemaField)
            : undefined}
          settingsScope={panelScope}
          {collectionPath}
          {collectionId}
        />
      {/each}
    </div>
  {/if}

  <AddPropertyRow
    {schema}
    {existingKeys}
    onAdd={handleAdd}
    onAddFormula={collectionId && !isUntitled ? openNewFormula : undefined}
    onAddComputed={collectionId && !isUntitled && cliFeatures.supportsLookupRollup
      ? openNewLookupRollup
      : undefined}
  />
  {#if schemaWritesPending > 0}
    <p class="dh-schema-status" role="status">Adding field to schema…</p>
  {:else if schemaWriteError}
    <div class="dh-schema-error" role="alert">
      <span>Property added, but “{schemaWriteError.key}” was not added to the schema.</span>
      {#if isUntitled}
        <span>It will retry automatically after the document is saved.</span>
      {:else}
        <button
          type="button"
          onclick={() => {
            const context = mutationContext()
            if (!context) return
            const { message: _message, ...request } = schemaWriteError!
            queueSchemaWrite({ ...request, context })
          }}
        >
          Retry
        </button>
      {/if}
      <span class="dh-schema-error-detail">{schemaWriteError.message}</span>
    </div>
  {/if}
  <div class="dh-divider"></div>
</div>

{#if formulaDialog}
  <FormulaModal
    collectionId={formulaDialog.context.collectionId}
    root={formulaDialog.context.collectionPath}
    scope={formulaDialog.context.scope}
    field={formulaDialog.field}
    fields={formulaDialog.fields}
    initialName={formulaDialog.initialName}
    onbeforemutate={() => onBeforeSchemaMutate?.(formulaDialog!.context)}
    onapplied={() => onSchemaApplied?.(formulaDialog!.context)}
    onclose={closeFormulaModal}
  />
{/if}

{#if lookupRollupDialog}
  <LookupRollupModal
    collectionId={lookupRollupDialog.context.collectionId}
    root={lookupRollupDialog.context.collectionPath}
    scope={lookupRollupDialog.context.scope}
    kind={lookupRollupDialog.kind}
    field={lookupRollupDialog.field}
    fields={lookupRollupDialog.fields}
    initialName={lookupRollupDialog.initialName}
    onbeforemutate={() => onBeforeSchemaMutate?.(lookupRollupDialog!.context)}
    onapplied={() => onSchemaApplied?.(lookupRollupDialog!.context)}
    onclose={() => (lookupRollupDialog = null)}
  />
{/if}

<style>
  .dh {
    max-width: 60rem;
    min-width: 20rem;
    margin: 0 auto;
    padding: 1rem 4rem 0;
  }
  .dh-divider {
    height: 1px;
    background: var(--color-border, #27272a);
    margin: 4px 0;
  }
  .dh-properties {
    display: flex;
    flex-direction: column;
    gap: 0;
  }
  .dh-schema-status,
  .dh-schema-error {
    margin: 2px 6px 4px 30px;
    font-family: var(--font-mono, 'JetBrains Mono'), monospace;
    font-size: 11px;
  }
  .dh-schema-status {
    color: var(--color-text-dim, #71717a);
  }
  .dh-schema-error {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    color: var(--color-danger, #ef4444);
  }
  .dh-schema-error button {
    border: 0;
    padding: 0;
    background: none;
    color: inherit;
    font: inherit;
    text-decoration: underline;
    cursor: pointer;
  }
  .dh-schema-error-detail {
    flex-basis: 100%;
    color: var(--color-text-dim, #71717a);
  }
</style>
