<script lang="ts">
  import { tick } from 'svelte'
  import { completeOnboarding } from '../stores/ui'
  import type { CliDetectResult, CliInstallProgress, Collection } from '../../preload/api'
  import { openSettingsSection } from '../stores/settings'
  import {
    addAndActivateCollection,
    createAndActivateExampleCollection
  } from '../stores/collections'
  import { loadAssetTree, loadFileTree } from '../stores/files'

  interface Props {
    oncomplete?: () => void
  }

  let { oncomplete = () => {} }: Props = $props()

  const steps = [
    { label: 'Welcome', detail: 'Meet your workspace', icon: 'auto_awesome' },
    { label: 'CLI', detail: 'Connect the engine', icon: 'terminal' },
    { label: 'Embeddings', detail: 'Choose intelligence', icon: 'hub' },
    { label: 'Collection', detail: 'Open your knowledge', icon: 'folder_open' }
  ] as const

  let step = $state(0)
  let dialogEl: HTMLDivElement | undefined = $state(undefined)
  let headingEl: HTMLHeadingElement | undefined = $state(undefined)

  let cliDetecting = $state(false)
  let cliDetectionAttempted = $state(false)
  let cliDetectionError: string | null = $state(null)
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
  let savingProvider = $state(false)

  let choosingCollection = $state(false)
  let creatingExample = $state(false)
  let collectionError: string | null = $state(null)
  let doctorWarning: string | null = $state(null)
  let finishing = $state(false)

  function goToStep(nextStep: number): void {
    step = Math.max(0, Math.min(steps.length - 1, nextStep))
  }

  async function detectCli(): Promise<void> {
    cliDetectionAttempted = true
    cliDetecting = true
    cliDetectionError = null
    try {
      cliResult = await window.api.detectCli()
    } catch (error) {
      cliResult = { found: false }
      cliDetectionError =
        error instanceof Error ? error.message : 'Tesseract could not check for the CLI.'
    } finally {
      cliDetecting = false
    }
  }

  async function handleInstallCli(): Promise<void> {
    installing = true
    installError = null
    installPercent = 0
    installStage = 'Preparing installation…'

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
    } catch (error) {
      installError = error instanceof Error ? error.message : 'Installation failed'
    } finally {
      installing = false
      window.api.removeInstallProgressListener()
    }
  }

  async function handleAddCollection(): Promise<void> {
    choosingCollection = true
    collectionError = null
    try {
      const collection = await addAndActivateCollection()
      if (collection) {
        await Promise.allSettled([loadFileTree(), loadAssetTree()])
        await finishWithDoctor(collection)
      }
    } catch (error) {
      collectionError =
        error instanceof Error ? error.message : 'Tesseract could not open that folder.'
    } finally {
      choosingCollection = false
    }
  }

  async function handleCreateExampleCollection(): Promise<void> {
    creatingExample = true
    collectionError = null
    try {
      await createAndActivateExampleCollection()
      await Promise.allSettled([loadFileTree(), loadAssetTree()])
      await finish()
    } catch (error) {
      collectionError =
        error instanceof Error
          ? error.message
          : 'Tesseract could not create the example collection.'
    } finally {
      creatingExample = false
    }
  }

  async function saveProviderAndContinue(): Promise<void> {
    if (!provider || savingProvider) return

    const apiKey = openAiKey.trim()
    const host = ollamaHost.trim()
    const model = ollamaModel.trim()
    if (provider === 'openai' && !apiKey) {
      providerError = 'Enter an OpenAI API key, or choose Skip for now.'
      return
    }
    if (provider === 'ollama' && (!host || !model)) {
      providerError = 'Both an Ollama host and embedding model are required.'
      return
    }

    providerError = null
    savingProvider = true
    try {
      await window.api.setUserConfig('MDVDB_EMBEDDING_PROVIDER', provider)
      if (provider === 'openai') {
        await window.api.setUserConfig('OPENAI_API_KEY', apiKey)
      } else {
        await window.api.setUserConfig('MDVDB_EMBEDDING_MODEL', model)
        await window.api.setUserConfig('OLLAMA_HOST', host)
      }
      goToStep(3)
    } catch (error) {
      providerError = error instanceof Error ? error.message : 'Could not save provider settings'
    } finally {
      savingProvider = false
    }
  }

  async function finishWithDoctor(collection: Collection): Promise<void> {
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

  async function openEmbeddingSettings(): Promise<void> {
    if (finishing) return
    finishing = true
    collectionError = null
    try {
      await completeOnboarding()
      openSettingsSection('global', 'embedding')
      oncomplete()
    } catch (error) {
      collectionError =
        error instanceof Error ? error.message : 'Could not finish onboarding. Please try again.'
      finishing = false
    }
  }

  async function finish(): Promise<void> {
    if (finishing) return
    finishing = true
    collectionError = null
    try {
      await completeOnboarding()
      oncomplete()
    } catch (error) {
      collectionError =
        error instanceof Error ? error.message : 'Could not finish onboarding. Please try again.'
      finishing = false
    }
  }

  function trapFocus(event: KeyboardEvent): void {
    if (event.key !== 'Tab' || !dialogEl) return
    const focusable = Array.from(
      dialogEl.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      )
    ).filter((element) => element.offsetParent !== null)
    if (focusable.length === 0) return

    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  $effect(() => {
    if (step === 1 && !cliDetectionAttempted && !cliDetecting) void detectCli()
  })

  $effect(() => {
    const currentStep = step
    void tick().then(() => {
      if (step === currentStep) headingEl?.focus()
    })
  })
</script>

<div class="onboarding-overlay">
  <div
    class="onboarding-card"
    role="dialog"
    aria-modal="true"
    aria-labelledby="onboarding-heading"
    aria-describedby="onboarding-description"
    tabindex="-1"
    bind:this={dialogEl}
    onkeydown={trapFocus}
  >
    <aside class="onboarding-rail" aria-label="Onboarding progress">
      <div class="brand-lockup">
        <span class="brand-mark" aria-hidden="true">
          <span class="brand-core"></span>
        </span>
        <div>
          <strong>Tesseract</strong>
          <span>Knowledge, in focus.</span>
        </div>
      </div>

      <ol class="step-nav">
        {#each steps as item, index}
          <li
            class:current={index === step}
            class:complete={index < step}
            aria-current={index === step ? 'step' : undefined}
          >
            <span class="step-marker" aria-hidden="true">
              {#if index < step}
                <span class="material-symbols-outlined">check</span>
              {:else}
                {index + 1}
              {/if}
            </span>
            <span class="step-copy">
              <strong>{item.label}</strong>
              <span>{item.detail}</span>
            </span>
          </li>
        {/each}
      </ol>

      <div class="privacy-note">
        <span class="material-symbols-outlined" aria-hidden="true">shield_lock</span>
        <div>
          <strong>Your files stay yours</strong>
          <span>Tesseract works directly with the Markdown on your machine.</span>
        </div>
      </div>
    </aside>

    <main class="onboarding-main">
      <div class="step-kicker">
        <span>Step {step + 1} of {steps.length}</span>
        <span class="kicker-line" aria-hidden="true"></span>
        <span>{steps[step].label}</span>
      </div>

      {#if step === 0}
        <section class="step-content welcome-step">
          <div class="knowledge-orbit" aria-hidden="true">
            <span class="orbit orbit-one"></span>
            <span class="orbit orbit-two"></span>
            <span class="knowledge-node node-one"></span>
            <span class="knowledge-node node-two"></span>
            <span class="knowledge-node node-three"></span>
            <span class="knowledge-node node-four"></span>
            <span class="orbit-center">
              <span class="material-symbols-outlined">search_insights</span>
            </span>
          </div>

          <div class="welcome-copy">
            <p class="eyebrow">A new lens for your notes</p>
            <h1 id="onboarding-heading" class="hero-title" tabindex="-1" bind:this={headingEl}>
              Your knowledge,<br /><em>finally connected.</em>
            </h1>
            <p id="onboarding-description" class="hero-description">
              Search your notes by meaning, follow the ideas between files, and keep every insight
              in the open Markdown format you already own.
            </p>
          </div>

          <ul class="feature-list" aria-label="Tesseract highlights">
            <li><span class="material-symbols-outlined">manage_search</span>Semantic search</li>
            <li><span class="material-symbols-outlined">device_hub</span>Link-aware context</li>
            <li><span class="material-symbols-outlined">markdown</span>Local Markdown</li>
          </ul>

          <div class="step-actions welcome-actions">
            <button class="primary-btn hero-cta" onclick={() => goToStep(1)}>
              Get Started
              <span class="material-symbols-outlined" aria-hidden="true">arrow_forward</span>
            </button>
            <span class="action-hint">Four quick steps · about two minutes</span>
          </div>
        </section>
      {:else if step === 1}
        <section class="step-content setup-step">
          <header class="step-header">
            <span class="section-icon material-symbols-outlined" aria-hidden="true">terminal</span>
            <div>
              <p class="eyebrow">Power under the hood</p>
              <h2 id="onboarding-heading" class="step-title" tabindex="-1" bind:this={headingEl}>
                CLI Setup
              </h2>
              <p id="onboarding-description" class="step-desc">
                The mdvdb engine indexes your Markdown and makes fast, local-first retrieval
                possible.
              </p>
            </div>
          </header>

          <div class="setup-panel" aria-live="polite">
            <div class="terminal-preview" aria-hidden="true">
              <div class="terminal-bar">
                <span></span><span></span><span></span>
                <code>mdvdb</code>
              </div>
              <div class="terminal-body">
                <span class="prompt">~</span><code>mdvdb status</code>
                {#if cliDetecting}
                  <span class="terminal-response muted">Checking your system…</span>
                {:else if cliResult?.found}
                  <span class="terminal-response success">✓ Engine ready</span>
                {:else}
                  <span class="terminal-response muted">Install when you’re ready.</span>
                {/if}
              </div>
            </div>

            {#if cliDetecting}
              <div class="status-block">
                <div class="status-heading">
                  <span class="status-pulse"></span>
                  <strong>Looking for mdvdb</strong>
                </div>
                <p>Detecting CLI...</p>
                <div class="progress-bar-track" role="progressbar" aria-label="Detecting CLI">
                  <div class="progress-bar-indeterminate"></div>
                </div>
              </div>
            {:else if cliResult?.found}
              <div class="status-card success-card">
                <span class="material-symbols-outlined status-icon">check_circle</span>
                <div class="cli-info">
                  <strong>Engine connected</strong>
                  <span class="cli-path">{cliResult.path}</span>
                  {#if cliResult.version}<span class="cli-version">Version {cliResult.version}</span
                    >{/if}
                </div>
              </div>
            {:else if installing}
              <div class="status-block">
                <div class="status-heading">
                  <span class="status-pulse"></span>
                  <strong>{installStage}</strong>
                  <span class="progress-percent">{installPercent}%</span>
                </div>
                <div
                  class="progress-bar-track"
                  role="progressbar"
                  aria-label={installStage}
                  aria-valuemin="0"
                  aria-valuemax="100"
                  aria-valuenow={installPercent}
                >
                  <div class="progress-bar-fill" style:width={`${installPercent}%`}></div>
                </div>
              </div>
            {:else}
              <div class="status-card neutral-card">
                <span class="material-symbols-outlined status-icon">download_for_offline</span>
                <div>
                  <strong>The CLI tool was not found on your system.</strong>
                  <p>Install it here, or continue and configure the engine later in Settings.</p>
                </div>
              </div>
            {/if}

            {#if cliDetectionError}
              <div class="error-box" role="alert">
                <span class="material-symbols-outlined error-icon">error</span>
                <div>
                  <strong>Detection failed</strong>
                  <p>{cliDetectionError}</p>
                </div>
              </div>
            {/if}
            {#if installError}
              <div class="error-box" role="alert">
                <span class="material-symbols-outlined error-icon">error</span>
                <div>
                  <strong>Installation failed</strong>
                  <p>{installError}</p>
                </div>
              </div>
            {/if}
          </div>

          <footer class="step-actions split-actions">
            <button class="back-btn" onclick={() => goToStep(0)}>
              <span class="material-symbols-outlined" aria-hidden="true">arrow_back</span>Back
            </button>
            <div class="forward-actions">
              {#if cliResult?.found}
                <button class="primary-btn" onclick={() => goToStep(2)}>
                  Continue<span class="material-symbols-outlined" aria-hidden="true"
                    >arrow_forward</span
                  >
                </button>
              {:else if !cliDetecting && !installing}
                {#if cliDetectionError}
                  <button class="secondary-btn" onclick={detectCli}>Check again</button>
                {/if}
                <button class="skip-link" onclick={() => goToStep(2)}>Skip for now</button>
                <button class="primary-btn" onclick={handleInstallCli}>
                  {installError ? 'Retry' : 'Install CLI'}
                  <span class="material-symbols-outlined" aria-hidden="true">download</span>
                </button>
              {/if}
            </div>
          </footer>
        </section>
      {:else if step === 2}
        <section class="step-content setup-step">
          <header class="step-header">
            <span class="section-icon material-symbols-outlined" aria-hidden="true">hub</span>
            <div>
              <p class="eyebrow">Meaning, not just keywords</p>
              <h2 id="onboarding-heading" class="step-title" tabindex="-1" bind:this={headingEl}>
                Choose an Embedding Provider
              </h2>
              <p id="onboarding-description" class="step-desc">
                Embeddings power semantic search. Your choice is saved globally and can be changed
                anytime.
              </p>
            </div>
          </header>

          <div class="provider-cards" role="group" aria-label="Embedding provider">
            <button
              type="button"
              class="provider-card"
              class:selected={provider === 'openai'}
              aria-pressed={provider === 'openai'}
              onclick={() => {
                provider = 'openai'
                providerError = null
              }}
            >
              <span class="provider-icon cloud-icon material-symbols-outlined" aria-hidden="true"
                >cloud</span
              >
              <span class="provider-copy">
                <strong>OpenAI</strong>
                <span>Managed cloud embeddings with your own API key.</span>
              </span>
              <span class="choice-indicator" aria-hidden="true"></span>
            </button>
            <button
              type="button"
              class="provider-card"
              class:selected={provider === 'ollama'}
              aria-pressed={provider === 'ollama'}
              onclick={() => {
                provider = 'ollama'
                providerError = null
              }}
            >
              <span class="provider-icon local-icon material-symbols-outlined" aria-hidden="true"
                >memory</span
              >
              <span class="provider-copy">
                <strong>Ollama</strong>
                <span>Private, local embeddings through your Ollama server.</span>
              </span>
              <span class="choice-indicator" aria-hidden="true"></span>
            </button>
          </div>

          {#if provider}
            <div class="provider-config">
              <div class="config-heading">
                <span class="material-symbols-outlined" aria-hidden="true"
                  >{provider === 'openai' ? 'key' : 'tune'}</span
                >
                <div>
                  <strong>{provider === 'openai' ? 'Connect OpenAI' : 'Connect Ollama'}</strong>
                  <span
                    >{provider === 'openai'
                      ? 'Stored in your local Tesseract configuration.'
                      : 'Tesseract will connect directly to this local endpoint.'}</span
                  >
                </div>
              </div>

              {#if provider === 'openai'}
                <label class="provider-field">
                  <span>OpenAI API key</span>
                  <span class="input-shell">
                    <span class="material-symbols-outlined" aria-hidden="true">key</span>
                    <input
                      type="password"
                      bind:value={openAiKey}
                      placeholder="sk-..."
                      autocomplete="off"
                      aria-describedby="api-key-hint"
                    />
                  </span>
                  <small id="api-key-hint">Used only when generating embeddings.</small>
                </label>
              {:else}
                <div class="field-grid">
                  <label class="provider-field">
                    <span>Ollama host</span>
                    <input type="url" bind:value={ollamaHost} autocomplete="url" />
                  </label>
                  <label class="provider-field">
                    <span>Embedding model</span>
                    <input type="text" bind:value={ollamaModel} autocomplete="off" />
                  </label>
                </div>
              {/if}
            </div>
          {:else}
            <div class="provider-placeholder">
              <span class="material-symbols-outlined" aria-hidden="true">arrow_upward</span>
              <span>Select the provider that best fits how you work.</span>
            </div>
          {/if}

          {#if providerError}
            <div class="error-box" role="alert">
              <span class="material-symbols-outlined error-icon">error</span>
              <p>{providerError}</p>
            </div>
          {/if}

          <footer class="step-actions split-actions">
            <button class="back-btn" onclick={() => goToStep(1)}>
              <span class="material-symbols-outlined" aria-hidden="true">arrow_back</span>Back
            </button>
            <div class="forward-actions">
              <button class="skip-link" onclick={() => goToStep(3)}>Skip for now</button>
              {#if provider}
                <button
                  class="primary-btn"
                  disabled={savingProvider}
                  onclick={saveProviderAndContinue}
                >
                  {savingProvider ? 'Saving…' : 'Continue'}
                  <span class="material-symbols-outlined" aria-hidden="true">arrow_forward</span>
                </button>
              {/if}
            </div>
          </footer>
        </section>
      {:else}
        <section class="step-content setup-step">
          <header class="step-header">
            <span class="section-icon material-symbols-outlined" aria-hidden="true"
              >folder_open</span
            >
            <div>
              <p class="eyebrow">Bring your own knowledge</p>
              <h2 id="onboarding-heading" class="step-title" tabindex="-1" bind:this={headingEl}>
                Add Your First Collection
              </h2>
              <p id="onboarding-description" class="step-desc">
                Choose a folder of Markdown files. Tesseract keeps your folder structure intact and
                never locks your notes into a proprietary format.
              </p>
            </div>
          </header>

          {#if !doctorWarning}
            <div class="collection-dropzone">
              <div class="folder-illustration" aria-hidden="true">
                <span class="folder-back"></span>
                <span class="folder-page page-one"># Ideas</span>
                <span class="folder-page page-two">[[Links]]</span>
                <span class="folder-front"></span>
                <span class="material-symbols-outlined folder-search">manage_search</span>
              </div>
              <div>
                <strong>Your notes become a collection</strong>
                <span>Markdown files · nested folders · links · frontmatter</span>
              </div>
              <button
                class="choose-folder-btn"
                disabled={choosingCollection || creatingExample}
                onclick={handleAddCollection}
              >
                <span class="material-symbols-outlined" aria-hidden="true">folder_open</span>
                {choosingCollection ? 'Opening folder picker…' : 'Choose Folder'}
              </button>
            </div>
            <div class="example-option">
              <span class="example-divider" aria-hidden="true"><span>or</span></span>
              <div class="example-copy">
                <span class="material-symbols-outlined" aria-hidden="true">school</span>
                <div>
                  <strong>Learn by exploring</strong>
                  <span
                    >Create a guided collection that demonstrates Tesseract’s core features.</span
                  >
                </div>
              </div>
              <button
                class="example-btn"
                disabled={choosingCollection || creatingExample || finishing}
                onclick={handleCreateExampleCollection}
              >
                <span class="material-symbols-outlined" aria-hidden="true">auto_awesome</span>
                {creatingExample ? 'Creating example…' : 'Explore Example Collection'}
              </button>
            </div>
          {:else}
            <div class="doctor-warning" role="alert">
              <span class="material-symbols-outlined warning-icon">warning</span>
              <div>
                <span class="warning-label">One more thing</span>
                <strong>Embedding setup needs attention</strong>
                <p>{doctorWarning}</p>
              </div>
            </div>
          {/if}

          <div class="local-promise">
            <span class="material-symbols-outlined" aria-hidden="true">verified_user</span>
            <div>
              <strong>Non-destructive by design</strong>
              <span>Your original files remain readable in every editor you already use.</span>
            </div>
          </div>

          {#if collectionError}
            <div class="error-box" role="alert">
              <span class="material-symbols-outlined error-icon">error</span>
              <p>{collectionError}</p>
            </div>
          {/if}

          <footer class="step-actions split-actions">
            <button class="back-btn" disabled={finishing} onclick={() => goToStep(2)}>
              <span class="material-symbols-outlined" aria-hidden="true">arrow_back</span>Back
            </button>
            <div class="forward-actions">
              {#if doctorWarning}
                <button class="skip-link" disabled={finishing} onclick={finish}
                  >Continue anyway</button
                >
                <button class="primary-btn" disabled={finishing} onclick={openEmbeddingSettings}>
                  Open Embedding Settings
                  <span class="material-symbols-outlined" aria-hidden="true">arrow_forward</span>
                </button>
              {:else}
                <button class="skip-link" disabled={finishing} onclick={finish}>
                  {finishing ? 'Finishing…' : 'Skip'}
                </button>
              {/if}
            </div>
          </footer>
        </section>
      {/if}

      <div class="step-dots" aria-label={`Step ${step + 1} of ${steps.length}`}>
        {#each steps as _, index}
          <span class="dot" class:active={index === step} class:completed={index < step}></span>
        {/each}
      </div>
    </main>
  </div>
</div>

<style>
  .onboarding-overlay {
    position: fixed;
    inset: 0;
    z-index: 200;
    display: grid;
    place-items: center;
    padding: 46px 28px 28px;
    overflow: auto;
    background:
      radial-gradient(
        circle at 14% 14%,
        var(--color-primary-dim, rgba(0, 229, 255, 0.12)),
        transparent 30%
      ),
      radial-gradient(circle at 88% 85%, rgba(99, 102, 241, 0.12), transparent 32%),
      rgba(6, 6, 8, 0.94);
    backdrop-filter: blur(18px) saturate(0.8);
    font-family: var(--font-display, 'Space Grotesk Variable', system-ui, sans-serif);
  }

  .onboarding-overlay::after {
    content: '';
    position: absolute;
    inset: 0;
    pointer-events: none;
    background-image:
      linear-gradient(rgba(255, 255, 255, 0.025) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255, 255, 255, 0.025) 1px, transparent 1px);
    background-size: 42px 42px;
    mask-image: linear-gradient(to bottom, rgba(0, 0, 0, 0.7), transparent 85%);
  }

  .onboarding-card {
    position: relative;
    z-index: 1;
    display: grid;
    grid-template-columns: 286px minmax(0, 1fr);
    width: min(980px, 100%);
    min-height: min(670px, calc(100vh - 78px));
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--color-border, #27272a) 78%, white 8%);
    border-radius: 22px;
    background: color-mix(in srgb, var(--color-surface, #161617) 94%, transparent);
    box-shadow:
      0 36px 100px rgba(0, 0, 0, 0.64),
      0 0 0 1px rgba(255, 255, 255, 0.025) inset;
    animation: card-enter 420ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
  }

  .onboarding-rail {
    position: relative;
    display: flex;
    flex-direction: column;
    padding: 34px 30px 28px;
    overflow: hidden;
    border-right: 1px solid var(--color-border, #27272a);
    background:
      radial-gradient(
        circle at 5% 0%,
        var(--color-primary-dim, rgba(0, 229, 255, 0.13)),
        transparent 34%
      ),
      color-mix(in srgb, var(--color-surface-dark, #0a0a0a) 92%, transparent);
  }

  .onboarding-rail::after {
    content: '';
    position: absolute;
    right: -76px;
    bottom: 96px;
    width: 180px;
    height: 180px;
    border: 1px solid var(--color-primary-glow, rgba(0, 229, 255, 0.2));
    border-radius: 38px;
    transform: rotate(45deg);
    opacity: 0.36;
  }

  .brand-lockup,
  .privacy-note,
  .step-nav {
    position: relative;
    z-index: 1;
  }

  .brand-lockup {
    display: flex;
    align-items: center;
    gap: 13px;
  }

  .brand-mark {
    position: relative;
    display: grid;
    place-items: center;
    width: 42px;
    height: 42px;
    flex: 0 0 auto;
    border: 1px solid var(--color-primary-glow, rgba(0, 229, 255, 0.35));
    border-radius: 13px;
    background: var(--color-primary-dim, rgba(0, 229, 255, 0.1));
    transform: rotate(45deg);
    box-shadow: 0 0 28px var(--color-primary-dim, rgba(0, 229, 255, 0.16));
  }

  .brand-core {
    width: 15px;
    height: 15px;
    border: 2px solid var(--color-primary, #00e5ff);
    border-radius: 5px;
    transform: rotate(45deg);
  }

  .brand-lockup > div {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .brand-lockup strong {
    color: var(--color-text-white, #fff);
    font-size: 17px;
    letter-spacing: -0.02em;
  }

  .brand-lockup div span {
    color: var(--color-text-dim, #71717a);
    font-size: 11px;
    letter-spacing: 0.04em;
  }

  .step-nav {
    display: flex;
    flex: 1;
    flex-direction: column;
    justify-content: center;
    gap: 0;
    margin: 44px 0 34px;
    list-style: none;
  }

  .step-nav li {
    position: relative;
    display: flex;
    align-items: center;
    gap: 13px;
    min-height: 72px;
    color: var(--color-text-dim, #71717a);
    transition: color 180ms ease;
  }

  .step-nav li:not(:last-child)::after {
    content: '';
    position: absolute;
    top: 49px;
    left: 16px;
    width: 1px;
    height: 38px;
    background: var(--color-border, #27272a);
  }

  .step-nav li.complete:not(:last-child)::after {
    background: color-mix(in srgb, var(--color-primary, #00e5ff) 55%, transparent);
  }

  .step-marker {
    display: grid;
    place-items: center;
    width: 33px;
    height: 33px;
    flex: 0 0 auto;
    border: 1px solid var(--color-border, #27272a);
    border-radius: 11px;
    background: var(--color-surface, #161617);
    color: var(--color-text-dim, #71717a);
    font-family: var(--font-mono, 'JetBrains Mono Variable', ui-monospace, monospace);
    font-size: 11px;
    transition: 180ms ease;
  }

  .step-marker .material-symbols-outlined {
    font-size: 17px;
  }

  .step-nav li.current {
    color: var(--color-text, #e4e4e7);
  }

  .step-nav li.current .step-marker {
    border-color: var(--color-primary, #00e5ff);
    background: var(--color-primary, #00e5ff);
    color: var(--color-surface-dark, #0a0a0a);
    box-shadow: 0 0 22px var(--color-primary-glow, rgba(0, 229, 255, 0.25));
  }

  .step-nav li.complete .step-marker {
    border-color: var(--color-primary-glow, rgba(0, 229, 255, 0.3));
    color: var(--color-primary, #00e5ff);
  }

  .step-copy {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .step-copy strong {
    font-size: 13px;
    font-weight: 600;
  }

  .step-copy span {
    color: var(--color-text-faint, #52525b);
    font-size: 11px;
  }

  .step-nav li.current .step-copy span {
    color: var(--color-text-muted, #a1a1aa);
  }

  .privacy-note {
    display: flex;
    gap: 10px;
    padding: 13px;
    border: 1px solid var(--color-border, #27272a);
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.025);
  }

  .privacy-note > .material-symbols-outlined {
    color: var(--color-primary, #00e5ff);
    font-size: 18px;
  }

  .privacy-note div {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .privacy-note strong {
    color: var(--color-text, #e4e4e7);
    font-size: 11px;
  }

  .privacy-note div span {
    color: var(--color-text-dim, #71717a);
    font-size: 10px;
    line-height: 1.45;
  }

  .onboarding-main {
    position: relative;
    display: flex;
    min-width: 0;
    flex-direction: column;
    padding: 34px 48px 28px;
    overflow: auto;
  }

  .step-kicker {
    display: flex;
    align-items: center;
    gap: 9px;
    color: var(--color-text-dim, #71717a);
    font-family: var(--font-mono, 'JetBrains Mono Variable', ui-monospace, monospace);
    font-size: 9px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }

  .kicker-line {
    width: 28px;
    height: 1px;
    background: var(--color-border-hover, #3f3f46);
  }

  .step-content {
    display: flex;
    flex: 1;
    min-height: 0;
    flex-direction: column;
    animation: step-enter 280ms ease both;
  }

  .welcome-step {
    justify-content: center;
    padding: 18px 0 12px;
  }

  .knowledge-orbit {
    position: absolute;
    top: 52px;
    right: 32px;
    width: 190px;
    height: 190px;
    opacity: 0.88;
  }

  .orbit {
    position: absolute;
    inset: 24px;
    border: 1px solid var(--color-border, #27272a);
    border-radius: 50%;
  }

  .orbit-two {
    inset: 53px;
    border-color: var(--color-primary-glow, rgba(0, 229, 255, 0.22));
  }

  .orbit-one::before,
  .orbit-one::after {
    content: '';
    position: absolute;
    top: 50%;
    left: 50%;
    background: var(--color-border, #27272a);
    transform: translate(-50%, -50%);
  }

  .orbit-one::before {
    width: 162px;
    height: 1px;
  }

  .orbit-one::after {
    width: 1px;
    height: 162px;
  }

  .orbit-center {
    position: absolute;
    top: 50%;
    left: 50%;
    display: grid;
    place-items: center;
    width: 48px;
    height: 48px;
    border: 1px solid var(--color-primary, #00e5ff);
    border-radius: 15px;
    background: color-mix(in srgb, var(--color-surface, #161617) 86%, transparent);
    color: var(--color-primary, #00e5ff);
    box-shadow: 0 0 36px var(--color-primary-dim, rgba(0, 229, 255, 0.14));
    transform: translate(-50%, -50%) rotate(45deg);
  }

  .orbit-center .material-symbols-outlined {
    font-size: 23px;
    transform: rotate(-45deg);
  }

  .knowledge-node {
    position: absolute;
    width: 9px;
    height: 9px;
    border: 2px solid var(--color-surface, #161617);
    border-radius: 50%;
    background: var(--color-primary, #00e5ff);
    box-shadow: 0 0 0 1px var(--color-primary-glow, rgba(0, 229, 255, 0.3));
  }

  .node-one {
    top: 22px;
    left: 91px;
  }
  .node-two {
    top: 91px;
    right: 20px;
    background: #818cf8;
  }
  .node-three {
    right: 52px;
    bottom: 34px;
  }
  .node-four {
    top: 66px;
    left: 29px;
    background: #34d399;
  }

  .welcome-copy {
    position: relative;
    z-index: 1;
    max-width: 490px;
    margin-top: 94px;
  }

  .eyebrow {
    margin: 0 0 10px;
    color: var(--color-primary, #00e5ff);
    font-family: var(--font-mono, 'JetBrains Mono Variable', ui-monospace, monospace);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .hero-title {
    margin: 0;
    color: var(--color-text-white, #fff);
    font-size: clamp(36px, 5vw, 54px);
    font-weight: 600;
    letter-spacing: -0.055em;
    line-height: 0.98;
  }

  .hero-title em {
    color: var(--color-primary, #00e5ff);
    font-style: normal;
    font-weight: 500;
  }

  .hero-description {
    max-width: 510px;
    margin: 21px 0 0;
    color: var(--color-text-muted, #a1a1aa);
    font-size: 14px;
    line-height: 1.65;
  }

  .feature-list {
    display: flex;
    flex-wrap: wrap;
    gap: 9px;
    margin: 24px 0 0;
    list-style: none;
  }

  .feature-list li {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 7px 9px;
    border: 1px solid var(--color-border, #27272a);
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.025);
    color: var(--color-text-muted, #a1a1aa);
    font-size: 10px;
  }

  .feature-list .material-symbols-outlined {
    color: var(--color-primary, #00e5ff);
    font-size: 14px;
  }

  .step-actions {
    display: flex;
    align-items: center;
  }

  .welcome-actions {
    gap: 15px;
    margin-top: 28px;
  }

  .action-hint {
    color: var(--color-text-faint, #52525b);
    font-size: 10px;
  }

  .setup-step {
    padding-top: 42px;
  }

  .step-header {
    display: grid;
    grid-template-columns: 46px minmax(0, 1fr);
    gap: 16px;
    align-items: start;
  }

  .section-icon {
    display: grid;
    place-items: center;
    width: 46px;
    height: 46px;
    border: 1px solid var(--color-primary-glow, rgba(0, 229, 255, 0.25));
    border-radius: 14px;
    background: var(--color-primary-dim, rgba(0, 229, 255, 0.09));
    color: var(--color-primary, #00e5ff);
    font-size: 23px;
  }

  .step-header .eyebrow {
    margin-bottom: 7px;
  }

  .step-title {
    margin: 0;
    color: var(--color-text-white, #fff);
    font-size: 27px;
    font-weight: 600;
    letter-spacing: -0.035em;
    line-height: 1.15;
  }

  .step-desc {
    max-width: 540px;
    margin: 10px 0 0;
    color: var(--color-text-muted, #a1a1aa);
    font-size: 12px;
    line-height: 1.55;
  }

  .setup-panel {
    display: grid;
    gap: 12px;
    margin-top: 29px;
  }

  .terminal-preview {
    overflow: hidden;
    border: 1px solid var(--color-border, #27272a);
    border-radius: 12px;
    background: var(--color-surface-dark, #0a0a0a);
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.18);
  }

  .terminal-bar {
    display: flex;
    align-items: center;
    gap: 5px;
    height: 31px;
    padding: 0 11px;
    border-bottom: 1px solid var(--color-border, #27272a);
    background: rgba(255, 255, 255, 0.025);
  }

  .terminal-bar > span {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--color-text-faint, #52525b);
  }

  .terminal-bar > span:first-child {
    background: #f87171;
  }
  .terminal-bar > span:nth-child(2) {
    background: #fbbf24;
  }
  .terminal-bar > span:nth-child(3) {
    background: #34d399;
  }

  .terminal-bar code {
    margin-left: 7px;
    color: var(--color-text-dim, #71717a);
    font-family: var(--font-mono, 'JetBrains Mono Variable', ui-monospace, monospace);
    font-size: 9px;
  }

  .terminal-body {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 8px;
    min-height: 78px;
    padding: 16px;
    color: var(--color-text, #e4e4e7);
    font-family: var(--font-mono, 'JetBrains Mono Variable', ui-monospace, monospace);
    font-size: 11px;
  }

  .prompt {
    color: var(--color-primary, #00e5ff);
  }
  .terminal-response {
    grid-column: 2;
  }
  .terminal-response.muted {
    color: var(--color-text-dim, #71717a);
  }
  .terminal-response.success {
    color: var(--color-success, #34d399);
  }

  .status-card,
  .status-block,
  .error-box,
  .local-promise {
    width: 100%;
    border-radius: 11px;
  }

  .example-option {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 12px 16px;
    align-items: center;
    margin-top: 12px;
  }

  .example-divider {
    position: relative;
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--color-text-faint, #52525b);
    font-family: var(--font-mono, 'JetBrains Mono Variable', ui-monospace, monospace);
    font-size: 8px;
    text-transform: uppercase;
  }

  .example-divider::before,
  .example-divider::after {
    content: '';
    height: 1px;
    flex: 1;
    background: var(--color-border, #27272a);
  }

  .example-divider span {
    padding: 0 10px;
  }

  .example-copy {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 10px;
  }

  .example-copy > .material-symbols-outlined {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    flex: 0 0 auto;
    border-radius: 9px;
    background: rgba(129, 140, 248, 0.1);
    color: #a5b4fc;
    font-size: 17px;
  }

  .example-copy div {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 3px;
  }

  .example-copy strong {
    color: var(--color-text, #e4e4e7);
    font-size: 10px;
  }

  .example-copy div span {
    color: var(--color-text-dim, #71717a);
    font-size: 8px;
    line-height: 1.4;
  }

  .example-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    min-height: 36px;
    padding: 0 12px;
    border: 1px solid rgba(129, 140, 248, 0.32);
    border-radius: 9px;
    background: rgba(129, 140, 248, 0.08);
    color: #c7d2fe;
    font-size: 9px;
    font-weight: 600;
    cursor: pointer;
    transition: 150ms ease;
  }

  .example-btn:hover:not(:disabled) {
    border-color: rgba(129, 140, 248, 0.58);
    background: rgba(129, 140, 248, 0.14);
    transform: translateY(-1px);
  }

  .example-btn .material-symbols-outlined {
    font-size: 15px;
  }

  .status-card {
    display: flex;
    align-items: center;
    gap: 13px;
    padding: 13px 15px;
    border: 1px solid var(--color-border, #27272a);
  }

  .success-card {
    border-color: color-mix(in srgb, var(--color-success, #34d399) 34%, transparent);
    background: color-mix(in srgb, var(--color-success, #34d399) 8%, transparent);
  }

  .neutral-card {
    background: rgba(255, 255, 255, 0.022);
  }

  .status-icon {
    flex: 0 0 auto;
    color: var(--color-primary, #00e5ff);
    font-size: 25px;
  }

  .success-card .status-icon {
    color: var(--color-success, #34d399);
  }

  .status-card > div,
  .cli-info {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 3px;
  }

  .status-card strong {
    color: var(--color-text, #e4e4e7);
    font-size: 12px;
  }

  .status-card p {
    margin: 0;
    color: var(--color-text-dim, #71717a);
    font-size: 10px;
    line-height: 1.45;
  }

  .cli-path,
  .cli-version {
    overflow: hidden;
    color: var(--color-text-muted, #a1a1aa);
    font-family: var(--font-mono, 'JetBrains Mono Variable', ui-monospace, monospace);
    font-size: 9px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .status-block {
    padding: 13px 15px;
    border: 1px solid var(--color-border, #27272a);
    background: rgba(255, 255, 255, 0.02);
  }

  .status-heading {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--color-text, #e4e4e7);
    font-size: 11px;
  }

  .status-heading .progress-percent {
    margin-left: auto;
    color: var(--color-text-dim, #71717a);
    font-family: var(--font-mono, 'JetBrains Mono Variable', ui-monospace, monospace);
    font-size: 9px;
  }

  .status-block > p {
    margin: 5px 0 0 16px;
    color: var(--color-text-dim, #71717a);
    font-size: 10px;
  }

  .status-pulse {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--color-primary, #00e5ff);
    box-shadow: 0 0 0 4px var(--color-primary-dim, rgba(0, 229, 255, 0.1));
    animation: status-pulse 1.4s ease-in-out infinite;
  }

  .progress-bar-track {
    width: 100%;
    height: 4px;
    margin-top: 11px;
    overflow: hidden;
    border-radius: 999px;
    background: var(--color-border, #27272a);
  }

  .progress-bar-fill,
  .progress-bar-indeterminate {
    height: 100%;
    border-radius: inherit;
    background: var(--color-primary, #00e5ff);
    box-shadow: 0 0 12px var(--color-primary-glow, rgba(0, 229, 255, 0.3));
  }

  .progress-bar-fill {
    transition: width 240ms ease;
  }
  .progress-bar-indeterminate {
    width: 34%;
    animation: indeterminate 1.3s ease-in-out infinite;
  }

  .error-box {
    display: flex;
    align-items: flex-start;
    gap: 10px;
    padding: 11px 13px;
    border: 1px solid color-mix(in srgb, var(--color-error, #ef4444) 34%, transparent);
    background: color-mix(in srgb, var(--color-error, #ef4444) 8%, transparent);
  }

  .error-icon {
    flex: 0 0 auto;
    color: var(--color-error, #ef4444);
    font-size: 19px;
  }

  .error-box div {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .error-box strong {
    color: var(--color-text, #e4e4e7);
    font-size: 11px;
  }
  .error-box p {
    margin: 0;
    color: #fca5a5;
    font-size: 10px;
    line-height: 1.45;
  }

  .split-actions {
    justify-content: space-between;
    gap: 16px;
    margin-top: auto;
    padding-top: 28px;
  }

  .forward-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 9px;
  }

  button {
    font-family: inherit;
  }

  button:disabled {
    cursor: wait;
    opacity: 0.58;
  }

  .primary-btn,
  .secondary-btn,
  .back-btn,
  .skip-link,
  .choose-folder-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    min-height: 38px;
    border-radius: 9px;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition:
      transform 150ms ease,
      border-color 150ms ease,
      background 150ms ease,
      color 150ms ease;
  }

  .primary-btn {
    padding: 0 17px;
    border: 1px solid var(--color-primary, #00e5ff);
    background: var(--color-primary, #00e5ff);
    color: var(--color-surface-dark, #0a0a0a);
    box-shadow: 0 8px 24px var(--color-primary-dim, rgba(0, 229, 255, 0.12));
  }

  .primary-btn .material-symbols-outlined,
  .back-btn .material-symbols-outlined {
    font-size: 16px;
  }

  .primary-btn:hover:not(:disabled),
  .choose-folder-btn:hover:not(:disabled) {
    background: var(--color-primary-dark, #00b8cc);
    transform: translateY(-1px);
  }

  .hero-cta {
    min-height: 44px;
    padding: 0 21px;
    font-size: 12px;
  }

  .secondary-btn,
  .back-btn {
    padding: 0 12px;
    border: 1px solid var(--color-border, #27272a);
    background: rgba(255, 255, 255, 0.025);
    color: var(--color-text-muted, #a1a1aa);
  }

  .secondary-btn:hover,
  .back-btn:hover:not(:disabled) {
    border-color: var(--color-border-hover, #3f3f46);
    color: var(--color-text, #e4e4e7);
  }

  .skip-link {
    min-height: 34px;
    padding: 0 9px;
    border: 0;
    background: transparent;
    color: var(--color-text-dim, #71717a);
  }

  .skip-link:hover:not(:disabled) {
    color: var(--color-text, #e4e4e7);
  }

  .provider-cards {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 11px;
    margin-top: 27px;
  }

  .provider-card {
    position: relative;
    display: grid;
    grid-template-columns: 38px minmax(0, 1fr) 16px;
    gap: 11px;
    align-items: center;
    min-height: 88px;
    padding: 14px;
    border: 1px solid var(--color-border, #27272a);
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.018);
    color: var(--color-text, #e4e4e7);
    text-align: left;
    cursor: pointer;
    transition: 160ms ease;
  }

  .provider-card:hover,
  .provider-card.selected {
    border-color: var(--color-primary-glow, rgba(0, 229, 255, 0.5));
    background: var(--color-primary-dim, rgba(0, 229, 255, 0.06));
  }

  .provider-card.selected {
    box-shadow: 0 0 0 1px var(--color-primary-dim, rgba(0, 229, 255, 0.1)) inset;
  }

  .provider-icon {
    display: grid;
    place-items: center;
    width: 38px;
    height: 38px;
    border-radius: 11px;
    font-size: 20px;
  }

  .cloud-icon {
    background: rgba(99, 102, 241, 0.12);
    color: #a5b4fc;
  }
  .local-icon {
    background: rgba(52, 211, 153, 0.1);
    color: #6ee7b7;
  }

  .provider-copy {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 4px;
  }

  .provider-copy strong {
    font-size: 12px;
  }
  .provider-copy span {
    color: var(--color-text-dim, #71717a);
    font-size: 9px;
    line-height: 1.45;
  }

  .choice-indicator {
    width: 14px;
    height: 14px;
    border: 1px solid var(--color-border-hover, #3f3f46);
    border-radius: 50%;
  }

  .provider-card.selected .choice-indicator {
    border: 4px solid var(--color-primary, #00e5ff);
    background: var(--color-surface-dark, #0a0a0a);
  }

  .provider-config,
  .provider-placeholder {
    margin-top: 13px;
    border: 1px solid var(--color-border, #27272a);
    border-radius: 12px;
    background: color-mix(in srgb, var(--color-surface-dark, #0a0a0a) 78%, transparent);
  }

  .provider-config {
    padding: 15px;
  }

  .config-heading {
    display: flex;
    gap: 10px;
    margin-bottom: 13px;
  }

  .config-heading > .material-symbols-outlined {
    color: var(--color-primary, #00e5ff);
    font-size: 18px;
  }
  .config-heading div {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .config-heading strong {
    color: var(--color-text, #e4e4e7);
    font-size: 11px;
  }
  .config-heading div span {
    color: var(--color-text-dim, #71717a);
    font-size: 9px;
  }

  .provider-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 72px;
    color: var(--color-text-faint, #52525b);
    font-size: 10px;
  }

  .provider-placeholder .material-symbols-outlined {
    font-size: 16px;
  }

  .provider-field {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 6px;
    color: var(--color-text-muted, #a1a1aa);
    font-size: 9px;
    font-weight: 600;
  }

  .provider-field input {
    width: 100%;
    height: 34px;
    padding: 0 10px;
    border: 1px solid var(--color-border, #27272a);
    border-radius: 8px;
    background: var(--color-surface, #161617);
    color: var(--color-text, #e4e4e7);
    font-family: var(--font-mono, 'JetBrains Mono Variable', ui-monospace, monospace);
    font-size: 10px;
  }

  .provider-field small {
    color: var(--color-text-faint, #52525b);
    font-size: 8px;
    font-weight: 400;
  }

  .input-shell {
    position: relative;
    display: block;
  }
  .input-shell .material-symbols-outlined {
    position: absolute;
    top: 50%;
    left: 10px;
    color: var(--color-text-dim, #71717a);
    font-size: 14px;
    transform: translateY(-50%);
  }
  .input-shell input {
    padding-left: 30px;
  }

  .field-grid {
    display: grid;
    grid-template-columns: 1.25fr 1fr;
    gap: 10px;
  }

  .collection-dropzone {
    display: grid;
    grid-template-columns: 116px minmax(0, 1fr) auto;
    gap: 17px;
    align-items: center;
    min-height: 170px;
    margin-top: 28px;
    padding: 18px;
    border: 1px dashed
      color-mix(in srgb, var(--color-primary, #00e5ff) 36%, var(--color-border, #27272a));
    border-radius: 15px;
    background:
      radial-gradient(
        circle at 12% 50%,
        var(--color-primary-dim, rgba(0, 229, 255, 0.08)),
        transparent 26%
      ),
      rgba(255, 255, 255, 0.015);
  }

  .folder-illustration {
    position: relative;
    width: 105px;
    height: 105px;
  }
  .folder-back,
  .folder-front {
    position: absolute;
    left: 8px;
    width: 90px;
    border: 1px solid var(--color-primary-glow, rgba(0, 229, 255, 0.3));
    background: var(--color-primary-dim, rgba(0, 229, 255, 0.1));
  }
  .folder-back {
    top: 27px;
    height: 58px;
    border-radius: 9px;
    transform: rotate(-3deg);
  }
  .folder-back::before {
    content: '';
    position: absolute;
    top: -9px;
    left: 7px;
    width: 32px;
    height: 10px;
    border: 1px solid var(--color-primary-glow, rgba(0, 229, 255, 0.3));
    border-bottom: 0;
    border-radius: 5px 5px 0 0;
    background: inherit;
  }
  .folder-front {
    top: 47px;
    height: 43px;
    border-radius: 7px 7px 12px 12px;
    transform: rotate(2deg);
  }
  .folder-page {
    position: absolute;
    z-index: 1;
    width: 59px;
    height: 43px;
    padding: 8px 6px;
    border: 1px solid var(--color-border-hover, #3f3f46);
    border-radius: 5px;
    background: var(--color-surface, #161617);
    color: var(--color-text-muted, #a1a1aa);
    font-family: var(--font-mono, 'JetBrains Mono Variable', ui-monospace, monospace);
    font-size: 7px;
  }
  .page-one {
    top: 17px;
    left: 19px;
    transform: rotate(-8deg);
  }
  .page-two {
    top: 12px;
    left: 36px;
    transform: rotate(7deg);
    color: var(--color-primary, #00e5ff);
  }
  .folder-search {
    position: absolute;
    z-index: 3;
    right: 2px;
    bottom: 4px;
    display: grid;
    place-items: center;
    width: 34px;
    height: 34px;
    border: 2px solid var(--color-surface, #161617);
    border-radius: 50%;
    background: var(--color-primary, #00e5ff);
    color: var(--color-surface-dark, #0a0a0a);
    font-size: 18px;
  }

  .collection-dropzone > div:nth-child(2) {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .collection-dropzone strong {
    color: var(--color-text, #e4e4e7);
    font-size: 12px;
  }
  .collection-dropzone div span {
    color: var(--color-text-dim, #71717a);
    font-size: 9px;
    line-height: 1.45;
  }

  .choose-folder-btn {
    min-height: 40px;
    padding: 0 15px;
    border: 1px solid var(--color-primary, #00e5ff);
    background: transparent;
    color: var(--color-primary, #00e5ff);
  }
  .choose-folder-btn:hover:not(:disabled) {
    color: var(--color-surface-dark, #0a0a0a);
  }
  .choose-folder-btn .material-symbols-outlined {
    font-size: 16px;
  }

  .local-promise {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 12px;
    padding: 11px 13px;
    border: 1px solid var(--color-border, #27272a);
    background: rgba(255, 255, 255, 0.018);
  }
  .local-promise > .material-symbols-outlined {
    color: var(--color-success, #34d399);
    font-size: 18px;
  }
  .local-promise div {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .local-promise strong {
    color: var(--color-text-muted, #a1a1aa);
    font-size: 9px;
  }
  .local-promise div span {
    color: var(--color-text-faint, #52525b);
    font-size: 8px;
  }

  .doctor-warning {
    display: flex;
    gap: 14px;
    margin-top: 28px;
    padding: 19px;
    border: 1px solid color-mix(in srgb, var(--color-warning, #f59e0b) 38%, transparent);
    border-radius: 14px;
    background: color-mix(in srgb, var(--color-warning, #f59e0b) 8%, transparent);
  }
  .warning-icon {
    color: var(--color-warning, #f59e0b);
    font-size: 26px;
  }
  .doctor-warning > div {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .warning-label {
    color: var(--color-warning, #f59e0b);
    font-family: var(--font-mono, 'JetBrains Mono Variable', ui-monospace, monospace);
    font-size: 8px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  .doctor-warning strong {
    color: var(--color-text, #e4e4e7);
    font-size: 13px;
  }
  .doctor-warning p {
    margin: 2px 0 0;
    color: var(--color-text-muted, #a1a1aa);
    font-size: 10px;
    line-height: 1.5;
  }

  .step-dots {
    display: none;
    justify-content: center;
    gap: 7px;
    padding-top: 17px;
  }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 999px;
    background: var(--color-border-hover, #3f3f46);
    transition: 180ms ease;
  }
  .dot.active {
    width: 22px;
    background: var(--color-primary, #00e5ff);
  }
  .dot.completed {
    background: color-mix(in srgb, var(--color-primary, #00e5ff) 50%, transparent);
  }

  @keyframes card-enter {
    from {
      opacity: 0;
      transform: translateY(12px) scale(0.992);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  @keyframes step-enter {
    from {
      opacity: 0;
      transform: translateY(7px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  @keyframes indeterminate {
    from {
      transform: translateX(-110%);
    }
    to {
      transform: translateX(310%);
    }
  }

  @keyframes status-pulse {
    50% {
      opacity: 0.55;
      box-shadow: 0 0 0 7px transparent;
    }
  }

  @media (max-width: 800px) {
    .onboarding-overlay {
      padding: 34px 14px 14px;
    }
    .onboarding-card {
      grid-template-columns: 1fr;
      min-height: min(690px, calc(100vh - 48px));
    }
    .onboarding-rail {
      display: none;
    }
    .onboarding-main {
      padding: 27px 28px 20px;
    }
    .step-dots {
      display: flex;
    }
    .knowledge-orbit {
      right: 9px;
      transform: scale(0.82);
      transform-origin: top right;
    }
    .welcome-copy {
      margin-top: 105px;
    }
  }

  @media (max-width: 580px) {
    .onboarding-main {
      padding-inline: 20px;
    }
    .knowledge-orbit {
      opacity: 0.48;
    }
    .hero-title {
      font-size: 38px;
    }
    .feature-list {
      gap: 6px;
    }
    .provider-cards,
    .field-grid {
      grid-template-columns: 1fr;
    }
    .collection-dropzone {
      grid-template-columns: 1fr;
      justify-items: center;
      text-align: center;
    }
    .split-actions {
      align-items: flex-end;
    }
    .forward-actions {
      flex-wrap: wrap;
    }
    .action-hint {
      display: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .onboarding-card,
    .step-content,
    .status-pulse,
    .progress-bar-indeterminate {
      animation: none;
    }
  }
</style>
