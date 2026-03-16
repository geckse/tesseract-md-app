<script lang="ts">
  import { onMount } from 'svelte';
  import { get } from 'svelte/store';
  import Sidebar from './components/Sidebar.svelte';
  import Titlebar from './components/Titlebar.svelte';
  import StatusBar from './components/StatusBar.svelte';
  import Editor from './components/Editor.svelte';
  import WysiwygEditor from './components/WysiwygEditor.svelte';
  import MarkdownPreview from './components/MarkdownPreview.svelte';
  import PropertiesPanel from './components/PropertiesPanel.svelte';
  import GraphView from './components/GraphView.svelte';
  import GraphPreview from './components/GraphPreview.svelte';
  import IngestModal from './components/IngestModal.svelte';
  import QuickOpen from './components/QuickOpen.svelte';
  import Onboarding from './components/Onboarding.svelte';
  import Settings from './components/Settings.svelte';
  import UpdateNotification from './components/UpdateNotification.svelte';
  import { loadCollections, setActiveCollection, activeCollectionId } from './stores/collections';
  import { selectFile, fileContentLoading, selectedFilePath, fileContent, resetFileState } from './stores/files';
  import { renderMarkdown } from './lib/markdown-render';
  import { searchOpen, clearSearch } from './stores/search';
  import { scrollToLine, editorMode, toggleEditorMode, requestSave, isDirty, resetEditorState } from './stores/editor';
  import { loadFavorites } from './stores/favorites';
  import { openQuickOpen } from './stores/quickopen';
  import { shortcutManager } from './lib/shortcuts';
  import { setupWatcherListener, teardownWatcherListener, fetchWatcherStatus, clearWatcherEvents } from './stores/watcher';
  import { graphViewActive, graphSelectedNode, toggleGraphView, selectGraphNode, loadGraphData, resetGraphState } from './stores/graph';
  import { goBack, goForward, setNavigating, clearNavigation } from './stores/navigation';
  import { settingsOpen, onboardingComplete, loadOnboardingState, editorFontSize, loadEditorFontSize } from './stores/ui';
  import { setupUpdateListener, teardownUpdateListener } from './stores/updater';
  import type { SearchResult } from './types/cli';


  let propertiesOpen = $state(localStorage.getItem('mdvdb-properties-open') === 'true');
  let searchAreaEl: HTMLElement | undefined = $state(undefined);

  // Copy dropdown state
  let copyDropdownOpen = $state(false);
  let copyFeedback = $state<string | null>(null);

  function closeCopyDropdown() {
    copyDropdownOpen = false;
  }

  function handleCopyDropdownClickOutside(e: MouseEvent) {
    const target = e.target as HTMLElement;
    if (!target.closest('.copy-dropdown-wrapper')) {
      closeCopyDropdown();
    }
  }

  async function copyAsMarkdown() {
    const content = get(fileContent);
    if (!content) return;
    await navigator.clipboard.writeText(content);
    copyFeedback = 'Copied as Markdown';
    closeCopyDropdown();
    setTimeout(() => (copyFeedback = null), 1500);
  }

  async function copyAsHtml() {
    const content = get(fileContent);
    if (!content) return;
    const html = renderMarkdown(content);
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([html], { type: 'text/plain' }),
      }),
    ]);
    copyFeedback = 'Copied as HTML';
    closeCopyDropdown();
    setTimeout(() => (copyFeedback = null), 1500);
  }

  // Focus management refs for Tab navigation
  let sidebarEl: HTMLElement | undefined = $state(undefined);
  let editorEl: HTMLElement | undefined = $state(undefined);
  let propertiesEl: HTMLElement | undefined = $state(undefined);

  onMount(() => {
    loadCollections();
    loadFavorites();
    setupWatcherListener();
    setupUpdateListener();
    fetchWatcherStatus();
    loadOnboardingState();
    loadEditorFontSize();

    // Close copy dropdown on outside click
    document.addEventListener('click', handleCopyDropdownClickOutside);

    // Listen for native menu "Open Recent" clicks
    window.api.onMenuOpenRecent(({ collectionId, filePath }) => {
      setActiveCollection(collectionId);
      // Small delay to let collection switch propagate before selecting file
      setTimeout(() => selectFile(filePath), 50);
    });

    // Register keyboard shortcuts
    const unregisterShortcuts = [
      // Cmd+P / Ctrl+P: Open quick file finder
      shortcutManager.register({
        key: 'p',
        meta: true,
        handler: () => {
          openQuickOpen();
        },
      }),

      // Cmd+K / Ctrl+K: Open search
      shortcutManager.register({
        key: 'k',
        meta: true,
        handler: () => {
          searchOpen.set(true);
        },
      }),

      // Cmd+Shift+B / Ctrl+Shift+B: Toggle properties panel
      shortcutManager.register({
        key: 'b',
        meta: true,
        shift: true,
        handler: () => {
          propertiesOpen = !propertiesOpen;
          localStorage.setItem('mdvdb-properties-open', String(propertiesOpen));
        },
      }),

      // Cmd+W / Ctrl+W: Deselect file
      shortcutManager.register({
        key: 'w',
        meta: true,
        handler: () => {
          selectFile(null);
        },
      }),

      // Cmd+G / Ctrl+G: Toggle graph view
      shortcutManager.register({
        key: 'g',
        meta: true,
        handler: () => {
          toggleGraphView();
        },
      }),

      // Cmd+E / Ctrl+E: Toggle editor/preview mode
      shortcutManager.register({
        key: 'e',
        meta: true,
        handler: () => {
          if (!get(graphViewActive)) {
            toggleEditorMode();
          }
        },
      }),

      // Cmd+S / Ctrl+S: Global save (works in preview and wysiwyg mode too)
      shortcutManager.register({
        key: 's',
        meta: true,
        handler: () => {
          const mode = get(editorMode);
          if (mode === 'preview' || mode === 'wysiwyg') {
            requestSave();
          }
          // In editor mode, CodeMirror's own keymap handles Cmd+S
        },
      }),

      // Escape: Deselect graph node or exit graph view
      shortcutManager.register({
        key: 'Escape',
        handler: () => {
          if ($graphViewActive) {
            if ($graphSelectedNode) {
              selectGraphNode(null);
            } else {
              toggleGraphView();
            }
          }
        },
      }),

      // Cmd+, / Ctrl+,: Toggle settings panel
      shortcutManager.register({
        key: ',',
        meta: true,
        handler: () => {
          settingsOpen.update((v) => !v);
        },
      }),

      // Cmd+[ / Ctrl+[: Navigate back
      shortcutManager.register({
        key: '[',
        meta: true,
        handler: () => {
          const path = goBack();
          if (path) {
            setNavigating(true);
            selectFile(path);
            setNavigating(false);
          }
        },
      }),

      // Cmd+] / Ctrl+]: Navigate forward
      shortcutManager.register({
        key: ']',
        meta: true,
        handler: () => {
          const path = goForward();
          if (path) {
            setNavigating(true);
            selectFile(path);
            setNavigating(false);
          }
        },
      }),

      // Tab: Cycle focus forward through regions (sidebar → editor → metadata)
      shortcutManager.register({
        key: 'Tab',
        handler: (event) => {
          // Only handle Tab if we're not in an input/textarea
          const target = event.target as HTMLElement;
          if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
            return;
          }

          cycleFocus(false);
        },
        preventDefault: true,
      }),

      // Shift+Tab: Cycle focus backward through regions
      shortcutManager.register({
        key: 'Tab',
        shift: true,
        handler: (event) => {
          // Only handle Shift+Tab if we're not in an input/textarea
          const target = event.target as HTMLElement;
          if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
            return;
          }

          cycleFocus(true);
        },
        preventDefault: true,
      }),
    ];

    // Attach shortcut manager to document
    shortcutManager.attach();

    // Click-away to close search
    function handleClickAway(e: MouseEvent) {
      if (searchAreaEl && !searchAreaEl.contains(e.target as Node)) {
        clearSearch();
        searchOpen.set(false);
      }
    }

    document.addEventListener('mousedown', handleClickAway);

    // Reset all collection-dependent state when switching collections
    let firstRun = true;
    const unsub = activeCollectionId.subscribe(() => {
      // Skip the initial subscription fire — state is already clean on mount
      if (firstRun) {
        firstRun = false;
        return;
      }
      // Clear file selection, tree, properties, and editor state FIRST
      // to prevent stale paths from being used in CLI calls
      resetFileState();
      resetEditorState();
      clearSearch();
      clearNavigation();
      clearWatcherEvents();
      // Reset graph state (clears old data immediately) then reload if active
      const wasGraphActive = get(graphViewActive);
      resetGraphState();
      if (wasGraphActive) {
        loadGraphData();
      }
    });

    return () => {
      // Unregister all shortcuts
      unregisterShortcuts.forEach((unregister) => unregister());
      shortcutManager.detach();
      document.removeEventListener('mousedown', handleClickAway);
      document.removeEventListener('click', handleCopyDropdownClickOutside);
      teardownWatcherListener();
      teardownUpdateListener();
      window.api.removeMenuOpenRecentListener();
      unsub();
    };
  });

  function handleNavigate(detail: { id: string }) {
    setActiveCollection(detail.id);
  }

  function handleFileSelect(detail: { folderId: string; fileId: string }) {
    selectFile(detail.fileId);
  }

  function navigateToResult(result: SearchResult) {
    selectFile(result.file.path);
    // Wait for loading to finish, then scroll to the result line
    let wasLoading = false;
    const unsub = fileContentLoading.subscribe((loading) => {
      if (loading) { wasLoading = true; return; }
      if (wasLoading) {
        // Defer scroll so the editor's content $effect creates the view first
        requestAnimationFrame(() => {
          scrollToLine.set(result.chunk.start_line);
        });
        unsub();
      }
    });
    clearSearch();
    searchOpen.set(false);
  }

  function handleToggleProperties(detail: { open: boolean }) {
    propertiesOpen = detail.open;
    localStorage.setItem('mdvdb-properties-open', String(propertiesOpen));
  }

  /**
   * Cycle focus between the three main regions: sidebar, editor, and metadata panel.
   * @param reverse - If true, cycle backward (Shift+Tab), otherwise forward (Tab)
   */
  function cycleFocus(reverse: boolean = false) {
    const regions = [sidebarEl, editorEl, propertiesOpen ? propertiesEl : null].filter(Boolean) as HTMLElement[];

    if (regions.length === 0) return;

    // Find currently focused region
    const activeElement = document.activeElement as HTMLElement;
    let currentIndex = -1;

    for (let i = 0; i < regions.length; i++) {
      if (regions[i] === activeElement || regions[i].contains(activeElement)) {
        currentIndex = i;
        break;
      }
    }

    // Calculate next index
    let nextIndex: number;
    if (currentIndex === -1) {
      // No region focused, start at the beginning
      nextIndex = reverse ? regions.length - 1 : 0;
    } else {
      if (reverse) {
        nextIndex = (currentIndex - 1 + regions.length) % regions.length;
      } else {
        nextIndex = (currentIndex + 1) % regions.length;
      }
    }

    // Focus the next region
    regions[nextIndex]?.focus();
  }

