<script lang="ts">
  import { onMount } from 'svelte'
  import {
    isDirty,
    wordCount as wordCountStore,
    tokenCount as tokenCountStore
  } from '../stores/editor'
  import { workspace, type AssetTab } from '../stores/workspace.svelte'
  import WatcherToggle from './WatcherToggle.svelte'
  import { terminalStore } from '../stores/terminal.svelte'
  import { collectionDoctorResult, openDoctorModal } from '../stores/collections'
  import type { DoctorResult } from '../types/cli'
  import mdvdbIcon from '../../../resources/mdvdb.png'
  import type { MimeCategory } from '../types/cli'
  import { cliFeatures } from '../lib/cli-features.svelte'

  interface StatusBarProps {
    language?: string
    syncStatus?: 'synced' | 'syncing' | 'error'
    encoding?: string
  }

  let {
    language = 'Markdown',
    syncStatus: _syncStatus = 'synced',
    encoding: _encoding = 'UTF-8'
  }: StatusBarProps = $props()

  let currentIsDirty = $state(false)
  isDirty.subscribe((v) => (currentIsDirty = v))

  let doctorResult = $state<DoctorResult | null>(null)
  collectionDoctorResult.subscribe((v) => (doctorResult = v))
  const hasDoctorFailures = $derived(doctorResult?.checks.some((c) => c.status === 'Fail') ?? false)

  let currentWordCount = $state(0)
  wordCountStore.subscribe((v) => (currentWordCount = v))

  let currentTokenCount = $state(0)
  tokenCountStore.subscribe((v) => (currentTokenCount = v))

  let cliVersion: string | null = $state(null)
  let cliFound = $state(false)
  let cliInstalling = $state(false)
  const cliOutdated = $derived(cliFound && cliFeatures.isOutdated)

  // Active tab awareness for asset vs document display
  const activeTab = $derived(workspace.focusedTab)
  const isAssetTab = $derived(activeTab?.kind === 'asset')
  const assetTab = $derived(
    isAssetTab && activeTab?.kind === 'asset' ? (activeTab as AssetTab) : null
  )

  function mimeIcon(cat?: MimeCategory): string {
    switch (cat) {
      case 'image':
        return 'image'
      case 'pdf':
        return 'picture_as_pdf'
      case 'video':
        return 'videocam'
      case 'audio':
        return 'audiotrack'
      default:
        return 'attach_file'
    }
  }

  function mimeLabel(cat?: MimeCategory): string {
    switch (cat) {
      case 'image':
        return 'Image'
      case 'pdf':
        return 'PDF'
      case 'video':
        return 'Video'
      case 'audio':
        return 'Audio'
      default:
        return 'File'
    }
  }

  function formatSize(bytes?: number): string {
    if (bytes == null) return ''
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  onMount(async () => {
    try {
      const path = await window.api.findCli()
      if (path) {
        cliFound = true
        cliVersion = await window.api.getCliVersion()
        cliFeatures.version = cliVersion
      }
    } catch {
      cliFound = false
      cliVersion = null
    }
  })

  async function installCli() {
    if (cliInstalling) return
    cliInstalling = true
    try {
      const result = await window.api.installCli()
      if (result.success) {
        cliFound = true
        cliVersion = result.version ?? (await window.api.getCliVersion())
        cliFeatures.version = cliVersion
      }
    } catch {
      // Keep the current missing/outdated state so the user can retry.
    } finally {
      cliInstalling = false
    }
  }
</script>

<div class="status-bar">
  <!-- Screen reader announcements for status changes -->
  <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">
    {#if cliOutdated}
      mdvdb CLI version {cliVersion || 'unknown'} is outdated and must be updated
    {:else if cliFound}
      mdvdb CLI found, version {cliVersion || 'unknown'}
    {:else}
      mdvdb CLI not found
    {/if}
  </div>

  <div class="status-group">
    {#if isAssetTab && assetTab}
      <span class="status-item">
        <span class="material-symbols-outlined status-icon">{mimeIcon(assetTab.mimeCategory)}</span>
        {mimeLabel(assetTab.mimeCategory)}
      </span>
      {#if assetTab.fileSize}
        <span class="status-item">{formatSize(assetTab.fileSize)}</span>
      {/if}
    {:else}
      <span class="status-item interactive">
        <span class="material-symbols-outlined status-icon">markdown</span>
        {language}
        {#if currentIsDirty}
          <span class="dirty-dot"></span>
        {/if}
      </span>
      <span class="status-item interactive">{currentWordCount} words</span>
      <span class="status-item interactive">{currentTokenCount.toLocaleString()} tokens</span>
    {/if}
  </div>

  <div class="status-group">
    <button
      type="button"
      class="status-item interactive terminal-toggle"
      class:active={workspace.bottomPaneOpen}
      title={workspace.bottomPaneOpen ? 'Hide bottom panel' : 'Show bottom panel'}
      aria-label="Toggle bottom panel"
      aria-pressed={workspace.bottomPaneOpen}
      onclick={() => void terminalStore.toggleBottomPanel()}
    >
      <span class="material-symbols-outlined status-icon">terminal</span>
      {#if terminalStore.terminalCount > 0}
        <span class="terminal-count">{terminalStore.terminalCount}</span>
      {/if}
    </button>
    <WatcherToggle />
    {#if hasDoctorFailures}
      <button
        type="button"
        class="status-item interactive doctor-warning"
        title="Doctor found issues — click for details"
        aria-label="Doctor found issues"
        onclick={openDoctorModal}
      >
        <span class="material-symbols-outlined status-icon">warning</span>
      </button>
    {/if}
    <button
      type="button"
      class="status-item cli-indicator"
      class:cli-found={cliFound && !cliOutdated}
      class:cli-outdated={cliOutdated}
      class:cli-missing={!cliFound}
      disabled={cliInstalling || (cliFound && !cliOutdated)}
      title={cliOutdated
        ? 'Update mdvdb CLI'
        : cliFound
          ? 'mdvdb CLI is ready'
          : 'Install mdvdb CLI'}
      onclick={() => void installCli()}
    >
      <span
        class="cli-dot"
        class:cli-dot-found={cliFound && !cliOutdated}
        class:cli-dot-outdated={cliOutdated}
        class:cli-dot-missing={!cliFound}
      ></span>
      {#if cliInstalling}
        Installing CLI…
      {:else if cliOutdated}
        mdvdb {cliVersion ? `v${cliVersion}` : ''} — update required
      {:else if cliFound}
        mdvdb {cliVersion ? `v${cliVersion}` : ''}
      {:else}
        CLI not found
      {/if}
    </button>
    <img class="status-logo" src={mdvdbIcon} alt="Tesseract" />
  </div>
</div>

<style>
  .status-bar {
    height: 35px;
    min-height: 35px;
    background: var(--color-surface-darker, #0a0a0a);
    border-top: 1px solid var(--color-border, #27272a);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 20px 8px 16px;
    font-family: var(--font-mono);
    font-size: 11px;
    line-height: 35px;
    color: var(--color-text-dim, #71717a);
    user-select: none;
    letter-spacing: -0.025em;
    z-index: 30;
  }

  .status-group {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .status-item {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .status-item.interactive {
    cursor: pointer;
    transition: color 0.15s;
  }

  .status-item.interactive:hover {
    color: var(--color-text-white, #fff);
  }

  .status-icon {
    font-size: 12px;
  }

  .dirty-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #f59e0b;
  }

  .cli-indicator {
    display: flex;
    align-items: center;
    gap: 6px;
    border: 0;
    background: transparent;
    font: inherit;
    padding: 0;
  }

  .cli-indicator:not(:disabled) {
    cursor: pointer;
  }

  .cli-found {
    color: #10b981;
  }

  .cli-missing {
    color: #ef4444;
  }

  .cli-outdated {
    color: #f59e0b;
  }

  .cli-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .cli-dot-found {
    background: #10b981;
  }

  .cli-dot-missing {
    background: #ef4444;
  }

  .cli-dot-outdated {
    background: #f59e0b;
  }

  .terminal-toggle {
    background: transparent;
    border: none;
    color: inherit;
    font: inherit;
    padding: 0 6px;
    height: 22px;
    border-radius: 4px;
  }

  .doctor-warning {
    background: transparent;
    border: none;
    font: inherit;
    padding: 0 6px;
    height: 22px;
    border-radius: 4px;
    color: var(--color-warning, #f59e0b);
  }

  .terminal-toggle.active {
    color: var(--color-primary, #60a5fa);
    background: var(--overlay-active, rgba(255, 255, 255, 0.08));
  }

  .terminal-count {
    font-size: 10px;
    padding: 0 4px;
    border-radius: 8px;
    background: var(--overlay-active, rgba(255, 255, 255, 0.1));
    line-height: 14px;
    min-width: 14px;
    text-align: center;
  }

  .status-logo {
    height: 14px;
    width: auto;
    object-fit: contain;
    filter: grayscale(100%);
    opacity: 0.5;
  }

  /* Screen reader only - visually hidden but available to assistive tech */
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border-width: 0;
  }
</style>
