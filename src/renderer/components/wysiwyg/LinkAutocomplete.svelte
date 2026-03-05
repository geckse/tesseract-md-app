<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { computePosition, flip, shift, offset } from '@floating-ui/dom';
  import type { LinkSuggestionItem } from '../../lib/tiptap/link-autocomplete-extension';

  interface Props {
    query: string;
    command: (item: LinkSuggestionItem) => void;
    clientRect: (() => DOMRect | null) | null;
    collectionPath: string;
  }

  let { query, command, clientRect, collectionPath }: Props = $props();

  let menuEl: HTMLDivElement | undefined = $state(undefined);
  let selectedIndex = $state(0);
  let items: LinkSuggestionItem[] = $state([]);
  let loading = $state(false);
  let headingMode = $state(false);
  let selectedFile = $state('');

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let searchGeneration = 0;

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
    } else if (e.key === 'Enter') {
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
    if (!menuEl || !clientRect) return;
    const rect = clientRect();
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

  async function searchFiles(searchQuery: string): Promise<void> {
    if (!collectionPath || searchQuery.length < 1) {
      items = [];
      loading = false;
      return;
    }

    const generation = ++searchGeneration;
    loading = true;

    try {
      const result = await window.api.search(collectionPath, searchQuery, {
        mode: 'lexical',
        limit: 10,
      });

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
            label: r.file.path,
          });
        }
      }

      items = deduped;
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

    try {
      // Read target file to extract headings
      const fullPath = collectionPath + '/' + filePath;
      const content = await window.api.readFile(fullPath);
      const headings = parseHeadingsFromContent(content);

      items = headings.map((h) => ({
        path: filePath,
        anchor: h,
        label: `# ${h}`,
      }));
    } catch {
      items = [];
    } finally {
      loading = false;
    }
  }

  function selectItem(index: number) {
    const item = items[index];
    if (!item) return;

    if (!headingMode) {
      // Check if query ends with '#' to enter heading mode
      command(item);
    } else {
      command(item);
    }
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
    void clientRect;
    positionMenu();
  });

  // React to query changes with debounced search
  $effect(() => {
    const q = query;

    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }

    // Check if '#' is in the query — switch to heading browsing
    const hashIndex = q.indexOf('#');
    if (hashIndex > 0 && !headingMode) {
      const filePart = q.slice(0, hashIndex);
      // Find matching file in current items
      const match = items.find(
        (i) => i.path === filePart || i.path.endsWith('/' + filePart) || i.path.endsWith(filePart + '.md')
      );
      if (match) {
        switchToHeadingMode(match.path);
        return;
      }
    }

    if (headingMode) {
      // Filter headings by text after #
      const headingQuery = q.slice(q.indexOf('#') + 1).toLowerCase();
      if (headingQuery) {
        // Re-filter is handled by reading file, but we can filter displayed items
        items = items.filter((i) =>
          i.label.toLowerCase().includes(headingQuery)
        );
        selectedIndex = 0;
      }
      return;
    }

    if (q.length < 1) {
      items = [];
      return;
    }

    loading = true;
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      searchFiles(q);
    }, 150);
  });
</script>

<div
  class="link-autocomplete-menu"
  bind:this={menuEl}
  role="listbox"
  aria-label="Link autocomplete"
>
  {#if loading}
    <div class="link-empty">Searching...</div>
  {:else if items.length === 0}
    <div class="link-empty">{query.length < 1 ? 'Type to search files...' : 'No results'}</div>
  {:else}
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
        <span class="link-label">{item.label}</span>
      </button>
    {/each}
  {/if}
</div>

<style>
  .link-autocomplete-menu {
    position: fixed;
    z-index: var(--z-overlay, 40);
    min-width: 240px;
    max-width: 400px;
    max-height: 320px;
    overflow-y: auto;
    background: var(--color-surface, #161617);
    border: 1px solid var(--color-border, #27272a);
    border-radius: var(--radius-md, 6px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    padding: var(--space-1, 4px);
  }

  .link-item {
    display: flex;
    align-items: center;
    gap: var(--space-2, 8px);
    width: 100%;
    padding: var(--space-2, 8px) var(--space-3, 12px);
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
  }

  .link-label {
    flex: 1;
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
