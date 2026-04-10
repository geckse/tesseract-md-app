<script lang="ts">
  import { onMount } from 'svelte'
  import { get } from 'svelte/store'
  import Editor from './Editor.svelte'
  import WysiwygEditor from './WysiwygEditor.svelte'
  import GraphView from './GraphView.svelte'
  import ImageViewer from './ImageViewer.svelte'
  import PdfViewer from './PdfViewer.svelte'
  import AssetInfoCard from './AssetInfoCard.svelte'
  import SaveAsModal from './SaveAsModal.svelte'
  import { workspace } from '../stores/workspace.svelte'
  import { syncFileStoresFromTab } from '../stores/files'
  import { saveAsTabId, requestSaveAs, dismissSaveAs } from '../stores/save-as'
  import { collections, activeCollectionId } from '../stores/collections'
  import { loadAccentColors, primaryVariants } from '../stores/accent-color'
  import { applyAccentColor } from '../lib/apply-accent-color'
  import { loadTheme, initSystemPreference, resolvedTheme, themeTokens } from '../stores/theme'
  import { applyTheme } from '../lib/apply-theme'
  import { reinitMermaid } from '../lib/mermaid-renderer'
  import { shortcutManager } from '../lib/shortcuts'
  import { loadEditorFontSize, editorFontSize } from '../stores/ui'
  import type { EditorMode } from '../stores/editor'
  import type { PopupInitData, TabTransferData } from '../../preload/api'
  import type { MimeCategory, GraphLevel } from '../types/cli'
  import type { GraphColoringMode } from '../stores/workspace.svelte'

  interface PopupShellProps {
    urlParams: URLSearchParams
  }

  let { urlParams }: PopupShellProps = $props()

  // ── Parse URL parameters ──────────────────────────────────────────
  const kind = (urlParams.get('kind') ?? 'document') as 'document' | 'asset' | 'graph'
  const filePath = urlParams.get('filePath') ?? ''
  const collectionId = urlParams.get('collectionId') ?? ''
  const collectionPath = urlParams.get('collectionPath') ?? ''
  const initialEditorMode = (urlParams.get('editorMode') ?? 'wysiwyg') as EditorMode
  const popupIsUntitled = urlParams.get('isUntitled') === 'true'
  const mimeCategory = (urlParams.get('mimeCategory') ?? 'other') as MimeCategory
  const initialGraphLevel = (urlParams.get('graphLevel') ?? 'document') as GraphLevel
  const graphColoringMode = (urlParams.get('graphColoringMode') ?? 'cluster') as GraphColoringMode

  // ── Local state ───────────────────────────────────────────────────
  let tabId = $state<string>('')
  let currentEditorMode = $state<EditorMode>(initialEditorMode)
  let currentGraphLevel = $state<GraphLevel>(initialGraphLevel)
  let fileSize = $state<number | undefined>(undefined)
  let contentReady = $state(false)

  // ── Derived state from workspace ──────────────────────────────────
  const tab = $derived(workspace.tabs[tabId])
  const isDirty = $derived(tab?.kind === 'document' ? tab.isDirty : false)
  const isUntitled = $derived(tab?.kind === 'document' ? tab.isUntitled : false)
  const title = $derived(
    kind === 'graph' ? 'Graph' :
    tab && 'title' in tab ? tab.title : filePath.split('/').pop() ?? 'Untitled'
  )

  // ── Save As modal state ──────────────────────────────────────────
  let currentSaveAsTabId: string | null = $state(null)
  saveAsTabId.subscribe((v) => (currentSaveAsTabId = v))

  // ── Lifecycle ─────────────────────────────────────────────────────
  onMount(() => {
    // 1. Load theme and accent colors
    loadTheme()
    loadAccentColors()
    loadEditorFontSize()
    const cleanupSystemPref = initSystemPreference()

    let currentResolvedTheme: 'light' | 'dark' = 'dark'
    const unsubTheme = resolvedTheme.subscribe((mode) => { currentResolvedTheme = mode })
    const unsubThemeTokens = themeTokens.subscribe((tokens) => {
      applyTheme(tokens, currentResolvedTheme)
      reinitMermaid()
    })
    const unsubAccent = primaryVariants.subscribe((variants) => {
      applyAccentColor(variants)
      reinitMermaid()
    })

    // 2. Set active collection directly — skip the full loadCollections() round-trip.
    //    We already have the ID and path from URL params; just set the store.
    if (collectionId) {
      activeCollectionId.set(collectionId)
      // Populate the collections store with a minimal entry so activeCollection resolves
      collections.set([{ id: collectionId, name: '', path: collectionPath, addedAt: 0, lastOpenedAt: 0 }])
    }

    // 3. Initialize workspace immediately so the editor mounts fast
    tabId = workspace.initAsPopup(kind, {
      filePath,
      editorMode: initialEditorMode,
      isUntitled: popupIsUntitled,
      mimeCategory,
      graphLevel: initialGraphLevel,
      graphColoringMode,
    })
    contentReady = true
    syncFileStoresFromTab()

    // 4. Load file content in the background (skip for untitled — no file on disk)
    if (kind === 'document' && filePath && !popupIsUntitled) {
      const absolutePath = collectionPath ? `${collectionPath}/${filePath}` : filePath
      window.api.readFile(absolutePath).then((content) => {
        const docTab = workspace.tabs[tabId]
        if (docTab && docTab.kind === 'document' && !docTab.isDirty) {
          docTab.content = content
          docTab.savedContent = content
          syncFileStoresFromTab()
        }
      }).catch(() => {})
    }

    if (kind === 'asset' && filePath) {
      const absolutePath = collectionPath ? `${collectionPath}/${filePath}` : filePath
      window.api.fileInfo(absolutePath).then((info) => {
        fileSize = info.size
        const assetTab = workspace.tabs[tabId]
        if (assetTab && assetTab.kind === 'asset') {
          assetTab.fileSize = info.size
        }
      }).catch(() => {})
    }

    // 4. Listen for popup:init IPC (dirty content transfer from tab detach)
    window.api.onPopupInit((data: PopupInitData) => {
      if (!tabId) return
      const docTab = workspace.tabs[tabId]
      if (!docTab || docTab.kind !== 'document') return

      docTab.content = data.content
      docTab.savedContent = data.savedContent
      docTab.isDirty = data.isDirty
      syncFileStoresFromTab()
    })

    // 4b. Listen for cross-window file saves (another window saved the same file)
    if (kind === 'document' && filePath) {
      window.api.onFileSavedExternally((data: { path: string; content: string }) => {
        const absolutePath = collectionPath ? `${collectionPath}/${filePath}` : filePath
        if (!data.path.endsWith(filePath) && data.path !== absolutePath) return
        const docTab = workspace.tabs[tabId]
        if (!docTab || docTab.kind !== 'document') return

        // Silently update — this is from another window in the same app, not an external editor
        docTab.content = data.content
        docTab.savedContent = data.content
        docTab.isDirty = false
        syncFileStoresFromTab()
      })
    }

    // 5. Register Cmd+S for save (documents only)
    const unregisterSave = kind === 'document' ? shortcutManager.register({
      key: 's',
      meta: true,
      handler: () => { handleSave() },
    }) : null

    shortcutManager.attach()

    // Cross-window sync (file:saved-externally) handles changes from other app windows.
    // The Editor/WysiwygEditor components have their own built-in polling for true external
    // edits (VS Code, vim, etc). No need for a separate watcher in the popup.

    return () => {
      unregisterSave?.()
      shortcutManager.detach()
      window.api.removePopupInitListener()
      window.api.removeFileSavedExternallyListener()
      unsubTheme()
      unsubThemeTokens()
      unsubAccent()
      cleanupSystemPref()
    }
  })

  // Update OS window title (shows in dock/taskbar) for dirty indicator
  $effect(() => {
    const prefix = isDirty ? '● ' : ''
    window.api.updatePopupTitle(prefix + title)
  })

  let alwaysOnTop = $state(false)

  async function handleSave(): Promise<void> {
    if (!tabId) return
    const docTab = workspace.tabs[tabId]
    if (!docTab || docTab.kind !== 'document' || !docTab.isDirty) return

    // Untitled files need a "Save As" dialog to pick a filename
    if (docTab.isUntitled) {
      requestSaveAs(tabId)
      return
    }

    try {
      const absolutePath = collectionPath ? `${collectionPath}/${docTab.filePath}` : docTab.filePath
      await window.api.writeFile(absolutePath, docTab.content ?? '')
      docTab.savedContent = docTab.content
      docTab.isDirty = false
      syncFileStoresFromTab()
    } catch (err) {
      console.error('Failed to save:', err)
    }
  }

  function handleModeChange(mode: EditorMode): void {
    currentEditorMode = mode
    if (tab && tab.kind === 'document') {
      tab.editorMode = mode
    }
  }

  function handleTogglePin(): void {
    alwaysOnTop = !alwaysOnTop
    window.api.setPopupAlwaysOnTop(alwaysOnTop)
  }

  function handlePopBack(): void {
    if (!tabId) return
    const t = workspace.tabs[tabId]
    if (!t) return

    // Build transfer data
    let data: TabTransferData
    if (t.kind === 'document') {
      const includeContent = t.isDirty || t.isUntitled
      data = {
        kind: 'document',
        filePath: t.filePath,
        editorMode: t.editorMode,
        isDirty: t.isDirty,
        isUntitled: t.isUntitled || undefined,
        content: includeContent ? (t.content ?? '') : null,
        savedContent: includeContent ? (t.savedContent ?? '') : null,
      }
    } else if (t.kind === 'asset') {
      data = { kind: 'asset', filePath: t.filePath, mimeCategory: t.mimeCategory }
    } else {
      data = { kind: 'graph', graphLevel: t.graphLevel, graphColoringMode: t.graphColoringMode }
    }

    window.api.popBack(data)
  }
