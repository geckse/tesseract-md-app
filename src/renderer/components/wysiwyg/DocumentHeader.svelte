<script lang="ts">
  import type { JsonValue, Schema, SchemaField } from '../../types/cli'
  import { parseFrontmatterData, serializeFrontmatter } from '../../lib/tiptap/markdown-bridge'
  import FileNameEditor from './FileNameEditor.svelte'
  import PropertyRow, { type DetectedType } from './PropertyRow.svelte'
  import AddPropertyRow from './AddPropertyRow.svelte'

  interface Props {
    frontmatterYaml: string | null
    onFrontmatterUpdate: (newYaml: string | null) => void
    schema: Schema | null
    filePath: string
    collectionPath: string
    onFileRenamed: (newPath: string) => void
  }

  let { frontmatterYaml, onFrontmatterUpdate, schema, filePath, collectionPath, onFileRenamed }: Props = $props()

  interface FrontmatterRow {
    key: string
    value: JsonValue
    id: number
  }

  let rows = $state<FrontmatterRow[]>([])
  let nextId = 0
  let lastEmittedYaml: string | null = null

  // Sync rows from frontmatterYaml prop (only on external changes)
  $effect(() => {
    if (frontmatterYaml === null) {
      if (lastEmittedYaml === null && rows.length === 0) return
      rows = []
      lastEmittedYaml = null
      return
    }
    if (frontmatterYaml === lastEmittedYaml) return
    const data = parseFrontmatterData(frontmatterYaml)
    rows = Object.entries(data).map(([key, value]) => ({
      key,
      value,
      id: nextId++,
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
    const yaml = Object.keys(data).length > 0 ? serializeFrontmatter(data) : null
    lastEmittedYaml = yaml
    onFrontmatterUpdate(yaml)
  }

  function getSchemaField(key: string): SchemaField | null {
    if (!schema?.fields) return null
    return schema.fields.find((f) => f.name === key) ?? null
  }

  /** Detect the type of a value, with schema override. */
  function detectType(key: string, value: JsonValue): DetectedType {
    const sf = getSchemaField(key)

    // Schema-driven overrides
    if (sf?.allowed_values?.length) return 'select'
    if (sf?.field_type === 'Boolean' || typeof value === 'boolean') return 'boolean'
    if (sf?.field_type === 'Number' || typeof value === 'number') return 'number'
    if (sf?.field_type === 'List' || Array.isArray(value)) return 'tags'
    if (sf?.field_type === 'Date') return 'date'

    if (typeof value === 'string') {
      // Datetime before date (more specific)
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return 'datetime'
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'date'
      if (/^https?:\/\//.test(value)) return 'url'
      if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) return 'email'
    }

    if (value !== null && typeof value === 'object' && !Array.isArray(value)) return 'complex'
    return 'text'
  }

  function getDefaultValue(type: string): JsonValue {
    switch (type) {
      case 'boolean': return false
      case 'number': return 0
      case 'date': return new Date().toISOString().slice(0, 10)
      case 'datetime': {
        const now = new Date()
        return `${now.toISOString().slice(0, 10)}T${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`
      }
      case 'url': return 'https://'
      case 'email': return ''
      case 'tags': return []
      case 'select': return ''
      case 'complex': return {}
      default: return ''
    }
  }

  function handleAdd(key: string, type: string) {
    rows.push({ key, value: getDefaultValue(type), id: nextId++ })
    emitUpdate()
  }

  function handleKeyChange(id: number, newKey: string) {
    const row = rows.find((r) => r.id === id)
    if (row) { row.key = newKey; emitUpdate() }
  }

  function handleValueChange(id: number, newValue: JsonValue) {
    const row = rows.find((r) => r.id === id)
    if (row) { row.value = newValue; emitUpdate() }
  }

  function handleRemove(id: number) {
    rows = rows.filter((r) => r.id !== id)
    emitUpdate()
  }

  let existingKeys = $derived(rows.map((r) => r.key))
</script>

<div class="dh">
  <FileNameEditor {filePath} {collectionPath} {onFileRenamed} />

  {#if rows.length > 0}
    <div class="dh-divider"></div>
    <div class="dh-properties">
      {#each rows as row (row.id)}
        <PropertyRow
          rowKey={row.key}
          value={row.value}
          fieldType={detectType(row.key, row.value)}
          schemaField={getSchemaField(row.key)}
          onKeyChange={(k) => handleKeyChange(row.id, k)}
          onValueChange={(v) => handleValueChange(row.id, v)}
          onRemove={() => handleRemove(row.id)}
        />
      {/each}
    </div>
  {/if}

  <AddPropertyRow {schema} {existingKeys} onAdd={handleAdd} />
  <div class="dh-divider"></div>
</div>

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
</style>
