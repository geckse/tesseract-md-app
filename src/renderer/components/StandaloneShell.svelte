<script lang="ts">
  import { onMount } from 'svelte'
  import Editor from './Editor.svelte'
  import WysiwygEditor from './WysiwygEditor.svelte'
  import { workspace, type DocumentTab } from '../stores/workspace.svelte'
  import { syncFileStoresFromTab } from '../stores/files'
  import { syncEditorStoresFromTab, wordCount, tokenCount, type EditorMode } from '../stores/editor'
  import { getEditorSnapshots, markEditorSaved } from '../stores/computed-editor-flush'
  import { requestConfirmation } from '../stores/confirmation'
  import { handleMenuCommand } from '../lib/menu-commands'
  import { getShortcutDisplay } from '../lib/shortcuts'
  import { loadEditorFontSize, editorFontSize } from '../stores/ui'
  import { loadAccentColors, primaryVariants } from '../stores/accent-color'
  import { applyAccentColor } from '../lib/apply-accent-color'
  import { loadTheme, initSystemPreference, resolvedTheme, themeTokens } from '../stores/theme'
  import { applyTheme } from '../lib/apply-theme'
  import { reinitMermaid } from '../lib/mermaid-renderer'
  import type { MenuCommand, StandaloneDocument } from '../../preload/api'

  let tabId = $state('')
  let document = $state<StandaloneDocument | null>(null)
  let loading = $state(true)
  let loadError = $state<string | null>(null)
  let operationError = $state<string | null>(null)
  let diskChanged = $state(false)
  let saving = $state(false)
  let savedNotice = $state<string | null>(null)
  let editorRevision = $state(0)
  let savedNoticeTimer: ReturnType<typeof setTimeout> | null = null
  let refreshPromise: Promise<void> | null = null

  const tab = $derived.by(() => {
    const candidate = tabId ? workspace.tabs[tabId] : undefined
    return candidate?.kind === 'document' ? (candidate as DocumentTab) : null
  })
  const isDirty = $derived(tab?.isDirty ?? false)
  const currentMode = $derived(tab?.editorMode ?? 'wysiwyg')
  const saveShortcut = getShortcutDisplay('s', true)

  function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }

  function setSavedNotice(message: string): void {
    savedNotice = message
    if (savedNoticeTimer) clearTimeout(savedNoticeTimer)
    savedNoticeTimer = setTimeout(() => {
      savedNotice = null
      savedNoticeTimer = null
    }, 2200)
  }

  function updateDocumentTab(next: StandaloneDocument, remountEditor: boolean): void {
    document = next
    const currentTab = tab
    if (!currentTab) {
      tabId = workspace.initAsStandalone({
        standalonePath: next.path,
        filePath: next.name,
        title: next.name,
        content: next.content,
        savedContent: next.content
      })
    } else {
      currentTab.filePath = next.name
      currentTab.title = next.name
      currentTab.standalonePath = next.path
      currentTab.content = next.content
      currentTab.savedContent = next.content
      currentTab.isDirty = false
      currentTab.diskMissing = false
      currentTab.contentError = null
    }
    diskChanged = false
    operationError = null
    if (remountEditor) editorRevision += 1
    syncFileStoresFromTab()
    syncEditorStoresFromTab()
  }

  async function loadDocument(): Promise<void> {
    loading = true
    loadError = null
    try {
      const next = await window.api.getStandaloneDocument()
      updateDocumentTab(next, Boolean(tabId))
    } catch (error) {
      loadError = errorMessage(error)
    } finally {
      loading = false
    }
  }

  function liveSnapshot(): { content: string; isDirty: boolean } | null {
    const currentTab = tab
    if (!currentTab) return null

    const snapshots = getEditorSnapshots(currentTab.id)
    const distinctContents = new Set(snapshots.map((snapshot) => snapshot.content))
    if (distinctContents.size > 1) {
      operationError = 'Two editor views contain different unsaved versions of this document.'
      return null
    }

    return (
      snapshots[0] ?? {
        content: currentTab.content ?? '',
        isDirty: currentTab.isDirty
      }
    )
  }

  async function saveDocument(): Promise<void> {
    const currentTab = tab
    if (!currentTab || saving || diskChanged) return
    if (currentTab.savedContent === null) {
      operationError = 'This document has no verified on-disk version to save against.'
      return
    }

    operationError = null
    const beforeSave = liveSnapshot()
    if (!beforeSave) return
    if (!beforeSave.isDirty && beforeSave.content === currentTab.savedContent) {
      setSavedNotice('Already saved')
      return
    }

    const expectedContent = currentTab.savedContent
    saving = true
    let verifyAfterFailure = false
    try {
      await window.api.saveStandaloneDocument(expectedContent, beforeSave.content)

      const afterSave = liveSnapshot()
      if (!afterSave) return
      const clean = afterSave.content === beforeSave.content
      markEditorSaved(currentTab.id, beforeSave.content, clean)
      currentTab.savedContent = beforeSave.content
      currentTab.content = afterSave.content
      currentTab.isDirty = !clean
      diskChanged = false
      syncFileStoresFromTab()
      syncEditorStoresFromTab()
      setSavedNotice(clean ? 'Saved' : 'Saved — newer edits remain')
    } catch (error) {
      operationError = errorMessage(error)
      verifyAfterFailure = true
    } finally {
      saving = false
    }
    if (verifyAfterFailure) await checkForExternalChange()
  }

  async function reloadFromDisk(): Promise<void> {
    const snapshot = liveSnapshot()
    if (!snapshot) return
    if (snapshot.isDirty) {
      const confirmed = await requestConfirmation({
        title: `Reload ${document?.name ?? 'document'}?`,
        message: 'Reloading will discard your unsaved edits and use the version currently on disk.',
        confirmLabel: 'Discard and Reload',
        cancelLabel: 'Keep Editing',
        tone: 'danger'
      })
      if (!confirmed) return
    }

    try {
      const next = await window.api.getStandaloneDocument()
      updateDocumentTab(next, true)
      setSavedNotice('Reloaded from disk')
    } catch (error) {
      operationError = errorMessage(error)
    }
  }

  async function discardChanges(): Promise<void> {
    const currentTab = tab
    if (!currentTab?.isDirty || currentTab.savedContent === null) return
    const confirmed = await requestConfirmation({
      title: `Discard changes to ${currentTab.title}?`,
      message: 'Your unsaved edits will be replaced with the last version read from disk.',
      confirmLabel: 'Discard Changes',
      cancelLabel: 'Keep Editing',
      tone: 'danger'
    })
    if (!confirmed) return

    currentTab.content = currentTab.savedContent
    currentTab.isDirty = false
    editorRevision += 1
    operationError = null
    syncFileStoresFromTab()
    syncEditorStoresFromTab()
  }

  function setMode(mode: EditorMode): void {
    if (!tab || tab.editorMode === mode) return
    tab.editorMode = mode
    syncEditorStoresFromTab()
  }

  async function revealDocument(): Promise<void> {
    try {
      await window.api.revealStandaloneDocument()
    } catch (error) {
      operationError = errorMessage(error)
    }
  }

  function checkForExternalChange(): Promise<void> {
    if (refreshPromise) return refreshPromise
    if (!tab || loading || saving) return Promise.resolve()

    refreshPromise = (async () => {
      try {
        const next = await window.api.getStandaloneDocument()
        const currentTab = tab
        if (!currentTab || next.content === currentTab.savedContent) {
          diskChanged = false
          return
        }

        const snapshot = liveSnapshot()
        if (!snapshot) return
        if (snapshot.isDirty) {
          document = next
          diskChanged = true
          operationError = null
        } else {
          updateDocumentTab(next, true)
          setSavedNotice('Updated from disk')
        }
      } catch (error) {
        operationError = `Could not verify the file on disk: ${errorMessage(error)}`
      }
    })().finally(() => {
      refreshPromise = null
    })
    return refreshPromise
  }

  function handleKeydown(event: KeyboardEvent): void {
    const platformModifier = navigator.platform.toLowerCase().includes('mac')
      ? event.metaKey
      : event.ctrlKey
    if (!platformModifier || event.key.toLowerCase() !== 's') return
    event.preventDefault()
    event.stopImmediatePropagation()
    void saveDocument()
  }

  function handleStandaloneMenu(command: MenuCommand): void {
    if (command.id === 'file.save') {
      void saveDocument()
      return
    }
    if (command.id === 'file.reveal-current') {
      void revealDocument()
      return
    }
    handleMenuCommand(command)
  }

  onMount(() => {
    loadTheme()
    loadAccentColors()
    loadEditorFontSize()
    const cleanupSystemPreference = initSystemPreference()

    let currentResolvedTheme: 'light' | 'dark' = 'dark'
    const unsubscribeTheme = resolvedTheme.subscribe((mode) => {
      currentResolvedTheme = mode
    })
    const unsubscribeThemeTokens = themeTokens.subscribe((tokens) => {
      applyTheme(tokens, currentResolvedTheme)
      reinitMermaid()
    })
    const unsubscribeAccent = primaryVariants.subscribe((variants) => {
      applyAccentColor(variants)
      reinitMermaid()
    })

    window.addEventListener('keydown', handleKeydown, true)
    window.addEventListener('focus', checkForExternalChange)
    window.api.onMenuCommand(handleStandaloneMenu)
    window.api.onCloseRequest(() => {
      const snapshot = liveSnapshot()
      const hasUnsavedChanges =
        snapshot?.isDirty ??
        Boolean(tab?.isDirty || (tab && getEditorSnapshots(tab.id).some((entry) => entry.isDirty)))
      if (!hasUnsavedChanges) {
        void window.api.confirmClose()
        return
      }
      void requestConfirmation({
        title: `Close ${document?.name ?? 'document'}?`,
        message: 'This document has unsaved changes. Discard them and close the window?',
        confirmLabel: 'Discard and Close',
        cancelLabel: 'Keep Editing',
        tone: 'danger'
      }).then((shouldClose) => {
        if (shouldClose) {
          void window.api.confirmClose()
        } else {
          void window.api.cancelClose()
        }
      })
    })

    void loadDocument()

    return () => {
      window.removeEventListener('keydown', handleKeydown, true)
      window.removeEventListener('focus', checkForExternalChange)
      window.api.removeMenuCommandListener()
      window.api.removeCloseRequestListener()
      unsubscribeTheme()
      unsubscribeThemeTokens()
      unsubscribeAccent()
      cleanupSystemPreference()
      if (savedNoticeTimer) clearTimeout(savedNoticeTimer)
    }
  })

  $effect(() => {
    const prefix = isDirty ? '● ' : ''
    const title = document?.name ? `${document.name} — Tesseract` : 'Tesseract'
    void window.api.updatePopupTitle(prefix + title).catch(() => {})
  })
