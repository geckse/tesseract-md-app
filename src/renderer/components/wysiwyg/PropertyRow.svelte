<script lang="ts">
  import type { JsonValue, SchemaField } from '../../types/cli'
  import AutocompleteDropdown from './AutocompleteDropdown.svelte'
  import DatePicker from './DatePicker.svelte'
  import DateTimePicker from './DateTimePicker.svelte'

  export type DetectedType = 'text' | 'number' | 'boolean' | 'date' | 'datetime' | 'url' | 'email' | 'select' | 'tags' | 'complex'

  interface Props {
    rowKey: string
    value: JsonValue
    fieldType: DetectedType
    schemaField: SchemaField | null
    onKeyChange: (newKey: string) => void
    onValueChange: (newValue: JsonValue) => void
    onRemove: () => void
  }

  let { rowKey, value, fieldType, schemaField, onKeyChange, onValueChange, onRemove }: Props = $props()

  const typeIcons: Record<DetectedType, string> = {
    text: 'notes',
    number: 'tag',
    boolean: 'check_box_outline_blank',
    date: 'calendar_today',
    datetime: 'event',
    url: 'link',
    email: 'mail',
    select: 'arrow_drop_down_circle',
    tags: 'sell',
    complex: 'data_object',
  }

  let showDatePicker = $state(false)
  let showDateTimePicker = $state(false)
  let dateAnchor = $state<HTMLElement | null>(null)
  let newTagInput = $state('')

  // Value autocomplete
  let showValueAc = $state(false)
  let valueAcAnchor = $state<HTMLElement | null>(null)
  let valueAcFilter = $state('')

  let tagAcAnchor = $state<HTMLElement | null>(null)
  let showTagAc = $state(false)
  let tagAcFilter = $state('')

  function getFilteredSamples(): string[] {
    if (!schemaField?.sample_values?.length) return []
    if (schemaField.allowed_values?.length) return []
    const f = valueAcFilter.toLowerCase()
    return schemaField.sample_values.filter((v) => v.toLowerCase().includes(f))
  }

  function getFilteredTagSamples(): string[] {
    if (!schemaField?.sample_values?.length) return []
    const existing = new Set(Array.isArray(value) ? (value as JsonValue[]).map(String) : [])
    const f = tagAcFilter.toLowerCase()
    return schemaField.sample_values.filter((v) => !existing.has(v) && v.toLowerCase().includes(f))
  }

  function addTag(input: string) {
    const trimmed = input.trim()
    if (!trimmed) return
    if (Array.isArray(value)) {
      onValueChange([...value, trimmed])
    } else {
      onValueChange([trimmed])
    }
    newTagInput = ''
  }

  function removeTag(index: number) {
    if (Array.isArray(value)) {
      onValueChange(value.filter((_, i) => i !== index))
    }
  }

  function handleTagKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); addTag(newTagInput) }
  }

  function getStatusColor(v: string): string | null {
    const lc = v.toLowerCase()
    if (['published', 'active', 'done', 'complete'].includes(lc)) return '#22c55e'
    if (['draft', 'wip', 'in-progress'].includes(lc)) return '#eab308'
    if (['archived', 'deprecated'].includes(lc)) return '#71717a'
    return null
  }

  let booleanIcon = $derived(value === true ? 'check_box' : 'check_box_outline_blank')
</script>

