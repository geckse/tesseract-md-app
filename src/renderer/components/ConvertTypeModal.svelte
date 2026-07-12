<script lang="ts">
  import { propertyOps, isVaultWideScope } from '../stores/property-ops.svelte'
  import { focusTrap } from '../lib/focus-trap'
  import { calculateVirtualListState } from '../lib/virtual-list'
  import Button from './ui/Button.svelte'
  import type { PropertyOpPlanEntry, PropertyTargetType } from '../../preload/api'

  const TYPE_LABELS: Record<PropertyTargetType, string> = {
    text: 'Text',
    number: 'Number',
    boolean: 'Boolean',
    date: 'Date',
    datetime: 'Date & Time',
    url: 'URL',
    email: 'Email',
    select: 'Select',
    tags: 'Tags',
    complex: 'JSON'
  }

  /** Virtualize the preview list above this row count (fixed row height). */
  const VIRTUALIZE_THRESHOLD = 200
  const ROW_HEIGHT = 26

  const m = $derived(propertyOps.modal)
  const op = $derived(m?.req.op ?? null)
  const isRename = $derived(op?.kind === 'rename')
  const targetLabel = $derived(
    op?.kind === 'convert' ? TYPE_LABELS[op.target] : (op?.newKey ?? '')
  )

  const scopeLabel = $derived.by(() => {
    if (!m) return ''
    if (m.req.scope === null) return 'this file only'
    if (isVaultWideScope(m.req.scope)) return 'entire vault'
    return m.req.scope
  })

  /** Files that will be written (convert or rename). */
  const convertCount = $derived(m?.plan?.totals.convert ?? 0)

  const applyLabel = $derived.by(() => {
    if (!m?.plan) return ''
    const verb = isRename ? 'Rename' : 'Convert'
    if (convertCount === 0) return m.plan.schemaPin ? 'Update schema only' : verb
    return `${verb} ${convertCount} file${convertCount === 1 ? '' : 's'}`
  })
  const applyDisabled = $derived(!m?.plan || (convertCount === 0 && !m.plan.schemaPin))

  // ── Rename input ──────────────────────────────────────────────────────
  let renameInput = $state('')
  const renameValid = $derived(
    renameInput.trim() !== '' && renameInput.trim() !== m?.req.key
  )

  function submitRename(): void {
    if (!renameValid) return
    propertyOps.setRenameKey(renameInput.trim())
    void propertyOps.preview()
  }

  // ── Allowed values chip editor (select target) ────────────────────────
  let newAllowedValue = $state('')
  const allowedValues = $derived(
    m && op?.kind === 'convert' && op.target === 'select' ? (op.allowedValues ?? []) : null
  )

  function addAllowedValue(): void {
    const trimmed = newAllowedValue.trim()
    if (!trimmed || !allowedValues) return
    if (!allowedValues.includes(trimmed)) {
      propertyOps.setAllowedValues([...allowedValues, trimmed])
    }
    newAllowedValue = ''
  }

  function removeAllowedValue(index: number): void {
    if (!allowedValues) return
    propertyOps.setAllowedValues(allowedValues.filter((_, i) => i !== index))
  }

  // ── Virtualized preview list ──────────────────────────────────────────
  let scrollTop = $state(0)
  let viewportHeight = $state(320)
  let listEl = $state<HTMLDivElement | null>(null)

  const files = $derived(m?.plan?.files ?? [])
  const virtualized = $derived(files.length > VIRTUALIZE_THRESHOLD)
  const listState = $derived(
    calculateVirtualListState(scrollTop, viewportHeight, {
      itemHeight: ROW_HEIGHT,
      totalItems: files.length,
      buffer: 10
    })
  )
  const visibleFiles = $derived(
    virtualized ? files.slice(listState.start, listState.end) : files
  )

  function onListScroll(): void {
    if (listEl) {
      scrollTop = listEl.scrollTop
      viewportHeight = listEl.clientHeight || viewportHeight
    }
  }

  function rowIcon(entry: PropertyOpPlanEntry): string {
    switch (entry.action) {
      case 'convert':
      case 'rename':
        return 'east'
      case 'skip':
        return 'warning'
      case 'no-value':
        return 'remove'
      default:
        return 'check'
    }
  }

  const progressPct = $derived.by(() => {
    const p = m?.progress
    if (!p || p.total === 0) return 0
    return Math.round((p.done / p.total) * 100)
  })

  function onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Escape' && m?.phase !== 'running') propertyOps.close()
  }

  function close(): void {
    propertyOps.close()
  }
