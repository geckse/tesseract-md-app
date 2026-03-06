<script lang="ts">
  import KeyboardShortcuts from './KeyboardShortcuts.svelte'
  import {
    userConfig,
    collectionConfig,
    configLoading,
    activeSection,
    settingsTarget,
    loadUserConfig,
    loadCollectionConfig,
    saveUserConfig,
    saveCollectionConfig,
    deleteCollectionConfigKey,
  } from '../stores/settings'
  import { settingsOpen } from '../stores/ui'
  import { collections, activeCollection } from '../stores/collections'
  import type { Collection } from '../../preload/api'

  interface SettingsProps {
    onclose: () => void
  }

  let { onclose }: SettingsProps = $props()

  type Section = 'cli' | 'embedding' | 'search' | 'chunking' | 'appearance' | 'about'

  const globalSections: { id: Section; label: string; icon: string }[] = [
    { id: 'cli', label: 'CLI', icon: 'terminal' },
    { id: 'embedding', label: 'Embedding Provider', icon: 'hub' },
    { id: 'search', label: 'Search Defaults', icon: 'search' },
    { id: 'chunking', label: 'Chunking', icon: 'content_cut' },
    { id: 'appearance', label: 'Appearance', icon: 'palette' },
    { id: 'about', label: 'About', icon: 'info' },
  ]

  const collectionSections: { id: Section; label: string; icon: string }[] = [
    { id: 'embedding', label: 'Embedding Provider', icon: 'hub' },
    { id: 'search', label: 'Search Defaults', icon: 'search' },
    { id: 'chunking', label: 'Chunking', icon: 'content_cut' },
  ]

  const sectionExplainers: Record<Section, string> = {
    cli: 'Manage the mdvdb command-line binary used for indexing and search.',
    embedding: 'Configure which AI model generates vector embeddings for your documents.',
    search: 'Default parameters for search queries.',
    chunking: 'Control how documents are split into chunks before embedding.',
    appearance: 'Visual preferences for the app.',
    about: 'Version information and resources.',
  }

  let currentSection: Section = $state('cli')
  let currentTarget: string = $state('global')
  let currentUserConfig: Record<string, string> = $state({})
  let currentCollectionConfig: Record<string, string> = $state({})
  let currentLoading = $state(false)
  let allCollections: Collection[] = $state([])

  // CLI state
  let cliPath = $state('')
  let cliVersion = $state('')
  let checkingUpdate = $state(false)
  let latestVersion = $state('')

  // Appearance state
  let fontSize = $state(14)

  // Keyboard shortcuts modal
  let shortcutsOpen = $state(false)

  // API key visibility
  let showApiKey = $state(false)

  activeSection.subscribe((v) => (currentSection = v as Section))
  settingsTarget.subscribe((v) => (currentTarget = v))
  userConfig.subscribe((v) => (currentUserConfig = v))
  collectionConfig.subscribe((v) => (currentCollectionConfig = v))
  configLoading.subscribe((v) => (currentLoading = v))
  collections.subscribe((v) => (allCollections = v))

  let isGlobal = $derived(currentTarget === 'global')
  let availableSections = $derived(isGlobal ? globalSections : collectionSections)
  let targetCollection = $derived(
    isGlobal ? null : allCollections.find((c) => c.id === currentTarget) ?? null
  )

  // Resolve effective config value: collection override > user > empty
  function getConfigValue(key: string): string {
    if (!isGlobal && currentCollectionConfig[key] !== undefined) {
      return currentCollectionConfig[key]
    }
    return currentUserConfig[key] ?? ''
  }

  // Check if collection overrides a key
  function isCollectionOverride(key: string): boolean {
    return currentCollectionConfig[key] !== undefined
  }

  // Get annotation for a config value
  function getAnnotation(key: string): string {
    if (isGlobal) return ''
    if (isCollectionOverride(key)) return '(overridden)'
    return '(inherited from global)'
  }

  function handleSave(key: string, value: string) {
    if (!isGlobal && targetCollection) {
      saveCollectionConfig(targetCollection.path, key, value)
    } else {
      saveUserConfig(key, value)
    }
  }

  function handleResetToInherited(key: string) {
    if (!isGlobal && targetCollection) {
      deleteCollectionConfigKey(targetCollection.path, key)
    }
  }

  function selectTarget(target: string) {
    settingsTarget.set(target)
    if (target === 'global') {
      activeSection.set('cli')
    } else {
      activeSection.set('embedding')
      const coll = allCollections.find((c) => c.id === target)
      if (coll) {
        loadCollectionConfig(coll.path)
      }
    }
  }

  function selectSection(id: Section) {
    activeSection.set(id)
  }

  // Load configs on mount
  $effect(() => {
    loadUserConfig()
    window.api.findCli().then((p) => (cliPath = p)).catch(() => {})
    window.api.getCliVersion().then((v) => (cliVersion = v)).catch(() => {})
    window.api.getEditorFontSize().then((s) => (fontSize = s)).catch(() => {})
  })

  // Load collection config when target changes to a collection
  $effect(() => {
    if (!isGlobal && targetCollection) {
      loadCollectionConfig(targetCollection.path)
    }
  })

  async function checkForUpdate() {
    checkingUpdate = true
    try {
      latestVersion = await window.api.checkLatestCliVersion()
    } catch {
      latestVersion = 'Error checking'
    } finally {
      checkingUpdate = false
    }
  }

  async function reinstallCli() {
    try {
      await window.api.installCli()
      cliVersion = await window.api.getCliVersion()
      cliPath = await window.api.findCli()
    } catch {
      // handled silently
    }
  }

  function adjustFontSize(delta: number) {
    const newSize = Math.max(10, Math.min(24, fontSize + delta))
    fontSize = newSize
    window.api.setEditorFontSize(newSize)
  }

  function handleClose() {
    settingsTarget.set('global')
    activeSection.set('cli')
    settingsOpen.set(false)
    onclose?.()
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && !shortcutsOpen) {
      handleClose()
    }
  }

  // Embedding provider-dependent visibility
  let embeddingProvider = $derived(getConfigValue('MDVDB_EMBEDDING_PROVIDER'))
  let showHostUrl = $derived(
    embeddingProvider.toLowerCase() === 'ollama' || embeddingProvider.toLowerCase() === 'custom'
  )
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="settings-panel">
  <div class="settings-header">
    <h1 class="settings-title">Settings</h1>
    <button class="close-btn" onclick={handleClose} title="Close settings">
      <span class="material-symbols-outlined">close</span>
    </button>
  </div>

  <div class="settings-body">
    <nav class="settings-nav">
      <button
        class="nav-item"
        class:active={isGlobal}
        onclick={() => selectTarget('global')}
      >
        <span class="material-symbols-outlined nav-icon">settings</span>
        Global Settings
      </button>

      {#if allCollections.length > 0}
        <div class="nav-section-header">Collections</div>
        {#each allCollections as collection}
          <button
            class="nav-item"
            class:active={currentTarget === collection.id}
            onclick={() => selectTarget(collection.id)}
          >
            <span class="material-symbols-outlined nav-icon">folder</span>
            <span class="nav-label">{collection.name}</span>
          </button>
        {/each}
      {/if}
    </nav>

    <div class="settings-content">
      {#if isGlobal}
        <h2 class="page-title">Global System-Wide Settings</h2>
        <p class="page-explainer">These settings apply to all collections unless a collection has its own overrides.</p>
      {:else}
        <h2 class="page-title">Settings for {targetCollection?.name ?? 'Unknown'}</h2>
        <p class="page-explainer">These settings override global defaults for this collection only. Reset a field to inherit from global settings.</p>
      {/if}

      <div class="section-tabs">
        {#each availableSections as section}
          <button
            class="section-tab"
            class:active={currentSection === section.id}
            onclick={() => selectSection(section.id)}
          >
            <span class="material-symbols-outlined">{section.icon}</span>
            {section.label}
          </button>
        {/each}
      </div>

      {#if currentSection === 'cli' && isGlobal}
        <div class="section">
          <h2 class="section-title">CLI Configuration</h2>
          <p class="section-explainer">{sectionExplainers.cli}</p>
          <div class="field-group">
            <label class="field-label">Binary Path</label>
            <div class="field-value mono">{cliPath || 'Not found'}</div>
          </div>
          <div class="field-group">
            <label class="field-label">Version</label>
            <div class="field-row">
              <span class="field-value mono">{cliVersion || 'Unknown'}</span>
              <button class="action-btn" onclick={checkForUpdate} disabled={checkingUpdate}>
                {checkingUpdate ? 'Checking...' : 'Check for Update'}
              </button>
            </div>
            {#if latestVersion}
              <div class="field-hint">Latest: {latestVersion}</div>
            {/if}
          </div>
          <div class="field-group">
            <button class="action-btn" onclick={reinstallCli}>Reinstall CLI</button>
          </div>
        </div>

      {:else if currentSection === 'embedding'}
        <div class="section">
          <h2 class="section-title">Embedding Provider</h2>
          <p class="section-explainer">{sectionExplainers.embedding}</p>
          <div class="field-group">
            <label class="field-label">
              Provider
              <span class="annotation">{getAnnotation('MDVDB_EMBEDDING_PROVIDER')}</span>
            </label>
            <div class="field-row">
              <select
                class="field-select"
                value={getConfigValue('MDVDB_EMBEDDING_PROVIDER')}
                onchange={(e) => handleSave('MDVDB_EMBEDDING_PROVIDER', (e.target as HTMLSelectElement).value)}
              >
                <option value="">— Select —</option>
                <option value="openai">OpenAI</option>
                <option value="ollama">Ollama</option>
                <option value="custom">Custom</option>
              </select>
              {#if !isGlobal && isCollectionOverride('MDVDB_EMBEDDING_PROVIDER')}
                <button class="reset-btn" title="Reset to inherited" onclick={() => handleResetToInherited('MDVDB_EMBEDDING_PROVIDER')}>
                  <span class="material-symbols-outlined">undo</span>
                </button>
              {/if}
            </div>
          </div>
          <div class="field-group">
            <label class="field-label">
              Model
              <span class="annotation">{getAnnotation('MDVDB_EMBEDDING_MODEL')}</span>
            </label>
            <div class="field-row">
              <input
                class="field-input"
                type="text"
                value={getConfigValue('MDVDB_EMBEDDING_MODEL')}
                placeholder="text-embedding-3-small"
                oninput={(e) => handleSave('MDVDB_EMBEDDING_MODEL', (e.target as HTMLInputElement).value)}
              />
              {#if !isGlobal && isCollectionOverride('MDVDB_EMBEDDING_MODEL')}
                <button class="reset-btn" title="Reset to inherited" onclick={() => handleResetToInherited('MDVDB_EMBEDDING_MODEL')}>
                  <span class="material-symbols-outlined">undo</span>
                </button>
              {/if}
            </div>
          </div>
          <div class="field-group">
            <label class="field-label">
              API Key
              <span class="annotation">{getAnnotation('OPENAI_API_KEY')}</span>
            </label>
            <div class="field-row">
              <input
                class="field-input"
                type={showApiKey ? 'text' : 'password'}
                value={getConfigValue('OPENAI_API_KEY')}
                placeholder="sk-..."
                oninput={(e) => handleSave('OPENAI_API_KEY', (e.target as HTMLInputElement).value)}
              />
              <button class="icon-btn" onclick={() => (showApiKey = !showApiKey)} title={showApiKey ? 'Hide' : 'Show'}>
                <span class="material-symbols-outlined">{showApiKey ? 'visibility_off' : 'visibility'}</span>
              </button>
              {#if !isGlobal && isCollectionOverride('OPENAI_API_KEY')}
                <button class="reset-btn" title="Reset to inherited" onclick={() => handleResetToInherited('OPENAI_API_KEY')}>
                  <span class="material-symbols-outlined">undo</span>
                </button>
              {/if}
            </div>
          </div>
          <div class="field-group">
            <label class="field-label">
              Dimensions
              <span class="annotation">{getAnnotation('MDVDB_EMBEDDING_DIMENSIONS')}</span>
            </label>
            <div class="field-row">
              <input
                class="field-input field-input-sm"
                type="number"
                value={getConfigValue('MDVDB_EMBEDDING_DIMENSIONS')}
                placeholder="1536"
                oninput={(e) => handleSave('MDVDB_EMBEDDING_DIMENSIONS', (e.target as HTMLInputElement).value)}
              />
              {#if !isGlobal && isCollectionOverride('MDVDB_EMBEDDING_DIMENSIONS')}
                <button class="reset-btn" title="Reset to inherited" onclick={() => handleResetToInherited('MDVDB_EMBEDDING_DIMENSIONS')}>
                  <span class="material-symbols-outlined">undo</span>
                </button>
              {/if}
            </div>
          </div>
          {#if showHostUrl}
            <div class="field-group">
              <label class="field-label">
                Host URL
                <span class="annotation">{getAnnotation('OLLAMA_HOST')}</span>
              </label>
              <div class="field-row">
                <input
                  class="field-input"
                  type="text"
                  value={getConfigValue('OLLAMA_HOST')}
                  placeholder="http://localhost:11434"
                  oninput={(e) => handleSave('OLLAMA_HOST', (e.target as HTMLInputElement).value)}
                />
                {#if !isGlobal && isCollectionOverride('OLLAMA_HOST')}
                  <button class="reset-btn" title="Reset to inherited" onclick={() => handleResetToInherited('OLLAMA_HOST')}>
                    <span class="material-symbols-outlined">undo</span>
                  </button>
                {/if}
              </div>
            </div>
          {/if}
        </div>

      {:else if currentSection === 'search'}
        <div class="section">
          <h2 class="section-title">Search Defaults</h2>
          <p class="section-explainer">{sectionExplainers.search}</p>
          <div class="field-group">
            <label class="field-label">
              Mode
              <span class="annotation">{getAnnotation('MDVDB_SEARCH_MODE')}</span>
            </label>
            <div class="field-row">
              <select
                class="field-select"
                value={getConfigValue('MDVDB_SEARCH_MODE')}
                onchange={(e) => handleSave('MDVDB_SEARCH_MODE', (e.target as HTMLSelectElement).value)}
              >
                <option value="">— Default —</option>
                <option value="hybrid">Hybrid</option>
                <option value="semantic">Semantic</option>
                <option value="lexical">Lexical</option>
              </select>
              {#if !isGlobal && isCollectionOverride('MDVDB_SEARCH_MODE')}
                <button class="reset-btn" title="Reset to inherited" onclick={() => handleResetToInherited('MDVDB_SEARCH_MODE')}>
                  <span class="material-symbols-outlined">undo</span>
                </button>
              {/if}
            </div>
          </div>
          <div class="field-group">
            <label class="field-label">
              Result Limit
              <span class="annotation">{getAnnotation('MDVDB_SEARCH_DEFAULT_LIMIT')}</span>
            </label>
            <div class="field-row">
              <input
                class="field-input field-input-sm"
                type="number"
                value={getConfigValue('MDVDB_SEARCH_DEFAULT_LIMIT')}
                placeholder="10"
                oninput={(e) => handleSave('MDVDB_SEARCH_DEFAULT_LIMIT', (e.target as HTMLInputElement).value)}
              />
              {#if !isGlobal && isCollectionOverride('MDVDB_SEARCH_DEFAULT_LIMIT')}
                <button class="reset-btn" title="Reset to inherited" onclick={() => handleResetToInherited('MDVDB_SEARCH_DEFAULT_LIMIT')}>
                  <span class="material-symbols-outlined">undo</span>
                </button>
              {/if}
            </div>
          </div>
          <div class="field-group">
            <label class="field-label">
              Min Score
              <span class="annotation">{getAnnotation('MDVDB_SEARCH_MIN_SCORE')}</span>
            </label>
            <div class="field-row">
              <input
                class="field-input field-input-sm"
                type="number"
                step="0.01"
                value={getConfigValue('MDVDB_SEARCH_MIN_SCORE')}
                placeholder="0.0"
                oninput={(e) => handleSave('MDVDB_SEARCH_MIN_SCORE', (e.target as HTMLInputElement).value)}
              />
              {#if !isGlobal && isCollectionOverride('MDVDB_SEARCH_MIN_SCORE')}
                <button class="reset-btn" title="Reset to inherited" onclick={() => handleResetToInherited('MDVDB_SEARCH_MIN_SCORE')}>
                  <span class="material-symbols-outlined">undo</span>
                </button>
              {/if}
            </div>
          </div>
          <div class="field-group">
            <label class="field-label">
              Link Boosting
              <span class="annotation">{getAnnotation('MDVDB_SEARCH_BOOST_LINKS')}</span>
            </label>
            <div class="field-row">
              <label class="toggle-label">
                <input
                  type="checkbox"
                  checked={getConfigValue('MDVDB_SEARCH_BOOST_LINKS') === 'true'}
                  onchange={(e) => handleSave('MDVDB_SEARCH_BOOST_LINKS', (e.target as HTMLInputElement).checked ? 'true' : 'false')}
                />
                Boost results linked to top matches
              </label>
              {#if !isGlobal && isCollectionOverride('MDVDB_SEARCH_BOOST_LINKS')}
                <button class="reset-btn" title="Reset to inherited" onclick={() => handleResetToInherited('MDVDB_SEARCH_BOOST_LINKS')}>
                  <span class="material-symbols-outlined">undo</span>
                </button>
              {/if}
            </div>
          </div>
          <div class="field-group">
            <label class="field-label">
              Time Decay
              <span class="annotation">{getAnnotation('MDVDB_SEARCH_DECAY')}</span>
            </label>
            <div class="field-row">
              <label class="toggle-label">
                <input
                  type="checkbox"
                  checked={getConfigValue('MDVDB_SEARCH_DECAY') === 'true'}
                  onchange={(e) => handleSave('MDVDB_SEARCH_DECAY', (e.target as HTMLInputElement).checked ? 'true' : 'false')}
                />
                Enable time decay
              </label>
              {#if !isGlobal && isCollectionOverride('MDVDB_SEARCH_DECAY')}
                <button class="reset-btn" title="Reset to inherited" onclick={() => handleResetToInherited('MDVDB_SEARCH_DECAY')}>
                  <span class="material-symbols-outlined">undo</span>
                </button>
              {/if}
            </div>
          </div>
          {#if getConfigValue('MDVDB_SEARCH_DECAY') === 'true'}
            <div class="field-group">
              <label class="field-label">
                Half-Life (days)
                <span class="annotation">{getAnnotation('MDVDB_SEARCH_DECAY_HALF_LIFE')}</span>
              </label>
              <div class="field-row">
                <input
                  class="field-input field-input-sm"
                  type="number"
                  value={getConfigValue('MDVDB_SEARCH_DECAY_HALF_LIFE')}
                  placeholder="90"
                  oninput={(e) => handleSave('MDVDB_SEARCH_DECAY_HALF_LIFE', (e.target as HTMLInputElement).value)}
                />
                {#if !isGlobal && isCollectionOverride('MDVDB_SEARCH_DECAY_HALF_LIFE')}
                  <button class="reset-btn" title="Reset to inherited" onclick={() => handleResetToInherited('MDVDB_SEARCH_DECAY_HALF_LIFE')}>
                    <span class="material-symbols-outlined">undo</span>
                  </button>
                {/if}
              </div>
            </div>
            <div class="field-group">
              <label class="field-label">
                Exclude Paths
                <span class="annotation">{getAnnotation('MDVDB_SEARCH_DECAY_EXCLUDE')}</span>
              </label>
              <div class="field-row">
                <input
                  class="field-input"
                  type="text"
                  value={getConfigValue('MDVDB_SEARCH_DECAY_EXCLUDE')}
                  placeholder="docs/reference,wiki/glossary"
                  oninput={(e) => handleSave('MDVDB_SEARCH_DECAY_EXCLUDE', (e.target as HTMLInputElement).value)}
                />
                {#if !isGlobal && isCollectionOverride('MDVDB_SEARCH_DECAY_EXCLUDE')}
                  <button class="reset-btn" title="Reset to inherited" onclick={() => handleResetToInherited('MDVDB_SEARCH_DECAY_EXCLUDE')}>
                    <span class="material-symbols-outlined">undo</span>
                  </button>
                {/if}
              </div>
              <div class="field-hint">Comma-separated path prefixes immune to decay (evergreen content)</div>
            </div>
            <div class="field-group">
              <label class="field-label">
                Include Paths
                <span class="annotation">{getAnnotation('MDVDB_SEARCH_DECAY_INCLUDE')}</span>
              </label>
              <div class="field-row">
                <input
                  class="field-input"
                  type="text"
                  value={getConfigValue('MDVDB_SEARCH_DECAY_INCLUDE')}
                  placeholder="journal,daily"
                  oninput={(e) => handleSave('MDVDB_SEARCH_DECAY_INCLUDE', (e.target as HTMLInputElement).value)}
                />
                {#if !isGlobal && isCollectionOverride('MDVDB_SEARCH_DECAY_INCLUDE')}
                  <button class="reset-btn" title="Reset to inherited" onclick={() => handleResetToInherited('MDVDB_SEARCH_DECAY_INCLUDE')}>
                    <span class="material-symbols-outlined">undo</span>
                  </button>
                {/if}
              </div>
              <div class="field-hint">Comma-separated path prefixes where decay applies (whitelist). Empty = all files. Exclude takes precedence.</div>
            </div>
          {/if}
        </div>

      {:else if currentSection === 'chunking'}
        <div class="section">
          <h2 class="section-title">Chunking</h2>
          <p class="section-explainer">{sectionExplainers.chunking}</p>
          <div class="field-group">
            <label class="field-label">
              Max Tokens
              <span class="annotation">{getAnnotation('MDVDB_CHUNK_MAX_TOKENS')}</span>
            </label>
            <div class="field-row">
              <input
                class="field-input field-input-sm"
                type="number"
                value={getConfigValue('MDVDB_CHUNK_MAX_TOKENS')}
                placeholder="512"
                oninput={(e) => handleSave('MDVDB_CHUNK_MAX_TOKENS', (e.target as HTMLInputElement).value)}
              />
              {#if !isGlobal && isCollectionOverride('MDVDB_CHUNK_MAX_TOKENS')}
                <button class="reset-btn" title="Reset to inherited" onclick={() => handleResetToInherited('MDVDB_CHUNK_MAX_TOKENS')}>
                  <span class="material-symbols-outlined">undo</span>
                </button>
              {/if}
            </div>
          </div>
          <div class="field-group">
            <label class="field-label">
              Overlap
              <span class="annotation">{getAnnotation('MDVDB_CHUNK_OVERLAP_TOKENS')}</span>
            </label>
            <div class="field-row">
              <input
                class="field-input field-input-sm"
                type="number"
                value={getConfigValue('MDVDB_CHUNK_OVERLAP_TOKENS')}
                placeholder="50"
                oninput={(e) => handleSave('MDVDB_CHUNK_OVERLAP_TOKENS', (e.target as HTMLInputElement).value)}
              />
              {#if !isGlobal && isCollectionOverride('MDVDB_CHUNK_OVERLAP_TOKENS')}
                <button class="reset-btn" title="Reset to inherited" onclick={() => handleResetToInherited('MDVDB_CHUNK_OVERLAP_TOKENS')}>
                  <span class="material-symbols-outlined">undo</span>
                </button>
              {/if}
            </div>
          </div>
        </div>

      {:else if currentSection === 'appearance' && isGlobal}
        <div class="section">
          <h2 class="section-title">Appearance</h2>
          <p class="section-explainer">{sectionExplainers.appearance}</p>
          <div class="field-group">
            <label class="field-label">Editor Font Size</label>
            <div class="field-row font-size-row">
              <button class="font-btn" onclick={() => adjustFontSize(-1)} disabled={fontSize <= 10}>
                <span class="material-symbols-outlined">remove</span>
              </button>
              <span class="font-size-value">{fontSize}px</span>
              <button class="font-btn" onclick={() => adjustFontSize(1)} disabled={fontSize >= 24}>
                <span class="material-symbols-outlined">add</span>
              </button>
            </div>
          </div>
        </div>

      {:else if currentSection === 'about' && isGlobal}
        <div class="section">
          <h2 class="section-title">About</h2>
          <p class="section-explainer">{sectionExplainers.about}</p>
          <div class="field-group">
            <label class="field-label">App Version</label>
            <div class="field-value mono">{cliVersion || 'Unknown'}</div>
          </div>
          <div class="field-group">
            <label class="field-label">Links</label>
            <button class="link-btn" onclick={() => window.api.openPath('https://github.com/nicholasgriffintn/markdown-vdb')}>
              <span class="material-symbols-outlined">open_in_new</span>
              GitHub Repository
            </button>
          </div>
          <div class="field-group">
            <label class="field-label">Keyboard Shortcuts</label>
            <button class="action-btn" onclick={() => (shortcutsOpen = true)}>
              <span class="material-symbols-outlined">keyboard</span>
              View Shortcuts
            </button>
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>

<KeyboardShortcuts open={shortcutsOpen} onclose={() => (shortcutsOpen = false)} />

<style>
  .settings-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--color-bg, #09090b);
    color: var(--color-text, #e4e4e7);
  }

  .settings-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 24px;
    border-bottom: 1px solid var(--color-border, #27272a);
  }

  .settings-title {
    font-size: var(--text-lg, 16px);
    font-weight: var(--weight-bold, 700);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin: 0;
  }

  .close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    background: none;
    border: 1px solid var(--color-border, #27272a);
    border-radius: var(--radius-sm, 2px);
    color: var(--color-text-dim, #71717a);
    cursor: pointer;
    transition: color var(--transition-fast, 150ms ease), border-color var(--transition-fast, 150ms ease);
  }

  .close-btn:hover {
    color: var(--color-text-white, #fff);
    border-color: var(--color-border-hover, #3f3f46);
  }

  .settings-body {
    display: flex;
    flex: 1;
    overflow: hidden;
  }

  .settings-nav {
    display: flex;
    flex-direction: column;
    width: 200px;
    min-width: 200px;
    border-right: 1px solid var(--color-border, #27272a);
    padding: 8px 0;
    overflow-y: auto;
  }

  .nav-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    background: none;
    border: none;
    color: var(--color-text-dim, #71717a);
    font-family: inherit;
    font-size: var(--text-sm, 12px);
    text-align: left;
    cursor: pointer;
    transition: color var(--transition-fast, 150ms ease), background var(--transition-fast, 150ms ease);
  }

  .nav-item:hover {
    color: var(--color-text, #e4e4e7);
    background: var(--color-surface, #161617);
  }

  .nav-item.active {
    color: var(--color-primary, #00E5FF);
    background: var(--color-surface, #161617);
  }

  .nav-icon {
    font-size: 18px;
  }

  .nav-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .nav-section-header {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: var(--color-text-dim, #71717a);
    padding: 16px 16px 8px;
    margin-top: 8px;
    border-top: 1px solid var(--color-border, #27272a);
  }

  .settings-content {
    flex: 1;
    padding: 24px;
    overflow-y: auto;
  }

  .page-title {
    font-size: var(--text-lg, 16px);
    font-weight: var(--weight-bold, 700);
    margin: 0 0 8px 0;
  }

  .page-explainer {
    font-size: var(--text-sm, 12px);
    color: var(--color-text-dim, #71717a);
    margin: 0 0 20px 0;
    line-height: 1.5;
  }

  .section-tabs {
    display: flex;
    gap: 0;
    margin-bottom: 20px;
    border-bottom: 1px solid var(--color-border, #27272a);
    flex-wrap: wrap;
  }

  .section-tab {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--color-text-dim, #71717a);
    font-family: inherit;
    font-size: var(--text-xs, 10px);
    font-weight: var(--weight-bold, 700);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    cursor: pointer;
    transition: color var(--transition-fast, 150ms ease), border-color var(--transition-fast, 150ms ease);
  }

  .section-tab:hover {
    color: var(--color-text, #e4e4e7);
  }

  .section-tab.active {
    color: var(--color-primary, #00E5FF);
    border-bottom-color: var(--color-primary, #00E5FF);
  }

  .section-tab .material-symbols-outlined {
    font-size: 14px;
  }

  .section {
    max-width: 480px;
  }

  .section-title {
    font-size: var(--text-base, 14px);
    font-weight: var(--weight-bold, 700);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin: 0 0 6px 0;
  }

  .section-explainer {
    font-size: var(--text-xs, 10px);
    color: var(--color-text-dim, #71717a);
    margin: 0 0 16px 0;
    line-height: 1.5;
  }

  .field-group {
    margin-bottom: 16px;
  }

  .field-label {
    display: block;
    font-size: var(--text-xs, 10px);
    font-weight: var(--weight-bold, 700);
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--color-text-dim, #71717a);
    margin-bottom: 6px;
  }

  .annotation {
    font-weight: 400;
    text-transform: none;
    letter-spacing: normal;
    color: var(--color-primary, #00E5FF);
    font-size: var(--text-xs, 10px);
  }

  .field-value {
    font-size: var(--text-sm, 12px);
    color: var(--color-text, #e4e4e7);
  }

  .field-value.mono {
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
  }

  .field-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .field-input {
    flex: 1;
    padding: 6px 12px;
    background: var(--color-surface-darker, #0a0a0a);
    border: 1px solid var(--color-border, #27272a);
    border-radius: var(--radius-md, 6px);
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: var(--text-sm, 12px);
    color: var(--color-text-white, #fff);
    outline: none;
    transition: border-color var(--transition-fast, 150ms ease);
  }

  .field-input:focus {
    border-color: var(--color-primary, #00E5FF);
  }

  .field-input-sm {
    max-width: 120px;
  }

  .field-select {
    flex: 1;
    padding: 6px 12px;
    background: var(--color-surface-darker, #0a0a0a);
    border: 1px solid var(--color-border, #27272a);
    border-radius: var(--radius-md, 6px);
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: var(--text-sm, 12px);
    color: var(--color-text-white, #fff);
    outline: none;
    cursor: pointer;
  }

  .field-select:focus {
    border-color: var(--color-primary, #00E5FF);
  }

  .field-hint {
    font-size: var(--text-xs, 10px);
    color: var(--color-text-dim, #71717a);
    margin-top: 4px;
  }

  .action-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 14px;
    background: var(--color-surface, #161617);
    border: 1px solid var(--color-border, #27272a);
    border-radius: var(--radius-sm, 2px);
    color: var(--color-text, #e4e4e7);
    font-family: inherit;
    font-size: var(--text-sm, 12px);
    font-weight: var(--weight-bold, 700);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    cursor: pointer;
    transition: background var(--transition-fast, 150ms ease), border-color var(--transition-fast, 150ms ease);
  }

  .action-btn:hover:not(:disabled) {
    background: var(--color-surface-dark, #0a0a0a);
    border-color: var(--color-border-hover, #3f3f46);
  }

  .action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    background: none;
    border: 1px solid var(--color-border, #27272a);
    border-radius: var(--radius-sm, 2px);
    color: var(--color-text-dim, #71717a);
    cursor: pointer;
    transition: color var(--transition-fast, 150ms ease);
  }

  .icon-btn:hover {
    color: var(--color-text-white, #fff);
  }

  .reset-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    background: none;
    border: none;
    color: var(--color-text-dim, #71717a);
    cursor: pointer;
    padding: 0;
    transition: color var(--transition-fast, 150ms ease);
  }

  .reset-btn:hover {
    color: var(--color-primary, #00E5FF);
  }

  .reset-btn .material-symbols-outlined {
    font-size: 16px;
  }

  .toggle-label {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: var(--text-sm, 12px);
    color: var(--color-text, #e4e4e7);
    cursor: pointer;
  }

  .toggle-label input[type="checkbox"] {
    accent-color: var(--color-primary, #00E5FF);
  }

  .font-size-row {
    gap: 12px;
  }

  .font-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    background: var(--color-surface, #161617);
    border: 1px solid var(--color-border, #27272a);
    border-radius: var(--radius-sm, 2px);
    color: var(--color-text, #e4e4e7);
    cursor: pointer;
    transition: background var(--transition-fast, 150ms ease);
  }

  .font-btn:hover:not(:disabled) {
    background: var(--color-surface-dark, #0a0a0a);
  }

  .font-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .font-btn .material-symbols-outlined {
    font-size: 18px;
  }

  .font-size-value {
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: var(--text-sm, 12px);
    min-width: 40px;
    text-align: center;
  }

  .link-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 14px;
    background: none;
    border: 1px solid var(--color-border, #27272a);
    border-radius: var(--radius-sm, 2px);
    color: var(--color-primary, #00E5FF);
    font-family: inherit;
    font-size: var(--text-sm, 12px);
    cursor: pointer;
    transition: background var(--transition-fast, 150ms ease);
  }

  .link-btn:hover {
    background: var(--color-surface, #161617);
  }

  .link-btn .material-symbols-outlined {
    font-size: 16px;
  }
</style>
