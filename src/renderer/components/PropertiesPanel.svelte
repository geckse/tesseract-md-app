<script lang="ts">
  import { onDestroy } from 'svelte'
  import Badge from './ui/Badge.svelte'
  import ResizeHandle from './ResizeHandle.svelte'
  import LocalGraph from './LocalGraph.svelte'
  import RelationChip from './RelationChip.svelte'
  import {
    documentInfo,
    backlinksInfo,
    linksInfo,
    neighborhoodInfo,
    frontmatter,
    outline,
    propertiesLoading,
    propertiesError
  } from '../stores/properties'
  import { activeCollectionId } from '../stores/collections'
  import { selectedFilePath } from '../stores/files'
  import { scrollToLine, activeHeadingIndex, isDirty } from '../stores/editor'
  import { isFavorited, toggleFavorite } from '../stores/favorites'
  import {
    graphSelectedNode,
    graphOpenedNode,
    openGraphWithNeighborhood,
    openGraphView
  } from '../stores/graph'
  import type {
    DocumentInfo,
    BacklinksOutput,
    LinksOutput,
    NeighborhoodResult,
    NeighborhoodNode,
    JsonValue
  } from '../types/cli'
  import type { OutlineHeading } from '../stores/properties'

  interface PropertiesPanelProps {
    onfileselect?: (detail: { path: string }) => void
  }

  let { onfileselect }: PropertiesPanelProps = $props()

  // Panel width management with persistence
  const STORAGE_KEY = 'propertiesPanelWidth'
  const DEFAULT_WIDTH = 288
  const MIN_WIDTH = 180
  const MAX_WIDTH = 500

  let panelWidth = $state(DEFAULT_WIDTH)

  // Load saved width from localStorage
  $effect(() => {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const parsed = parseInt(saved, 10)
      if (!isNaN(parsed)) {
        panelWidth = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, parsed))
      }
    }
  })

  function handleResize(newWidth: number) {
    panelWidth = newWidth
    localStorage.setItem(STORAGE_KEY, String(newWidth))
  }

  // Store subscriptions
  let currentDocInfo: DocumentInfo | null = $state(null)
  let currentBacklinks: BacklinksOutput | null = $state(null)
  let currentLinks: LinksOutput | null = $state(null)
  let currentFrontmatter: Record<string, JsonValue> | null = $state(null)
  let currentOutline: OutlineHeading[] = $state([])
  let currentLoading = $state(false)
  let currentError: string | null = $state(null)
  let currentFilePath: string | null = $state(null)
  let currentActiveHeadingIndex = $state(-1)

  let currentNeighborhood: NeighborhoodResult | null = $state(null)

  let currentActiveCollectionId: string | null = $state(null)
  let currentIsDirty = $state(false)
  let currentIsFavorited = $state(false)

  const unsubs = [
    documentInfo.subscribe((v) => (currentDocInfo = v)),
    backlinksInfo.subscribe((v) => (currentBacklinks = v)),
    linksInfo.subscribe((v) => (currentLinks = v)),
    neighborhoodInfo.subscribe((v) => (currentNeighborhood = v)),
    frontmatter.subscribe((v) => (currentFrontmatter = v)),
    outline.subscribe((v) => (currentOutline = v)),
    propertiesLoading.subscribe((v) => (currentLoading = v)),
    propertiesError.subscribe((v) => (currentError = v)),
    selectedFilePath.subscribe((v) => (currentFilePath = v)),
    activeHeadingIndex.subscribe((v) => (currentActiveHeadingIndex = v)),
    activeCollectionId.subscribe((v) => (currentActiveCollectionId = v)),
    isDirty.subscribe((v) => (currentIsDirty = v)),
    isFavorited.subscribe((v) => (currentIsFavorited = v))
  ]

  onDestroy(() => unsubs.forEach((u) => u()))

  // Filename derivation
  let fileName = $derived.by(() => {
    if (currentFilePath) {
      const parts = currentFilePath.split('/').filter((s: string) => s.length > 0)
      return parts.length > 0 ? parts[parts.length - 1] : null
    }
    return null
  })

  async function handleToggleFavorite() {
    if (!currentActiveCollectionId || !currentFilePath) return
    await toggleFavorite(currentActiveCollectionId, currentFilePath)
  }

  // Section collapse state
  let metadataOpen = $state(true)
  let localGraphOpen = $state(true)
  let linksOpen = $state(true)
  let referencedByOpen = $state(true)
  let outlineOpen = $state(true)

  // ── Referenced by (phase 42: reverse frontmatter relations) ───────────
  /** Long lists collapse — referenced_by is unbounded by contract. */
  const REFERENCED_BY_COLLAPSE = 50
  let showAllReferencedBy = $state(false)

  const referencedBy = $derived(currentDocInfo?.referenced_by ?? [])

  /** Entries grouped by originating field (already sorted by (source, field)). */
  const referencedByGroups = $derived.by(() => {
    const shown = showAllReferencedBy ? referencedBy : referencedBy.slice(0, REFERENCED_BY_COLLAPSE)
    const order: string[] = []
    const map = new Map<string, typeof shown>()
    for (const entry of shown) {
      if (!map.has(entry.field)) {
        map.set(entry.field, [])
        order.push(entry.field)
      }
      map.get(entry.field)!.push(entry)
    }
    return order.map((field) => ({ field, entries: map.get(field)! }))
  })

  /** Server-resolved relations for a frontmatter key (populate only). */
  function relationsFor(key: string) {
    return currentDocInfo?.relations?.[key]
  }

  function handleRelationNavigate(path: string) {
    onfileselect?.({ path })
  }

  // Links tab: 'incoming' or 'outgoing'
  type LinksTab = 'incoming' | 'outgoing'
  let linksTab: LinksTab = $state('incoming')

  let incomingCount = $derived(
    currentNeighborhood?.incoming_depth_count ?? currentBacklinks?.total_backlinks ?? 0
  )
  let outgoingCount = $derived(
    currentNeighborhood?.outgoing_depth_count ?? currentLinks?.links?.outgoing?.length ?? 0
  )
  let neighborCount = $derived(incomingCount + outgoingCount)

  function expandToFullGraph() {
    if (!currentFilePath) return
    const nh = currentNeighborhood
    const hasNeighbors = nh && (nh.outgoing?.length ?? 0) + (nh.incoming?.length ?? 0) > 0
    if (hasNeighbors) {
      openGraphWithNeighborhood(currentFilePath, nh)
    } else {
      // No local neighborhood — open full graph with this file selected
      openGraphView()
      const node = {
        id: currentFilePath,
        path: currentFilePath,
        label: null,
        cluster_id: null,
        chunk_index: null
      }
      graphSelectedNode.set(node)
      graphOpenedNode.set(node)
    }
  }

  function formatDate(timestamp: number | null | undefined): string {
    if (!timestamp) return '—'
    const date = new Date(timestamp * 1000)
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    }).format(date)
  }

  function formatValue(value: JsonValue): string {
    if (value === null) return '—'
    if (typeof value === 'string') return value
    if (typeof value === 'number' || typeof value === 'boolean') return String(value)
    if (Array.isArray(value)) return value.map(formatValue).join(', ')
    return JSON.stringify(value)
  }

  function isArrayValue(value: JsonValue): value is JsonValue[] {
    return Array.isArray(value)
  }

  function getFileName(path: string): string {
    const parts = path.split('/')
    return parts[parts.length - 1]
  }

  function handleBacklinkClick(path: string) {
    onfileselect?.({ path })
  }

  function handleOutlineClick(heading: OutlineHeading) {
    scrollToLine.set(heading.line)
  }

  /** Pick a badge variant based on common status values. */
  function statusVariant(value: string): 'primary' | 'success' | 'warning' | 'info' | 'default' {
    const lower = value.toLowerCase()
    if (lower.includes('progress') || lower.includes('active')) return 'primary'
    if (lower.includes('done') || lower.includes('complete') || lower.includes('published'))
      return 'success'
    if (lower.includes('draft') || lower.includes('review')) return 'warning'
    if (lower.includes('archived') || lower.includes('deprecated')) return 'info'
    return 'default'
  }
