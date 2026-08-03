<script lang="ts">
  import type {
    ComputedFieldDiagnostic,
    JsonValue,
    RelationValue,
    SchemaField
  } from '../../types/cli'
  import { cliFeatures } from '../../lib/cli-features.svelte'
  import { formatRelationValue } from '../../lib/relation-format'
  import { openResolvedPath } from '../../lib/link-navigation'
  import type { PropertyValueColorSelection } from '../../../shared/value-colors'
  import { automaticValueColorSlot, valueColorSelectionStyle } from '../../lib/value-colors'
  import { resolvedTheme } from '../../stores/theme'
  import {
    loadPropertyValueColors,
    neutralValueColorPalette,
    propertyValueColorOverrides,
    valueColorOverride,
    valueColorPalette
  } from '../../stores/value-colors'
  import AutocompleteDropdown from './AutocompleteDropdown.svelte'
  import DatePicker from './DatePicker.svelte'
  import DateTimePicker from './DateTimePicker.svelte'
  import TypePickerDropdown from './TypePickerDropdown.svelte'
  import PopoverMenu, { type PopoverMenuItem } from '../ui/PopoverMenu.svelte'
  import PropertySettingsPopover from '../PropertySettingsPopover.svelte'
  import RelationChip from '../RelationChip.svelte'
  import RelationPicker from '../RelationPicker.svelte'
  import FilePicker from '../FilePicker.svelte'
  import FileTile from '../FileTile.svelte'
  import JsonEditor from '../ui/JsonEditor.svelte'
  import JsonSyntax from '../ui/JsonSyntax.svelte'
  import { assetsByPath } from '../../stores/files'
  import { formatFileReference, parseFileReference } from '../../../shared/file-reference'
  import { exactNumberText, stringifyExactJson } from '../../../shared/exact-number'
  import {
    computedFieldIcon,
    computedFieldMarker,
    type ComputedFieldType
  } from '../../lib/computed-fields'

  export type DetectedType =
    | 'text'
    | 'number'
    | 'boolean'
    | 'date'
    | 'datetime'
    | 'url'
    | 'email'
    | 'select'
    | 'tags'
    | 'relation'
    | 'file'
    | 'complex'

  interface Props {
    rowKey: string
    value: JsonValue
    fieldType: DetectedType
    schemaField: SchemaField | null
    onKeyChange: (newKey: string) => void
    onValueChange: (newValue: JsonValue) => void
    onRemove: () => void
    /** Phase 41: request a recursive type conversion (enables the type picker + menu). */
    onTypeChange?: (target: DetectedType) => void
    /** Phase 41: request a recursive key rename. */
    onRename?: () => void
    /** Open the schema-backed Formula definition editor. */
    onEditFormula?: () => void
    /** Open a Lookup/Rollup definition editor. */
    onEditComputed?: () => void
    /** Phase 41: overlay scope for Property settings (null = global section). */
    settingsScope?: string | null
    /** Phase 42: server-resolved relations for THIS key (from `get --populate`). */
    relationValues?: RelationValue[]
    /** Phase 42: collection root (relation picker needs it for CLI calls). */
    collectionPath?: string
    /** Active collection id (synced Select/Tags value colors). */
    collectionId?: string | null
    /** CLI-maintained Formula values are visible in frontmatter but never user-editable. */
    isFormula?: boolean
    /** Formula evaluation failure for this materialized field, when present. */
    formulaError?: ComputedFieldDiagnostic
    computedType?: ComputedFieldType | null
    computedError?: ComputedFieldDiagnostic
  }

  let {
    rowKey,
    value,
    fieldType,
    schemaField,
    onKeyChange,
    onValueChange,
    onRemove,
    onTypeChange,
    onRename,
    onEditFormula,
    onEditComputed,
    settingsScope,
    relationValues,
    collectionPath,
    collectionId = null,
    isFormula = false,
    formulaError,
    computedType = null,
    computedError
  }: Props = $props()

  const effectiveComputedType = $derived<ComputedFieldType | null>(
    computedType ?? (isFormula ? 'Formula' : null)
  )
  const isComputed = $derived(effectiveComputedType !== null)
  const fieldError = $derived(computedError ?? formulaError)

  // ── Phase 41: type change / rename / settings affordances ─────────────
  let showTypePicker = $state(false)
  let typeAnchor = $state<HTMLElement | null>(null)
  let showRowMenu = $state(false)
  let rowMenuAnchor = $state<HTMLElement | null>(null)
  let showSettings = $state(false)

  const rowMenuItems = $derived<PopoverMenuItem[]>(
    isComputed && effectiveComputedType
      ? [
          {
            id: 'edit-computed',
            label: `Edit ${effectiveComputedType.toLowerCase()}…`,
            icon: computedFieldIcon(effectiveComputedType)
          }
        ]
      : [
          { id: 'change-type', label: 'Change type…', icon: 'swap_horiz' },
          { id: 'rename', label: 'Rename property…', icon: 'drive_file_rename_outline' },
          { id: 'settings', label: 'Property settings…', icon: 'tune' }
        ]
  )

  function handleRowMenuSelect(id: string): void {
    if (id === 'edit-computed') {
      ;(onEditComputed ?? onEditFormula)?.()
    } else if (id === 'change-type') {
      showTypePicker = true
    } else if (id === 'rename') {
      onRename?.()
    } else if (id === 'settings') {
      showSettings = true
    }
  }

  function handleTypeSelect(type: string): void {
    showTypePicker = false
    if (type !== fieldType) onTypeChange?.(type as DetectedType)
  }

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
    relation: 'account_tree', // NOT 'link' — the url type already uses it
    file: 'attach_file',
    complex: 'data_object'
  }

  // ── Phase 42: relation editing ─────────────────────────────────────────
  let showRelationPicker = $state(false)
  let relationAnchor = $state<HTMLElement | null>(null)

  /** Server-resolved RelationValue for a raw string (null → neutral chip). */
  function matchRelation(raw: string): RelationValue | null {
    return relationValues?.find((r) => r.raw === raw) ?? null
  }

  // openResolvedPath (not bare workspace.openFile): editors don't poll, so
  // skipping the file-store sync opens an empty editor tab.
  function openRelationTarget(path: string): void {
    openResolvedPath(path)
  }

  function pickRelation(path: string): void {
    showRelationPicker = false
    if (Array.isArray(value)) {
      onValueChange([...value, formatRelationValue(path)])
    } else {
      onValueChange(formatRelationValue(path))
    }
  }

  function removeRelationAt(index: number): void {
    if (Array.isArray(value)) {
      onValueChange(value.filter((_, i) => i !== index))
    }
  }

  const relationRawValues = $derived.by<string[]>(() => {
    if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string')
    if (typeof value === 'string' && value !== '') return [value]
    return []
  })

  // ── File attachment editing ───────────────────────────────────────────
  let showFilePicker = $state(false)
  let fileAnchor = $state<HTMLDivElement | null>(null)

  const fileRawValues = $derived.by<string[]>(() => {
    if (Array.isArray(value))
      return value.filter((item): item is string => typeof item === 'string')
    if (typeof value === 'string' && value !== '') return [value]
    return []
  })

  const fileReferences = $derived(
    fileRawValues.map((raw) => ({ raw, path: parseFileReference(raw, true) }))
  )

  const linkedFilePaths = $derived(
    fileReferences
      .map((reference) => reference.path)
      .filter((path): path is string => path !== null)
  )

  function addFiles(paths: string[]): void {
    showFilePicker = false
    onValueChange([...fileRawValues, ...paths.map(formatFileReference)])
  }

  function removeFileAt(index: number): void {
    onValueChange(fileRawValues.filter((_, candidate) => candidate !== index))
  }

  const excludedTypes = $derived([
    ...(!cliFeatures.supportsRelations ? ['relation'] : []),
    ...(!cliFeatures.supportsFileFields ? ['file'] : [])
  ])

  let showDatePicker = $state(false)
  let showDateTimePicker = $state(false)
  let dateAnchor = $state<HTMLElement | null>(null)
  let newTagInput = $state('')

  $effect(() => {
    void loadPropertyValueColors(collectionId, settingsScope ?? null)
  })

  function automaticColorSlot(option: string): number {
    return automaticValueColorSlot(rowKey, option, schemaField?.allowed_values)
  }

  function propertyValueColorStyle(option: string): string {
    const selection: PropertyValueColorSelection = valueColorOverride(
      $propertyValueColorOverrides,
      collectionId,
      settingsScope ?? null,
      rowKey,
      option
    ) ?? { palette: 'accent', slot: automaticColorSlot(option) }
    return valueColorSelectionStyle(
      $valueColorPalette,
      $neutralValueColorPalette,
      selection,
      $resolvedTheme
    )
  }

  const propertyColorValues = $derived.by(() => {
    if (fieldType === 'select') return schemaField?.allowed_values ?? []
    if (fieldType !== 'tags') return []

    const values = new Set(schemaField?.sample_values ?? [])
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
          const text = String(item).trim()
          if (text) values.add(text)
        }
      }
    }
    return [...values].slice(0, 100)
  })

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
    if (e.key === 'Enter') {
      e.preventDefault()
      addTag(newTagInput)
    }
  }

  function getStatusColor(v: string): string | null {
    const lc = v.toLowerCase()
    if (['published', 'active', 'done', 'complete'].includes(lc)) return '#22c55e'
    if (['draft', 'wip', 'in-progress'].includes(lc)) return '#eab308'
    if (['archived', 'deprecated'].includes(lc)) return '#71717a'
    return null
  }

  let booleanIcon = $derived(value === true ? 'check_box' : 'check_box_outline_blank')

  function displayValueText(source: JsonValue): string {
    if (source === null) return '—'
    const exact = exactNumberText(source)
    if (exact !== null) return exact
    if (typeof source === 'string') return source
    if (typeof source === 'number' || typeof source === 'boolean') return String(source)
    return stringifyExactJson(source)
  }

  function formulaValueText(): string {
    return displayValueText(value)
  }

  function formatComputedDate(source: string, withTime: boolean): string {
    const parsed = new Date(withTime ? source : `${source}T00:00:00`)
    if (Number.isNaN(parsed.getTime())) return source
    return withTime
      ? parsed.toLocaleString()
      : parsed.toLocaleDateString(undefined, {
          year: 'numeric',
          month: 'short',
          day: 'numeric'
        })
  }
