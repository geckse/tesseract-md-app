<script lang="ts">
  import { onDestroy } from 'svelte'
  import type {
    CollectionSkillsStatus,
    CollectionSkillsTarget,
    CollectionSkillsTargetId
  } from '../../preload/api'
  import { refreshCollectionSkills } from '../stores/collection-skills'

  interface Props {
    collectionId: string
  }

  let { collectionId }: Props = $props()

  let status = $state<CollectionSkillsStatus | null>(null)
  let loading = $state(true)
  let installing = $state(false)
  let installCompleted = $state(0)
  let installTotal = $state(0)
  let error = $state('')
  let selectedTargetIds = $state<Set<CollectionSkillsTargetId>>(new Set())
  let requestGeneration = 0

  let actionableTargets = $derived(
    status?.targets.filter((target) => target.state === 'missing' || target.state === 'outdated') ??
      []
  )
  let selectedTargets = $derived(
    actionableTargets.filter((target) => selectedTargetIds.has(target.id))
  )
  let allActionableSelected = $derived(
    actionableTargets.length > 0 &&
      actionableTargets.every((target) => selectedTargetIds.has(target.id))
  )
  let installLabel = $derived(
    installing
      ? `Installing ${installCompleted}/${installTotal}…`
      : selectedTargets.length > 1
        ? `Install / update ${selectedTargets.length} targets`
        : selectedTargets[0]?.state === 'outdated'
          ? 'Update selected'
          : 'Install selected'
  )

  function defaultSelection(nextStatus: CollectionSkillsStatus): Set<CollectionSkillsTargetId> {
    const selected = new Set<CollectionSkillsTargetId>()
    for (const target of nextStatus.targets) {
      if (
        target.state === 'outdated' ||
        (target.state === 'missing' && target.agentDirectoryPresent)
      ) {
        selected.add(target.id)
      }
    }

    if (selected.size === 0) {
      const recommended = nextStatus.targets.find(
        (target) =>
          target.id === nextStatus.recommendedTargetId &&
          (target.state === 'missing' || target.state === 'outdated')
      )
      if (recommended) selected.add(recommended.id)
    }
    return selected
  }

  async function loadStatus(targetCollectionId: string): Promise<void> {
    const generation = ++requestGeneration
    installing = false
    installCompleted = 0
    installTotal = 0
    loading = true
    error = ''
    try {
      const nextStatus = await window.api.checkCollectionSkills(targetCollectionId)
      if (generation !== requestGeneration) return
      status = nextStatus
      selectedTargetIds = defaultSelection(nextStatus)
    } catch (loadError) {
      if (generation !== requestGeneration) return
      status = null
      error = loadError instanceof Error ? loadError.message : String(loadError)
    } finally {
      if (generation === requestGeneration) loading = false
    }
  }

  function toggleTarget(targetId: CollectionSkillsTargetId, checked: boolean): void {
    const next = new Set(selectedTargetIds)
    if (checked) next.add(targetId)
    else next.delete(targetId)
    selectedTargetIds = next
  }

  function toggleAllActionable(): void {
    selectedTargetIds = allActionableSelected
      ? new Set()
      : new Set(actionableTargets.map((target) => target.id))
  }

  async function installSelected(): Promise<void> {
    const targets = [...selectedTargets]
    if (targets.length === 0 || installing) return

    const generation = ++requestGeneration
    const targetCollectionId = collectionId
    installing = true
    installCompleted = 0
    installTotal = targets.length
    error = ''
    const failures: string[] = []

    for (const target of targets) {
      try {
        const nextStatus = await window.api.installCollectionSkills(targetCollectionId, target.id)
        if (generation !== requestGeneration) return
        status = nextStatus
      } catch (installError) {
        if (generation !== requestGeneration) return
        const message = installError instanceof Error ? installError.message : String(installError)
        failures.push(`${target.label}: ${message}`)
      } finally {
        if (generation === requestGeneration) installCompleted++
      }
    }

    if (generation !== requestGeneration) return
    const latestStatus = status
    if (latestStatus) {
      selectedTargetIds = new Set(
        targets
          .filter((target) => {
            const latestTarget = latestStatus.targets.find(
              (candidate) => candidate.id === target.id
            )
            return latestTarget?.state !== 'current'
          })
          .map((target) => target.id)
      )
    }
    error = failures.join('\n')
    installing = false

    // Keep the footer reminder in sync with changes made from Settings.
    await refreshCollectionSkills(targetCollectionId)
  }

  function stateLabel(target: CollectionSkillsTarget): string {
    switch (target.state) {
      case 'current':
        return `Up to date · ${target.totalSkillCount} skills`
      case 'outdated':
        return `Update available · ${target.installedSkillCount}/${target.totalSkillCount} skills`
      case 'blocked':
        return 'Blocked by a symlink'
      default:
        return 'Not installed'
    }
  }

  $effect(() => {
    void loadStatus(collectionId)
  })

  onDestroy(() => {
    requestGeneration++
  })
