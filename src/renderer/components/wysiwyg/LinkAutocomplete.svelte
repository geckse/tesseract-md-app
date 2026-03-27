<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { computePosition, flip, shift, offset } from '@floating-ui/dom';
  import type { LinkSuggestionItem } from '../../lib/tiptap/link-autocomplete-extension';
  import { linkAutocompleteState as state } from '../../lib/tiptap/link-autocomplete-state.svelte';
  import type { SearchResultFile } from '../../types/cli';

  let menuEl: HTMLDivElement | undefined = $state(undefined);
  let selectedIndex = $state(0);
  let items: LinkSuggestionItem[] = $state([]);
  let loading = $state(false);
  let headingMode = $state(false);
  let selectedFile = $state('');
  let allHeadings: LinkSuggestionItem[] = [];
  let resultSource: 'recent' | 'search' | 'heading' = $state('recent');

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let searchGeneration = 0;

  /**
   * Extract a human-readable title from a file's metadata.
   */
  function extractTitle(file: SearchResultFile): string {
    if (file.frontmatter && typeof file.frontmatter === 'object' && !Array.isArray(file.frontmatter)) {
      const title = (file.frontmatter as Record<string, unknown>).title;
      if (typeof title === 'string' && title.trim()) return title.trim();
    }
    const filename = file.path.split('/').pop() ?? file.path;
    return filename.replace(/\.md$/i, '').replace(/[-_]/g, ' ');
  }

  /**
   * Extract a friendly name from a file path (for recents where we don't have frontmatter).
   */
  function fileNameToTitle(filePath: string): string {
    const filename = filePath.split('/').pop() ?? filePath;
    return filename.replace(/\.md$/i, '').replace(/[-_]/g, ' ');
  }

  function handleKeyDown(event: Event) {
    const e = event as KeyboardEvent;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (items.length > 0) {
        selectedIndex = (selectedIndex + 1) % items.length;
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (items.length > 0) {
        selectedIndex = (selectedIndex - 1 + items.length) % items.length;
      }
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      if (items[selectedIndex]) {
        selectItem(selectedIndex);
      }
    }
  }

  function handleDismiss() {
    // Handled by suggestion plugin onExit
  }

  function positionMenu() {
    if (!menuEl || !state.clientRect) return;
    const rect = state.clientRect();
    if (!rect) return;

    const virtualEl = {
      getBoundingClientRect: () => rect,
    };

    computePosition(virtualEl as Element, menuEl, {
      placement: 'bottom-start',
      middleware: [offset(8), flip(), shift({ padding: 8 })],
    }).then(({ x, y }) => {
      if (menuEl) {
        menuEl.style.left = `${x}px`;
        menuEl.style.top = `${y}px`;
      }
    });
  }

  /**
   * Load recently opened files as default suggestions.
   */
  async function loadRecentFiles(): Promise<void> {
    if (!state.collectionPath) {
      items = [];
      return;
    }

    const generation = ++searchGeneration;
    loading = true;

    try {
      const recents = await window.api.listRecents();

      if (generation !== searchGeneration) return;

      // Filter to current collection
      const filtered = recents
        .filter((r) => r.collectionId === state.collectionId)
        .slice(0, 8);

      if (filtered.length > 0) {
        items = filtered.map((r) => ({
          path: r.filePath,
          label: fileNameToTitle(r.filePath),
          subtitle: r.filePath,
        }));
        resultSource = 'recent';
      } else {
        // Fallback: show files from the tree
        try {
          const tree = await window.api.tree(state.collectionPath);
          if (generation !== searchGeneration) return;

          const flatFiles: LinkSuggestionItem[] = [];
          function flatten(node: typeof tree.root) {
            if (!node.is_dir && node.path) {
              flatFiles.push({
                path: node.path,
                label: fileNameToTitle(node.path),
                subtitle: node.path,
              });
            }
            if (node.children) {
              for (const child of node.children) {
                if (flatFiles.length >= 10) return;
                flatten(child);
              }
            }
          }
          flatten(tree.root);
          items = flatFiles;
          resultSource = 'recent';
        } catch {
          items = [];
        }
      }
    } catch {
      if (generation !== searchGeneration) return;
      items = [];
    } finally {
      if (generation === searchGeneration) {
        loading = false;
      }
    }
  }

  /**
   * Search files via CLI with hybrid mode (falls back to lexical).
   */
  async function searchFiles(searchQuery: string): Promise<void> {
    if (!state.collectionPath || searchQuery.length < 1) {
      items = [];
      loading = false;
      return;
    }

    const generation = ++searchGeneration;
    loading = true;

    try {
      let result;
      try {
        result = await window.api.search(state.collectionPath, searchQuery, {
          mode: 'hybrid',
          limit: 10,
        });
      } catch {
        // Fallback: hybrid requires embeddings; lexical always works
        result = await window.api.search(state.collectionPath, searchQuery, {
          mode: 'lexical',
          limit: 10,
        });
      }

      // Ignore stale results
      if (generation !== searchGeneration) return;

      // Deduplicate by file path
      const seen = new Set<string>();
      const deduped: LinkSuggestionItem[] = [];
      for (const r of result.results) {
        if (!seen.has(r.file.path)) {
          seen.add(r.file.path);
          deduped.push({
            path: r.file.path,
            label: extractTitle(r.file),
            subtitle: r.file.path,
          });
        }
      }

      items = deduped;
      resultSource = 'search';
    } catch {
      if (generation !== searchGeneration) return;
      items = [];
    } finally {
      if (generation === searchGeneration) {
        loading = false;
      }
    }
  }

  function parseHeadingsFromContent(content: string): string[] {
    const headings: string[] = [];
    const lines = content.split('\n');
    for (const line of lines) {
      const match = line.match(/^#{1,6}\s+(.+)/);
      if (match) {
        headings.push(match[1].trim());
      }
    }
    return headings;
  }

  async function switchToHeadingMode(filePath: string): Promise<void> {
    selectedFile = filePath;
    headingMode = true;
    loading = true;
    selectedIndex = 0;
    resultSource = 'heading';

    try {
      const fullPath = state.collectionPath + '/' + filePath;
      const content = await window.api.readFile(fullPath);
      const headings = parseHeadingsFromContent(content);

      allHeadings = headings.map((h) => ({
        path: filePath,
        anchor: h,
        label: `# ${h}`,
      }));
      items = allHeadings;
    } catch {
      items = [];
    } finally {
      loading = false;
    }
  }

  function selectItem(index: number) {
    const item = items[index];
    if (!item || !state.command) return;
    state.command(item);
  }

  onMount(() => {
    positionMenu();
    const parent = menuEl?.parentElement;
    if (parent) {
      parent.addEventListener('keydown', handleKeyDown);
      parent.addEventListener('link-dismiss', handleDismiss);
    }
  });

  onDestroy(() => {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }
    searchGeneration++;
    const parent = menuEl?.parentElement;
    if (parent) {
      parent.removeEventListener('keydown', handleKeyDown);
      parent.removeEventListener('link-dismiss', handleDismiss);
    }
  });

  // Re-position when clientRect changes
  $effect(() => {
    void state.clientRect;
    positionMenu();
  });

  // Scroll selected item into view
  $effect(() => {
    void selectedIndex;
    const el = menuEl?.querySelector('.link-item.selected');
    el?.scrollIntoView({ block: 'nearest' });
  });

  // React to query changes with debounced search
  $effect(() => {
    const q = state.query;

    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }

    // Check if '#' is in the query — switch to heading browsing
    const hashIndex = q.indexOf('#');
    if (hashIndex > 0 && !headingMode) {
      const filePart = q.slice(0, hashIndex).toLowerCase().replace(/\.md$/i, '');
      const match = items.find((i) => {
        const normalized = i.path.toLowerCase().replace(/\.md$/i, '');
        const nameOnly = normalized.split('/').pop() ?? '';
        return normalized === filePart ||
               nameOnly === filePart ||
               normalized.endsWith('/' + filePart);
      });
      if (match) {
        switchToHeadingMode(match.path);
        return;
      }
    }

    if (headingMode) {
      // Filter headings by text after #
      const headingQuery = q.slice(q.indexOf('#') + 1).toLowerCase();
      if (headingQuery) {
        items = allHeadings.filter((i) =>
          i.label.toLowerCase().includes(headingQuery)
        );
      } else {
        items = allHeadings;
      }
      selectedIndex = 0;
      return;
    }

    // Empty query: show recent files
    if (q.length < 1) {
      loadRecentFiles();
      return;
    }

    loading = true;
    selectedIndex = 0;
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      searchFiles(q);
    }, 150);
  });
