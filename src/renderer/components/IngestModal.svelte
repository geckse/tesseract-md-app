<script lang="ts">
  import {
    ingestRunning,
    ingestIsReindex,
    ingestElapsed,
    ingestResult,
    ingestError,
    ingestModalOpen,
    ingestPreviewResult,
    ingestPreviewLoading,
    ingestState,
    closeIngestModal,
    cancelIngest,
  } from '../stores/ingest'
  import type { IngestResult, IngestPreview } from '../types/cli'
  import type { IngestState } from '../stores/ingest'

  let currentRunning = $state(false)
  let currentIsReindex = $state(false)
  let currentElapsed = $state(0)
  let currentResult: IngestResult | null = $state(null)
  let currentError: string | null = $state(null)
  let currentOpen = $state(false)
  let currentPreview: IngestPreview | null = $state(null)
  let currentPreviewLoading = $state(false)
  let currentState: IngestState = $state('idle')

  ingestRunning.subscribe((v) => (currentRunning = v))
  ingestIsReindex.subscribe((v) => (currentIsReindex = v))
  ingestElapsed.subscribe((v) => (currentElapsed = v))
  ingestResult.subscribe((v) => (currentResult = v))
  ingestError.subscribe((v) => (currentError = v))
  ingestModalOpen.subscribe((v) => (currentOpen = v))
  ingestPreviewResult.subscribe((v) => (currentPreview = v))
  ingestPreviewLoading.subscribe((v) => (currentPreviewLoading = v))
  ingestState.subscribe((v) => (currentState = v))

  let hasErrors = $derived(
    currentResult !== null && currentResult.errors.length > 0
  )

  function formatElapsed(secs: number): string {
    if (secs < 60) return `${secs}s`
    const m = Math.floor(secs / 60)
    const s = secs % 60
    return `${m}m ${s}s`
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget && !currentRunning && !currentPreviewLoading) {
      closeIngestModal()
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && !currentRunning && !currentPreviewLoading && currentOpen) {
      closeIngestModal()
    }
  }

  function handleCancel() {
    cancelIngest()
  }

  function statusBadgeClass(status: string): string {
    switch (status) {
      case 'New': return 'badge-new'
      case 'Changed': return 'badge-changed'
      case 'Unchanged': return 'badge-unchanged'
      default: return ''
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if currentOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal-backdrop" onclick={handleBackdropClick}>
    <div class="modal-content" role="dialog" aria-modal="true" aria-label="Ingest Results">

      {#if currentPreviewLoading}
        <div class="modal-header">
          <span class="material-symbols-outlined modal-icon spinning">sync</span>
          <h2 class="modal-title">Running Preview</h2>
        </div>
        <div class="modal-body">
          <p class="modal-subtitle">Analyzing files...</p>
          <div class="progress-bar-track">
            <div class="progress-bar-indeterminate"></div>
          </div>
        </div>

      {:else if currentPreview && !currentRunning && !currentResult && !currentError}
        <div class="modal-header">
          <span class="material-symbols-outlined modal-icon preview-icon">preview</span>
          <h2 class="modal-title">Ingest Preview</h2>
        </div>
        <div class="modal-body">
          <div class="preview-summary">
            <div class="stat-row">
              <span class="stat-label">Total files</span>
              <span class="stat-value">{currentPreview.total_files}</span>
            </div>
            <div class="stat-row">
              <span class="stat-label">Files to process</span>
              <span class="stat-value">{currentPreview.files_to_process}</span>
            </div>
            <div class="stat-row">
              <span class="stat-label">Unchanged</span>
              <span class="stat-value">{currentPreview.files_unchanged}</span>
            </div>
            <div class="stat-row">
              <span class="stat-label">Total chunks</span>
              <span class="stat-value">{currentPreview.total_chunks}</span>
            </div>
            <div class="stat-row">
              <span class="stat-label">Estimated tokens</span>
              <span class="stat-value">{currentPreview.estimated_tokens.toLocaleString()}</span>
            </div>
            <div class="stat-row">
              <span class="stat-label">Estimated API calls</span>
              <span class="stat-value">{currentPreview.estimated_api_calls}</span>
            </div>
          </div>

          {#if currentPreview.files.length > 0}
            <div class="preview-table-wrapper">
              <table class="preview-table">
                <thead>
                  <tr>
                    <th>File</th>
                    <th>Status</th>
                    <th>Chunks</th>
                    <th>Tokens</th>
                  </tr>
                </thead>
                <tbody>
                  {#each currentPreview.files as file}
                    <tr>
                      <td class="file-path-cell" title={file.path}>{file.path}</td>
                      <td><span class="status-badge {statusBadgeClass(file.status)}">{file.status}</span></td>
                      <td class="num-cell">{file.chunks}</td>
                      <td class="num-cell">{file.estimated_tokens.toLocaleString()}</td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        </div>
        <div class="modal-footer">
          <button class="modal-btn modal-btn-primary" onclick={closeIngestModal}>Close</button>
        </div>

      {:else if currentRunning}
        <div class="modal-header">
          <span class="material-symbols-outlined modal-icon spinning">sync</span>
          <h2 class="modal-title">Indexing Collection</h2>
        </div>
        <div class="modal-body">
          <p class="modal-subtitle">
            {currentIsReindex ? 'Running full reindex...' : 'Indexing new & changed files...'}
            <span class="elapsed">{formatElapsed(currentElapsed)}</span>
          </p>
          <div class="progress-bar-track">
            <div class="progress-bar-indeterminate"></div>
          </div>
          <p class="modal-hint">This may take a few minutes for large collections.</p>
        </div>
        <div class="modal-footer">
          <button class="modal-btn modal-btn-cancel" onclick={handleCancel}>Cancel</button>
        </div>

      {:else if currentError}
        <div class="modal-header">
          <span class="material-symbols-outlined modal-icon error-icon">error</span>
          <h2 class="modal-title">Indexing Failed</h2>
        </div>
        <div class="modal-body">
          <div class="error-box">
            <p class="error-message">{currentError}</p>
          </div>
        </div>
        <div class="modal-footer">
          <button class="modal-btn modal-btn-primary" onclick={closeIngestModal}>Close</button>
        </div>

      {:else if currentResult}
        <div class="modal-header">
          <span
            class="material-symbols-outlined modal-icon"
            class:success-icon={!hasErrors}
            class:warning-icon={hasErrors}
          >
            {hasErrors ? 'warning' : 'check_circle'}
          </span>
          <h2 class="modal-title">
            {hasErrors ? 'Indexing Complete (with errors)' : 'Indexing Complete'}
          </h2>
        </div>
        <div class="modal-body">
          <div class="stats-grid">
            <div class="stat-row">
              <span class="stat-label">Files indexed</span>
              <span class="stat-value">{currentResult.files_indexed}</span>
            </div>
            <div class="stat-row">
              <span class="stat-label">Files skipped</span>
              <span class="stat-value">{currentResult.files_skipped}</span>
            </div>
            <div class="stat-row">
              <span class="stat-label">Files removed</span>
              <span class="stat-value">{currentResult.files_removed}</span>
            </div>
            <div class="stat-row">
              <span class="stat-label">Chunks created</span>
              <span class="stat-value">{currentResult.chunks_created}</span>
            </div>
            <div class="stat-row">
              <span class="stat-label">API calls</span>
              <span class="stat-value">{currentResult.api_calls}</span>
            </div>
            <div class="stat-row">
              <span class="stat-label">Duration</span>
              <span class="stat-value">{currentResult.duration_secs.toFixed(1)}s</span>
            </div>
            {#if currentResult.files_failed > 0}
              <div class="stat-row stat-row-error">
                <span class="stat-label">Files failed</span>
                <span class="stat-value stat-value-error">{currentResult.files_failed}</span>
              </div>
            {/if}
          </div>

          {#if currentResult.errors.length > 0}
            <div class="errors-section">
              <h3 class="errors-title">Errors ({currentResult.errors.length})</h3>
              <div class="errors-list">
                {#each currentResult.errors as err}
                  <div class="error-item">
                    <span class="error-path">{err.path}</span>
                    <span class="error-detail">{err.message}</span>
                  </div>
                {/each}
              </div>
            </div>
          {/if}

          {#if currentResult.cancelled}
            <p class="cancelled-note">Indexing was cancelled before completion.</p>
          {/if}
        </div>
        <div class="modal-footer">
          <button class="modal-btn modal-btn-primary" onclick={closeIngestModal}>Done</button>
        </div>
      {/if}

    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }

  .modal-content {
    background: var(--color-surface, #161617);
    border: 1px solid var(--color-border, #27272a);
    border-radius: 8px;
    width: 520px;
    max-width: 90vw;
    max-height: 80vh;
    overflow-y: auto;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
  }

  .modal-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 20px 24px 0;
  }

  .modal-icon {
    font-size: 28px;
  }

  .success-icon { color: #22c55e; }
  .warning-icon { color: #eab308; }
  .error-icon { color: #ef4444; }
  .preview-icon { color: var(--color-primary, #00E5FF); }

  .modal-title {
    font-size: 16px;
    font-weight: 600;
    color: var(--color-text, #e4e4e7);
    margin: 0;
  }

  .modal-body {
    padding: 16px 24px;
  }

  .modal-subtitle {
    font-size: 13px;
    color: var(--color-text-dim, #71717a);
    margin-bottom: 16px;
  }

  .elapsed {
    font-family: 'JetBrains Mono', monospace;
    color: var(--color-primary, #00E5FF);
  }

  .modal-hint {
    font-size: 11px;
    color: var(--color-text-dim, #71717a);
    margin-top: 12px;
  }

  .progress-bar-track {
    height: 3px;
    background: var(--color-border, #27272a);
    border-radius: 2px;
    overflow: hidden;
  }

  .progress-bar-indeterminate {
    height: 100%;
    width: 40%;
    background: var(--color-primary, #00E5FF);
    border-radius: 2px;
    animation: indeterminate 1.5s ease-in-out infinite;
  }

  @keyframes indeterminate {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(350%); }
  }

  .spinning {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  .stats-grid {
    display: flex;
    flex-direction: column;
    gap: 0;
  }

  .stat-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 0;
    border-bottom: 1px solid rgba(39, 39, 42, 0.5);
  }

  .stat-row:last-child { border-bottom: none; }

  .stat-label {
    font-size: 12px;
    color: var(--color-text-dim, #71717a);
  }

  .stat-value {
    font-size: 12px;
    font-family: 'JetBrains Mono', monospace;
    color: var(--color-text, #e4e4e7);
    font-weight: 500;
  }

  .stat-row-error { border-bottom-color: rgba(239, 68, 68, 0.2); }
  .stat-value-error { color: #ef4444; }

  .errors-section {
    margin-top: 16px;
    border-top: 1px solid var(--color-border, #27272a);
    padding-top: 12px;
  }

  .errors-title {
    font-size: 12px;
    font-weight: 600;
    color: #ef4444;
    margin: 0 0 8px;
  }

  .errors-list {
    max-height: 160px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .error-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 8px;
    background: rgba(239, 68, 68, 0.05);
    border-radius: 4px;
    border: 1px solid rgba(239, 68, 68, 0.15);
  }

  .error-path {
    font-size: 11px;
    font-family: 'JetBrains Mono', monospace;
    color: var(--color-text, #e4e4e7);
  }

  .error-detail {
    font-size: 11px;
    color: var(--color-text-dim, #71717a);
  }

  .error-box {
    padding: 12px;
    background: rgba(239, 68, 68, 0.08);
    border: 1px solid rgba(239, 68, 68, 0.2);
    border-radius: 4px;
  }

  .error-message {
    font-size: 12px;
    font-family: 'JetBrains Mono', monospace;
    color: #ef4444;
    word-break: break-word;
    margin: 0;
  }

  .cancelled-note {
    font-size: 11px;
    color: #eab308;
    margin-top: 12px;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    padding: 12px 24px 20px;
  }

  .modal-btn {
    padding: 6px 20px;
    font-size: 12px;
    font-weight: 600;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-family: inherit;
    transition: background 0.15s ease;
  }

  .modal-btn-primary {
    background: var(--color-primary, #00E5FF);
    color: #0a0a0a;
  }

  .modal-btn-primary:hover {
    background: #00B8CC;
  }

  .modal-btn-cancel {
    background: rgba(239, 68, 68, 0.15);
    color: #ef4444;
    border: 1px solid rgba(239, 68, 68, 0.3);
  }

  .modal-btn-cancel:hover {
    background: rgba(239, 68, 68, 0.25);
  }

  /* Preview table styles */
  .preview-summary {
    margin-bottom: 16px;
  }

  .preview-table-wrapper {
    max-height: 300px;
    overflow-y: auto;
    border: 1px solid var(--color-border, #27272a);
    border-radius: 4px;
  }

  .preview-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 11px;
  }

  .preview-table thead {
    position: sticky;
    top: 0;
    background: var(--color-surface, #161617);
    z-index: 1;
  }

  .preview-table th {
    text-align: left;
    padding: 8px 10px;
    font-weight: 600;
    color: var(--color-text-dim, #71717a);
    border-bottom: 1px solid var(--color-border, #27272a);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .preview-table td {
    padding: 6px 10px;
    border-bottom: 1px solid rgba(39, 39, 42, 0.3);
    color: var(--color-text, #e4e4e7);
  }

  .preview-table tbody tr:last-child td {
    border-bottom: none;
  }

  .file-path-cell {
    font-family: 'JetBrains Mono', monospace;
    font-size: 11px;
    max-width: 240px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .num-cell {
    font-family: 'JetBrains Mono', monospace;
    text-align: right;
  }

  .status-badge {
    display: inline-block;
    padding: 1px 6px;
    border-radius: 3px;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }

  .badge-new {
    background: rgba(34, 197, 94, 0.15);
    color: #22c55e;
    border: 1px solid rgba(34, 197, 94, 0.3);
  }

  .badge-changed {
    background: rgba(234, 179, 8, 0.15);
    color: #eab308;
    border: 1px solid rgba(234, 179, 8, 0.3);
  }

  .badge-unchanged {
    background: rgba(113, 113, 122, 0.15);
    color: #71717a;
    border: 1px solid rgba(113, 113, 122, 0.3);
  }
</style>