</script>

<aside class="properties-panel" style="width: {panelWidth}px; min-width: {panelWidth}px">
  <ResizeHandle
    position="left"
    minWidth={MIN_WIDTH}
    maxWidth={MAX_WIDTH}
    width={panelWidth}
    onresize={handleResize}
  />

  <!-- File name + favorite -->
  {#if fileName}
    <div class="file-header">
      <span class="file-name"
        >{fileName}{#if currentIsDirty}<span class="dirty-indicator"> ●</span>{/if}</span
      >
      <button
        class="star-button"
        title={currentIsFavorited ? 'Remove from favorites' : 'Add to favorites'}
        onclick={handleToggleFavorite}
      >
        <span class="material-symbols-outlined" class:filled={currentIsFavorited}>star</span>
      </button>
    </div>
  {/if}

  {#if !currentFilePath}
    <div class="empty-state">
      <span class="material-symbols-outlined empty-icon">description</span>
      <span class="empty-text">Select a file to view properties</span>
    </div>
  {:else if currentLoading}
    <div class="empty-state">
      <span class="material-symbols-outlined empty-icon spinning">hourglass_empty</span>
      <span class="empty-text">Loading...</span>
    </div>
  {:else if currentError}
    <div class="empty-state">
      <span class="material-symbols-outlined empty-icon error-icon">error</span>
      <span class="empty-text error-text">{currentError}</span>
    </div>
  {:else}
    <!-- METADATA section -->
    <section class="panel-section">
      <button
        type="button"
        class="section-header"
        aria-expanded={metadataOpen}
        aria-controls="properties-frontmatter"
        onclick={() => (metadataOpen = !metadataOpen)}
      >
        <span
          class="material-symbols-outlined section-chevron"
          class:rotated={metadataOpen}
          aria-hidden="true">chevron_right</span
        >
        <span class="section-title">Frontmatter</span>
      </button>

      {#if metadataOpen}
        <div id="properties-frontmatter" class="section-content">
          {#if currentFrontmatter}
            <div class="properties-grid">
              {#each Object.entries(currentFrontmatter) as [key, value]}
                {@const keyRelations = relationsFor(key)}
                <div class="property-row">
                  <span class="property-label">{key}</span>
                  <div class="property-value">
                    {#if keyRelations && keyRelations.length > 0}
                      <div class="tags-list">
                        {#each keyRelations as relation, i (i)}
                          <RelationChip
                            {relation}
                            raw={relation.raw}
                            onnavigate={handleRelationNavigate}
                          />
                        {/each}
                      </div>
                    {:else if key.toLowerCase() === 'status' && typeof value === 'string'}
                      <Badge variant={statusVariant(value)}>{value}</Badge>
                    {:else if key.toLowerCase() === 'tags' && isArrayValue(value)}
                      <div class="tags-list">
                        {#each value as tag}
                          <Badge variant="default">{formatValue(tag)}</Badge>
                        {/each}
                      </div>
                    {:else}
                      <span class="value-text">{formatValue(value)}</span>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          {:else}
            <span class="muted-text">No frontmatter</span>
          {/if}

          <!-- Dates -->
          <div class="properties-grid dates-grid">
            <div class="property-row">
              <span class="property-label">Modified</span>
              <span class="value-text">{formatDate(currentDocInfo?.modified_at)}</span>
            </div>
            <div class="property-row">
              <span class="property-label">Indexed</span>
              <span class="value-text">{formatDate(currentDocInfo?.indexed_at)}</span>
            </div>
          </div>
        </div>
      {/if}
    </section>

    <!-- LOCAL GRAPH section -->
    <section class="panel-section">
      <div class="section-header section-header-group">
        <button
          type="button"
          class="section-toggle"
          aria-expanded={localGraphOpen}
          aria-controls="properties-local-graph"
          onclick={() => (localGraphOpen = !localGraphOpen)}
        >
          <span
            class="material-symbols-outlined section-chevron"
            class:rotated={localGraphOpen}
            aria-hidden="true">chevron_right</span
          >
          <span class="section-title">Local Graph</span>
          {#if neighborCount > 0}
            <span class="section-count">{neighborCount}</span>
          {/if}
        </button>
        <button
          type="button"
          class="expand-button"
          title="Open full graph view"
          onclick={expandToFullGraph}
        >
          <span class="material-symbols-outlined" aria-hidden="true">open_in_full</span>
        </button>
      </div>

      {#if localGraphOpen}
        <div id="properties-local-graph" class="graph-section-content">
          <LocalGraph
            centerPath={currentFilePath}
            linksInfo={currentLinks}
            backlinksInfo={currentBacklinks}
            {onfileselect}
            onexpand={expandToFullGraph}
          />
        </div>
      {/if}
    </section>

    <!-- LINKS section -->
    <section class="panel-section">
      <button
        type="button"
        class="section-header"
        aria-expanded={linksOpen}
        aria-controls="properties-links"
        onclick={() => (linksOpen = !linksOpen)}
      >
        <span
          class="material-symbols-outlined section-chevron"
          class:rotated={linksOpen}
          aria-hidden="true">chevron_right</span
        >
        <span class="section-title">Links</span>
        {#if incomingCount + outgoingCount > 0}
          <span class="section-count">{incomingCount + outgoingCount}</span>
        {/if}
      </button>

      {#if linksOpen}
        <div id="properties-links" class="section-content">
          <!-- Tabs -->
          <div class="links-tabs">
            <button
              class="links-tab"
              class:active={linksTab === 'incoming'}
              onclick={() => (linksTab = 'incoming')}
            >
              Incoming
              {#if incomingCount > 0}
                <span class="tab-count">{incomingCount}</span>
              {/if}
            </button>
            <button
              class="links-tab"
              class:active={linksTab === 'outgoing'}
              onclick={() => (linksTab = 'outgoing')}
            >
              Outgoing
              {#if outgoingCount > 0}
                <span class="tab-count">{outgoingCount}</span>
              {/if}
            </button>
          </div>

          <!-- Incoming (backlinks) -->
          {#if linksTab === 'incoming'}
            {#if currentNeighborhood?.incoming?.length > 0}
              <div class="links-list">
                {#each currentNeighborhood.incoming as node}
                  {@render neighborhoodTreeNode(node, 'in', 0)}
                {/each}
              </div>
            {:else if currentBacklinks && currentBacklinks.backlinks.length > 0}
              <div class="links-list">
                {#each currentBacklinks.backlinks as link}
                  <!-- svelte-ignore a11y_click_events_have_key_events -->
                  <div
                    class="link-item"
                    role="button"
                    tabindex="0"
                    onclick={() => handleBacklinkClick(link.entry.source)}
                  >
                    <span class="material-symbols-outlined link-icon link-icon-in">arrow_back</span>
                    <div class="link-info">
                      <span class="link-name">
                        {getFileName(link.entry.source)}
                        {#if link.entry.field}
                          <span
                            class="field-tag"
                            title="Frontmatter relation via `{link.entry.field}`"
                            >{link.entry.field}</span
                          >
                        {/if}
                      </span>
                      {#if link.entry.text}
                        <span class="link-snippet">{link.entry.text}</span>
                      {/if}
                    </div>
                  </div>
                {/each}
              </div>
            {:else}
              <span class="muted-text">No incoming links</span>
            {/if}
          {/if}

          <!-- Outgoing -->
          {#if linksTab === 'outgoing'}
            {#if currentNeighborhood?.outgoing?.length > 0}
              <div class="links-list">
                {#each currentNeighborhood.outgoing as node}
                  {@render neighborhoodTreeNode(node, 'out', 0)}
                {/each}
              </div>
            {:else if currentLinks && currentLinks.links.outgoing.length > 0}
              <div class="links-list">
                {#each currentLinks.links.outgoing as link}
                  <!-- svelte-ignore a11y_click_events_have_key_events -->
                  <div
                    class="link-item"
                    role="button"
                    tabindex="0"
                    onclick={() => handleBacklinkClick(link.entry.target)}
                  >
                    <span class="material-symbols-outlined link-icon link-icon-out"
                      >arrow_forward</span
                    >
                    <div class="link-info">
                      <span class="link-name">
                        {getFileName(link.entry.target)}
                        {#if link.entry.field}
                          <span
                            class="field-tag"
                            title="Frontmatter relation via `{link.entry.field}`"
                            >{link.entry.field}</span
                          >
                        {/if}
                      </span>
                      {#if link.entry.text}
                        <span class="link-snippet">{link.entry.text}</span>
                      {/if}
                    </div>
                  </div>
                {/each}
              </div>
            {:else}
              <span class="muted-text">No outgoing links</span>
            {/if}
          {/if}
        </div>
      {/if}
    </section>

    <!-- REFERENCED BY section (phase 42: reverse frontmatter relations).
         Distinct from Backlinks: "Referenced by" lists documents whose
         FRONTMATTER points here; Backlinks lists body links. -->
    {#if referencedBy.length > 0}
      <section class="panel-section">
        <button
          type="button"
          class="section-header"
          aria-expanded={referencedByOpen}
          aria-controls="properties-referenced-by"
          onclick={() => (referencedByOpen = !referencedByOpen)}
        >
          <span
            class="material-symbols-outlined section-chevron"
            class:rotated={referencedByOpen}
            aria-hidden="true">chevron_right</span
          >
          <span class="section-title">Referenced by</span>
          <span class="section-count">{referencedBy.length}</span>
        </button>

        {#if referencedByOpen}
          <div id="properties-referenced-by" class="section-content">
            <span class="muted-text refby-hint"
              >Documents whose frontmatter points here (body links are under Links).</span
            >
            {#each referencedByGroups as group (group.field)}
              <div class="refby-group">
                <span class="refby-field">{group.field}</span>
                <div class="links-list">
                  {#each group.entries as entry, i (`${entry.source} ${i}`)}
                    <!-- svelte-ignore a11y_click_events_have_key_events -->
                    <div
                      class="link-item"
                      role="button"
                      tabindex="0"
                      onclick={() => handleBacklinkClick(entry.source)}
                    >
                      <span class="material-symbols-outlined link-icon link-icon-in"
                        >account_tree</span
                      >
                      <div class="link-info">
                        <span class="link-name">{entry.title}</span>
                        <span class="link-snippet">{entry.source}</span>
                      </div>
                    </div>
                  {/each}
                </div>
              </div>
            {/each}
            {#if !showAllReferencedBy && referencedBy.length > REFERENCED_BY_COLLAPSE}
              <button class="refby-show-all" onclick={() => (showAllReferencedBy = true)}>
                Show all ({referencedBy.length})
              </button>
            {/if}
          </div>
        {/if}
      </section>
    {/if}

    <!-- OUTLINE section -->
    <section class="panel-section">
      <button
        type="button"
        class="section-header"
        aria-expanded={outlineOpen}
        aria-controls="properties-outline"
        onclick={() => (outlineOpen = !outlineOpen)}
      >
        <span
          class="material-symbols-outlined section-chevron"
          class:rotated={outlineOpen}
          aria-hidden="true">chevron_right</span
        >
        <span class="section-title">Outline</span>
      </button>

      {#if outlineOpen}
        <div id="properties-outline" class="section-content">
          {#if currentOutline.length > 0}
            <nav class="outline-list">
              {#each currentOutline as item, i}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <div
                  class="outline-item"
                  class:active={i === currentActiveHeadingIndex}
                  style="padding-left: {(item.level - 1) * 12}px"
                  role="button"
                  tabindex="0"
                  onclick={() => handleOutlineClick(item)}
                >
                  <span class="outline-text">{item.heading}</span>
                </div>
              {/each}
            </nav>
          {:else}
            <span class="muted-text">No headings</span>
          {/if}
        </div>
      {/if}
    </section>
  {/if}

  {#snippet neighborhoodTreeNode(node: NeighborhoodNode, direction: 'in' | 'out', depth: number)}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      class="link-item"
      class:depth-1={depth === 1}
      class:depth-2={depth >= 2}
      role="button"
      tabindex="0"
      style="padding-left: {8 + depth * 14}px"
      onclick={() => node.state === 'Valid' && handleBacklinkClick(node.path)}
    >
      <span
        class="material-symbols-outlined link-icon {direction === 'in'
          ? 'link-icon-in'
          : 'link-icon-out'}"
      >
        {direction === 'in' ? 'arrow_back' : 'arrow_forward'}
      </span>
      <div class="link-info">
        <span class="link-name" class:broken-link={node.state !== 'Valid'}>
          {getFileName(node.path)}
          {#if node.state !== 'Valid'}
            <span class="broken-badge">broken</span>
          {/if}
        </span>
      </div>
    </div>
    {#if node.children.length > 0}
      {#each node.children as child}
        {@render neighborhoodTreeNode(child, direction, depth + 1)}
      {/each}
    {/if}
  {/snippet}
</aside>

<style>
  .properties-panel {
    position: relative;
    background: var(--color-surface-dark, #0a0a0a);
    border-left: 1px solid var(--color-border, #27272a);
    overflow-y: auto;
    overflow-x: hidden;
    display: flex;
    flex-direction: column;
    height: 100%;
    scrollbar-width: thin;
    scrollbar-color: var(--overlay-active, rgba(255, 255, 255, 0.1)) transparent;
  }

  .properties-panel::-webkit-scrollbar {
    width: 6px;
  }
  .properties-panel::-webkit-scrollbar-track {
    background: transparent;
  }
  .properties-panel::-webkit-scrollbar-thumb {
    background: var(--overlay-active, rgba(255, 255, 255, 0.1));
    border-radius: 3px;
  }
  .properties-panel::-webkit-scrollbar-thumb:hover {
    background: var(--overlay-active, rgba(255, 255, 255, 0.2));
  }

  /* File header */
  .file-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px 16px;
    border-bottom: 1px solid var(--color-border, #27272a);
    flex-shrink: 0;
  }

  .file-name {
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: 12px;
    font-weight: 600;
    color: var(--color-text, #e4e4e7);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
    min-width: 0;
  }

  .dirty-indicator {
    color: var(--color-warning, #f59e0b);
  }

  .star-button {
    padding: 2px;
    margin-left: 4px;
    color: var(--color-text-dim, #71717a);
    background: none;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .star-button:hover {
    color: var(--color-primary, #00e5ff);
    background: var(--color-surface, #161617);
  }

  .star-button .material-symbols-outlined {
    font-size: 16px;
  }

  .star-button .material-symbols-outlined.filled {
    font-variation-settings:
      'FILL' 1,
      'wght' 400,
      'GRAD' 0,
      'opsz' 20;
    color: var(--color-primary, #00e5ff);
  }

  /* Empty / loading / error states */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: var(--space-8, 32px) var(--space-4, 16px);
    gap: var(--space-2, 8px);
    flex: 1;
  }

  .empty-icon {
    font-size: 32px;
    color: var(--color-text-dim, #71717a);
    opacity: 0.5;
  }

  .empty-text {
    font-size: var(--text-sm, 12px);
    color: var(--color-text-dim, #71717a);
    text-align: center;
  }

  .error-icon {
    color: var(--color-error, #ef4444);
    opacity: 0.7;
  }

  .error-text {
    color: var(--color-error, #ef4444);
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  .spinning {
    animation: spin 1.2s linear infinite;
  }

  /* Section layout */
  .panel-section {
    border-bottom: 1px solid var(--color-border, #27272a);
  }

  .section-header {
    display: flex;
    align-items: center;
    gap: var(--space-2, 8px);
    padding: var(--space-3, 12px) var(--space-4, 16px);
    cursor: pointer;
    transition: background var(--transition-fast, 150ms ease);
    width: 100%;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
  }

  .section-header:hover {
    background: var(--overlay-hover, rgba(255, 255, 255, 0.03));
  }

  .section-header-group {
    cursor: default;
  }

  .section-toggle {
    display: flex;
    align-items: center;
    gap: var(--space-2, 8px);
    flex: 1;
    min-width: 0;
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .section-chevron {
    font-size: 16px;
    color: var(--color-text-dim, #71717a);
    transition: transform var(--transition-fast, 150ms ease);
  }

  .section-chevron.rotated {
    transform: rotate(90deg);
  }

  .section-title {
    font-size: var(--text-xs, 10px);
    font-weight: var(--weight-bold, 700);
    color: var(--color-text-dim, #71717a);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin: 0;
    flex: 1;
  }

  .section-count {
    font-size: var(--text-xs, 10px);
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    color: var(--color-text-dim, #71717a);
    background: var(--color-surface, #161617);
    padding: 1px 6px;
    border-radius: var(--radius-full, 9999px);
    border: 1px solid var(--color-border, #27272a);
  }

  .section-content {
    padding: 0 var(--space-4, 16px) var(--space-4, 16px);
  }

  .graph-section-content {
    padding: 0 0 var(--space-4, 16px);
  }

  .expand-button {
    padding: 2px;
    color: var(--color-text-dim, #71717a);
    background: none;
    border: none;
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .expand-button:hover {
    color: var(--color-primary, #00e5ff);
    background: var(--color-surface, #161617);
  }

  .expand-button .material-symbols-outlined {
    font-size: 16px;
  }

  /* Properties grid */
  .properties-grid {
    display: flex;
    flex-direction: column;
    gap: var(--space-3, 12px);
  }

  .dates-grid {
    margin-top: var(--space-3, 12px);
    padding-top: var(--space-3, 12px);
    border-top: 1px solid var(--color-border, #27272a);
  }

  .property-row {
    display: flex;
    flex-direction: column;
    gap: var(--space-1, 4px);
  }

  .property-label {
    font-size: var(--text-xs, 10px);
    font-weight: var(--weight-medium, 500);
    color: var(--color-text-dim, #71717a);
    text-transform: capitalize;
  }

  .property-value {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1, 4px);
  }

  .value-text {
    font-size: var(--text-sm, 12px);
    color: var(--color-text, #e4e4e7);
  }

  .tags-list {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1, 4px);
  }

  .muted-text {
    font-size: var(--text-sm, 12px);
    color: var(--color-text-dim, #71717a);
    font-style: italic;
  }

  /* Links tabs */
  .links-tabs {
    display: flex;
    gap: 2px;
    margin-bottom: var(--space-3, 12px);
    background: var(--color-surface, #161617);
    border-radius: var(--radius-md, 6px);
    padding: 2px;
  }

  .links-tab {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-1, 4px);
    padding: var(--space-1, 4px) var(--space-2, 8px);
    border: none;
    background: none;
    border-radius: var(--radius-sm, 4px);
    font-size: var(--text-xs, 10px);
    font-weight: var(--weight-medium, 500);
    font-family: inherit;
    color: var(--color-text-dim, #71717a);
    cursor: pointer;
    transition: all var(--transition-fast, 150ms ease);
  }

  .links-tab:hover {
    color: var(--color-text, #e4e4e7);
  }

  .links-tab.active {
    background: var(--color-surface-dark, #0a0a0a);
    color: var(--color-text, #e4e4e7);
  }

  .tab-count {
    font-size: var(--text-xs, 10px);
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    color: var(--color-text-dim, #71717a);
    opacity: 0.7;
  }

  /* Link items */
  .links-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-1, 4px);
  }

  .link-item {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2, 8px);
    padding: var(--space-2, 8px);
    border-radius: var(--radius-md, 6px);
    cursor: pointer;
    transition: background var(--transition-fast, 150ms ease);
  }

  .link-item:hover {
    background: var(--color-surface, #161617);
  }

  .link-icon {
    font-size: 16px;
    margin-top: 1px;
    flex-shrink: 0;
  }

  .link-icon-in {
    color: var(--color-edge-in, #ff6b6b);
  }

  .link-icon-out {
    color: var(--color-edge-out, #00e5ff);
  }

  .link-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .link-name {
    font-size: var(--text-sm, 12px);
    color: var(--color-text, #e4e4e7);
    font-weight: var(--weight-medium, 500);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .link-snippet {
    font-size: var(--text-xs, 10px);
    color: var(--color-text-dim, #71717a);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Frontmatter-relation tag on link entries (phase 42) */
  .field-tag {
    display: inline-block;
    margin-left: 4px;
    padding: 0 5px;
    border-radius: var(--radius-full, 9999px);
    border: 1px solid var(--color-border, #27272a);
    color: var(--color-text-dim, #71717a);
    font-size: 9px;
    font-family: var(--font-mono, 'JetBrains Mono'), monospace;
    vertical-align: middle;
  }

  /* Referenced by (phase 42) */
  .refby-hint {
    display: block;
    margin-bottom: 6px;
    font-size: var(--text-xs, 10px);
  }

  .refby-group {
    margin-bottom: 8px;
  }

  .refby-field {
    display: block;
    margin-bottom: 2px;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--color-text-dim, #71717a);
    font-family: var(--font-mono, 'JetBrains Mono'), monospace;
  }

  .refby-show-all {
    background: none;
    border: none;
    color: var(--color-primary, #00e5ff);
    font-size: var(--text-xs, 11px);
    cursor: pointer;
    padding: 4px 0;
  }

  .refby-show-all:hover {
    text-decoration: underline;
  }

  /* Outline */
  .outline-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .outline-item {
    padding: var(--space-1, 4px) var(--space-2, 8px);
    border-radius: var(--radius-sm, 4px);
    cursor: pointer;
    transition: background var(--transition-fast, 150ms ease);
  }

  .outline-item:hover {
    background: var(--color-surface, #161617);
  }

  .outline-text {
    font-size: var(--text-sm, 12px);
    color: var(--color-text-dim, #71717a);
    transition: color var(--transition-fast, 150ms ease);
  }

  .outline-item:hover .outline-text {
    color: var(--color-text, #e4e4e7);
  }

  .outline-item.active .outline-text {
    color: var(--color-primary, #00e5ff);
    font-weight: var(--weight-medium, 500);
  }

  /* Neighborhood tree depth styles */
  .link-item.depth-1 .link-name,
  .link-item.depth-2 .link-name {
    font-size: var(--text-xs, 10px);
  }

  .link-item.depth-1 .link-icon,
  .link-item.depth-2 .link-icon {
    font-size: 14px;
  }

  .link-item.depth-2 {
    opacity: 0.6;
  }

  .broken-link {
    color: var(--color-text-dim, #71717a);
    text-decoration: line-through;
  }

  .broken-badge {
    font-size: 9px;
    color: var(--color-warning, #f59e0b);
    margin-left: 4px;
    font-weight: 400;
    font-style: italic;
  }
</style>
