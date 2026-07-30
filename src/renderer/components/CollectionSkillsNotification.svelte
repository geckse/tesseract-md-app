<script lang="ts">
  import type { CollectionSkillsTargetId } from '../../preload/api'
  import {
    collectionSkillsNotice,
    dismissCollectionSkillsForSession,
    dismissCollectionSkillsForever,
    installCollectionSkillsForAgent,
    refreshCollectionSkills
  } from '../stores/collection-skills'

  let selectedTargetId = $state<CollectionSkillsTargetId>('agents')
  let selectionKey = $state('')

  $effect(() => {
    const notice = $collectionSkillsNotice
    const status = notice?.status
    if (!notice || !status) return
    const nextKey = `${notice.collectionId}:${status.bundleFingerprint}:${status.recommendedTargetId}`
    if (selectionKey === nextKey) return
    selectionKey = nextKey
    selectedTargetId = status.recommendedTargetId
  })

  function handleInstall(collectionId: string): void {
    void installCollectionSkillsForAgent(collectionId, selectedTargetId)
  }

  function handleRetry(collectionId: string): void {
    void refreshCollectionSkills(collectionId)
  }
</script>

{#if $collectionSkillsNotice}
  {@const notice = $collectionSkillsNotice}
  {@const status = notice.status}
  {@const targets = status?.targets.filter((target) => target.state !== 'blocked') ?? []}
  <div
    class="skills-banner"
    class:error={notice.phase === 'error'}
    role="status"
    aria-live="polite"
  >
    <span class="material-symbols-outlined banner-icon">
      {notice.phase === 'error' ? 'error' : 'school'}
    </span>
    <span class="banner-text">
      {#if notice.phase === 'error'}
        Tesseract skills check failed: {notice.error ?? 'Unknown error'}
      {:else if status?.state === 'outdated'}
        Updated Tesseract skills are available for this collection.
      {:else}
        Add Tesseract skills so AI agents understand this collection.
      {/if}
    </span>

    <div class="banner-actions">
      {#if status && targets.length > 0}
        <select
          aria-label="Install Tesseract skills for"
          bind:value={selectedTargetId}
          disabled={notice.phase === 'installing'}
        >
          {#each targets as target (target.id)}
            <option value={target.id}>{target.label} · {target.relativePath}</option>
          {/each}
        </select>
        <button
          class="banner-btn banner-btn-primary"
          onclick={() => handleInstall(notice.collectionId)}
          disabled={notice.phase === 'installing'}
        >
          {notice.phase === 'installing'
            ? 'Installing…'
            : status.state === 'outdated'
              ? 'Update skills'
              : 'Install skills'}
        </button>
      {:else if notice.phase === 'error'}
        <button
          class="banner-btn banner-btn-primary"
          onclick={() => handleRetry(notice.collectionId)}
        >
          Check again
        </button>
      {/if}

      <button
        class="banner-btn"
        onclick={() => dismissCollectionSkillsForSession(notice.collectionId)}
      >
        Not now
      </button>
      <button
        class="banner-btn"
        onclick={() => void dismissCollectionSkillsForever(notice.collectionId)}
      >
        Never for this collection
      </button>
    </div>
  </div>
{/if}

<style>
  .skills-banner {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 34px;
    padding: 6px 12px;
    border-top: 1px solid color-mix(in srgb, var(--color-primary, #00e5ff) 22%, transparent);
    background: color-mix(
      in srgb,
      var(--color-primary, #00e5ff) 10%,
      var(--color-surface, #161617)
    );
    color: var(--color-text, #e4e4e7);
    font-size: 13px;
  }

  .skills-banner.error {
    border-top-color: color-mix(in srgb, var(--color-error, #e53935) 35%, transparent);
    background: color-mix(in srgb, var(--color-error, #e53935) 10%, var(--color-surface, #161617));
  }

  .banner-icon {
    flex-shrink: 0;
    color: var(--color-primary, #00e5ff);
    font-size: 18px;
  }

  .skills-banner.error .banner-icon {
    color: var(--color-error, #e53935);
  }

  .banner-text {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .banner-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }

  select,
  .banner-btn {
    min-height: 25px;
    border: 1px solid var(--color-border, #27272a);
    border-radius: 4px;
    background: transparent;
    color: inherit;
    font: inherit;
    font-size: 12px;
  }

  select {
    max-width: 250px;
    padding: 2px 7px;
    background: var(--color-surface, #161617);
  }

  .banner-btn {
    padding: 3px 9px;
    cursor: pointer;
    white-space: nowrap;
  }

  .banner-btn:hover:not(:disabled) {
    background: var(--overlay-hover, rgba(255, 255, 255, 0.08));
  }

  .banner-btn-primary {
    border-color: color-mix(in srgb, var(--color-primary, #00e5ff) 45%, transparent);
    color: var(--color-primary, #00e5ff);
    font-weight: 600;
  }

  :global(html[data-theme='light']) .banner-btn-primary {
    color: var(--color-primary-dark, #007d8b);
  }

  .banner-btn:disabled,
  select:disabled {
    cursor: default;
    opacity: 0.6;
  }

  .banner-btn:focus-visible,
  select:focus-visible {
    outline: 2px solid var(--color-primary, #00e5ff);
    outline-offset: 2px;
  }

  @media (max-width: 900px) {
    select {
      max-width: 150px;
    }

    .banner-text {
      display: none;
    }
  }
</style>
