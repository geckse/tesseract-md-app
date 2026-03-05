<script lang="ts">
  import { completeOnboarding } from '../stores/ui'
  import type { CliDetectResult, CliInstallProgress } from '../../preload/api'

  interface Props {
    oncomplete: () => void
  }

  let { oncomplete }: Props = $props()

  let step = $state(0)
  let cliDetecting = $state(false)
  let cliResult: CliDetectResult | null = $state(null)
  let cliError: string | null = $state(null)
  let installing = $state(false)
  let installPercent = $state(0)
  let installStage = $state('')
  let installError: string | null = $state(null)

  const totalSteps = 3

  async function detectCli() {
    cliDetecting = true
    cliError = null
    try {
      cliResult = await window.api.detectCli()
    } catch (e) {
      cliError = e instanceof Error ? e.message : 'Detection failed'
    } finally {
      cliDetecting = false
    }
  }

  async function handleInstallCli() {
    installing = true
    installError = null
    installPercent = 0
    installStage = 'Starting...'

    window.api.onInstallProgress((progress: CliInstallProgress) => {
      if (progress.percent !== undefined) installPercent = progress.percent
      installStage = progress.stage
      if (progress.error) {
        installError = progress.error
        installing = false
      }
    })

    try {
      const result = await window.api.installCli()
      if (result.success) {
        cliResult = { found: true, path: result.path, version: result.version }
      } else {
        installError = result.error ?? 'Installation failed'
      }
    } catch (e) {
      installError = e instanceof Error ? e.message : 'Installation failed'
    } finally {
      installing = false
      window.api.removeInstallProgressListener()
    }
  }

  async function handleAddCollection() {
    const collection = await window.api.addCollection()
    if (collection) {
      await finish()
    }
  }

  async function finish() {
    await completeOnboarding()
    oncomplete()
  }

  // Auto-detect CLI when entering step 1
  $effect(() => {
    if (step === 1 && !cliResult && !cliDetecting) {
      detectCli()
    }
  })
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="onboarding-overlay">
  <div class="onboarding-card">

    {#if step === 0}
      <!-- Step 1: Welcome -->
      <div class="step-content welcome">
        <span class="material-symbols-outlined logo-icon">search_insights</span>
        <h1 class="app-name">Markdown VDB</h1>
        <p class="tagline">Search your notes by meaning</p>
        <button class="primary-btn" onclick={() => { step = 1 }}>Get Started</button>
      </div>

    {:else if step === 1}
      <!-- Step 2: CLI Setup -->
      <div class="step-content">
        <span class="material-symbols-outlined step-icon">terminal</span>
        <h2 class="step-title">CLI Setup</h2>

        {#if cliDetecting}
          <p class="step-desc">Detecting CLI...</p>
          <div class="progress-bar-track">
            <div class="progress-bar-indeterminate"></div>
          </div>

        {:else if cliResult?.found}
          <div class="cli-found">
            <span class="material-symbols-outlined check-icon">check_circle</span>
            <div class="cli-info">
              <span class="cli-path">{cliResult.path}</span>
              {#if cliResult.version}
                <span class="cli-version">v{cliResult.version}</span>
              {/if}
            </div>
          </div>
          <button class="primary-btn" onclick={() => { step = 2 }}>Continue</button>

        {:else if installing}
          <p class="step-desc">{installStage}</p>
          <div class="progress-bar-track">
            <div class="progress-bar-fill" style="width: {installPercent}%"></div>
          </div>
          <span class="progress-percent">{installPercent}%</span>

        {:else if installError}
          <div class="error-box">
            <span class="material-symbols-outlined error-icon">error</span>
            <p>{installError}</p>
          </div>
          <button class="primary-btn" onclick={handleInstallCli}>Retry</button>
          <button class="skip-link" onclick={() => { step = 2 }}>Skip for now</button>

        {:else}
          <p class="step-desc">The CLI tool was not found on your system.</p>
          <button class="primary-btn" onclick={handleInstallCli}>Install CLI</button>
          <button class="skip-link" onclick={() => { step = 2 }}>Skip for now</button>
        {/if}
      </div>

    {:else if step === 2}
      <!-- Step 3: First Collection -->
      <div class="step-content">
        <span class="material-symbols-outlined step-icon">folder_open</span>
        <h2 class="step-title">Add Your First Collection</h2>
        <p class="step-desc">Choose a folder of Markdown files to index and search.</p>
        <button class="primary-btn" onclick={handleAddCollection}>Choose Folder</button>
        <button class="skip-link" onclick={finish}>Skip</button>
      </div>
    {/if}

    <!-- Step indicator dots -->
    <div class="step-dots">
      {#each Array(totalSteps) as _, i}
        <span class="dot" class:active={i === step} class:completed={i < step}></span>
      {/each}
    </div>
  </div>
</div>

<style>
  .onboarding-overlay {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.85);
    backdrop-filter: blur(8px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
  }

  .onboarding-card {
    background: var(--color-surface, #161617);
    border: 1px solid var(--color-border, #27272a);
    border-radius: 12px;
    width: 480px;
    max-width: 90vw;
    padding: 48px 40px 32px;
    display: flex;
    flex-direction: column;
    align-items: center;
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6);
  }

  .step-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    width: 100%;
    gap: 12px;
  }

  .welcome .logo-icon {
    font-size: 64px;
    color: var(--color-accent, #3b82f6);
    margin-bottom: 8px;
  }

  .app-name {
    font-size: 28px;
    font-weight: 700;
    color: var(--color-text, #fafafa);
    margin: 0;
  }

  .tagline {
    font-size: 16px;
    color: var(--color-text-secondary, #a1a1aa);
    margin: 0 0 16px;
  }

  .step-icon {
    font-size: 48px;
    color: var(--color-accent, #3b82f6);
    margin-bottom: 4px;
  }

  .step-title {
    font-size: 22px;
    font-weight: 600;
    color: var(--color-text, #fafafa);
    margin: 0;
  }

  .step-desc {
    font-size: 14px;
    color: var(--color-text-secondary, #a1a1aa);
    margin: 0;
  }

  .primary-btn {
    margin-top: 12px;
    padding: 10px 32px;
    background: var(--color-accent, #3b82f6);
    color: #fff;
    border: none;
    border-radius: 6px;
    font-size: 15px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s;
  }

  .primary-btn:hover {
    background: var(--color-accent-hover, #2563eb);
  }

  .skip-link {
    background: none;
    border: none;
    color: var(--color-text-secondary, #a1a1aa);
    font-size: 13px;
    cursor: pointer;
    padding: 4px 8px;
    margin-top: 4px;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .skip-link:hover {
    color: var(--color-text, #fafafa);
  }

  .cli-found {
    display: flex;
    align-items: center;
    gap: 12px;
    background: rgba(34, 197, 94, 0.1);
    border: 1px solid rgba(34, 197, 94, 0.3);
    border-radius: 8px;
    padding: 12px 16px;
    width: 100%;
  }

  .check-icon {
    font-size: 28px;
    color: #22c55e;
  }

  .cli-info {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
  }

  .cli-path {
    font-size: 13px;
    color: var(--color-text, #fafafa);
    font-family: monospace;
  }

  .cli-version {
    font-size: 12px;
    color: var(--color-text-secondary, #a1a1aa);
  }

  .progress-bar-track {
    width: 100%;
    height: 6px;
    background: var(--color-border, #27272a);
    border-radius: 3px;
    overflow: hidden;
    margin-top: 8px;
  }

  .progress-bar-fill {
    height: 100%;
    background: var(--color-accent, #3b82f6);
    border-radius: 3px;
    transition: width 0.3s ease;
  }

  .progress-bar-indeterminate {
    height: 100%;
    width: 40%;
    background: var(--color-accent, #3b82f6);
    border-radius: 3px;
    animation: indeterminate 1.5s ease-in-out infinite;
  }

  .progress-percent {
    font-size: 13px;
    color: var(--color-text-secondary, #a1a1aa);
    margin-top: 4px;
  }

  .error-box {
    display: flex;
    align-items: center;
    gap: 8px;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 8px;
    padding: 12px 16px;
    width: 100%;
  }

  .error-box .error-icon {
    font-size: 24px;
    color: #ef4444;
    flex-shrink: 0;
  }

  .error-box p {
    font-size: 13px;
    color: #fca5a5;
    margin: 0;
    text-align: left;
  }

  .step-dots {
    display: flex;
    gap: 8px;
    margin-top: 32px;
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--color-border, #27272a);
    transition: background 0.2s;
  }

  .dot.active {
    background: var(--color-accent, #3b82f6);
  }

  .dot.completed {
    background: #22c55e;
  }

  @keyframes indeterminate {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(350%); }
  }
</style>
