<script lang="ts">
  import { obsidianImportNotice, dismissObsidianImportNotice } from '../stores/obsidian-import'
  import { activeCollectionId } from '../stores/collections'
  import { topicsNeedIngest } from '../stores/topics'
  import { runIngest } from '../stores/ingest'
  import type { ObsidianTopicsSyncedEvent } from '../../preload/api'

  const MAX_LISTED = 4

  let notice = $state<ObsidianTopicsSyncedEvent | null>(null)
  let activeId = $state<string | null>(null)
  let syncing = $state(false)

  obsidianImportNotice.subscribe((v) => (notice = v))
  activeCollectionId.subscribe((v) => (activeId = v))

  /** First sync of a fresh vault is a pure import — phrase it that way. */
  let isInitialImport = $derived(
    notice !== null && notice.updated.length === 0 && notice.removed.length === 0
  )

  let topicPreview = $derived.by(() => {
    if (!notice) return ''
    const names = [...notice.added, ...notice.updated]
    const listed = names.slice(0, MAX_LISTED).join(', ')
    const extra = names.length - MAX_LISTED
    return extra > 0 ? `${listed} +${extra} more` : listed
  })

  let syncSummary = $derived.by(() => {
    if (!notice) return ''
    const parts: string[] = []
    if (notice.added.length > 0) parts.push(`${notice.added.length} added`)
    if (notice.updated.length > 0) parts.push(`${notice.updated.length} updated`)
    if (notice.removed.length > 0) parts.push(`${notice.removed.length} removed`)
    return parts.join(' · ')
  })

  /** Sync only applies to the active collection — runIngest targets it. */
  let canSync = $derived(notice !== null && notice.collectionId === activeId)

  async function handleSync() {
    if (syncing) return
    syncing = true
    try {
      await runIngest()
      // The ingest we just ran computed the imported topics' assignments.
      topicsNeedIngest.set(false)
      dismissObsidianImportNotice()
    } catch {
      // Ingest errors surface through the ingest store; keep the notice.
    } finally {
      syncing = false
    }
  }
</script>

{#if notice}
  <div class="obsidian-import-banner" role="status" aria-live="polite">
    <span class="material-symbols-outlined banner-icon">interests</span>
    <span class="banner-text">
      {#if isInitialImport}
        Imported {notice.added.length}
        {notice.added.length === 1 ? 'topic' : 'topics'} from your Obsidian vault:
        <span class="banner-topics">{topicPreview}</span>
      {:else}
        Obsidian topics synced ({syncSummary}){#if topicPreview}:
          <span class="banner-topics">{topicPreview}</span>{/if}
      {/if}
    </span>
    <div class="banner-actions">
      {#if canSync}
        <button class="banner-btn" onclick={handleSync} disabled={syncing}>
          {syncing ? 'Syncing…' : 'Sync now'}
        </button>
      {/if}
      <button
        class="banner-dismiss"
        onclick={dismissObsidianImportNotice}
        aria-label="Dismiss Obsidian topic import notification"
      >
        <span class="material-symbols-outlined">close</span>
      </button>
    </div>
  </div>
{/if}

<style>
  .obsidian-import-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    min-height: 32px;
    font-size: 13px;
    background: color-mix(in srgb, var(--color-primary, #00e5ff) 8%, var(--color-surface, #161617));
    border-bottom: 1px solid color-mix(in srgb, var(--color-primary, #00e5ff) 15%, transparent);
    color: var(--color-text-main, #e4e4e7);
  }

  .banner-icon {
    font-size: 18px;
    flex-shrink: 0;
    color: var(--color-primary, #00e5ff);
  }

  .banner-text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .banner-topics {
    color: var(--color-text-dim, #71717a);
  }

  .banner-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  .banner-btn {
    padding: 3px 10px;
    font-size: 12px;
    font-weight: 500;
    border-radius: 4px;
    border: 1px solid color-mix(in srgb, var(--color-primary, #00e5ff) 40%, transparent);
    background: transparent;
    color: var(--color-primary, #00e5ff);
    cursor: pointer;
    transition: background 150ms ease;
    white-space: nowrap;
  }

  .banner-btn:hover:not(:disabled) {
    background: color-mix(in srgb, var(--color-primary, #00e5ff) 12%, transparent);
  }

  .banner-btn:disabled {
    opacity: 0.6;
    cursor: default;
  }

  .banner-btn:focus-visible {
    outline: 2px solid var(--color-primary, #00e5ff);
    outline-offset: 2px;
  }

  .banner-dismiss {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 2px;
    border: none;
    background: transparent;
    color: var(--color-text-dim, #71717a);
    cursor: pointer;
    border-radius: 4px;
    transition: color 150ms ease;
  }

  .banner-dismiss:hover {
    color: var(--color-text-main, #e4e4e7);
  }

  .banner-dismiss:focus-visible {
    outline: 2px solid var(--color-primary, #00e5ff);
    outline-offset: 2px;
  }

  .banner-dismiss .material-symbols-outlined {
    font-size: 16px;
  }

  @media (prefers-reduced-motion: reduce) {
    .banner-btn,
    .banner-dismiss {
      transition: none;
    }
  }
</style>
