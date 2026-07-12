<script lang="ts">
  import {
    collectionInfo,
    infoModalOpen,
    infoLoading,
    infoError,
    infoScope,
    activeCollection,
    closeInfoModal,
    fetchCollectionInfo
  } from '../stores/collections'
  import { focusTrap } from '../lib/focus-trap'
  import type { VaultInfo } from '../types/cli'
  import type { Collection } from '../../preload/api'

  let open = $state(false)
  let loading = $state(false)
  let error = $state<string | null>(null)
  let info = $state<VaultInfo | null>(null)
  let scope = $state<string | null>(null)
  let collection = $state<Collection | null>(null)

  infoModalOpen.subscribe((value) => (open = value))
  infoLoading.subscribe((value) => (loading = value))
  infoError.subscribe((value) => (error = value))
  collectionInfo.subscribe((value) => (info = value))
  infoScope.subscribe((value) => (scope = value))
  activeCollection.subscribe((value) => (collection = value))

  function handleBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) closeInfoModal()
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape' && open) closeInfoModal()
  }

  function formatBytes(bytes: number): string {
    if (bytes === 0) return '0 B'
    const units = ['B', 'KB', 'MB', 'GB', 'TB']
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
    const value = bytes / 1024 ** index
    return `${value.toLocaleString(undefined, { maximumFractionDigits: index === 0 ? 0 : 1 })} ${units[index]}`
  }

  function formatUpdated(timestamp: number): string {
    if (timestamp <= 0) return 'Never'
    return new Date(timestamp * 1000).toLocaleString()
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal-backdrop" onclick={handleBackdropClick}>
    <div
      class="modal-content"
      role="dialog"
      aria-modal="true"
      aria-label="Collection Information"
      use:focusTrap
    >
      <div class="modal-header">
        <span class="material-symbols-outlined modal-icon">info</span>
        <div class="header-text">
          <h2 class="modal-title">Collection Information</h2>
          <span class="modal-subtitle">
            {scope ?? collection?.name ?? 'No collection selected'}
          </span>
        </div>
      </div>

      <div class="modal-body" aria-live="polite">
        {#if loading && !info}
          <div class="skeleton-list" aria-label="Loading collection information">
            {#each Array(10) as _unused}
              <div class="skeleton-row"></div>
            {/each}
          </div>
        {:else if error}
          <div class="error-state">
            <span class="material-symbols-outlined error-icon">error</span>
            <p>{error}</p>
            <p class="error-hint">
              If this command is unavailable, update the mdvdb CLI and try again.
            </p>
            <button class="inline-btn" onclick={() => void fetchCollectionInfo()}>Retry</button>
          </div>
        {:else if info}
          <div class="info-content" class:refreshing={loading}>
            <section>
              <h3>Contents</h3>
              <div class="preview-summary">
                <div class="stat-row">
                  <span class="stat-label">Markdown files</span>
                  <span class="stat-value">{info.file_count.toLocaleString()}</span>
                </div>
                <div class="stat-row">
                  <span class="stat-label">Indexed</span>
                  <span class="stat-value">{info.indexed_file_count.toLocaleString()}</span>
                </div>
                <div class="stat-row">
                  <span class="stat-label">Chunks</span>
                  <span class="stat-value">{info.chunk_count.toLocaleString()}</span>
                </div>
                <div class="stat-row">
                  <span class="stat-label">Vectors</span>
                  <span class="stat-value">
                    {info.vector_count.toLocaleString()}
                    <span class="value-detail">({info.edge_count.toLocaleString()} edge)</span>
                  </span>
                </div>
              </div>
            </section>

            <section>
              <h3>Sync</h3>
              <div class="sync-badges">
                <span class="sync-badge badge-new">{info.sync.new} new</span>
                <span class="sync-badge badge-changed">{info.sync.changed} changed</span>
                <span class="sync-badge badge-unchanged">{info.sync.unchanged} unchanged</span>
                <span class="sync-badge badge-deleted">{info.sync.deleted} deleted</span>
              </div>
            </section>

            <section>
              <h3>Full reindex estimate</h3>
              <div class="preview-summary">
                <div class="stat-row">
                  <span class="stat-label">Chunks</span>
                  <span class="stat-value">{info.reindex_chunks.toLocaleString()}</span>
                </div>
                <div class="stat-row">
                  <span class="stat-label">Estimated tokens</span>
                  <span class="stat-value">{info.reindex_estimated_tokens.toLocaleString()}</span>
                </div>
                <div class="stat-row">
                  <span class="stat-label">Estimated API calls</span>
                  <span class="stat-value">
                    {info.reindex_estimated_api_calls.toLocaleString()}
                  </span>
                </div>
              </div>
            </section>

            <section>
              <h3>Index</h3>
              <div class="preview-summary">
                <div class="stat-row">
                  <span class="stat-label">Size</span>
                  <span class="stat-value">{formatBytes(info.index_file_size)}</span>
                </div>
                <div class="stat-row">
                  <span class="stat-label">Last updated</span>
                  <span class="stat-value">{formatUpdated(info.last_updated)}</span>
                </div>
                <div class="stat-row">
                  <span class="stat-label">Embedding</span>
                  <span class="stat-value embedding-value">
                    {info.embedding.provider} · {info.embedding.model} · {info.embedding.dimensions}
                    dims
                  </span>
                </div>
              </div>
            </section>
          </div>
        {:else}
          <div class="error-state">
            <p>No collection information is available.</p>
            <button class="inline-btn" onclick={() => void fetchCollectionInfo()}>Retry</button>
          </div>
        {/if}
      </div>

      <div class="modal-footer">
        <button class="modal-btn" onclick={() => void fetchCollectionInfo()} disabled={loading}>
          {#if loading}
            <span class="material-symbols-outlined spinner">progress_activity</span>
          {/if}
          Refresh
        </button>
        <button class="modal-btn modal-btn-primary" onclick={closeInfoModal}>Close</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .modal-content {
    background: var(--color-bg, #09090b);
    border: 1px solid var(--color-border, #27272a);
    border-radius: var(--radius-lg, 8px);
    width: 560px;
    max-width: 90vw;
    max-height: 85vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .modal-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 20px 24px 12px;
  }

  .modal-icon {
    font-size: 26px;
    color: var(--color-primary, #00e5ff);
  }

  .header-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .modal-title {
    margin: 0;
    color: var(--color-text, #fafafa);
    font-size: var(--text-lg, 16px);
    font-weight: var(--weight-semibold, 600);
  }

  .modal-subtitle {
    overflow: hidden;
    color: var(--color-text-dim, #71717a);
    font-size: var(--text-xs, 11px);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .modal-body {
    padding: 8px 24px 16px;
    overflow-y: auto;
  }

  .info-content {
    display: flex;
    flex-direction: column;
    gap: 18px;
    transition: opacity var(--transition-fast, 150ms ease);
  }

  .info-content.refreshing {
    opacity: 0.55;
  }

  section h3 {
    margin: 0 0 8px;
    color: var(--color-text-muted, #a1a1aa);
    font-size: var(--text-xs, 11px);
    font-weight: var(--weight-semibold, 600);
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }

  .preview-summary {
    display: flex;
    flex-direction: column;
    border: 1px solid var(--color-border, #27272a);
    border-radius: var(--radius-md, 6px);
    overflow: hidden;
  }

  .stat-row {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 20px;
    padding: 9px 12px;
    border-bottom: 1px solid var(--color-border, #27272a);
  }

  .stat-row:last-child {
    border-bottom: 0;
  }

  .stat-label {
    color: var(--color-text-muted, #a1a1aa);
    font-size: var(--text-sm, 13px);
  }

  .stat-value {
    color: var(--color-text, #fafafa);
    font-size: var(--text-sm, 13px);
    font-variant-numeric: tabular-nums;
    font-weight: var(--weight-medium, 500);
    text-align: right;
  }

  .value-detail {
    margin-left: 4px;
    color: var(--color-text-dim, #71717a);
    font-size: var(--text-xs, 11px);
    font-weight: 400;
  }

  .embedding-value {
    max-width: 65%;
    overflow-wrap: anywhere;
  }

  .sync-badges {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }

  .sync-badge {
    padding: 4px 8px;
    border: 1px solid var(--color-border, #27272a);
    border-radius: 999px;
    font-size: var(--text-xs, 11px);
    font-variant-numeric: tabular-nums;
  }

  .badge-new {
    color: var(--color-success, #22c55e);
  }

  .badge-changed {
    color: var(--color-warning, #f59e0b);
  }

  .badge-unchanged {
    color: var(--color-text-muted, #a1a1aa);
  }

  .badge-deleted,
  .error-icon {
    color: var(--color-error, #ef4444);
  }

  .error-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 32px 12px;
    color: var(--color-text-muted, #a1a1aa);
    text-align: center;
  }

  .error-state p {
    margin: 0;
  }

  .error-hint {
    max-width: 420px;
    color: var(--color-text-dim, #71717a);
    font-size: var(--text-xs, 11px);
  }

  .inline-btn,
  .modal-btn {
    border: 1px solid var(--color-border, #27272a);
    border-radius: var(--radius-md, 6px);
    background: var(--color-bg-elevated, #18181b);
    color: var(--color-text, #fafafa);
    cursor: pointer;
    font: inherit;
  }

  .inline-btn {
    padding: 6px 12px;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 24px 20px;
    border-top: 1px solid var(--color-border, #27272a);
  }

  .modal-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 14px;
  }

  .modal-btn-primary {
    border-color: var(--color-primary, #00e5ff);
    background: var(--color-primary, #00e5ff);
    color: #001114;
  }

  .modal-btn:disabled {
    cursor: default;
    opacity: 0.55;
  }

  .skeleton-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px 0;
  }

  .skeleton-row {
    height: 34px;
    border-radius: var(--radius-md, 6px);
    background: linear-gradient(
      90deg,
      var(--color-bg-elevated, #18181b) 25%,
      var(--color-bg-hover, #27272a) 50%,
      var(--color-bg-elevated, #18181b) 75%
    );
    background-size: 200% 100%;
    animation: shimmer 1.4s infinite;
  }

  .spinner {
    font-size: 16px;
    animation: spin 1s linear infinite;
  }

  @keyframes shimmer {
    from {
      background-position: 200% 0;
    }
    to {
      background-position: -200% 0;
    }
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .info-content {
      transition: none;
    }

    .skeleton-row,
    .spinner {
      animation: none;
    }
  }
</style>