</script>

{#if !$onboardingComplete}
  <Onboarding />
{:else}
<!-- Skip navigation link for accessibility -->
<a href="#main-content" class="skip-link">Skip to main content</a>

<div class="app-shell bg-grain" style="--editor-font-size: {$editorFontSize}px">
  <UpdateNotification />
  <div class="titlebar-region" bind:this={searchAreaEl}>
    <Titlebar
      bind:propertiesOpen
      onsearchresultclick={navigateToResult}
      ontoggleproperties={handleToggleProperties}
    />
  </div>

  <div class="body-region">
    <div class="sidebar-region" bind:this={sidebarEl} tabindex="-1" role="navigation" aria-label="File navigation">
      <Sidebar
        onnavigate={handleNavigate}
        onfileselect={handleFileSelect}
      />
    </div>

    <main class="main-area">
      <div class="content-area">
        {#if $graphViewActive}
          <div id="main-content" class="graph-region" tabindex="-1" role="main" aria-label="Graph view">
            <GraphView />
          </div>
          {#if $graphSelectedNode}
            <div class="preview-region" role="complementary" aria-label="File preview">
              <GraphPreview />
            </div>
          {/if}
        {:else if $settingsOpen}
          <div class="settings-region" role="main" aria-label="Settings">
            <Settings />
          </div>
        {:else}
          <div class="editor-with-tabs">
            {#if $selectedFilePath}
              <div class="mode-toggle-bar">
                <div class="mode-toggle-spacer"></div>
                <div class="mode-toggle" role="tablist" aria-label="Editor mode">
                  <button
                    class="mode-tab"
                    class:active={$editorMode === 'preview'}
                    role="tab"
                    aria-selected={$editorMode === 'preview'}
                    onclick={() => editorMode.set('preview')}
                  >
                    Preview
                  </button>
                  <button
                    class="mode-tab"
                    class:active={$editorMode === 'wysiwyg'}
                    role="tab"
                    aria-selected={$editorMode === 'wysiwyg'}
                    onclick={() => editorMode.set('wysiwyg')}
                  >
                    WYSIWYG
                  </button>
                  <button
                    class="mode-tab"
                    class:active={$editorMode === 'editor'}
                    role="tab"
                    aria-selected={$editorMode === 'editor'}
                    onclick={() => editorMode.set('editor')}
                  >
                    Source
                  </button>
                </div>
                <div class="mode-toggle-spacer">
                  <div class="copy-dropdown-wrapper">
                    <button
                      class="copy-split-button"
                      onclick={copyAsMarkdown}
                      title="Copy as Markdown"
                    >
                      {#if copyFeedback}
                        <span class="material-symbols-outlined copy-icon">check</span>
                        <span class="copy-label">{copyFeedback}</span>
                      {:else}
                        <span class="material-symbols-outlined copy-icon">content_copy</span>
                        <span class="copy-label">Copy</span>
                      {/if}
                    </button>
                    <button
                      class="copy-chevron-button"
                      onclick={(e) => { e.stopPropagation(); copyDropdownOpen = !copyDropdownOpen; }}
                      aria-haspopup="true"
                      aria-expanded={copyDropdownOpen}
                      title="Copy options"
                    >
                      <span class="material-symbols-outlined copy-chevron-icon">expand_more</span>
                    </button>
                    {#if copyDropdownOpen}
                      <div class="copy-dropdown-menu" role="menu">
                        <button class="copy-dropdown-item" role="menuitem" onclick={copyAsMarkdown}>
                          <span class="material-symbols-outlined copy-menu-icon">markdown</span>
                          Copy as Markdown
                        </button>
                        <button class="copy-dropdown-item" role="menuitem" onclick={copyAsHtml}>
                          <span class="material-symbols-outlined copy-menu-icon">code</span>
                          Copy as HTML
                        </button>
                      </div>
                    {/if}
                  </div>
                  {#if $isDirty}
                    <button class="save-button" onclick={requestSave}>
                      <span>Save</span>
                      <kbd class="save-kbd"><span class="kbd-symbol">⌘</span>S</kbd>
                    </button>
                  {/if}
                </div>
              </div>
            {/if}
            {#if $editorMode === 'editor'}
              <div
                id="main-content"
                class="editor-region"
                bind:this={editorEl}
                tabindex="-1"
                role="main"
                aria-label="Source editor"
              >
                <Editor />
              </div>
            {:else if $editorMode === 'wysiwyg'}
              <div
                id="main-content"
                class="editor-region"
                bind:this={editorEl}
                tabindex="-1"
                role="main"
                aria-label="WYSIWYG editor"
              >
                <WysiwygEditor />
              </div>
            {:else}
              <div class="preview-content-region" role="main" aria-label="Preview">
                <MarkdownPreview />
              </div>
            {/if}
          </div>
          {#if propertiesOpen}
            <div class="properties-region" bind:this={propertiesEl} tabindex="-1" role="complementary" aria-label="File metadata">
              <PropertiesPanel onfileselect={(detail) => handleFileSelect({ folderId: '', fileId: detail.path })} />
            </div>
          {/if}
        {/if}
      </div>

      <StatusBar />
    </main>
  </div>

  <IngestModal />
  <QuickOpen />
</div>
{/if}

<style>
  /* Skip link for accessibility - only visible on keyboard focus */
  .skip-link {
    position: absolute;
    top: -40px;
    left: 0;
    background: var(--color-primary, #00E5FF);
    color: var(--color-surface-darker, #0a0a0a);
    padding: 8px 16px;
    text-decoration: none;
    border-radius: 4px;
    font-weight: 600;
    z-index: 1000;
    transition: top 0.2s ease-out;
  }

  .skip-link:focus {
    top: 8px;
    left: 8px;
    outline: 2px solid var(--color-text-main, #e4e4e7);
    outline-offset: 2px;
  }

  .app-shell {
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
    position: relative;
  }

  .app-shell::selection,
  .app-shell :global(::selection) {
    background: var(--color-primary, #00E5FF);
    color: var(--color-surface-darker, #0a0a0a);
  }

  .titlebar-region {
    flex-shrink: 0;
    z-index: 35;
    position: relative;
  }

  .body-region {
    flex: 1;
    display: flex;
    flex-direction: row;
    min-height: 0;
    overflow: hidden;
  }

  .sidebar-region {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .main-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    height: 100%;
    min-width: 0;
    position: relative;
    z-index: 10;
  }

  .content-area {
    flex: 1;
    display: flex;
    flex-direction: row;
    overflow: hidden;
    position: relative;
    min-height: 0;
  }

  .editor-region {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .properties-region {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .settings-region {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .graph-region {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .preview-region {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  .preview-content-region {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow: hidden;
  }

  /* ── Editor with mode tabs ─────────────────────── */

  .editor-with-tabs {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow: hidden;
  }

  .mode-toggle-bar {
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 6px 12px;
    flex-shrink: 0;
    border-bottom: 1px solid var(--color-border, #27272a);
    background: var(--color-bg, #0f0f10);
  }

  .mode-toggle-spacer {
    flex: 1;
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 8px;
  }

  .mode-toggle {
    display: flex;
    background: var(--color-surface-dark, #0a0a0a);
    border: 1px solid var(--color-border, #27272a);
    border-radius: 6px;
    padding: 2px;
    gap: 2px;
  }

  .mode-tab {
    padding: 3px 12px;
    font-size: 11px;
    font-weight: 600;
    font-family: inherit;
    color: var(--color-text-dim, #71717a);
    background: transparent;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    transition: all var(--transition-fast, 150ms ease);
    letter-spacing: 0.02em;
  }

  .mode-tab:hover {
    color: var(--color-text, #e4e4e7);
  }

  .mode-tab.active {
    background: var(--color-surface, #161617);
    color: var(--color-primary, #00E5FF);
  }

  /* ── Save button ──────────────────────────────── */

  .save-button {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    background: var(--color-primary, #00E5FF);
    color: var(--color-surface-darker, #0a0a0a);
    border: none;
    border-radius: 4px;
    font-weight: 700;
    font-size: 11px;
    cursor: pointer;
    transition: background 0.15s;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    font-family: inherit;
  }

  .save-button:hover {
    background: var(--color-primary-dark, #00B8CC);
  }

  .save-kbd {
    display: inline-flex;
    height: 16px;
    align-items: center;
    gap: 1px;
    border-radius: 3px;
    background: rgba(0, 0, 0, 0.15);
    padding: 0 4px;
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: 9px;
    font-weight: 600;
    color: var(--color-surface-darker, #0a0a0a);
    border: none;
  }

  /* ── Copy dropdown ─────────────────────────── */

  .copy-dropdown-wrapper {
    position: relative;
    display: flex;
    align-items: center;
  }

  .copy-split-button {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 8px;
    background: transparent;
    color: var(--color-text-dim, #71717a);
    border: 1px solid var(--color-border, #27272a);
    border-right: none;
    border-radius: 4px 0 0 4px;
    font-size: 11px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: all var(--transition-fast, 150ms ease);
    letter-spacing: 0.02em;
  }

  .copy-split-button:hover {
    color: var(--color-text, #e4e4e7);
    background: var(--color-surface, #161617);
  }

  .copy-icon {
    font-size: 14px;
  }

  .copy-label {
    white-space: nowrap;
  }

  .copy-chevron-button {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 4px 2px;
    background: transparent;
    color: var(--color-text-dim, #71717a);
    border: 1px solid var(--color-border, #27272a);
    border-radius: 0 4px 4px 0;
    cursor: pointer;
    transition: all var(--transition-fast, 150ms ease);
  }

  .copy-chevron-button:hover {
    color: var(--color-text, #e4e4e7);
    background: var(--color-surface, #161617);
  }

  .copy-chevron-icon {
    font-size: 16px;
  }

  .copy-dropdown-menu {
    position: absolute;
    top: 100%;
    right: 0;
    margin-top: 4px;
    min-width: 170px;
    background: var(--color-surface, #161617);
    border: 1px solid var(--color-border, #27272a);
    border-radius: 6px;
    padding: 4px;
    z-index: 100;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  }

  .copy-dropdown-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 6px 8px;
    background: transparent;
    color: var(--color-text-dim, #71717a);
    border: none;
    border-radius: 4px;
    font-size: 12px;
    font-family: inherit;
    cursor: pointer;
    transition: all var(--transition-fast, 150ms ease);
    text-align: left;
  }

  .copy-dropdown-item:hover {
    color: var(--color-text, #e4e4e7);
    background: var(--color-surface-dark, #0a0a0a);
  }

  .copy-menu-icon {
    font-size: 16px;
  }

  @media (prefers-reduced-motion: reduce) {
    .mode-tab,
    .copy-split-button,
    .copy-chevron-button,
    .copy-dropdown-item {
      transition: none;
    }
  }
</style>
