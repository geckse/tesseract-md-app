<script lang="ts">
  import type { Snippet } from 'svelte'
  import { workspace } from '../stores/workspace.svelte'
  import type { TerminalTab } from '../stores/workspace.svelte'
  import { closedTabs } from '../stores/closed-tabs.svelte'
  import { syncFileStoresFromTab } from '../stores/files'
  import { saveAsTabId, dismissSaveAs } from '../stores/save-as'
  import TabBar from './TabBar.svelte'
  import ModeBar from './ModeBar.svelte'
  import Editor from './Editor.svelte'
  import WysiwygEditor from './WysiwygEditor.svelte'
  import GraphView from './GraphView.svelte'
  import ImageViewer from './ImageViewer.svelte'
  import PdfViewer from './PdfViewer.svelte'
  import AssetInfoCard from './AssetInfoCard.svelte'
  import SaveAsModal from './SaveAsModal.svelte'
  import Terminal from './Terminal.svelte'
  import TableView from './table/TableView.svelte'

  interface TabPaneProps {
    paneId: string
    onfocus?: (paneId: string) => void
    /** Extra controls rendered at the right end of the tab bar. */
    trailingActions?: Snippet
  }

  let { paneId, onfocus, trailingActions }: TabPaneProps = $props()

  // ── Reactive state from workspace ─────────────────────────────────

  const pane = $derived(workspace.panes[paneId])
  const activeTab = $derived(pane?.activeTabId ? workspace.tabs[pane.activeTabId] : undefined)
  const isFocused = $derived(workspace.activePaneId === paneId)
  const tabKind = $derived(activeTab?.kind ?? null)
  const currentEditorMode = $derived(activeTab?.kind === 'document' ? activeTab.editorMode : null)

  /**
   * Terminal tabs of this pane. Rendered as always-mounted frames (hidden
   * unless active) so the xterm buffer, selection, and any full-screen app
   * survive switching tabs within the pane.
   */
  const terminalTabs = $derived(
    pane
      ? workspace.getTabsInOrder(paneId).filter((t): t is TerminalTab => t.kind === 'terminal')
      : []
  )

  // ── Focus handling ────────────────────────────────────────────────

  function handlePaneClick() {
    if (!isFocused) {
      workspace.setActivePane(paneId)
      // Sync backward-compat stores when pane focus changes
      syncFileStoresFromTab()
      onfocus?.(paneId)
    }
  }

  // ── Tab lifecycle ─────────────────────────────────────────────────

  function handleTabActivate(_tabId: string) {
    // Focus this pane when a tab is activated
    if (!isFocused) {
      workspace.setActivePane(paneId)
      onfocus?.(paneId)
    }
    // Sync backward-compat stores to the newly active tab
    syncFileStoresFromTab()
  }

  function handleTabClose(tabId: string) {
    const tab = workspace.tabs[tabId]
    if (!tab) return
    // Graph tabs cannot be closed
    if (tab.kind === 'graph') return

    // Confirm before closing dirty document tabs to prevent data loss
    if (tab.kind === 'document' && tab.isDirty) {
      const shouldClose = window.confirm(
        `"${tab.title}" has unsaved changes. Discard changes and close?`
      )
      if (!shouldClose) return
    }

    const closedTab = workspace.closeTab(tabId, paneId)
    if (closedTab && closedTab.kind === 'document') {
      closedTabs.push(closedTab, paneId)
    }

    // Sync backward-compat stores after close
    syncFileStoresFromTab()
  }

  function handleTabCloseMany(tabIds: string[]) {
    for (const tabId of tabIds) {
      handleTabClose(tabId)
    }
  }

  function handleTabCreate() {
    workspace.createUntitledTab(paneId)
    // Focus this pane if not already focused
    if (!isFocused) {
      workspace.setActivePane(paneId)
      onfocus?.(paneId)
    }
    syncFileStoresFromTab()
  }

  // ── Save As modal state ──────────────────────────────────────────
  let currentSaveAsTabId: string | null = $state(null)
  saveAsTabId.subscribe((v) => (currentSaveAsTabId = v))

  // Only show modal if the tab belongs to this pane
  const showSaveAsModal = $derived(
    currentSaveAsTabId !== null && pane !== undefined && pane.tabOrder.includes(currentSaveAsTabId)
  )

  function handleSaveAsClose() {
    dismissSaveAs()
  }

  function handleSaveAsSaved(_filePath: string) {
    syncFileStoresFromTab()
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="tab-pane" class:focused={isFocused} onclick={handlePaneClick}>
  <!-- Tab bar -->
  <TabBar
    {paneId}
    onactivate={handleTabActivate}
    onclose={handleTabClose}
    onclosemany={handleTabCloseMany}
    oncreate={handleTabCreate}
    {trailingActions}
  />

  <!-- Mode bar (document tabs only: editor mode toggle + copy/save actions) -->
  <ModeBar {paneId} />

  <!-- Content area -->
  <div class="tab-pane-content">
    {#if tabKind === 'graph'}
      <div class="content-region" role="main" aria-label="Graph view">
        <GraphView {paneId} />
      </div>
    {:else if tabKind === 'asset'}
      {@const assetTab = activeTab?.kind === 'asset' ? activeTab : null}
      {#if assetTab}
        <div class="content-region" role="main" aria-label="Asset preview">
          {#if assetTab.mimeCategory === 'image'}
            <ImageViewer filePath={assetTab.filePath} fileSize={assetTab.fileSize} />
          {:else if assetTab.mimeCategory === 'pdf'}
            <PdfViewer filePath={assetTab.filePath} />
          {:else}
            <AssetInfoCard
              filePath={assetTab.filePath}
              mimeCategory={assetTab.mimeCategory}
              fileSize={assetTab.fileSize}
            />
          {/if}
        </div>
      {/if}
    {:else if tabKind === 'table'}
      {@const tableTab = activeTab?.kind === 'table' ? activeTab : null}
      {#if tableTab}
        <div class="content-region" role="main" aria-label="Table view">
          <TableView tabId={tableTab.id} />
        </div>
      {/if}
    {:else if tabKind === 'document'}
      {#if currentEditorMode === 'editor'}
        <div class="content-region" role="main" aria-label="Raw editor">
          <Editor tabId={pane?.activeTabId ?? undefined} />
        </div>
      {:else}
        <div class="content-region" role="main" aria-label="Editor">
          <WysiwygEditor tabId={pane?.activeTabId ?? undefined} />
        </div>
      {/if}
    {:else if tabKind === null}
      <!-- Empty state: no active tab (terminal tabs render via the frames below) -->
      <div class="empty-state" role="main" aria-label="No file open">
        <div class="empty-state-content">
          <span class="material-symbols-outlined empty-icon">draft</span>
          <p class="empty-title">No file open</p>
          <p class="empty-hint">
            Open a file from the sidebar or press
            <kbd class="empty-kbd"><span class="kbd-symbol">&#8984;</span>P</kbd>
            to search
          </p>
        </div>
      </div>
    {/if}

    <!-- Terminals stay mounted across tab switches; only the active one is shown -->
    {#each terminalTabs as terminalTab (terminalTab.id)}
      <div
        class="terminal-frame"
        class:visible={pane?.activeTabId === terminalTab.id}
        role="main"
        aria-label="Terminal"
        aria-hidden={pane?.activeTabId !== terminalTab.id}
      >
        <Terminal terminalId={terminalTab.terminalId} />
      </div>
    {/each}
  </div>

  {#if showSaveAsModal && currentSaveAsTabId}
    <SaveAsModal
      tabId={currentSaveAsTabId}
      onclose={handleSaveAsClose}
      onsaved={handleSaveAsSaved}
    />
  {/if}
</div>

<style>
  .tab-pane {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  /* ── Content area ─────────────────────────────────────────────── */

  .tab-pane-content {
    position: relative;
    flex: 1;
    display: flex;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }

  /* Always-mounted terminal hosts; display switching preserves xterm state */
  .terminal-frame {
    position: absolute;
    inset: 0;
    display: none;
  }

  .terminal-frame.visible {
    display: block;
  }

  .content-region {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  /* ── Empty state ──────────────────────────────────────────────── */

  .empty-state {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--color-bg, #0f0f10);
  }

  .empty-state-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    color: var(--color-text-dim, #71717a);
    user-select: none;
  }

  .empty-icon {
    font-size: 48px;
    opacity: 0.3;
  }

  .empty-title {
    font-size: 14px;
    font-weight: 600;
    margin: 0;
    color: var(--color-text-muted, #52525b);
  }

  .empty-hint {
    font-size: 12px;
    margin: 0;
    color: var(--color-text-dim, #71717a);
  }

  .empty-kbd {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 1px 5px;
    border-radius: 3px;
    background: var(--color-surface-dark, #0a0a0a);
    border: 1px solid var(--color-border, #27272a);
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: 10px;
    font-weight: 600;
    color: var(--color-text-dim, #71717a);
    vertical-align: middle;
  }

  .kbd-symbol {
    font-size: 11px;
  }

  @media (prefers-reduced-motion: reduce) {
    .tab-pane {
      transition: none;
    }
  }
</style>