</script>

{#if m}
  <div
    class="modal-overlay"
    role="dialog"
    aria-modal="true"
    aria-label={isRename ? `Rename property ${m.req.key}` : `Change type of ${m.req.key}`}
    tabindex="-1"
    onkeydown={onKeydown}
  >
    <button
      class="overlay-backdrop"
      aria-label="Dismiss dialog"
      onclick={close}
      disabled={m.phase === 'running'}
    ></button>
    <div class="modal" use:focusTrap>
      <h2 class="modal-title">
        {#if isRename}
          Rename property: <span class="mono">{m.req.key}</span>
        {:else}
          Change type: <span class="mono">{m.req.key}</span>
          <span class="arrow" aria-hidden="true">→</span>
          {targetLabel}
        {/if}
      </h2>
      <p class="scope-line">
        {#if m.req.scope === null}
          Applies to <strong>this file only</strong>
        {:else if isVaultWideScope(m.req.scope)}
          Applies to the <strong>entire vault</strong> — every markdown file with this property
        {:else}
          Database: <span class="mono">{scopeLabel}</span> (recursive
          {#if m.plan}, {m.plan.files.length} file{m.plan.files.length === 1 ? '' : 's'}{/if})
        {/if}
      </p>

      {#if isRename && m.phase !== 'running' && m.phase !== 'report'}
        <div class="rename-row">
          <!-- svelte-ignore a11y_autofocus -->
          <input
            class="rename-input"
            type="text"
            placeholder="New property name"
            aria-label="New property name"
            autofocus
            bind:value={renameInput}
            onkeydown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                submitRename()
              }
            }}
          />
          <Button size="sm" disabled={!renameValid || m.phase === 'loading'} onclick={submitRename}>
            Preview
          </Button>
        </div>
      {/if}

      {#if m.phase === 'loading'}
        <p class="status" aria-live="polite">Computing preview…</p>
      {:else if m.phase === 'error'}
        <p class="error" role="alert">{m.error}</p>
      {:else if m.phase === 'preview' && m.plan}
        <p class="totals" aria-live="polite">
          {m.plan.totals.convert} file{m.plan.totals.convert === 1 ? '' : 's'} convert ·
          {m.plan.totals.skip} skipped · {m.plan.totals.noValue} without a value ·
          {m.plan.totals.unchanged} unchanged
        </p>

        {#if m.dirtyAffected.length > 0}
          <p class="warn">
            <span class="material-symbols-outlined warn-icon">warning</span>
            {m.dirtyAffected.length} affected file{m.dirtyAffected.length === 1 ? ' has' : 's have'}
            unsaved changes in open tabs — they'll show the conflict banner.
          </p>
        {/if}

        {#if files.length > 0}
          <div
            class="file-list"
            bind:this={listEl}
            onscroll={onListScroll}
            role="list"
            aria-label="Affected files"
          >
            {#if virtualized}
              <div class="virtual-spacer" style="height: {listState.totalHeight}px;">
                <div style="transform: translateY({listState.offsetY}px);">
                  {#each visibleFiles as entry (entry.path)}
                    {@render fileRow(entry)}
                  {/each}
                </div>
              </div>
            {:else}
              {#each visibleFiles as entry (entry.path)}
                {@render fileRow(entry)}
              {/each}
            {/if}
          </div>
        {/if}

        {#if allowedValues}
          <div class="allowed-values">
            <span class="allowed-label">Allowed values</span>
            <div class="chips">
              {#each allowedValues as v, i (v)}
                <span class="chip">
                  {v}
                  <button
                    class="chip-remove"
                    onclick={() => removeAllowedValue(i)}
                    aria-label="Remove allowed value {v}"
                  >
                    &times;
                  </button>
                </span>
              {/each}
              <input
                class="chip-input"
                type="text"
                placeholder="+ value"
                aria-label="Add allowed value"
                bind:value={newAllowedValue}
                onkeydown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addAllowedValue()
                  }
                }}
                onblur={addAllowedValue}
              />
            </div>
          </div>
        {/if}

        {#if m.plan.totals.skip > 0}
          <p class="note">Skipped values keep their current value and type.</p>
        {/if}
        {#if m.plan.schemaPin}
          <p class="note">
            The schema for
            <span class="mono">{m.plan.schemaPin.scopeKey ?? 'the vault'}</span>
            will record: <strong>{m.plan.schemaPin.fieldType}</strong>.
            {#if op?.kind === 'convert' && (op.target === 'url' || op.target === 'email')}
              (URL/Email display is detected per value — the schema stores strings.)
            {/if}
          </p>
        {/if}
      {:else if m.phase === 'running' && m.progress}
        <div class="progress-wrap" aria-live="polite">
          <div
            class="progress-bar"
            role="progressbar"
            aria-valuemin="0"
            aria-valuemax={m.progress.total}
            aria-valuenow={m.progress.done}
          >
            <div class="progress-fill" style="width: {progressPct}%;"></div>
          </div>
          <p class="status">
            {m.progress.done}/{m.progress.total}
            <span class="mono current-path">{m.progress.path}</span>
          </p>
        </div>
      {:else if m.phase === 'report' && m.result}
        <p class="totals" aria-live="polite">
          {m.result.totals.ok} converted · {m.result.totals.skipped} skipped ·
          {m.result.totals.failed} failed
        </p>
        {#if m.result.totals.skipped > 0}
          <details class="report-group">
            <summary>Skipped ({m.result.totals.skipped})</summary>
            <ul class="report-list">
              {#each m.result.entries.filter((e) => e.status === 'skipped') as e (e.path)}
                <li><span class="mono">{e.path}</span> — {e.reason}</li>
              {/each}
            </ul>
          </details>
        {/if}
        {#if m.result.totals.failed > 0}
          <details class="report-group" open>
            <summary class="failed">Failed ({m.result.totals.failed})</summary>
            <ul class="report-list">
              {#each m.result.entries.filter((e) => e.status === 'failed') as e (e.path)}
                <li><span class="mono">{e.path}</span> — {e.reason}</li>
              {/each}
            </ul>
          </details>
        {/if}
      {/if}

      <div class="modal-actions">
        {#if m.phase === 'report'}
          <Button size="sm" onclick={close}>Close</Button>
        {:else if m.phase === 'error'}
          <Button variant="secondary" size="sm" onclick={close}>Close</Button>
        {:else}
          <Button
            variant="secondary"
            size="sm"
            disabled={m.phase === 'running'}
            onclick={close}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={applyDisabled || m.phase !== 'preview'}
            onclick={() => void propertyOps.apply()}
          >
            {applyLabel || 'Convert'}
          </Button>
        {/if}
      </div>
    </div>
  </div>
{/if}

{#snippet fileRow(entry: PropertyOpPlanEntry)}
  <div
    class="file-row"
    class:skipped={entry.action === 'skip'}
    class:dimmed={entry.action === 'no-value' || entry.action === 'unchanged'}
    style="height: {ROW_HEIGHT}px;"
    role="listitem"
  >
    <span class="material-symbols-outlined row-icon" aria-hidden="true">{rowIcon(entry)}</span>
    <span class="row-path mono" title={entry.path}>{entry.path}</span>
    {#if entry.action === 'skip'}
      <span class="row-before mono">{entry.before ?? ''}</span>
      <span class="row-reason" title={entry.reason}>{entry.reason}</span>
    {:else if entry.action === 'no-value'}
      <span class="row-reason">no value</span>
    {:else if entry.action === 'unchanged'}
      <span class="row-before mono">{entry.before ?? ''}</span>
      <span class="row-reason">unchanged</span>
    {:else}
      <span class="row-before mono">{entry.before ?? ''}</span>
      <span class="row-arrow" aria-hidden="true">→</span>
      <span class="row-after mono">{entry.after ?? ''}</span>
    {/if}
  </div>
{/snippet}

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
    background: var(--overlay-backdrop, rgba(0, 0, 0, 0.55));
    border: none;
    cursor: default;
  }

  .modal {
    position: relative;
    width: min(640px, calc(100vw - 48px));
    max-height: calc(100vh - 96px);
    overflow-y: auto;
    background: var(--color-surface, #161617);
    border: 1px solid var(--color-border, #27272a);
    border-radius: var(--radius-lg, 8px);
    box-shadow: var(--shadow-popover, 0 8px 24px rgba(0, 0, 0, 0.45));
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .modal-title {
    font-size: 14px;
    font-weight: 600;
    color: var(--color-text, #e4e4e7);
    margin: 0;
  }

  .arrow {
    color: var(--color-primary, #00e5ff);
    margin: 0 2px;
  }

  .mono {
    font-family: var(--font-mono, 'JetBrains Mono'), monospace;
  }

  .scope-line {
    font-size: 12px;
    color: var(--color-text-dim, #71717a);
    margin: 0;
  }

  .rename-row {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  .rename-input {
    flex: 1;
    background: transparent;
    border: 1px solid var(--color-border, #27272a);
    border-radius: 4px;
    color: var(--color-text, #e4e4e7);
    font-family: var(--font-mono, 'JetBrains Mono'), monospace;
    font-size: 12px;
    padding: 5px 8px;
    outline: none;
    transition: border-color 150ms ease;
  }
  .rename-input:focus {
    border-color: var(--color-primary, #00e5ff);
  }

  .status {
    font-size: 12px;
    color: var(--color-text-dim, #71717a);
    margin: 0;
  }

  .error {
    font-size: 12px;
    color: var(--color-error, #ef4444);
    margin: 0;
  }

  .totals {
    font-size: 12px;
    color: var(--color-text, #e4e4e7);
    margin: 0;
  }

  .warn {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    color: var(--color-warning, #eab308);
    margin: 0;
  }
  .warn-icon {
    font-size: 14px;
  }

  .file-list {
    max-height: 280px;
    overflow-y: auto;
    border: 1px solid var(--color-border, #27272a);
    border-radius: var(--radius-md, 6px);
    scrollbar-width: thin;
  }

  .virtual-spacer {
    position: relative;
    overflow: hidden;
  }

  .file-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 8px;
    font-size: 11px;
    color: var(--color-text, #e4e4e7);
    border-bottom: 1px solid var(--color-border, #27272a);
    box-sizing: border-box;
  }
  .file-row:last-child {
    border-bottom: none;
  }
  .file-row.skipped {
    color: var(--color-warning, #eab308);
  }
  .file-row.dimmed {
    color: var(--color-text-faint, #52525b);
  }

  .row-icon {
    font-size: 13px;
    flex-shrink: 0;
    color: var(--color-text-faint, #52525b);
  }
  .skipped .row-icon {
    color: var(--color-warning, #eab308);
  }

  .row-path {
    flex: 1 1 40%;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row-before,
  .row-after {
    flex: 0 1 25%;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .row-after {
    color: var(--color-primary, #00e5ff);
  }
  .skipped .row-after {
    color: inherit;
  }

  .row-arrow {
    flex-shrink: 0;
    color: var(--color-text-faint, #52525b);
  }

  .row-reason {
    flex: 0 1 30%;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-style: italic;
  }

  .allowed-values {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .allowed-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-text-dim, #71717a);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    align-items: center;
  }
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 2px 8px;
    border-radius: 9999px;
    border: 1px solid var(--color-primary-glow, rgba(0, 229, 255, 0.25));
    color: var(--color-primary, #00e5ff);
    font-size: 10px;
    font-family: var(--font-mono, 'JetBrains Mono'), monospace;
  }
  .chip-remove {
    background: none;
    border: none;
    color: var(--color-primary, #00e5ff);
    cursor: pointer;
    padding: 0;
    font-size: 12px;
    line-height: 1;
    opacity: 0.5;
    transition: opacity 150ms ease;
  }
  .chip-remove:hover {
    opacity: 1;
  }
  .chip-input {
    background: transparent;
    border: none;
    color: var(--color-text, #e4e4e7);
    font-size: 10px;
    font-family: var(--font-mono, 'JetBrains Mono'), monospace;
    padding: 2px 4px;
    width: 64px;
    outline: none;
  }

  .note {
    font-size: 11px;
    color: var(--color-text-dim, #71717a);
    margin: 0;
  }

  .progress-wrap {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .progress-bar {
    height: 6px;
    border-radius: 9999px;
    background: var(--color-border, #27272a);
    overflow: hidden;
  }
  .progress-fill {
    height: 100%;
    background: var(--color-primary, #00e5ff);
    transition: width 150ms ease;
  }
  .current-path {
    color: var(--color-text-faint, #52525b);
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .report-group {
    font-size: 12px;
    color: var(--color-text, #e4e4e7);
  }
  .report-group summary {
    cursor: pointer;
    color: var(--color-text-dim, #71717a);
  }
  .report-group summary.failed {
    color: var(--color-error, #ef4444);
  }
  .report-list {
    margin: 4px 0 0;
    padding-left: 18px;
    font-size: 11px;
    color: var(--color-text-dim, #71717a);
    max-height: 140px;
    overflow-y: auto;
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 4px;
  }

  @media (prefers-reduced-motion: reduce) {
    .rename-input,
    .chip-remove,
    .progress-fill {
      transition: none;
    }
  }
</style>
