<script lang="ts">
  import type { JsonValue } from '../../types/cli'
  import { parseFrontmatterData, serializeFrontmatter } from '../../lib/tiptap/markdown-bridge'

  interface Props {
    frontmatterYaml: string | null
    onUpdate: (newYaml: string | null) => void
  }

  let { frontmatterYaml, onUpdate }: Props = $props()

  interface FrontmatterRow {
    key: string
    value: JsonValue
    id: number
  }

  let rows = $state<FrontmatterRow[]>([])
  let nextId = 0
  let newTagInputs = $state<Record<number, string>>({})

  // Sync rows from frontmatterYaml prop
  $effect(() => {
    if (frontmatterYaml === null) {
      rows = []
      return
    }
    const data = parseFrontmatterData(frontmatterYaml)
    rows = Object.entries(data).map(([key, value]) => ({
      key,
      value,
      id: nextId++,
    }))
  })

  function emitUpdate() {
    if (rows.length === 0) {
      onUpdate(null)
      return
    }
    const data: Record<string, JsonValue> = {}
    for (const row of rows) {
      if (row.key.trim()) {
        data[row.key.trim()] = row.value
      }
    }
    onUpdate(Object.keys(data).length > 0 ? serializeFrontmatter(data) : null)
  }

  function detectType(value: JsonValue): 'text' | 'number' | 'boolean' | 'date' | 'array' | 'complex' {
    if (typeof value === 'boolean') return 'boolean'
    if (typeof value === 'number') return 'number'
    if (Array.isArray(value)) return 'array'
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return 'date'
    if (value !== null && typeof value === 'object') return 'complex'
    return 'text'
  }

  function updateKey(row: FrontmatterRow, newKey: string) {
    row.key = newKey
    emitUpdate()
  }

  function updateValue(row: FrontmatterRow, newValue: JsonValue) {
    row.value = newValue
    emitUpdate()
  }

  function addProperty() {
    rows.push({ key: '', value: '', id: nextId++ })
    // Don't emit yet — user needs to fill in the key
  }

  function removeProperty(id: number) {
    rows = rows.filter((r) => r.id !== id)
    emitUpdate()
  }

  function addTag(row: FrontmatterRow) {
    const input = (newTagInputs[row.id] ?? '').trim()
    if (!input) return
    if (Array.isArray(row.value)) {
      row.value = [...row.value, input]
    } else {
      row.value = [input]
    }
    newTagInputs[row.id] = ''
    emitUpdate()
  }

  function removeTag(row: FrontmatterRow, index: number) {
    if (Array.isArray(row.value)) {
      row.value = row.value.filter((_, i) => i !== index)
      emitUpdate()
    }
  }

  function handleTagKeydown(event: KeyboardEvent, row: FrontmatterRow) {
    if (event.key === 'Enter') {
      event.preventDefault()
      addTag(row)
    }
  }
</script>

