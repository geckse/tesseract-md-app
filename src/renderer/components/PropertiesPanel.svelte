<script lang="ts">
  import { onDestroy } from 'svelte'
  import Badge from './ui/Badge.svelte'
  import ResizeHandle from './ResizeHandle.svelte'
  import {
    documentInfo,
    backlinksInfo,
    linksInfo,
    frontmatter,
    outline,
    propertiesLoading,
    propertiesError,
  } from '../stores/properties'
  import { selectedFilePath } from '../stores/files'
  import { scrollToLine, activeHeadingIndex } from '../stores/editor'
  import type { DocumentInfo, BacklinksOutput, LinksOutput, JsonValue } from '../types/cli'
  import type { OutlineHeading } from '../stores/properties'

  interface PropertiesPanelProps {
    onfileselect?: (detail: { path: string }) => void
  }

  let { onfileselect }: PropertiesPanelProps = $props()

  let collapsed = $state(false)

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

  function togglePanel() {
    collapsed = !collapsed
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

  const unsubs = [
    documentInfo.subscribe((v) => (currentDocInfo = v)),
    backlinksInfo.subscribe((v) => (currentBacklinks = v)),
    linksInfo.subscribe((v) => (currentLinks = v)),
    frontmatter.subscribe((v) => (currentFrontmatter = v)),
    outline.subscribe((v) => (currentOutline = v)),
    propertiesLoading.subscribe((v) => (currentLoading = v)),
    propertiesError.subscribe((v) => (currentError = v)),
    selectedFilePath.subscribe((v) => (currentFilePath = v)),
    activeHeadingIndex.subscribe((v) => (currentActiveHeadingIndex = v)),
  ]

  onDestroy(() => unsubs.forEach((u) => u()))

  // Section collapse state
  let metadataOpen = $state(true)
  let linksOpen = $state(true)
  let outlineOpen = $state(true)

  // Links tab: 'incoming' or 'outgoing'
  type LinksTab = 'incoming' | 'outgoing'
  let linksTab: LinksTab = $state('incoming')

  let incomingCount = $derived(currentBacklinks?.total_backlinks ?? 0)
  let outgoingCount = $derived(currentLinks?.links?.outgoing?.length ?? 0)

  function formatDate(timestamp: number | null | undefined): string {
    if (!timestamp) return '—'
    const date = new Date(timestamp * 1000)
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
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

<aside class="properties-panel" class:collapsed={collapsed} style="width: {collapsed ? '48px' : `${panelWidth}px`}; min-width: {collapsed ? '48px' : `${panelWidth}px`}">
  <!-- Resize handle (left edge) -->
  {#if !collapsed}
    <ResizeHandle
      position="left"
      minWidth={MIN_WIDTH}
      maxWidth={MAX_WIDTH}
      width={panelWidth}
      onresize={handleResize}
    />
  {/if}

  <!-- Panel toggle button -->
  <div class="panel-header">
    <button class="panel-toggle" onclick={togglePanel} title={collapsed ? 'Expand panel' : 'Collapse panel'}>
      <span class="material-symbols-outlined">
        {collapsed ? 'chevron_left' : 'chevron_right'}
      </span>
    </button>
    {#if !collapsed}
      <h2 class="panel-title">Properties</h2>
    {/if}
  </div>

  {#if !currentFilePath}
    <div class="empty-state">
      <span class="material-symbols-outlined empty-icon">description</span>
      {#if !collapsed}
        <span class="empty-text">Select a file to view properties</span>
      {/if}
    </div>
  {:else if currentLoading}
    <div class="empty-state">
      <span class="material-symbols-outlined empty-icon spinning">hourglass_empty</span>
      {#if !collapsed}
        <span class="empty-text">Loading...</span>
      {/if}
    </div>
  {:else if currentError}
    <div class="empty-state">
      <span class="material-symbols-outlined empty-icon error-icon">error</span>
      {#if !collapsed}
        <span class="empty-text error-text">{currentError}</span>
      {/if}
    </div>
  {:else if !collapsed}
    <!-- METADATA section -->
    <section class="panel-section">
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="section-header" onclick={() => (metadataOpen = !metadataOpen)}>
        <span class="material-symbols-outlined section-chevron" class:rotated={metadataOpen}
          >chevron_right</span
        >
        <h3 class="section-title">Metadata</h3>
      </div>

      {#if metadataOpen}
        <div class="section-content">
          {#if currentFrontmatter}
            <div class="properties-grid">
              {#each Object.entries(currentFrontmatter) as [key, value]}
                <div class="property-row">
                  <span class="property-label">{key}</span>
                  <div class="property-value">
                    {#if key.toLowerCase() === 'status' && typeof value === 'string'}
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

    <!-- LINKS section -->
    <section class="panel-section">
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="section-header" onclick={() => (linksOpen = !linksOpen)}>
        <span class="material-symbols-outlined section-chevron" class:rotated={linksOpen}
          >chevron_right</span
        >
        <h3 class="section-title">Links</h3>
        {#if incomingCount + outgoingCount > 0}
          <span class="section-count">{incomingCount + outgoingCount}</span>
        {/if}
      </div>

      {#if linksOpen}
        <div class="section-content">
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
            {#if currentBacklinks && currentBacklinks.backlinks.length > 0}
              <div class="links-list">
                {#each currentBacklinks.backlinks as link}
                  <!-- svelte-ignore a11y_click_events_have_key_events -->
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <div
                    class="link-item"
                    role="button"
                    tabindex="0"
                    onclick={() => handleBacklinkClick(link.entry.source)}
                  >
                    <span class="material-symbols-outlined link-icon">arrow_back</span>
                    <div class="link-info">
                      <span class="link-name">{getFileName(link.entry.source)}</span>
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
            {#if currentLinks && currentLinks.links.outgoing.length > 0}
              <div class="links-list">
                {#each currentLinks.links.outgoing as link}
                  <!-- svelte-ignore a11y_click_events_have_key_events -->
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <div
                    class="link-item"
                    role="button"
                    tabindex="0"
                    onclick={() => handleBacklinkClick(link.entry.target)}
                  >
                    <span class="material-symbols-outlined link-icon">arrow_forward</span>
                    <div class="link-info">
                      <span class="link-name">{getFileName(link.entry.target)}</span>
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

    <!-- OUTLINE section -->
    <section class="panel-section">
      <!-- svelte-ignore a11y_click_events_have_key_events -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="section-header" onclick={() => (outlineOpen = !outlineOpen)}>
        <span class="material-symbols-outlined section-chevron" class:rotated={outlineOpen}
          >chevron_right</span
        >
        <h3 class="section-title">Outline</h3>
      </div>

      {#if outlineOpen}
        <div class="section-content">
          {#if currentOutline.length > 0}
            <nav class="outline-list">
              {#each currentOutline as item, i}
                <!-- svelte-ignore a11y_click_events_have_key_events -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
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
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.1) transparent;
  }

  .panel-header {
    display: flex;
    align-items: center;
    gap: var(--space-2, 8px);
    padding: var(--space-3, 12px) var(--space-4, 16px);
    border-bottom: 1px solid var(--color-border, #27272a);
    min-height: 44px;
  }

  .properties-panel.collapsed .panel-header {
    justify-content: center;
    padding: var(--space-3, 12px);
  }

  .panel-toggle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 4px;
    background: none;
    border: none;
    color: var(--color-text-dim, #71717a);
    cursor: pointer;
    transition: all 0.15s ease;
    padding: 0;
  }

  .panel-toggle:hover {
    background: var(--color-surface, #161617);
    color: var(--color-primary, #00E5FF);
  }

  .panel-toggle .material-symbols-outlined {
    font-size: 18px;
  }

  @media (prefers-reduced-motion: reduce) {
    .panel-toggle {
      transition: none;
    }
  }

  .panel-title {
    font-size: var(--text-xs, 10px);
    font-weight: var(--weight-bold, 700);
    color: var(--color-text-dim, #71717a);
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin: 0;
    white-space: nowrap;
    overflow: hidden;
  }

  .properties-panel::-webkit-scrollbar {
    width: 6px;
  }
  .properties-panel::-webkit-scrollbar-track {
    background: transparent;
  }
  .properties-panel::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.1);
    border-radius: 3px;
  }
  .properties-panel::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.2);
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
  }

  .section-header:hover {
    background: rgba(255, 255, 255, 0.03);
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
    color: var(--color-primary, #00e5ff);
    margin-top: 1px;
    flex-shrink: 0;
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
</style>
