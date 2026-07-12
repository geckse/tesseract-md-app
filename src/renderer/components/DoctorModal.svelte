<script lang="ts">
  import {
    doctorModalOpen,
    doctorRunning,
    collectionDoctorResult,
    activeCollection,
    runDoctor
  } from '../stores/collections'
  import { openSettingsSection } from '../stores/settings'
  import { runIngest } from '../stores/ingest'
  import { focusTrap } from '../lib/focus-trap'
  import type { DoctorCheck } from '../types/cli'

  let open = $state(false)
  doctorModalOpen.subscribe((v) => (open = v))

  let running = $state(false)
  doctorRunning.subscribe((v) => (running = v))

  let result = $state<import('../types/cli').DoctorResult | null>(null)
  collectionDoctorResult.subscribe((v) => (result = v))

  let collection = $state<import('../../preload/api').Collection | null>(null)
  activeCollection.subscribe((v) => (collection = v))

  function close() {
    doctorModalOpen.set(false)
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) close()
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) close()
  }

  function statusIcon(status: DoctorCheck['status']): string {
    if (status === 'Pass') return 'check_circle'
    if (status === 'Warn') return 'warning'
    return 'cancel'
  }

  /** Contextual fix action per CLI check name (unknown names get none). */
  interface CheckAction {
    label: string
    run: () => void
  }

  function actionFor(check: DoctorCheck): CheckAction | null {
    if (check.status === 'Pass') return null
    switch (check.name) {
      case 'API key':
      case 'Provider reachable':
        return {
          label: 'Open Settings',
          run: () => {
            close()
            openSettingsSection('global', 'embedding')
          }
        }
      case 'Config loaded':
      case 'User config':
      case 'Project config':
        return {
          label: 'Open Settings',
          run: () => {
            close()
            openSettingsSection('global', 'cli')
          }
        }
      case 'Index':
        return {
          label: 'Reindex',
          run: () => {
            close()
            void runIngest(true)
          }
        }
      case 'Source directories':
        return {
          label: 'Reveal Collection',
          run: () => {
            if (collection) void window.api.showItemInFolder(collection.path)
          }
        }
      default:
        return null
    }
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
      aria-label="Collection Doctor"
      use:focusTrap
    >
      <div class="modal-header">
        <span class="material-symbols-outlined modal-icon">troubleshoot</span>
        <div class="header-text">
          <h2 class="modal-title">Collection Doctor</h2>
          <span class="modal-subtitle" aria-live="polite">
            {#if running}
              Running checks…
            {:else if result}
              {result.passed}/{result.total} checks passed
              {#if collection}· {collection.name}{/if}
            {:else}
              No results
            {/if}
          </span>
        </div>
      </div>

      <div class="modal-body">
        {#if running && !result}
          <div class="skeleton-list">
            {#each Array(6) as _unused}
              <div class="skeleton-row"></div>
            {/each}
          </div>
        {:else if result}
          <div class="check-list" class:refreshing={running}>
            {#each result.checks as check (check.name)}
              <div class="check-row">
                <span
                  class="material-symbols-outlined check-icon"
                  class:pass={check.status === 'Pass'}
                  class:warn={check.status === 'Warn'}
                  class:fail={check.status === 'Fail'}
                >
                  {statusIcon(check.status)}
                </span>
                <div class="check-text">
                  <span class="check-name">{check.name}</span>
                  <span class="check-detail">{check.detail}</span>
                </div>
                {#if actionFor(check)}
                  {@const action = actionFor(check)!}
                  <button class="check-action" onclick={action.run}>{action.label}</button>
                {/if}
              </div>
            {/each}
          </div>
        {:else}
          <div class="empty-state">
            <p>Doctor could not run — is the mdvdb CLI installed?</p>
            <button
              class="check-action"
              onclick={() => {
                close()
                openSettingsSection('global', 'cli')
              }}
            >
              CLI Settings
            </button>
          </div>
        {/if}
      </div>

      <div class="modal-footer">
        <button class="modal-btn" onclick={() => void runDoctor()} disabled={running}>
          {#if running}
            <span class="material-symbols-outlined spinner">progress_activity</span>
          {/if}
          Run Again
        </button>
        <button class="modal-btn modal-btn-primary" onclick={close}>Close</button>
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
    max-height: 80vh;
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
  }

  .modal-title {
    font-size: var(--text-lg, 16px);
    font-weight: var(--weight-semibold, 600);
    color: var(--color-text, #fafafa);
    margin: 0;
  }

  .modal-subtitle {
    font-size: var(--text-xs, 11px);
    color: var(--color-text-dim, #71717a);
  }

  .modal-body {
    padding: 8px 24px 16px;
    overflow-y: auto;
  }

  .check-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    transition: opacity var(--transition-fast, 150ms ease);
  }

  .check-list.refreshing {
    opacity: 0.5;
  }

  .check-row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 8px 4px;
    border-bottom: 1px solid var(--color-border, #27272a);
  }

  .check-row:last-child {
    border-bottom: none;
  }

  .check-icon {
    font-size: 18px;
    margin-top: 1px;
  }

  .check-icon.pass {
    color: var(--color-success, #22c55e);
  }

  .check-icon.warn {
    color: var(--color-warning, #f59e0b);
  }

  .check-icon.fail {
    color: var(--color-error, #ef4444);
  }

  .check-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    flex: 1;
    min-width: 0;
  }

  .check-name {
    font-size: var(--text-sm, 13px);
    font-weight: var(--weight-medium, 500);
    color: var(--color-text, #fafafa);
  }

  .check-detail {
    font-size: var(--text-xs, 11px);
    color: var(--color-text-dim, #71717a);
    overflow-wrap: anywhere;
  }

  .check-action {
    flex-shrink: 0;
    padding: 4px 10px;
    border-radius: var(--radius-md, 4px);
    font-size: var(--text-xs, 11px);
    font-weight: var(--weight-medium, 500);
    background: var(--color-surface, #161617);
    border: 1px solid var(--color-border, #27272a);
    color: var(--color-text, #fafafa);
    cursor: pointer;
    transition: border-color var(--transition-fast, 150ms ease);
  }

  .check-action:hover {
    border-color: var(--color-primary, #00e5ff);
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 24px 0;
    color: var(--color-text-dim, #71717a);
    font-size: var(--text-sm, 13px);
  }

  .empty-state p {
    margin: 0;
  }

  .skeleton-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 4px 0;
  }

  .skeleton-row {
    height: 34px;
    border-radius: var(--radius-md, 4px);
    background: var(--color-surface, #161617);
    animation: pulse 1.2s ease-in-out infinite;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 0.5;
    }
    50% {
      opacity: 1;
    }
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding: 12px 24px 16px;
    border-top: 1px solid var(--color-border, #27272a);
  }

  .modal-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 16px;
    border-radius: var(--radius-md, 4px);
    font-size: var(--text-sm, 13px);
    font-weight: var(--weight-medium, 500);
    cursor: pointer;
    border: 1px solid var(--color-border, #27272a);
    background: var(--color-surface, #161617);
    color: var(--color-text, #fafafa);
  }

  .modal-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .modal-btn-primary {
    background: var(--color-accent, #3b82f6);
    border-color: transparent;
    color: white;
  }

  .modal-btn-primary:hover {
    opacity: 0.9;
  }

  .spinner {
    font-size: 14px;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .skeleton-row,
    .spinner {
      animation: none;
    }

    .check-list {
      transition: none;
    }
  }
</style>
