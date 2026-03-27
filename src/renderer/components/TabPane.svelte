<script lang="ts">
  import { workspace } from '../stores/workspace.svelte'
  import { closedTabs } from '../stores/closed-tabs.svelte'
  import { syncFileStoresFromTab } from '../stores/files'
  import TabBar from './TabBar.svelte'
  import ModeBar from './ModeBar.svelte'
  import Editor from './Editor.svelte'
  import WysiwygEditor from './WysiwygEditor.svelte'
  import GraphView from './GraphView.svelte'

  interface TabPaneProps {
    paneId: string
    onfocus?: (paneId: string) => void
  }

  let {
    paneId,
    onfocus,
  }: TabPaneProps = $props()

  // ── Reactive state from workspace ─────────────────────────────────

  const pane = $derived(workspace.panes[paneId])
  const activeTab = $derived(
    pane?.activeTabId ? workspace.tabs[pane.activeTabId] : undefined
  )
  const isFocused = $derived(workspace.activePaneId === paneId)
  const tabKind = $derived(activeTab?.kind ?? null)
  const currentEditorMode = $derived(
    activeTab?.kind === 'document' ? activeTab.editorMode : null
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

  function handleTabActivate(tabId: string) {
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
    if (!tab || tab.kind !== 'document') return

    // TODO: In a future subtask, add dirty-tab confirmation dialog here
    // For now, close immediately and push to closed tabs stack

    const closedTab = workspace.closeTab(tabId, paneId)
    if (closedTab && closedTab.kind === 'document') {
      closedTabs.push(closedTab, paneId)
    }

    // Sync backward-compat stores after close
    syncFileStoresFromTab()
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div
  class="tab-pane"
  class:focused={isFocused}
  onclick={handlePaneClick}
>
  <!-- Tab bar -->
  <TabBar
    {paneId}
    onactivate={handleTabActivate}
    onclose={handleTabClose}
  />

  <!-- Mode bar (context-aware: document mode toggle or graph level switcher) -->
  <ModeBar {paneId} />

  <!-- Content area -->
  <div class="tab-pane-content">
    {#if tabKind === 'graph'}
      <div class="content-region" role="main" aria-label="Graph view">
        <GraphView />
      </div>
    {:else if tabKind === 'document'}
      {#if currentEditorMode === 'editor'}
        <div class="content-region" role="main" aria-label="Raw editor">
          <Editor />
        </div>
      {:else}
        <div class="content-region" role="main" aria-label="Editor">
          <WysiwygEditor />
        </div>
      {/if}
    {:else}
      <!-- Empty state: no active tab -->
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
  </div>
</div>

<style>
  .tab-pane {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    border-left: 2px solid transparent;
    transition: border-color var(--transition-fast, 150ms ease);
  }

  .tab-pane.focused {
    border-left-color: var(--color-primary, #00E5FF);
  }

  /* ── Content area ─────────────────────────────────────────────── */

  .tab-pane-content {
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

  /* ── Empty state ──────────────────────────────────────────────── */

  .empty-state {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--color-background, #0f0f10);
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
