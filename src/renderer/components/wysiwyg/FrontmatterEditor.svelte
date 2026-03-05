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
  let collapsed = $state(false)

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
    collapsed = false
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

  function getStatusColor(value: string): string | null {
    const v = value.toLowerCase()
    if (v === 'published' || v === 'active' || v === 'done' || v === 'complete') return '#22c55e'
    if (v === 'draft' || v === 'wip' || v === 'in-progress') return '#eab308'
    if (v === 'archived' || v === 'deprecated') return '#71717a'
    return null
  }
</script>

{#if rows.length > 0 || frontmatterYaml !== null}
  <div class="fm-card">
    <button class="fm-header" onclick={() => (collapsed = !collapsed)}>
      <span class="fm-label">Frontmatter</span>
      <div class="fm-header-actions">
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <span
          class="material-symbols-outlined fm-add-icon"
          role="button"
          tabindex="0"
          onclick={(e: MouseEvent) => { e.stopPropagation(); addProperty(); }}
          title="Add property"
        >add</span>
        <span class="material-symbols-outlined fm-chevron" class:open={!collapsed}>expand_more</span>
      </div>
    </button>

    {#if !collapsed}
      <div class="fm-body">
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
                  class="fm-val"
                  type="number"
                  value={row.value as number}
                  aria-label="{row.key} value"
                  oninput={(e) => updateValue(row, Number((e.target as HTMLInputElement).value))}
                />
              {:else if type === 'date'}
                <input
                  class="fm-val"
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
                      <button class="fm-tag-remove" onclick={() => removeTag(row, i)} aria-label="Remove tag">&times;</button>
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
                  class="fm-val fm-textarea"
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
                {@const statusColor = typeof row.value === 'string' ? getStatusColor(row.value) : null}
                {#if statusColor}
                  <input
                    class="fm-val fm-status"
                    style="color: {statusColor}; border-color: {statusColor}40;"
                    type="text"
                    value={String(row.value ?? '')}
                    aria-label="{row.key} value"
                    oninput={(e) => updateValue(row, (e.target as HTMLInputElement).value)}
                  />
                {:else}
                  <input
                    class="fm-val"
                    type="text"
                    value={String(row.value ?? '')}
                    aria-label="{row.key} value"
                    oninput={(e) => updateValue(row, (e.target as HTMLInputElement).value)}
                  />
                {/if}
              {/if}
            </div>
            <button class="fm-remove-btn" onclick={() => removeProperty(row.id)} title="Remove property" aria-label="Remove property">
              <span class="material-symbols-outlined">close</span>
            </button>
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}

<style>
  .fm-card {
    background: #161617;
    border: 1px solid #27272a;
    border-radius: 8px;
    margin: 1rem 4rem 0 4rem;
    overflow: hidden;
  }

  .fm-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 10px 16px;
    background: none;
    border: none;
    color: #71717a;
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    cursor: pointer;
    transition: color 150ms ease;
  }

  .fm-header:hover {
    color: #e4e4e7;
  }

  .fm-header-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .fm-add-icon {
    font-size: 16px;
    opacity: 0;
    cursor: pointer;
    border-radius: 4px;
    padding: 2px;
    transition: opacity 150ms ease, background 150ms ease;
  }

  .fm-header:hover .fm-add-icon {
    opacity: 0.6;
  }

  .fm-add-icon:hover {
    opacity: 1 !important;
    background: rgba(255, 255, 255, 0.06);
  }

  .fm-chevron {
    font-size: 18px;
    transition: transform 150ms ease;
  }

  .fm-chevron.open {
    transform: rotate(180deg);
  }

  .fm-label {
    user-select: none;
  }

  .fm-body {
    padding: 0 16px 12px;
    border-top: 1px solid #27272a;
    padding-top: 12px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .fm-row {
    display: flex;
    align-items: baseline;
    gap: 16px;
    padding: 3px 0;
  }

  .fm-key {
    width: 110px;
    flex-shrink: 0;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 4px;
    color: #71717a;
    font-family: 'JetBrains Mono', monospace;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 3px 6px;
    transition: border-color 150ms ease, color 150ms ease;
  }

  .fm-key:hover,
  .fm-key:focus {
    border-color: #27272a;
    color: #a1a1aa;
    outline: none;
  }

  .fm-value-cell {
    flex: 1;
    min-width: 0;
    display: flex;
    justify-content: flex-end;
  }

  .fm-val {
    width: 100%;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 4px;
    color: #e4e4e7;
    font-size: 12px;
    font-family: 'JetBrains Mono', monospace;
    padding: 3px 6px;
    text-align: right;
    transition: border-color 150ms ease;
  }

  .fm-val:hover,
  .fm-val:focus {
    border-color: #27272a;
    outline: none;
  }

  .fm-val.fm-status {
    border: 1px solid;
    border-radius: 9999px;
    padding: 2px 10px;
    font-size: 10px;
    font-weight: 600;
    width: auto;
    text-align: center;
  }

  .fm-textarea {
    min-height: 60px;
    resize: vertical;
    text-align: left;
  }

  /* Toggle switch */
  .fm-toggle {
    width: 32px;
    height: 18px;
    border-radius: 9999px;
    background: #27272a;
    border: none;
    cursor: pointer;
    position: relative;
    padding: 0;
    margin: 2px 0;
    transition: background 150ms ease;
  }

  .fm-toggle-on {
    background: #00E5FF;
  }

  .fm-toggle-knob {
    display: block;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #ffffff;
    position: absolute;
    top: 2px;
    left: 2px;
    transition: transform 150ms ease;
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
    justify-content: flex-end;
    padding: 1px 0;
  }

  .fm-tag {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 2px 8px;
    border-radius: 9999px;
    border: 1px solid rgba(0, 229, 255, 0.25);
    background: transparent;
    color: #00E5FF;
    font-size: 10px;
    font-family: 'JetBrains Mono', monospace;
    transition: border-color 150ms ease;
  }

  .fm-tag:hover {
    border-color: rgba(0, 229, 255, 0.5);
  }

  .fm-tag-remove {
    background: none;
    border: none;
    color: #00E5FF;
    cursor: pointer;
    padding: 0;
    font-size: 12px;
    line-height: 1;
    opacity: 0.5;
    transition: opacity 150ms ease;
  }

  .fm-tag-remove:hover {
    opacity: 1;
  }

  .fm-tag-input {
    background: transparent;
    border: none;
    color: #e4e4e7;
    font-size: 10px;
    font-family: 'JetBrains Mono', monospace;
    padding: 2px 4px;
    width: 50px;
    outline: none;
    text-align: right;
  }

  .fm-tag-input::placeholder {
    color: #52525b;
  }

  .fm-remove-btn {
    background: none;
    border: none;
    color: #71717a;
    cursor: pointer;
    padding: 3px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: all 150ms ease;
    flex-shrink: 0;
  }

  .fm-row:hover .fm-remove-btn {
    opacity: 1;
  }

  .fm-remove-btn:hover {
    color: #ef4444;
  }

  .fm-remove-btn .material-symbols-outlined {
    font-size: 14px;
  }

  @media (prefers-reduced-motion: reduce) {
    .fm-header,
    .fm-chevron,
    .fm-add-icon,
    .fm-key,
    .fm-val,
    .fm-toggle,
    .fm-toggle-knob,
    .fm-tag,
    .fm-tag-remove,
    .fm-remove-btn {
      transition: none;
    }
  }
</style>