</script>

<div class="pr">
  {#if isComputed && effectiveComputedType}
    <span class="material-symbols-outlined pr-type-icon" title={effectiveComputedType}
      >{computedFieldIcon(effectiveComputedType)}</span
    >
  {:else if onTypeChange}
    <button
      class="pr-type-btn"
      bind:this={typeAnchor}
      onclick={() => (showTypePicker = !showTypePicker)}
      title="Change type of {rowKey}"
      aria-label="Change type of {rowKey}"
      aria-haspopup="listbox"
      aria-expanded={showTypePicker}
    >
      <span class="material-symbols-outlined pr-type-icon"
        >{fieldType === 'boolean' ? booleanIcon : typeIcons[fieldType]}</span
      >
    </button>
  {:else}
    <span class="material-symbols-outlined pr-type-icon"
      >{fieldType === 'boolean' ? booleanIcon : typeIcons[fieldType]}</span
    >
  {/if}

  <div class="pr-key-cell">
    {#if schemaField?.required}
      <span class="pr-required">*</span>
    {/if}
    {#if isComputed}
      <span class="pr-key pr-key-readonly" title={schemaField?.description ?? ''}>{rowKey}</span>
    {:else}
      <input
        class="pr-key"
        type="text"
        value={rowKey}
        placeholder="key"
        aria-label="Property name"
        title={schemaField?.description ?? ''}
        oninput={(e) => onKeyChange((e.target as HTMLInputElement).value)}
      />
    {/if}
  </div>

  <div class="pr-value-cell">
    {#if isComputed && effectiveComputedType}
      <div
        class="pr-formula"
        class:pr-formula-error={!!fieldError}
        aria-label={fieldError
          ? `${effectiveComputedType} error for ${rowKey}: ${fieldError.message}`
          : `${effectiveComputedType} value for ${rowKey}`}
        title={fieldError?.message ?? formulaValueText()}
      >
        <span
          class="pr-formula-mark"
          class:lookup={effectiveComputedType === 'Lookup'}
          class:material-symbols-outlined={effectiveComputedType === 'Lookup'}
          aria-hidden="true">{computedFieldMarker(effectiveComputedType)}</span
        >
        {#if fieldError}
          <span class="material-symbols-outlined pr-formula-error-icon" aria-hidden="true"
            >error</span
          >
          <span>{fieldError.code}</span>
        {:else if value === null}
          <span class="pr-computed-empty">—</span>
        {:else if fieldType === 'boolean'}
          <span
            class="material-symbols-outlined pr-computed-boolean"
            class:true={value === true}
            aria-label={value === true ? 'True' : 'False'}
          >
            {value === true ? 'check_box' : 'check_box_outline_blank'}
          </span>
        {:else if fieldType === 'date' && typeof value === 'string'}
          <span class="material-symbols-outlined pr-computed-value-icon" aria-hidden="true"
            >calendar_today</span
          >
          <span class="pr-formula-value">{formatComputedDate(value, false)}</span>
        {:else if fieldType === 'datetime' && typeof value === 'string'}
          <span class="material-symbols-outlined pr-computed-value-icon" aria-hidden="true"
            >schedule</span
          >
          <span class="pr-formula-value">{formatComputedDate(value, true)}</span>
        {:else if fieldType === 'tags' && Array.isArray(value)}
          <span
            class="pr-computed-list"
            aria-label={value.map((item) => displayValueText(item)).join(', ')}
          >
            {#each value as item, index (`${index}:${displayValueText(item)}`)}
              <span class="pr-computed-chip">{displayValueText(item)}</span>
            {/each}
          </span>
        {:else}
          <span
            class="pr-formula-value"
            class:pr-computed-mono={fieldType === 'number' || fieldType === 'complex'}
          >
            {#if fieldType === 'complex'}
              <JsonSyntax text={formulaValueText()} />
            {:else}
              {formulaValueText()}
            {/if}
          </span>
        {/if}
      </div>
    {:else if fieldType === 'boolean'}
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
          onSelect={(d) => {
            onValueChange(d)
            showDatePicker = false
          }}
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
          onSelect={(dt) => {
            onValueChange(dt)
            showDateTimePicker = false
          }}
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
          <button
            class="pr-icon-btn"
            onclick={() => window.api.openPath(String(value))}
            aria-label="Open URL"
          >
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
          <button
            class="pr-icon-btn"
            onclick={() => window.api.openPath(`mailto:${value}`)}
            aria-label="Send email"
          >
            <span class="material-symbols-outlined">mail</span>
          </button>
        {/if}
      </div>
    {:else if fieldType === 'select'}
      {@const allowedValues = schemaField?.allowed_values ?? []}
      {@const currentVal = String(value ?? '')}
      <select
        class="pr-val pr-select"
        style={currentVal ? propertyValueColorStyle(currentVal) : undefined}
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
        {#each Array.isArray(value) ? value : [] as tag, i}
          <span class="pr-tag" style={propertyValueColorStyle(String(tag))}>
            {String(tag)}
            <button class="pr-tag-remove" onclick={() => removeTag(i)} aria-label="Remove tag"
              >&times;</button
            >
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
            if (!showTagAc) {
              showTagAc = true
              tagAcAnchor = e.target as HTMLElement
            }
          }}
          onfocus={(e) => {
            showTagAc = true
            tagAcAnchor = e.target as HTMLElement
            tagAcFilter = newTagInput
          }}
          onblur={(e: FocusEvent) => {
            const related = e.relatedTarget as HTMLElement | null
            if (!related?.closest?.('.autocomplete-dropdown')) {
              showTagAc = false
              addTag(newTagInput)
            }
          }}
        />
      </div>
      {#if showTagAc && tagAcAnchor}
        {@const tagSuggestions = getFilteredTagSamples()}
        {#if tagSuggestions.length > 0}
          <AutocompleteDropdown
            suggestions={tagSuggestions}
            onSelect={(s) => {
              addTag(s)
              showTagAc = false
            }}
            anchorEl={tagAcAnchor}
            onDismiss={() => (showTagAc = false)}
          />
        {/if}
      {/if}
    {:else if fieldType === 'relation'}
      <div class="pr-relation" bind:this={relationAnchor}>
        {#each relationRawValues as raw, i (i)}
          <RelationChip
            relation={matchRelation(raw)}
            {raw}
            onnavigate={openRelationTarget}
            onremove={Array.isArray(value) ? () => removeRelationAt(i) : undefined}
          />
        {/each}
        <button
          class="pr-relation-pick"
          onclick={() => (showRelationPicker = !showRelationPicker)}
          aria-label="Pick document for {rowKey}"
          aria-haspopup="dialog"
          aria-expanded={showRelationPicker}
        >
          {#if relationRawValues.length === 0}
            Pick document…
          {:else}
            <span class="material-symbols-outlined pr-relation-pick-icon"
              >{Array.isArray(value) ? 'add' : 'edit'}</span
            >
          {/if}
        </button>
        {#if relationRawValues.length > 0 && !Array.isArray(value)}
          <button
            class="pr-icon-btn"
            onclick={() => onValueChange('')}
            aria-label="Clear {rowKey}"
            title="Clear"
          >
            <span class="material-symbols-outlined">backspace</span>
          </button>
        {/if}
      </div>
      {#if showRelationPicker && relationAnchor && collectionPath}
        <RelationPicker
          anchorEl={relationAnchor}
          root={collectionPath}
          targetFolder={schemaField?.relation_target ?? null}
          excludePaths={Array.isArray(value)
            ? (relationValues ?? []).map((r) => r.path).filter((p): p is string => p !== null)
            : []}
          onpick={pickRelation}
          ondismiss={() => (showRelationPicker = false)}
        />
      {/if}
    {:else if fieldType === 'file'}
      <div class="pr-files" bind:this={fileAnchor}>
        <div class="pr-file-tiles">
          {#each fileReferences as reference, i (i)}
            {@const asset = reference.path ? $assetsByPath.get(reference.path) : undefined}
            <FileTile
              root={collectionPath ?? ''}
              path={reference.path ?? reference.raw}
              raw={reference.raw}
              mimeCategory={asset?.mimeCategory ?? 'other'}
              fileSize={asset?.fileSize}
              exists={!!asset}
              compact
              onunlink={cliFeatures.supportsFileFields ? () => removeFileAt(i) : undefined}
            />
          {/each}
        </div>
        {#if cliFeatures.supportsFileFields}
          <button
            class="pr-file-pick"
            onclick={() => (showFilePicker = !showFilePicker)}
            aria-label="Add files to {rowKey}"
            aria-haspopup="dialog"
            aria-expanded={showFilePicker}
          >
            <span class="material-symbols-outlined">add</span>
            {fileReferences.length === 0 ? 'Add files…' : ''}
          </button>
        {/if}
      </div>
      {#if showFilePicker && fileAnchor && collectionPath}
        <FilePicker
          anchorEl={fileAnchor}
          excludePaths={linkedFilePaths}
          onpick={addFiles}
          ondismiss={() => (showFilePicker = false)}
        />
      {/if}
    {:else if fieldType === 'complex'}
      <JsonEditor {value} ariaLabel="{rowKey} value" {onValueChange} />
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
        onfocus={(e) => {
          showValueAc = true
          valueAcAnchor = e.target as HTMLElement
          valueAcFilter = String(value ?? '')
        }}
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
            onSelect={(s) => {
              onValueChange(s)
              showValueAc = false
            }}
            anchorEl={valueAcAnchor}
            onDismiss={() => (showValueAc = false)}
          />
        {/if}
      {/if}
    {/if}
  </div>

  {#if (isComputed && (onEditComputed || onEditFormula)) || (!isComputed && onTypeChange)}
    <button
      class="pr-more"
      bind:this={rowMenuAnchor}
      onclick={() => (showRowMenu = !showRowMenu)}
      title={isComputed ? `${effectiveComputedType} options` : 'Property options'}
      aria-label="{isComputed ? effectiveComputedType : 'Property'} options for {rowKey}"
      aria-haspopup="menu"
      aria-expanded={showRowMenu}
    >
      <span class="material-symbols-outlined">more_horiz</span>
    </button>
  {/if}

  {#if !isComputed}
    <button
      class="pr-remove"
      onclick={onRemove}
      title="Remove property"
      aria-label="Remove property"
    >
      <span class="material-symbols-outlined">close</span>
    </button>
  {/if}

  {#if !isComputed && showTypePicker && typeAnchor}
    <TypePickerDropdown
      anchorEl={typeAnchor}
      currentType={fieldType}
      excludeTypes={excludedTypes}
      onSelect={handleTypeSelect}
      onDismiss={() => (showTypePicker = false)}
    />
  {/if}

  {#if showRowMenu && rowMenuAnchor}
    <PopoverMenu
      anchorEl={rowMenuAnchor}
      items={rowMenuItems}
      ariaLabel={isComputed ? `${effectiveComputedType} options` : 'Property options'}
      onselect={handleRowMenuSelect}
      ondismiss={() => (showRowMenu = false)}
    />
  {/if}

  {#if showSettings && rowMenuAnchor}
    <PropertySettingsPopover
      anchorEl={rowMenuAnchor}
      scope={settingsScope ?? null}
      fieldKey={rowKey}
      description={schemaField?.description ?? null}
      required={schemaField?.required ?? false}
      allowedValues={schemaField?.allowed_values ?? null}
      {collectionId}
      colorValues={propertyColorValues}
      valueColorsEnabled={fieldType === 'select' || fieldType === 'tags'}
      isRelation={fieldType === 'relation'}
      relationTarget={schemaField?.relation_target ?? null}
      onclose={() => (showSettings = false)}
    />
  {/if}
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
  .pr:hover {
    background: var(--overlay-hover, rgba(255, 255, 255, 0.03));
  }

  .pr-type-icon {
    font-size: 16px;
    color: var(--color-text-dim, #71717a);
    flex-shrink: 0;
    width: 24px;
    text-align: center;
    transition: color 150ms ease;
  }

  .pr-key-readonly {
    display: block;
    cursor: default;
  }

  .pr-key-readonly:hover {
    border-color: transparent;
    color: var(--color-text-dim, #71717a);
  }

  .pr-formula {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    color: var(--color-text, #e4e4e7);
  }

  .pr-formula-mark {
    flex-shrink: 0;
    color: var(--color-primary, #00e5ff);
    font-family: var(--font-mono, 'JetBrains Mono'), monospace;
    font-size: 9px;
    opacity: 0.7;
  }

  .pr-formula-mark.lookup {
    font-family: 'Material Symbols Outlined';
    font-size: 14px;
    line-height: 1;
  }

  .pr-formula-value {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .pr-computed-empty,
  .pr-computed-boolean,
  .pr-computed-value-icon {
    color: var(--color-text-faint, #52525b);
  }

  .pr-computed-boolean {
    flex-shrink: 0;
    font-size: 16px;
  }

  .pr-computed-boolean.true {
    color: var(--color-primary, #00e5ff);
  }

  .pr-computed-value-icon {
    flex-shrink: 0;
    font-size: 13px;
  }

  .pr-computed-mono {
    font-family: var(--font-mono, 'JetBrains Mono'), monospace;
  }

  .pr-computed-list {
    display: flex;
    gap: 3px;
    min-width: 0;
    overflow: hidden;
  }

  .pr-computed-chip {
    flex-shrink: 0;
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 1px 5px;
    border-radius: 999px;
    background: var(--color-primary-dim, rgba(0, 229, 255, 0.12));
    color: var(--color-text, #e4e4e7);
    font-size: var(--text-xs, 0.625rem);
  }

  .pr-formula-error,
  .pr-formula-error-icon {
    color: var(--color-error, #ef4444);
  }

  .pr-formula-error-icon {
    flex-shrink: 0;
    font-size: 14px;
  }
  .pr:hover .pr-type-icon {
    color: var(--color-primary, #00e5ff);
  }

  .pr-type-btn {
    background: none;
    border: none;
    padding: 0;
    margin: 0;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    flex-shrink: 0;
    transition: background 150ms ease;
  }
  .pr-type-btn:hover {
    background: var(--overlay-hover, rgba(255, 255, 255, 0.06));
  }
  .pr-type-btn:focus-visible {
    outline: 1px solid var(--color-primary, #00e5ff);
    outline-offset: 1px;
  }
  .pr-type-btn .pr-type-icon {
    width: 24px;
  }

  .pr-more {
    background: none;
    border: none;
    color: var(--color-text-dim, #71717a);
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
  .pr:hover .pr-more,
  .pr-more:focus-visible {
    opacity: 1;
  }
  .pr-more:hover {
    color: var(--color-primary, #00e5ff);
  }
  .pr-more .material-symbols-outlined {
    font-size: 14px;
  }

  .pr-key-cell {
    display: flex;
    align-items: center;
    gap: 2px;
    width: 140px;
    flex-shrink: 0;
  }
  .pr-required {
    color: var(--color-primary, #00e5ff);
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
    transition:
      border-color 150ms ease,
      color 150ms ease;
  }
  .pr-key:hover,
  .pr-key:focus {
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
  .pr-val:hover,
  .pr-val:focus {
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
    background-color: color-mix(in srgb, var(--value-color-base) 14%, transparent);
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2371717a' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 6px center;
    border-color: color-mix(in srgb, var(--value-color) 42%, transparent);
    color: var(--value-color);
    padding-right: 22px;
    cursor: pointer;
  }
  .pr-select:hover,
  .pr-select:focus {
    border-color: color-mix(in srgb, var(--value-color) 68%, transparent);
  }

  .pr-date-wrap {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
  }
  .pr-date-wrap .pr-val {
    flex: 1;
  }

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
  .pr-icon-btn:hover {
    color: var(--color-primary, #00e5ff);
  }
  .pr-icon-btn .material-symbols-outlined {
    font-size: 16px;
  }

  /* Toggle */
  .pr-toggle {
    width: 32px;
    height: 18px;
    border-radius: 9999px;
    background: var(--color-border, #27272a);
    border: none;
    cursor: pointer;
    position: relative;
    padding: 0;
    margin: 2px 0;
    transition: background 150ms ease;
  }
  .pr-toggle-on {
    background: var(--color-primary, #00e5ff);
  }
  .pr-toggle-knob {
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
  .pr-toggle-on .pr-toggle-knob {
    transform: translateX(14px);
  }

  /* Tags */
  .pr-tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
    justify-content: flex-start;
    padding: 1px 0;
  }
  .pr-tag {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 2px 8px;
    border-radius: 9999px;
    border: 1px solid color-mix(in srgb, var(--value-color) 42%, transparent);
    background: color-mix(in srgb, var(--value-color-base) 14%, transparent);
    color: var(--value-color);
    font-size: 10px;
    font-family: var(--font-mono, 'JetBrains Mono'), monospace;
    transition: border-color 150ms ease;
  }
  .pr-tag:hover {
    border-color: color-mix(in srgb, var(--value-color) 68%, transparent);
  }
  .pr-tag-remove {
    background: none;
    border: none;
    color: inherit;
    cursor: pointer;
    padding: 0;
    font-size: 12px;
    line-height: 1;
    opacity: 0.5;
    transition: opacity 150ms ease;
  }
  .pr-tag-remove:hover {
    opacity: 1;
  }
  .pr-tag-input {
    background: transparent;
    border: none;
    color: var(--color-text, #e4e4e7);
    font-size: 10px;
    font-family: var(--font-mono, 'JetBrains Mono'), monospace;
    padding: 2px 4px;
    width: 50px;
    outline: none;
    text-align: left;
  }
  .pr-tag-input::placeholder {
    color: var(--color-text-faint, #52525b);
  }

  .pr-remove {
    background: none;
    border: none;
    color: var(--color-text-dim, #71717a);
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
  .pr:hover .pr-remove {
    opacity: 1;
  }
  .pr-remove:hover {
    color: var(--color-error, #ef4444);
  }
  .pr-remove .material-symbols-outlined {
    font-size: 14px;
  }

  .pr-relation {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px;
    width: 100%;
    min-height: 24px;
  }

  .pr-relation-pick {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    background: none;
    border: 1px dashed var(--color-border, #27272a);
    border-radius: var(--radius-full, 9999px);
    color: var(--color-text-dim, #71717a);
    font-size: var(--text-xs, 0.625rem);
    padding: 1px 8px;
    cursor: pointer;
    transition:
      color 150ms ease,
      border-color 150ms ease;
  }

  .pr-relation-pick:hover {
    color: var(--color-primary, #00e5ff);
    border-color: var(--color-primary-glow, rgba(0, 229, 255, 0.25));
  }

  .pr-relation-pick-icon {
    font-size: 12px;
  }

  .pr-files {
    width: 100%;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 5px;
  }

  .pr-file-tiles {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 5px;
    overflow-x: auto;
  }

  .pr-file-pick {
    min-height: 28px;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    flex: 0 0 auto;
    padding: 3px 7px;
    border: 1px dashed var(--color-border, #27272a);
    border-radius: 5px;
    background: transparent;
    color: var(--color-text-dim, #71717a);
    cursor: pointer;
    font-size: var(--text-xs, 0.625rem);
  }

  .pr-file-pick:hover {
    color: var(--color-primary, #00e5ff);
    border-color: var(--color-primary, #00e5ff);
  }

  .pr-file-pick .material-symbols-outlined {
    font-size: 15px;
  }

  @media (prefers-reduced-motion: reduce) {
    .pr,
    .pr-type-icon,
    .pr-key,
    .pr-val,
    .pr-toggle,
    .pr-toggle-knob,
    .pr-tag,
    .pr-tag-remove,
    .pr-remove,
    .pr-icon-btn,
    .pr-type-btn,
    .pr-more,
    .pr-relation-pick,
    .pr-file-pick {
      transition: none;
    }
  }
</style>