<div class="pr" role="row">
  <span class="material-symbols-outlined pr-type-icon">{fieldType === 'boolean' ? booleanIcon : typeIcons[fieldType]}</span>

  <div class="pr-key-cell">
    {#if schemaField?.required}
      <span class="pr-required">*</span>
    {/if}
    <input
      class="pr-key"
      type="text"
      value={rowKey}
      placeholder="key"
      aria-label="Property name"
      title={schemaField?.description ?? ''}
      oninput={(e) => onKeyChange((e.target as HTMLInputElement).value)}
    />
  </div>

  <div class="pr-value-cell">
    {#if fieldType === 'boolean'}
      <button
        class="pr-toggle"
        class:pr-toggle-on={value === true}
        onclick={() => onValueChange(!value)}
        aria-label="Toggle {rowKey}"
      >
        <span class="pr-toggle-knob"></span>
      </button>

    {:else if fieldType === 'number'}
      <input
        class="pr-val"
        type="number"
        value={value as number}
        aria-label="{rowKey} value"
        oninput={(e) => onValueChange(Number((e.target as HTMLInputElement).value))}
      />

    {:else if fieldType === 'date'}
      <div class="pr-date-wrap">
        <input
          class="pr-val"
          type="text"
          value={String(value ?? '')}
          placeholder="YYYY-MM-DD"
          aria-label="{rowKey} value"
          oninput={(e) => onValueChange((e.target as HTMLInputElement).value)}
        />
        <button
          class="pr-icon-btn"
          bind:this={dateAnchor}
          onclick={() => (showDatePicker = !showDatePicker)}
          aria-label="Open date picker"
        >
          <span class="material-symbols-outlined">calendar_today</span>
        </button>
      </div>
      {#if showDatePicker && dateAnchor}
        <DatePicker
          value={String(value ?? '')}
          anchorEl={dateAnchor}
          onSelect={(d) => { onValueChange(d); showDatePicker = false }}
          onClose={() => (showDatePicker = false)}
        />
      {/if}

    {:else if fieldType === 'datetime'}
      <div class="pr-date-wrap">
        <input
          class="pr-val"
          type="text"
          value={String(value ?? '')}
          placeholder="YYYY-MM-DDTHH:mm"
          aria-label="{rowKey} value"
          oninput={(e) => onValueChange((e.target as HTMLInputElement).value)}
        />
        <button
          class="pr-icon-btn"
          bind:this={dateAnchor}
          onclick={() => (showDateTimePicker = !showDateTimePicker)}
          aria-label="Open date time picker"
        >
          <span class="material-symbols-outlined">event</span>
        </button>
      </div>
      {#if showDateTimePicker && dateAnchor}
        <DateTimePicker
          value={String(value ?? '')}
          anchorEl={dateAnchor}
          onSelect={(dt) => { onValueChange(dt); showDateTimePicker = false }}
          onClose={() => (showDateTimePicker = false)}
        />
      {/if}

    {:else if fieldType === 'url'}
      <div class="pr-date-wrap">
        <input
          class="pr-val"
          type="text"
          value={String(value ?? '')}
          placeholder="https://..."
          aria-label="{rowKey} value"
          oninput={(e) => onValueChange((e.target as HTMLInputElement).value)}
        />
        {#if typeof value === 'string' && value.startsWith('http')}
          <button class="pr-icon-btn" onclick={() => window.api.openPath(String(value))} aria-label="Open URL">
            <span class="material-symbols-outlined">open_in_new</span>
          </button>
        {/if}
      </div>

    {:else if fieldType === 'email'}
      <div class="pr-date-wrap">
        <input
          class="pr-val"
          type="text"
          value={String(value ?? '')}
          placeholder="name@example.com"
          aria-label="{rowKey} value"
          oninput={(e) => onValueChange((e.target as HTMLInputElement).value)}
        />
        {#if typeof value === 'string' && value.includes('@')}
          <button class="pr-icon-btn" onclick={() => window.api.openPath(`mailto:${value}`)} aria-label="Send email">
            <span class="material-symbols-outlined">mail</span>
          </button>
        {/if}
      </div>

    {:else if fieldType === 'select'}
      {@const allowedValues = schemaField?.allowed_values ?? []}
      {@const currentVal = String(value ?? '')}
      <select
        class="pr-val pr-select"
        aria-label="{rowKey} value"
        onchange={(e) => onValueChange((e.target as HTMLSelectElement).value)}
      >
        {#if currentVal && !allowedValues.includes(currentVal)}
          <option value={currentVal}>{currentVal}</option>
        {/if}
        {#each allowedValues as opt}
          <option value={opt} selected={opt === currentVal}>{opt}</option>
        {/each}
      </select>

    {:else if fieldType === 'tags'}
      <div class="pr-tags">
        {#each (Array.isArray(value) ? value : []) as tag, i}
          <span class="pr-tag">
            {String(tag)}
            <button class="pr-tag-remove" onclick={() => removeTag(i)} aria-label="Remove tag">&times;</button>
          </span>
        {/each}
        <input
          class="pr-tag-input"
          type="text"
          placeholder="+ tag"
          aria-label="Add tag to {rowKey}"
          bind:value={newTagInput}
          onkeydown={(e) => handleTagKeydown(e)}
          oninput={(e) => {
            const val = (e.target as HTMLInputElement).value
            tagAcFilter = val
            if (!showTagAc) { showTagAc = true; tagAcAnchor = e.target as HTMLElement }
          }}
          onfocus={(e) => { showTagAc = true; tagAcAnchor = e.target as HTMLElement; tagAcFilter = newTagInput }}
          onblur={(e: FocusEvent) => {
            const related = e.relatedTarget as HTMLElement | null
            if (!related?.closest?.('.autocomplete-dropdown')) { showTagAc = false; addTag(newTagInput) }
          }}
        />
      </div>
      {#if showTagAc && tagAcAnchor}
        {@const tagSuggestions = getFilteredTagSamples()}
        {#if tagSuggestions.length > 0}
          <AutocompleteDropdown
            suggestions={tagSuggestions}
            onSelect={(s) => { addTag(s); showTagAc = false }}
            anchorEl={tagAcAnchor}
            onDismiss={() => (showTagAc = false)}
          />
        {/if}
      {/if}

    {:else if fieldType === 'complex'}
      <textarea
        class="pr-val pr-textarea"
        value={JSON.stringify(value, null, 2)}
        aria-label="{rowKey} value"
        oninput={(e) => {
          try { onValueChange(JSON.parse((e.target as HTMLTextAreaElement).value)) } catch { /* keep raw */ }
        }}
      ></textarea>

    {:else}
      {@const statusColor = typeof value === 'string' ? getStatusColor(value) : null}
      <input
        class="pr-val"
        class:pr-status={!!statusColor}
        style={statusColor ? `color: ${statusColor}; border-color: ${statusColor}40;` : ''}
        type="text"
        value={String(value ?? '')}
        aria-label="{rowKey} value"
        bind:this={valueAcAnchor}
        oninput={(e) => {
          const val = (e.target as HTMLInputElement).value
          onValueChange(val)
          valueAcFilter = val
          if (!showValueAc) showValueAc = true
        }}
        onfocus={(e) => { showValueAc = true; valueAcAnchor = e.target as HTMLElement; valueAcFilter = String(value ?? '') }}
        onblur={(e: FocusEvent) => {
          const related = e.relatedTarget as HTMLElement | null
          if (!related?.closest?.('.autocomplete-dropdown')) showValueAc = false
        }}
      />
      {#if showValueAc && valueAcAnchor}
        {@const samples = getFilteredSamples()}
        {#if samples.length > 0}
          <AutocompleteDropdown
            suggestions={samples}
            onSelect={(s) => { onValueChange(s); showValueAc = false }}
            anchorEl={valueAcAnchor}
            onDismiss={() => (showValueAc = false)}
          />
        {/if}
      {/if}
    {/if}
  </div>

  <button class="pr-remove" onclick={onRemove} title="Remove property" aria-label="Remove property">
    <span class="material-symbols-outlined">close</span>
  </button>
</div>

<style>
  .pr {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 0;
    border-radius: 4px;
    transition: background 150ms ease;
    position: relative;
  }
  .pr:hover { background: rgba(255, 255, 255, 0.03); }

  .pr-type-icon {
    font-size: 16px;
    color: var(--color-text-dim, #71717a);
    flex-shrink: 0;
    width: 24px;
    text-align: center;
    transition: color 150ms ease;
  }
  .pr:hover .pr-type-icon { color: var(--color-primary, #00E5FF); }

  .pr-key-cell {
    display: flex;
    align-items: center;
    gap: 2px;
    width: 140px;
    flex-shrink: 0;
  }
  .pr-required {
    color: var(--color-primary, #00E5FF);
    font-size: 12px;
    font-weight: 700;
    line-height: 1;
  }
  .pr-key {
    flex: 1;
    min-width: 0;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 4px;
    color: var(--color-text-dim, #71717a);
    font-family: var(--font-mono, 'JetBrains Mono'), monospace;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 3px 6px;
    transition: border-color 150ms ease, color 150ms ease;
  }
  .pr-key:hover, .pr-key:focus {
    border-color: var(--color-border, #27272a);
    color: var(--color-text, #a1a1aa);
    outline: none;
  }

  .pr-value-cell {
    flex: 1;
    min-width: 0;
    display: flex;
    justify-content: flex-start;
    position: relative;
  }

  .pr-val {
    width: 100%;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 4px;
    color: var(--color-text, #e4e4e7);
    font-size: 13px;
    font-family: var(--font-mono, 'JetBrains Mono'), monospace;
    padding: 3px 6px;
    text-align: left;
    transition: border-color 150ms ease;
  }
  .pr-val:hover, .pr-val:focus {
    border-color: var(--color-border, #27272a);
    outline: none;
  }
  .pr-val.pr-status {
    border: 1px solid;
    border-radius: 9999px;
    padding: 2px 10px;
    font-size: 10px;
    font-weight: 600;
    width: auto;
    text-align: center;
  }

  .pr-select {
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2371717a' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 6px center;
    padding-right: 22px;
    cursor: pointer;
  }
  .pr-select:hover, .pr-select:focus { border-color: #3f3f46; }

  .pr-textarea {
    min-height: 60px;
    resize: vertical;
    text-align: left;
  }

  .pr-date-wrap {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
  }
  .pr-date-wrap .pr-val { flex: 1; }

  .pr-icon-btn {
    background: none;
    border: none;
    color: var(--color-text-dim, #71717a);
    cursor: pointer;
    padding: 2px;
    border-radius: 4px;
    display: flex;
    align-items: center;
    transition: color 150ms ease;
    flex-shrink: 0;
  }
  .pr-icon-btn:hover { color: var(--color-primary, #00E5FF); }
  .pr-icon-btn .material-symbols-outlined { font-size: 16px; }

  /* Toggle */
  .pr-toggle {
    width: 32px; height: 18px; border-radius: 9999px; background: #27272a;
    border: none; cursor: pointer; position: relative; padding: 0; margin: 2px 0;
    transition: background 150ms ease;
  }
  .pr-toggle-on { background: var(--color-primary, #00E5FF); }
  .pr-toggle-knob {
    display: block; width: 14px; height: 14px; border-radius: 50%; background: #ffffff;
    position: absolute; top: 2px; left: 2px; transition: transform 150ms ease;
  }
  .pr-toggle-on .pr-toggle-knob { transform: translateX(14px); }

  /* Tags */
  .pr-tags {
    display: flex; flex-wrap: wrap; gap: 4px; align-items: center; justify-content: flex-start; padding: 1px 0;
  }
  .pr-tag {
    display: inline-flex; align-items: center; gap: 3px; padding: 2px 8px;
    border-radius: 9999px; border: 1px solid var(--color-primary-glow, rgba(0, 229, 255, 0.25));
    background: transparent; color: var(--color-primary, #00E5FF);
    font-size: 10px; font-family: var(--font-mono, 'JetBrains Mono'), monospace;
    transition: border-color 150ms ease;
  }
  .pr-tag:hover { border-color: var(--color-primary-glow, rgba(0, 229, 255, 0.5)); }
  .pr-tag-remove {
    background: none; border: none; color: var(--color-primary, #00E5FF);
    cursor: pointer; padding: 0; font-size: 12px; line-height: 1; opacity: 0.5;
    transition: opacity 150ms ease;
  }
  .pr-tag-remove:hover { opacity: 1; }
  .pr-tag-input {
    background: transparent; border: none; color: var(--color-text, #e4e4e7);
    font-size: 10px; font-family: var(--font-mono, 'JetBrains Mono'), monospace;
    padding: 2px 4px; width: 50px; outline: none; text-align: left;
  }
  .pr-tag-input::placeholder { color: #52525b; }

  .pr-remove {
    background: none; border: none; color: var(--color-text-dim, #71717a);
    cursor: pointer; padding: 3px; border-radius: 4px;
    display: flex; align-items: center; justify-content: center;
    opacity: 0; transition: all 150ms ease; flex-shrink: 0;
  }
  .pr:hover .pr-remove { opacity: 1; }
  .pr-remove:hover { color: var(--color-error, #ef4444); }
  .pr-remove .material-symbols-outlined { font-size: 14px; }

  @media (prefers-reduced-motion: reduce) {
    .pr, .pr-type-icon, .pr-key, .pr-val, .pr-toggle, .pr-toggle-knob,
    .pr-tag, .pr-tag-remove, .pr-remove, .pr-icon-btn { transition: none; }
  }
</style>