{#if rows.length > 0 || frontmatterYaml !== null}
  <div class="frontmatter-editor">
    <div class="fm-header">
      <span class="fm-title">Properties</span>
      <button class="fm-add-btn" onclick={addProperty} title="Add property" aria-label="Add property">
        <span class="material-symbols-outlined">add</span>
      </button>
    </div>

    <div class="fm-rows">
      {#each rows as row (row.id)}
        {@const type = detectType(row.value)}
        <div class="fm-row">
          <input
            class="fm-key"
            type="text"
            value={row.key}
            placeholder="key"
            aria-label="Property name"
            oninput={(e) => updateKey(row, (e.target as HTMLInputElement).value)}
          />
          <div class="fm-value-cell">
            {#if type === 'boolean'}
              <button
                class="fm-toggle"
                class:fm-toggle-on={row.value === true}
                onclick={() => updateValue(row, !row.value)}
                aria-label="Toggle {row.key}"
              >
                <span class="fm-toggle-knob"></span>
              </button>
            {:else if type === 'number'}
              <input
                class="fm-value"
                type="number"
                value={row.value as number}
                aria-label="{row.key} value"
                oninput={(e) => updateValue(row, Number((e.target as HTMLInputElement).value))}
              />
            {:else if type === 'date'}
              <input
                class="fm-value"
                type="date"
                value={row.value as string}
                aria-label="{row.key} value"
                oninput={(e) => updateValue(row, (e.target as HTMLInputElement).value)}
              />
            {:else if type === 'array'}
              <div class="fm-tags">
                {#each (row.value as JsonValue[]) as tag, i}
                  <span class="fm-tag">
                    {String(tag)}
                    <button class="fm-tag-remove" onclick={() => removeTag(row, i)} aria-label="Remove tag">×</button>
                  </span>
                {/each}
                <input
                  class="fm-tag-input"
                  type="text"
                  placeholder="+ tag"
                  aria-label="Add tag to {row.key}"
                  bind:value={newTagInputs[row.id]}
                  onkeydown={(e) => handleTagKeydown(e, row)}
                  onblur={() => addTag(row)}
                />
              </div>
            {:else if type === 'complex'}
              <textarea
                class="fm-value fm-textarea"
                value={JSON.stringify(row.value, null, 2)}
                aria-label="{row.key} value"
                oninput={(e) => {
                  try {
                    updateValue(row, JSON.parse((e.target as HTMLTextAreaElement).value))
                  } catch {
                    // Keep raw text until valid JSON
                  }
                }}
              ></textarea>
            {:else}
              <input
                class="fm-value"
                type="text"
                value={String(row.value ?? '')}
                aria-label="{row.key} value"
                oninput={(e) => updateValue(row, (e.target as HTMLInputElement).value)}
              />
            {/if}
          </div>
          <button class="fm-remove-btn" onclick={() => removeProperty(row.id)} title="Remove property" aria-label="Remove property">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>
      {/each}
    </div>
  </div>
{/if}

<style>
  .frontmatter-editor {
    border-bottom: 1px solid var(--color-border, #27272a);
    padding: var(--space-3, 12px) var(--space-4, 16px);
    background: var(--color-surface, #161617);
  }

  .fm-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: var(--space-2, 8px);
  }

  .fm-title {
    font-size: var(--text-sm, 12px);
    font-weight: var(--weight-semibold, 600);
    color: var(--color-text-dim, #71717a);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .fm-add-btn {
    background: none;
    border: 1px solid var(--color-border, #27272a);
    color: var(--color-text-dim, #71717a);
    cursor: pointer;
    padding: 2px;
    border-radius: var(--radius-sm, 4px);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all var(--transition-fast, 150ms ease);
  }

  .fm-add-btn:hover {
    color: var(--color-text, #e4e4e7);
    border-color: var(--color-border-hover, #3f3f46);
  }

  .fm-add-btn .material-symbols-outlined {
    font-size: 16px;
  }

  .fm-rows {
    display: flex;
    flex-direction: column;
    gap: var(--space-1, 4px);
  }

  .fm-row {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2, 8px);
  }

  .fm-key {
    width: 120px;
    flex-shrink: 0;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-sm, 4px);
    color: var(--color-primary, #00E5FF);
    font-size: var(--text-sm, 12px);
    font-family: var(--font-mono, monospace);
    padding: 4px 6px;
    transition: border-color var(--transition-fast, 150ms ease);
  }

  .fm-key:hover,
  .fm-key:focus {
    border-color: var(--color-border, #27272a);
    outline: none;
  }

  .fm-value-cell {
    flex: 1;
    min-width: 0;
  }

  .fm-value {
    width: 100%;
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-sm, 4px);
    color: var(--color-text, #e4e4e7);
    font-size: var(--text-sm, 12px);
    font-family: var(--font-mono, monospace);
    padding: 4px 6px;
    transition: border-color var(--transition-fast, 150ms ease);
  }

  .fm-value:hover,
  .fm-value:focus {
    border-color: var(--color-border, #27272a);
    outline: none;
  }

  .fm-textarea {
    min-height: 60px;
    resize: vertical;
  }

  /* Toggle switch */
  .fm-toggle {
    width: 32px;
    height: 18px;
    border-radius: var(--radius-full, 9999px);
    background: var(--color-border, #27272a);
    border: none;
    cursor: pointer;
    position: relative;
    padding: 0;
    margin: 4px 0;
    transition: background var(--transition-fast, 150ms ease);
  }

  .fm-toggle-on {
    background: var(--color-primary, #00E5FF);
  }

  .fm-toggle-knob {
    display: block;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--color-text-white, #ffffff);
    position: absolute;
    top: 2px;
    left: 2px;
    transition: transform var(--transition-fast, 150ms ease);
  }

  .fm-toggle-on .fm-toggle-knob {
    transform: translateX(14px);
  }

  /* Tags */
  .fm-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
    padding: 2px 0;
  }

  .fm-tag {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 2px 8px;
    border-radius: var(--radius-full, 9999px);
    background: var(--color-primary-dim, rgba(0, 229, 255, 0.1));
    color: var(--color-primary, #00E5FF);
    font-size: var(--text-xs, 10px);
    font-family: var(--font-mono, monospace);
  }

  .fm-tag-remove {
    background: none;
    border: none;
    color: var(--color-primary, #00E5FF);
    cursor: pointer;
    padding: 0;
    font-size: 12px;
    line-height: 1;
    opacity: 0.6;
    transition: opacity var(--transition-fast, 150ms ease);
  }

  .fm-tag-remove:hover {
    opacity: 1;
  }

  .fm-tag-input {
    background: transparent;
    border: none;
    color: var(--color-text, #e4e4e7);
    font-size: var(--text-xs, 10px);
    font-family: var(--font-mono, monospace);
    padding: 2px 4px;
    width: 60px;
    outline: none;
  }

  .fm-tag-input::placeholder {
    color: var(--color-text-dim, #71717a);
  }

  .fm-remove-btn {
    background: none;
    border: none;
    color: var(--color-text-dim, #71717a);
    cursor: pointer;
    padding: 4px;
    border-radius: var(--radius-sm, 4px);
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: all var(--transition-fast, 150ms ease);
    flex-shrink: 0;
  }

  .fm-row:hover .fm-remove-btn {
    opacity: 1;
  }

  .fm-remove-btn:hover {
    color: var(--color-error, #ef4444);
  }

  .fm-remove-btn .material-symbols-outlined {
    font-size: 14px;
  }

  @media (prefers-reduced-motion: reduce) {
    .fm-add-btn,
    .fm-key,
    .fm-value,
    .fm-toggle,
    .fm-toggle-knob,
    .fm-tag-remove,
    .fm-remove-btn {
      transition: none;
    }
  }
</style>
