<script lang="ts">
  import { completeOnboarding } from '../stores/ui'
  import type { CliDetectResult, CliInstallProgress } from '../../preload/api'
  import type { Collection } from '../../preload/api'
  import { openSettingsSection } from '../stores/settings'

  interface Props {
    oncomplete: () => void
  }

  let { oncomplete }: Props = $props()

  let step = $state(0)
  let cliDetecting = $state(false)
  let cliResult: CliDetectResult | null = $state(null)
  let installing = $state(false)
  let installPercent = $state(0)
  let installStage = $state('')
  let installError: string | null = $state(null)
  let provider: 'openai' | 'ollama' | null = $state(null)
  let openAiKey = $state('')
  let ollamaHost = $state('http://localhost:11434')
  let ollamaModel = $state('nomic-embed-text')
  let providerError: string | null = $state(null)
  let doctorWarning: string | null = $state(null)

  const totalSteps = 4

  async function detectCli() {
    cliDetecting = true
    try {
      cliResult = await window.api.detectCli()
    } catch {
      // Detection failure leaves cliResult null; the UI offers install instead
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
      await finishWithDoctor(collection)
    }
  }

  async function saveProviderAndContinue() {
    if (!provider) return
    providerError = null
    try {
      await window.api.setUserConfig('MDVDB_EMBEDDING_PROVIDER', provider)
      if (provider === 'openai') {
        await window.api.setUserConfig('OPENAI_API_KEY', openAiKey.trim())
      } else {
        await window.api.setUserConfig('MDVDB_EMBEDDING_MODEL', ollamaModel.trim())
        await window.api.setUserConfig('OLLAMA_HOST', ollamaHost.trim())
      }
      step = 3
    } catch (error) {
      providerError = error instanceof Error ? error.message : 'Could not save provider settings'
    }
  }

  async function finishWithDoctor(collection: Collection) {
    doctorWarning = null
    try {
      const result = await window.api.doctor(collection.path)
      const failures = result.checks.filter(
        (check) =>
          check.status === 'Fail' &&
          (check.name === 'API key' || check.name === 'Provider reachable')
      )
      if (failures.length > 0) {
        doctorWarning = failures.map((check) => check.detail).join(' ')
        return
      }
    } catch {
      // Doctor is advisory during onboarding; CLI errors must not trap the user here.
    }
    await finish()
  }

  async function openEmbeddingSettings() {
    await completeOnboarding()
    openSettingsSection('global', 'embedding')
    oncomplete()
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

<div class="onboarding-overlay">
  <div class="onboarding-card">
    {#if step === 0}
      <!-- Step 1: Welcome -->
      <div class="step-content welcome">
        <span class="material-symbols-outlined logo-icon">search_insights</span>
        <h1 class="app-name">Tesseract</h1>
        <p class="tagline">Search your notes by meaning</p>
        <button
          class="primary-btn"
          onclick={() => {
            step = 1
          }}>Get Started</button
        >
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
          <button
            class="primary-btn"
            onclick={() => {
              step = 2
            }}>Continue</button
          >
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
          <button
            class="skip-link"
            onclick={() => {
              step = 2
            }}>Skip for now</button
          >
        {:else}
          <p class="step-desc">The CLI tool was not found on your system.</p>
          <button class="primary-btn" onclick={handleInstallCli}>Install CLI</button>
          <button
            class="skip-link"
            onclick={() => {
              step = 2
            }}>Skip for now</button
          >
        {/if}
      </div>
    {:else if step === 2}
      <!-- Step 3: Embedding Provider -->
      <div class="step-content">
        <span class="material-symbols-outlined step-icon">hub</span>
        <h2 class="step-title">Choose an Embedding Provider</h2>
        <p class="step-desc">Embeddings power semantic search. Settings are saved globally.</p>

        <div class="provider-cards">
          <button
            type="button"
            class="provider-card"
            class:selected={provider === 'openai'}
            onclick={() => (provider = 'openai')}
          >
            <strong>OpenAI</strong>
            <span>Cloud embeddings using your API key</span>
          </button>
          <button
            type="button"
            class="provider-card"
            class:selected={provider === 'ollama'}
            onclick={() => (provider = 'ollama')}
          >
            <strong>Ollama</strong>
            <span>Local embeddings with a running Ollama server</span>
          </button>
          <button type="button" class="provider-card" onclick={() => (step = 3)}>
            <strong>Skip for now</strong>
            <span>Semantic search and indexing will not work until a provider is configured.</span>
          </button>
        </div>

        {#if provider === 'openai'}
          <label class="provider-field">
            <span>OpenAI API key</span>
            <input type="password" bind:value={openAiKey} placeholder="sk-..." autocomplete="off" />
          </label>
        {:else if provider === 'ollama'}
          <label class="provider-field">
            <span>Ollama host</span>
            <input type="url" bind:value={ollamaHost} />
          </label>
          <label class="provider-field">
            <span>Embedding model</span>
            <input type="text" bind:value={ollamaModel} />
          </label>
        {/if}

        {#if providerError}
          <div class="error-box" role="alert">
            <span class="material-symbols-outlined error-icon">error</span>
            <p>{providerError}</p>
          </div>
        {/if}

        {#if provider}
          <button class="primary-btn" onclick={saveProviderAndContinue}>Continue</button>
        {/if}
      </div>
    {:else if step === 3}
      <!-- Step 4: First Collection -->
      <div class="step-content">
        <span class="material-symbols-outlined step-icon">folder_open</span>
        <h2 class="step-title">Add Your First Collection</h2>
        <p class="step-desc">Choose a folder of Markdown files to index and search.</p>
        {#if !doctorWarning}
          <button class="primary-btn" onclick={handleAddCollection}>Choose Folder</button>
          <button class="skip-link" onclick={finish}>Skip</button>
        {:else}
          <div class="doctor-warning" role="alert">
            <span class="material-symbols-outlined">warning</span>
            <div>
              <strong>Embedding setup needs attention</strong>
              <p>{doctorWarning}</p>
            </div>
          </div>
          <button class="primary-btn" onclick={openEmbeddingSettings}
            >Open Embedding Settings</button
          >
          <button class="skip-link" onclick={finish}>Continue anyway</button>
        {/if}
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
    color: var(--color-primary, #00e5ff);
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
    color: var(--color-text-muted, #a1a1aa);
    margin: 0 0 16px;
  }

  .step-icon {
    font-size: 48px;
    color: var(--color-primary, #00e5ff);
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
    color: var(--color-text-muted, #a1a1aa);
    margin: 0;
  }

  .provider-cards {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
    width: 100%;
    margin-top: 8px;
  }

  .provider-card {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-height: 108px;
    padding: 12px;
    border: 1px solid var(--color-border, #27272a);
    border-radius: 8px;
    background: var(--color-surface-dark, #0a0a0a);
    color: var(--color-text, #fafafa);
    text-align: left;
    cursor: pointer;
  }

  .provider-card.selected {
    border-color: var(--color-primary, #00e5ff);
    box-shadow: 0 0 0 1px var(--color-primary, #00e5ff);
  }

  .provider-card span {
    color: var(--color-text-muted, #a1a1aa);
    font-size: 11px;
    line-height: 1.35;
  }

  .provider-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 100%;
    color: var(--color-text-muted, #a1a1aa);
    font-size: 12px;
    text-align: left;
  }

  .provider-field input {
    padding: 9px 10px;
    border: 1px solid var(--color-border, #27272a);
    border-radius: 6px;
    background: var(--color-surface-dark, #0a0a0a);
    color: var(--color-text, #fafafa);
    font: inherit;
  }

  .doctor-warning {
    display: flex;
    gap: 10px;
    width: 100%;
    box-sizing: border-box;
    margin-top: 8px;
    padding: 12px;
    border: 1px solid rgba(245, 158, 11, 0.4);
    border-radius: 8px;
    background: rgba(245, 158, 11, 0.1);
    color: #f59e0b;
    text-align: left;
  }

  .doctor-warning p {
    margin: 4px 0 0;
    color: var(--color-text-muted, #a1a1aa);
    font-size: 12px;
  }

  .primary-btn {
    margin-top: 12px;
    padding: 10px 32px;
    background: var(--color-primary, #00e5ff);
    color: var(--color-surface-dark, #0a0a0a);
    border: none;
    border-radius: 6px;
    font-size: 15px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s;
  }

  .primary-btn:hover {
    background: var(--color-primary-dark, #00b8cc);
  }

  .skip-link {
    background: none;
    border: none;
    color: var(--color-text-muted, #a1a1aa);
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
    color: var(--color-text-muted, #a1a1aa);
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
    background: var(--color-primary, #00e5ff);
    border-radius: 3px;
    transition: width 0.3s ease;
  }

  .progress-bar-indeterminate {
    height: 100%;
    width: 40%;
    background: var(--color-primary, #00e5ff);
    border-radius: 3px;
    animation: indeterminate 1.5s ease-in-out infinite;
  }

  .progress-percent {
    font-size: 13px;
    color: var(--color-text-muted, #a1a1aa);
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
    background: var(--color-primary, #00e5ff);
  }

  .dot.completed {
    background: #22c55e;
  }

  @keyframes indeterminate {
    0% {
      transform: translateX(-100%);
    }
    100% {
      transform: translateX(350%);
    }
  }
</style>