</script>

<div class="popup-shell" style="--editor-font-size: {$editorFontSize}px">
  <!-- Thin drag strip: traffic lights on left, mode toggle centered, action buttons right -->
  <div class="popup-drag-strip">
    <div class="drag-strip-center">
      {#if kind === 'document'}
        <div class="popup-mode-toggle">
          <button
            class="mode-btn"
            class:active={currentEditorMode === 'wysiwyg'}
            onclick={() => handleModeChange('wysiwyg')}
          >Editor</button>
          <button
            class="mode-btn"
            class:active={currentEditorMode === 'editor'}
            onclick={() => handleModeChange('editor')}
          >Raw</button>
        </div>
      {/if}
    </div>

    <div class="drag-strip-right">
      <button
        class="strip-btn"
        class:active={alwaysOnTop}
        onclick={handleTogglePin}
        title={alwaysOnTop ? 'Unpin from front' : 'Keep in front'}
      >
        <span class="material-symbols-outlined">push_pin</span>
      </button>
      <button
        class="strip-btn"
        onclick={handlePopBack}
        title="Pop back to main window"
      >
        <span class="material-symbols-outlined">open_in_new_down</span>
      </button>
      {#if isDirty}
        <button class="popup-save-btn" onclick={handleSave}>
          <span>Save</span>
          <kbd class="popup-save-kbd"><span class="kbd-symbol">⌘</span>S</kbd>
        </button>
      {/if}
    </div>
  </div>

  <div class="popup-content">
    {#if contentReady}
      {#if kind === 'document'}
        {#if currentEditorMode === 'editor'}
          <div class="content-region">
            <Editor tabId={tabId || undefined} />
          </div>
        {:else}
          <div class="content-region">
            <WysiwygEditor tabId={tabId || undefined} />
          </div>
        {/if}
      {:else if kind === 'asset'}
        <div class="content-region">
          {#if mimeCategory === 'image'}
            <ImageViewer filePath={filePath} {fileSize} />
          {:else if mimeCategory === 'pdf'}
            <PdfViewer filePath={filePath} />
          {:else}
            <AssetInfoCard filePath={filePath} {mimeCategory} {fileSize} />
          {/if}
        </div>
      {:else if kind === 'graph'}
        <div class="content-region">
          <GraphView paneId="popup-pane" />
        </div>
      {/if}
    {:else}
      <div class="loading-state">
        <span class="material-symbols-outlined loading-icon">hourglass_empty</span>
      </div>
    {/if}
  </div>

  {#if currentSaveAsTabId === tabId && tabId}
    <SaveAsModal
      tabId={currentSaveAsTabId}
      onclose={() => dismissSaveAs()}
      onsaved={() => syncFileStoresFromTab()}
    />
  {/if}
</div>

<style>
  .popup-shell {
    display: flex;
    flex-direction: column;
    height: 100vh;
    width: 100vw;
    overflow: hidden;
    background: var(--color-background, #0f0f10);
    color: var(--color-text-main, #e4e4e7);
    font-family: var(--font-display, 'Space Grotesk', sans-serif);
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
  }

  .popup-drag-strip {
    height: 28px;
    min-height: 28px;
    display: flex;
    align-items: center;
    -webkit-app-region: drag;
    user-select: none;
    padding: 0 12px;
    background: var(--color-background, #0f0f10);
    position: relative;
  }

  /* Center element uses absolute positioning so it's truly centered regardless of left/right content */
  .drag-strip-center {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    -webkit-app-region: no-drag;
  }

  .drag-strip-right {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 2px;
    -webkit-app-region: no-drag;
  }

  .strip-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 22px;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: var(--color-text-dim, #71717a);
    cursor: pointer;
    transition: color 0.15s ease, background 0.15s ease;
  }

  .strip-btn .material-symbols-outlined {
    font-size: 14px;
  }

  .strip-btn:hover {
    color: var(--color-text-main, #e4e4e7);
    background: var(--color-surface, #161617);
  }

  .strip-btn.active {
    color: var(--color-primary, #00E5FF);
  }

  .popup-save-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 8px;
    background: var(--color-primary, #00E5FF);
    color: var(--color-surface-darker, #0a0a0a);
    border: none;
    border-radius: 4px;
    font-weight: 700;
    font-size: 10px;
    cursor: pointer;
    transition: background 0.15s;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    font-family: inherit;
    line-height: 18px;
  }

  .popup-save-btn:hover {
    background: var(--color-primary-dark, #00B8CC);
  }

  .popup-save-kbd {
    display: inline-flex;
    height: 14px;
    align-items: center;
    gap: 1px;
    border-radius: 3px;
    background: rgba(0, 0, 0, 0.15);
    padding: 0 3px;
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: 8px;
    font-weight: 600;
    color: var(--color-surface-darker, #0a0a0a);
    border: none;
  }

  .popup-mode-toggle {
    display: flex;
    background: var(--color-surface, #161617);
    border-radius: 5px;
    padding: 1px;
    gap: 1px;
  }

  .mode-btn {
    padding: 1px 8px;
    font-size: 10px;
    font-weight: 500;
    font-family: var(--font-display, 'Space Grotesk', sans-serif);
    color: var(--color-text-dim, #71717a);
    background: transparent;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    transition: color 0.15s ease;
    white-space: nowrap;
    line-height: 18px;
  }

  .mode-btn:hover {
    color: var(--color-text-main, #e4e4e7);
  }

  .mode-btn.active {
    background: var(--color-surface-darker, #0a0a0a);
    color: var(--color-text-main, #e4e4e7);
  }

  @media (prefers-reduced-motion: reduce) {
    .strip-btn, .mode-btn {
      transition: none;
    }
  }

  .popup-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }

  .content-region {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .loading-state {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    color: var(--color-text-dim, #71717a);
  }

  .loading-icon {
    font-size: 32px;
    animation: spin 1.5s linear infinite;
  }

  @keyframes spin {
    from { transform: rotate(0deg); }
    to { transform: rotate(360deg); }
  }

  @media (prefers-reduced-motion: reduce) {
    .loading-icon {
      animation: none;
    }
  }
</style>