</script>

<div
  class="link-autocomplete-menu"
  bind:this={menuEl}
  role="combobox"
  aria-label="Link autocomplete"
  aria-expanded="true"
  aria-haspopup="listbox"
  aria-controls="link-autocomplete-listbox"
>
  {#if loading}
    <div class="link-empty">Searching...</div>
  {:else if items.length === 0}
    <div class="link-empty">{state.query.length < 1 ? 'No recent files' : 'No results'}</div>
  {:else}
    {#if resultSource === 'recent' && state.query.length < 1}
      <div class="link-section-header">Recent</div>
    {:else if resultSource === 'heading'}
      <div class="link-section-header">Headings in {fileNameToTitle(selectedFile)}</div>
    {/if}
    {#each items as item, index}
      <button
        class="link-item"
        class:selected={index === selectedIndex}
        role="option"
        aria-selected={index === selectedIndex}
        onclick={() => selectItem(index)}
        onmouseenter={() => { selectedIndex = index; }}
      >
        <span class="link-icon material-symbols-outlined">
          {headingMode ? 'tag' : 'description'}
        </span>
        <span class="link-text">
          <span class="link-label">{item.label}</span>
          {#if item.subtitle && item.subtitle !== item.label}
            <span class="link-subtitle">{item.subtitle}</span>
          {/if}
        </span>
      </button>
    {/each}
  {/if}
</div>

<style>
  .link-autocomplete-menu {
    position: fixed;
    z-index: var(--z-overlay, 40);
    min-width: 260px;
    max-width: 420px;
    max-height: 360px;
    overflow-y: auto;
    background: var(--color-surface, #161617);
    border: 1px solid var(--color-border, #27272a);
    border-radius: var(--radius-md, 6px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    padding: var(--space-1, 4px);
  }

  .link-section-header {
    padding: 4px 12px 2px;
    font-size: 11px;
    font-weight: 500;
    color: var(--color-text-dim, #71717a);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    user-select: none;
  }

  .link-item {
    display: flex;
    align-items: center;
    gap: var(--space-2, 8px);
    width: 100%;
    padding: 6px var(--space-3, 12px);
    border: none;
    border-radius: var(--radius-sm, 4px);
    background: transparent;
    color: var(--color-text, #e4e4e7);
    font-size: var(--text-sm, 13px);
    cursor: pointer;
    text-align: left;
    transition: background-color var(--transition-fast, 150ms ease);
  }

  .link-item:hover,
  .link-item.selected {
    background: var(--color-border, #27272a);
  }

  .link-icon {
    font-size: 18px;
    color: var(--color-text-secondary, #a1a1aa);
    width: 20px;
    text-align: center;
    flex-shrink: 0;
    align-self: flex-start;
    margin-top: 1px;
  }

  .link-text {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-width: 0;
    gap: 1px;
  }

  .link-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .link-subtitle {
    font-size: 11px;
    color: var(--color-text-dim, #71717a);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .link-empty {
    padding: var(--space-2, 8px) var(--space-3, 12px);
    color: var(--color-text-secondary, #a1a1aa);
    font-size: var(--text-sm, 13px);
  }

  @media (prefers-reduced-motion: reduce) {
    .link-item {
      transition: none;
    }
  }
</style>