</script>

<div class="standalone-shell" style="--editor-font-size: {$editorFontSize}px">
  <div class="drag-strip">
    <div class="mode-toggle" aria-label="Editor mode">
      <button
        class:active={currentMode === 'wysiwyg'}
        onclick={() => setMode('wysiwyg')}
        aria-pressed={currentMode === 'wysiwyg'}>Editor</button
      >
      <button
        class:active={currentMode === 'editor'}
        onclick={() => setMode('editor')}
        aria-pressed={currentMode === 'editor'}>Raw</button
      >
    </div>
  </div>

  <header class="document-bar">
    <div class="document-identity">
      <div class="title-row">
        <h1>{document?.name ?? 'Markdown document'}</h1>
        {#if isDirty}<span class="dirty-dot" aria-label="Unsaved changes"></span>{/if}
        <span class="collection-badge">No Collection</span>
      </div>
      <button
        class="path-button"
        onclick={revealDocument}
        title="Reveal in file manager"
        disabled={!document}
      >
        <span class="material-symbols-outlined">folder_open</span>
        <span>{document?.directory ?? 'Outside your collections'}</span>
      </button>
    </div>

    <div class="document-actions">
      {#if isDirty}
        <button class="secondary-button" onclick={discardChanges}>Discard</button>
      {/if}
      <button
        class="save-button"
        onclick={saveDocument}
        disabled={!tab || saving || diskChanged || (!isDirty && !operationError)}
        title={`Save (${saveShortcut})`}
      >
        {saving ? 'Saving…' : 'Save'}
        <kbd>{saveShortcut}</kbd>
      </button>
    </div>
  </header>

  {#if diskChanged}
    <div class="notice conflict-notice" role="alert">
      <span class="material-symbols-outlined">sync_problem</span>
      <div>
        <strong>This file changed on disk.</strong>
        <span>Reload it before saving so another editor's changes are not overwritten.</span>
      </div>
      <button onclick={reloadFromDisk}>Reload from disk</button>
    </div>
  {:else if operationError}
    <div class="notice error-notice" role="alert">
      <span class="material-symbols-outlined">error</span>
      <span>{operationError}</span>
      <button onclick={() => (operationError = null)} aria-label="Dismiss error">
        <span class="material-symbols-outlined">close</span>
      </button>
    </div>
  {/if}

  <main class="document-content">
    {#if loading}
      <div class="center-state" aria-live="polite">
        <span class="material-symbols-outlined loading-icon">progress_activity</span>
        <p>Opening Markdown…</p>
      </div>
    {:else if loadError}
      <div class="center-state error-state" role="alert">
        <span class="material-symbols-outlined">draft</span>
        <h2>Could not open this document</h2>
        <p>{loadError}</p>
        <button class="save-button" onclick={loadDocument}>Try again</button>
      </div>
    {:else if tabId}
      {#key `${tabId}:${currentMode}:${editorRevision}`}
        {#if currentMode === 'editor'}
          <Editor {tabId} />
        {:else}
          <WysiwygEditor {tabId} standalone />
        {/if}
      {/key}
    {/if}
  </main>

  <footer class="status-bar">
    <span>Markdown</span>
    <span class="status-separator"></span>
    <span>{$wordCount.toLocaleString()} words</span>
    <span>{$tokenCount.toLocaleString()} tokens</span>
    <span class="status-spacer"></span>
    <span class="save-status" aria-live="polite">
      {#if savedNotice}{savedNotice}{:else if isDirty}Unsaved{:else if document}Saved{/if}
    </span>
  </footer>
</div>

<style>
  .standalone-shell {
    display: flex;
    flex-direction: column;
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    color: var(--color-text, #e4e4e7);
    background: var(--color-bg, #0f0f10);
    font-family: var(--font-display, 'Space Grotesk', sans-serif);
  }

  .drag-strip {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 28px;
    min-height: 28px;
    -webkit-app-region: drag;
    user-select: none;
    border-bottom: 1px solid color-mix(in srgb, var(--color-border, #27272a) 55%, transparent);
  }

  .mode-toggle {
    display: flex;
    padding: 2px;
    border: 1px solid var(--color-border, #27272a);
    border-radius: 6px;
    background: var(--color-surface, #18181b);
    -webkit-app-region: no-drag;
  }

  .mode-toggle button {
    min-width: 48px;
    padding: 2px 9px;
    border: 0;
    border-radius: 4px;
    color: var(--color-text-dim, #71717a);
    background: transparent;
    font: inherit;
    font-size: 11px;
    line-height: 16px;
    cursor: pointer;
  }

  .mode-toggle button.active {
    color: var(--color-text, #e4e4e7);
    background: var(--color-surface-raised, #27272a);
  }

  .document-bar {
    display: flex;
    align-items: center;
    gap: 20px;
    flex: 0 0 auto;
    min-height: 54px;
    padding: 8px 16px;
    border-bottom: 1px solid var(--color-border, #27272a);
    background: color-mix(in srgb, var(--color-surface, #18181b) 58%, var(--color-bg, #0f0f10));
  }

  .document-identity {
    min-width: 0;
    flex: 1;
  }

  .title-row {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  h1 {
    overflow: hidden;
    margin: 0;
    color: var(--color-text, #e4e4e7);
    font-size: 14px;
    font-weight: 600;
    line-height: 20px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dirty-dot {
    width: 6px;
    height: 6px;
    flex: 0 0 auto;
    border-radius: 50%;
    background: var(--color-primary, #00e5ff);
    box-shadow: 0 0 8px color-mix(in srgb, var(--color-primary, #00e5ff) 55%, transparent);
  }

  .collection-badge {
    flex: 0 0 auto;
    padding: 1px 7px;
    border: 1px solid color-mix(in srgb, var(--color-text-dim, #71717a) 28%, transparent);
    border-radius: 999px;
    color: var(--color-text-muted, #a1a1aa);
    background: color-mix(in srgb, var(--color-surface-raised, #27272a) 70%, transparent);
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.02em;
  }

  .path-button {
    display: flex;
    align-items: center;
    gap: 5px;
    max-width: 100%;
    padding: 0;
    border: 0;
    color: var(--color-text-dim, #71717a);
    background: transparent;
    font: inherit;
    font-family: var(--font-mono, monospace);
    font-size: 10px;
    line-height: 15px;
    cursor: pointer;
  }

  .path-button span:last-child {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .path-button .material-symbols-outlined {
    flex: 0 0 auto;
    font-size: 13px;
  }

  .path-button:hover:not(:disabled) {
    color: var(--color-text-muted, #a1a1aa);
  }

  .document-actions {
    display: flex;
    align-items: center;
    gap: 7px;
    flex: 0 0 auto;
  }

  .secondary-button,
  .save-button,
  .notice button {
    min-height: 28px;
    padding: 5px 10px;
    border: 1px solid var(--color-border, #3f3f46);
    border-radius: 6px;
    color: var(--color-text, #e4e4e7);
    background: var(--color-surface-raised, #27272a);
    font: inherit;
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    transition:
      background 120ms ease,
      border-color 120ms ease,
      opacity 120ms ease;
  }

  .save-button {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    border-color: color-mix(in srgb, var(--color-primary, #00e5ff) 58%, transparent);
    color: var(--color-primary, #00e5ff);
    background: color-mix(in srgb, var(--color-primary, #00e5ff) 11%, transparent);
  }

  .save-button:hover:not(:disabled),
  .notice button:hover {
    background: color-mix(in srgb, var(--color-primary, #00e5ff) 18%, transparent);
  }

  button:disabled {
    cursor: default;
    opacity: 0.4;
  }

  kbd {
    color: currentColor;
    font-family: var(--font-mono, monospace);
    font-size: 9px;
    font-weight: 500;
    opacity: 0.72;
  }

  .notice {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 0 0 auto;
    min-height: 38px;
    padding: 6px 14px;
    border-bottom: 1px solid;
    font-size: 11px;
  }

  .notice > .material-symbols-outlined {
    flex: 0 0 auto;
    font-size: 18px;
  }

  .notice div {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
    gap: 1px;
  }

  .notice > span:not(.material-symbols-outlined) {
    min-width: 0;
    flex: 1;
  }

  .conflict-notice {
    border-color: color-mix(in srgb, #f59e0b 35%, transparent);
    color: #fcd34d;
    background: color-mix(in srgb, #f59e0b 10%, var(--color-bg, #0f0f10));
  }

  .error-notice {
    border-color: color-mix(in srgb, #ef4444 32%, transparent);
    color: #fca5a5;
    background: color-mix(in srgb, #ef4444 9%, var(--color-bg, #0f0f10));
  }

  .error-notice button {
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 26px;
    padding: 3px;
    color: inherit;
    background: transparent;
  }

  .error-notice button .material-symbols-outlined {
    font-size: 16px;
  }

  .document-content {
    display: flex;
    min-height: 0;
    flex: 1;
    overflow: hidden;
    background: var(--color-bg, #0f0f10);
  }

  .document-content :global(> *) {
    min-width: 0;
    min-height: 0;
    flex: 1;
  }

  .center-state {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: 9px;
    padding: 32px;
    color: var(--color-text-dim, #71717a);
    text-align: center;
  }

  .center-state h2,
  .center-state p {
    margin: 0;
  }

  .center-state h2 {
    color: var(--color-text, #e4e4e7);
    font-size: 16px;
  }

  .center-state p {
    max-width: 520px;
    font-size: 12px;
  }

  .center-state > .material-symbols-outlined {
    font-size: 28px;
  }

  .loading-icon {
    animation: spin 1s linear infinite;
  }

  .status-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 0 0 23px;
    min-height: 23px;
    padding: 0 12px;
    border-top: 1px solid var(--color-border, #27272a);
    color: var(--color-text-dim, #71717a);
    background: var(--color-surface, #18181b);
    font-size: 10px;
    user-select: none;
  }

  .status-separator {
    width: 1px;
    height: 10px;
    background: var(--color-border, #27272a);
  }

  .status-spacer {
    flex: 1;
  }

  .save-status {
    color: var(--color-text-muted, #a1a1aa);
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (max-width: 620px) {
    .document-bar {
      gap: 8px;
      padding-inline: 10px;
    }

    .collection-badge,
    .save-button kbd {
      display: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .loading-icon {
      animation-duration: 2.5s;
    }

    .secondary-button,
    .save-button,
    .notice button {
      transition: none;
    }
  }
</style>