</script>

<div class="skills-settings">
  <div class="section-heading">
    <div>
      <h2>Agent Skills</h2>
      <p>
        Install the bundled Tesseract skills into one or more project-local agent folders. Unrelated
        skills in those folders are left untouched.
      </p>
    </div>
    <button
      class="secondary-btn"
      onclick={() => void loadStatus(collectionId)}
      disabled={loading || installing}
    >
      <span class="material-symbols-outlined">refresh</span>
      Refresh
    </button>
  </div>

  {#if loading && !status}
    <div class="loading-state" role="status">Checking skill installations…</div>
  {:else if status}
    <div class="bundle-summary">
      <span class="material-symbols-outlined">school</span>
      Bundled version {status.bundleVersion} · {status.skillCount}
      {status.skillCount === 1 ? 'skill' : 'skills'}
    </div>

    <div class="target-list" aria-label="Agent skill destinations">
      {#each status.targets as target (target.id)}
        {@const actionable = target.state === 'missing' || target.state === 'outdated'}
        <label class="target-row" class:blocked={target.state === 'blocked'}>
          <input
            type="checkbox"
            aria-label={`${target.label} skill destination`}
            checked={selectedTargetIds.has(target.id)}
            disabled={!actionable || installing}
            onchange={(event) =>
              toggleTarget(target.id, (event.currentTarget as HTMLInputElement).checked)}
          />
          <span class="target-icon material-symbols-outlined">
            {target.state === 'current'
              ? 'check_circle'
              : target.state === 'blocked'
                ? 'block'
                : 'folder_copy'}
          </span>
          <span class="target-details">
            <span class="target-name">{target.label}</span>
            <code>{target.relativePath}</code>
          </span>
          <span
            class="target-state"
            class:current={target.state === 'current'}
            class:outdated={target.state === 'outdated'}
          >
            {stateLabel(target)}
          </span>
        </label>
      {/each}
    </div>

    <div class="skills-actions">
      <button
        class="secondary-btn"
        onclick={toggleAllActionable}
        disabled={actionableTargets.length === 0 || installing}
      >
        {allActionableSelected ? 'Clear selection' : 'Select all available'}
      </button>
      <button
        class="primary-btn"
        onclick={() => void installSelected()}
        disabled={selectedTargets.length === 0 || installing}
      >
        <span class="material-symbols-outlined">download</span>
        {installLabel}
      </button>
    </div>

    {#if actionableTargets.length === 0 && status.targets.some((target) => target.state === 'current')}
      <p class="success-message" role="status">Every available installation is up to date.</p>
    {/if}
  {/if}

  {#if error}
    <div class="error-message" role="alert">
      <span class="material-symbols-outlined">error</span>
      <span>{error}</span>
    </div>
  {/if}
</div>

<style>
  .skills-settings {
    max-width: 680px;
  }

  .section-heading {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 16px;
  }

  h2 {
    margin: 0 0 6px;
    font-size: var(--text-base, 14px);
    font-weight: var(--weight-bold, 700);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  p {
    margin: 0;
    color: var(--color-text-dim, #71717a);
    font-size: var(--text-xs, 10px);
    line-height: 1.5;
  }

  .bundle-summary,
  .loading-state {
    display: flex;
    align-items: center;
    gap: 7px;
    margin-bottom: 12px;
    color: var(--color-text-dim, #71717a);
    font-size: var(--text-sm, 12px);
  }

  .bundle-summary .material-symbols-outlined {
    color: var(--color-primary, #00e5ff);
    font-size: 18px;
  }

  .target-list {
    display: grid;
    gap: 8px;
  }

  .target-row {
    display: grid;
    grid-template-columns: auto auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 10px;
    min-height: 54px;
    padding: 9px 12px;
    border: 1px solid var(--color-border, #27272a);
    border-radius: var(--radius-md, 6px);
    background: var(--color-surface, #161617);
    cursor: pointer;
  }

  .target-row:has(input:checked) {
    border-color: color-mix(in srgb, var(--color-primary, #00e5ff) 48%, transparent);
  }

  .target-row.blocked,
  .target-row:has(input:disabled) {
    cursor: default;
  }

  .target-row input {
    accent-color: var(--color-primary, #00e5ff);
  }

  .target-icon {
    color: var(--color-text-dim, #71717a);
    font-size: 19px;
  }

  .target-details {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 3px;
  }

  .target-name {
    color: var(--color-text, #e4e4e7);
    font-size: var(--text-sm, 12px);
    font-weight: var(--weight-bold, 700);
  }

  code {
    overflow: hidden;
    color: var(--color-text-dim, #71717a);
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: var(--text-xs, 10px);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .target-state {
    color: var(--color-text-dim, #71717a);
    font-size: var(--text-xs, 10px);
    white-space: nowrap;
  }

  .target-state.current {
    color: #22c55e;
  }

  .target-state.outdated {
    color: #f59e0b;
  }

  .skills-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 14px;
  }

  .secondary-btn,
  .primary-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 30px;
    padding: 5px 11px;
    border-radius: var(--radius-sm, 2px);
    font-family: inherit;
    font-size: var(--text-xs, 10px);
    font-weight: var(--weight-bold, 700);
    cursor: pointer;
  }

  .secondary-btn {
    border: 1px solid var(--color-border, #27272a);
    background: transparent;
    color: var(--color-text, #e4e4e7);
  }

  .primary-btn {
    border: 1px solid color-mix(in srgb, var(--color-primary, #00e5ff) 55%, transparent);
    background: color-mix(in srgb, var(--color-primary, #00e5ff) 12%, transparent);
    color: var(--color-primary, #00e5ff);
  }

  .secondary-btn:hover:not(:disabled),
  .primary-btn:hover:not(:disabled) {
    background: var(--overlay-hover, rgba(255, 255, 255, 0.08));
  }

  .secondary-btn:disabled,
  .primary-btn:disabled {
    cursor: default;
    opacity: 0.5;
  }

  .secondary-btn:focus-visible,
  .primary-btn:focus-visible,
  .target-row input:focus-visible {
    outline: 2px solid var(--color-primary, #00e5ff);
    outline-offset: 2px;
  }

  .secondary-btn .material-symbols-outlined,
  .primary-btn .material-symbols-outlined {
    font-size: 15px;
  }

  .success-message {
    margin-top: 12px;
    color: #22c55e;
  }

  .error-message {
    display: flex;
    align-items: flex-start;
    gap: 7px;
    margin-top: 12px;
    padding: 9px 11px;
    border: 1px solid color-mix(in srgb, var(--color-error, #e53935) 35%, transparent);
    border-radius: var(--radius-sm, 2px);
    background: color-mix(in srgb, var(--color-error, #e53935) 8%, transparent);
    color: var(--color-error, #e53935);
    font-size: var(--text-xs, 10px);
    white-space: pre-line;
  }

  .error-message .material-symbols-outlined {
    font-size: 16px;
  }

  @media (max-width: 760px) {
    .target-row {
      grid-template-columns: auto auto minmax(0, 1fr);
    }

    .target-state {
      grid-column: 3;
    }

    .section-heading {
      flex-direction: column;
    }
  }
</style>
