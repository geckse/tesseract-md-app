<script lang="ts">
  import KeyboardShortcuts from './KeyboardShortcuts.svelte'
  import {
    userConfig,
    collectionConfig,
    configLoading,
    activeSection,
    loadUserConfig,
    loadCollectionConfig,
    saveUserConfig,
    saveCollectionConfig,
    deleteCollectionConfigKey,
  } from '../stores/settings'
  import { activeCollection } from '../stores/collections'
  import type { Collection } from '../../preload/api'

  interface SettingsProps {
    onclose: () => void
  }

  let { onclose }: SettingsProps = $props()

  type Section = 'cli' | 'embedding' | 'search' | 'chunking' | 'appearance' | 'about'
  type ConfigScope = 'user' | 'collection'

  const sections: { id: Section; label: string; icon: string }[] = [
    { id: 'cli', label: 'CLI', icon: 'terminal' },
    { id: 'embedding', label: 'Embedding Provider', icon: 'hub' },
    { id: 'search', label: 'Search Defaults', icon: 'search' },
    { id: 'chunking', label: 'Chunking', icon: 'content_cut' },
    { id: 'appearance', label: 'Appearance', icon: 'palette' },
    { id: 'about', label: 'About', icon: 'info' },
  ]

  let currentSection: Section = $state('cli')
  let configScope: ConfigScope = $state('user')
  let currentUserConfig: Record<string, string> = $state({})
  let currentCollectionConfig: Record<string, string> = $state({})
  let currentLoading = $state(false)
  let currentCollection: Collection | null = $state(null)

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
  userConfig.subscribe((v) => (currentUserConfig = v))
  collectionConfig.subscribe((v) => (currentCollectionConfig = v))
  configLoading.subscribe((v) => (currentLoading = v))
  activeCollection.subscribe((v) => (currentCollection = v))

  // Has config scope tabs (sections 2-4)
  let hasScopeTabs = $derived(
    currentSection === 'embedding' || currentSection === 'search' || currentSection === 'chunking'
  )

  // Resolve effective config value: collection override > user > empty
  function getConfigValue(key: string): string {
    if (configScope === 'collection' && currentCollectionConfig[key] !== undefined) {
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
    if (configScope !== 'collection') return ''
    if (isCollectionOverride(key)) return '(collection override)'
    if (currentUserConfig[key] !== undefined) return '(inherited)'
    return ''
  }

  function handleSave(key: string, value: string) {
    if (configScope === 'collection' && currentCollection) {
      saveCollectionConfig(currentCollection.path, key, value)
    } else {
      saveUserConfig(key, value)
    }
  }

  function handleResetToInherited(key: string) {
    if (configScope === 'collection' && currentCollection) {
      deleteCollectionConfigKey(currentCollection.path, key)
    }
  }

  function selectSection(id: Section) {
    activeSection.set(id)
    configScope = 'user'
  }

  // Load configs on mount
  $effect(() => {
    loadUserConfig()
    window.api.findCli().then((p) => (cliPath = p)).catch(() => {})
    window.api.getCliVersion().then((v) => (cliVersion = v)).catch(() => {})
    window.api.getEditorFontSize().then((s) => (fontSize = s)).catch(() => {})
  })

  // Load collection config when collection changes
  $effect(() => {
    if (currentCollection) {
      loadCollectionConfig(currentCollection.path)
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

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && !shortcutsOpen) {
      onclose()
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
    <button class="close-btn" onclick={onclose} title="Close settings">
      <span class="material-symbols-outlined">close</span>
    </button>
  </div>

  <div class="settings-body">
    <nav class="settings-nav">
      {#each sections as section}
        <button
          class="nav-item"
          class:active={currentSection === section.id}
          onclick={() => selectSection(section.id)}
        >
          <span class="material-symbols-outlined nav-icon">{section.icon}</span>
          {section.label}
        </button>
      {/each}
    </nav>

    <div class="settings-content">
      {#if hasScopeTabs}
        <div class="scope-tabs">
          <button
            class="scope-tab"
            class:active={configScope === 'user'}
            onclick={() => (configScope = 'user')}
          >User</button>
          <button
            class="scope-tab"
            class:active={configScope === 'collection'}
            disabled={!currentCollection}
            onclick={() => (configScope = 'collection')}
          >Collection</button>
        </div>
      {/if}

      {#if currentSection === 'cli'}
        <div class="section">
          <h2 class="section-title">CLI Configuration</h2>
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
              {#if configScope === 'collection' && isCollectionOverride('MDVDB_EMBEDDING_PROVIDER')}
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
              {#if configScope === 'collection' && isCollectionOverride('MDVDB_EMBEDDING_MODEL')}
                <button class="reset-btn" title="Reset to inherited" onclick={() => handleResetToInherited('MDVDB_EMBEDDING_MODEL')}>
                  <span class="material-symbols-outlined">undo</span>
                </button>
              {/if}
            </div>
          </div>
          <div class="field-group">
            <label class="field-label">
              API Key
              <span class="annotation">{getAnnotation('MDVDB_API_KEY')}</span>
            </label>
            <div class="field-row">
              <input
                class="field-input"
                type={showApiKey ? 'text' : 'password'}
                value={getConfigValue('MDVDB_API_KEY')}
                placeholder="sk-..."
                oninput={(e) => handleSave('MDVDB_API_KEY', (e.target as HTMLInputElement).value)}
              />
              <button class="icon-btn" onclick={() => (showApiKey = !showApiKey)} title={showApiKey ? 'Hide' : 'Show'}>
                <span class="material-symbols-outlined">{showApiKey ? 'visibility_off' : 'visibility'}</span>
              </button>
              {#if configScope === 'collection' && isCollectionOverride('MDVDB_API_KEY')}
                <button class="reset-btn" title="Reset to inherited" onclick={() => handleResetToInherited('MDVDB_API_KEY')}>
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
              {#if configScope === 'collection' && isCollectionOverride('MDVDB_EMBEDDING_DIMENSIONS')}
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
                <span class="annotation">{getAnnotation('MDVDB_EMBEDDING_HOST')}</span>
              </label>
              <div class="field-row">
                <input
                  class="field-input"
                  type="text"
                  value={getConfigValue('MDVDB_EMBEDDING_HOST')}
                  placeholder="http://localhost:11434"
                  oninput={(e) => handleSave('MDVDB_EMBEDDING_HOST', (e.target as HTMLInputElement).value)}
                />
                {#if configScope === 'collection' && isCollectionOverride('MDVDB_EMBEDDING_HOST')}
                  <button class="reset-btn" title="Reset to inherited" onclick={() => handleResetToInherited('MDVDB_EMBEDDING_HOST')}>
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
              {#if configScope === 'collection' && isCollectionOverride('MDVDB_SEARCH_MODE')}
                <button class="reset-btn" title="Reset to inherited" onclick={() => handleResetToInherited('MDVDB_SEARCH_MODE')}>
                  <span class="material-symbols-outlined">undo</span>
                </button>
              {/if}
            </div>
          </div>
          <div class="field-group">
            <label class="field-label">
              Result Limit
              <span class="annotation">{getAnnotation('MDVDB_SEARCH_LIMIT')}</span>
            </label>
            <div class="field-row">
              <input
                class="field-input field-input-sm"
                type="number"
                value={getConfigValue('MDVDB_SEARCH_LIMIT')}
                placeholder="10"
                oninput={(e) => handleSave('MDVDB_SEARCH_LIMIT', (e.target as HTMLInputElement).value)}
              />
              {#if configScope === 'collection' && isCollectionOverride('MDVDB_SEARCH_LIMIT')}
                <button class="reset-btn" title="Reset to inherited" onclick={() => handleResetToInherited('MDVDB_SEARCH_LIMIT')}>
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
              {#if configScope === 'collection' && isCollectionOverride('MDVDB_SEARCH_MIN_SCORE')}
                <button class="reset-btn" title="Reset to inherited" onclick={() => handleResetToInherited('MDVDB_SEARCH_MIN_SCORE')}>
                  <span class="material-symbols-outlined">undo</span>
                </button>
              {/if}
            </div>
          </div>
          <div class="field-group">
            <label class="field-label">
              Time Decay
              <span class="annotation">{getAnnotation('MDVDB_TIME_DECAY')}</span>
            </label>
            <div class="field-row">
              <label class="toggle-label">
                <input
                  type="checkbox"
                  checked={getConfigValue('MDVDB_TIME_DECAY') === 'true'}
                  onchange={(e) => handleSave('MDVDB_TIME_DECAY', (e.target as HTMLInputElement).checked ? 'true' : 'false')}
                />
                Enable time decay
              </label>
              {#if configScope === 'collection' && isCollectionOverride('MDVDB_TIME_DECAY')}
                <button class="reset-btn" title="Reset to inherited" onclick={() => handleResetToInherited('MDVDB_TIME_DECAY')}>
                  <span class="material-symbols-outlined">undo</span>
                </button>
              {/if}
            </div>
          </div>
          {#if getConfigValue('MDVDB_TIME_DECAY') === 'true'}
            <div class="field-group">
              <label class="field-label">
                Half-Life (days)
                <span class="annotation">{getAnnotation('MDVDB_TIME_DECAY_HALF_LIFE')}</span>
              </label>
              <div class="field-row">
                <input
                  class="field-input field-input-sm"
                  type="number"
                  value={getConfigValue('MDVDB_TIME_DECAY_HALF_LIFE')}
                  placeholder="30"
                  oninput={(e) => handleSave('MDVDB_TIME_DECAY_HALF_LIFE', (e.target as HTMLInputElement).value)}
                />
                {#if configScope === 'collection' && isCollectionOverride('MDVDB_TIME_DECAY_HALF_LIFE')}
                  <button class="reset-btn" title="Reset to inherited" onclick={() => handleResetToInherited('MDVDB_TIME_DECAY_HALF_LIFE')}>
                    <span class="material-symbols-outlined">undo</span>
                  </button>
                {/if}
              </div>
            </div>
          {/if}
        </div>

      {:else if currentSection === 'chunking'}
        <div class="section">
          <h2 class="section-title">Chunking</h2>
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
              {#if configScope === 'collection' && isCollectionOverride('MDVDB_CHUNK_MAX_TOKENS')}
                <button class="reset-btn" title="Reset to inherited" onclick={() => handleResetToInherited('MDVDB_CHUNK_MAX_TOKENS')}>
                  <span class="material-symbols-outlined">undo</span>
                </button>
              {/if}
            </div>
          </div>
          <div class="field-group">
            <label class="field-label">
              Overlap
              <span class="annotation">{getAnnotation('MDVDB_CHUNK_OVERLAP')}</span>
            </label>
            <div class="field-row">
              <input
                class="field-input field-input-sm"
                type="number"
                value={getConfigValue('MDVDB_CHUNK_OVERLAP')}
                placeholder="50"
                oninput={(e) => handleSave('MDVDB_CHUNK_OVERLAP', (e.target as HTMLInputElement).value)}
              />
              {#if configScope === 'collection' && isCollectionOverride('MDVDB_CHUNK_OVERLAP')}
                <button class="reset-btn" title="Reset to inherited" onclick={() => handleResetToInherited('MDVDB_CHUNK_OVERLAP')}>
                  <span class="material-symbols-outlined">undo</span>
                </button>
              {/if}
            </div>
          </div>
        </div>

      {:else if currentSection === 'appearance'}
        <div class="section">
          <h2 class="section-title">Appearance</h2>
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

      {:else if currentSection === 'about'}
        <div class="section">
          <h2 class="section-title">About</h2>
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

  .settings-content {
    flex: 1;
    padding: 24px;
    overflow-y: auto;
  }

  .scope-tabs {
    display: flex;
    gap: 0;
    margin-bottom: 20px;
    border-bottom: 1px solid var(--color-border, #27272a);
  }

  .scope-tab {
    padding: 8px 16px;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--color-text-dim, #71717a);
    font-family: inherit;
    font-size: var(--text-sm, 12px);
    font-weight: var(--weight-bold, 700);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    cursor: pointer;
    transition: color var(--transition-fast, 150ms ease), border-color var(--transition-fast, 150ms ease);
  }

  .scope-tab:hover:not(:disabled) {
    color: var(--color-text, #e4e4e7);
  }

  .scope-tab.active {
    color: var(--color-primary, #00E5FF);
    border-bottom-color: var(--color-primary, #00E5FF);
  }

  .scope-tab:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .section {
    max-width: 480px;
  }

  .section-title {
    font-size: var(--text-base, 14px);
    font-weight: var(--weight-bold, 700);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin: 0 0 20px 0;
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
