<script lang="ts">
  import { workspace } from '../../stores/workspace.svelte'
  import { tableStore, type TableRowGroup } from '../../stores/table.svelte'

  interface Props {
    tabId: string
    group: TableRowGroup
    width: number
  }
  let { tabId, group, width }: Props = $props()

  const collapsed = $derived(tableStore.mergedConfig(tabId).collapsedGroups.includes(group.value))

  function toggle(): void {
    const current = tableStore.mergedConfig(tabId).collapsedGroups
    const next = current.includes(group.value)
      ? current.filter((g) => g !== group.value)
      : [...current, group.value]
    workspace.setTableEphemeral(tabId, { collapsedGroups: next })
  }
</script>

<button
  class="group-header"
  role="row"
  aria-expanded={!collapsed}
  style="width: {width}px;"
  onclick={toggle}
>
  <span class="material-symbols-outlined chevron" class:expanded={!collapsed}>chevron_right</span>
  <span class="group-value">{group.label ?? (group.value || '(empty)')}</span>
  <span class="group-count">{group.rows.length}</span>
</button>

<style>
  .group-header {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 100%;
    padding: 0 var(--space-2, 8px);
    box-sizing: border-box;
    background: var(--color-surface);
    border: none;
    border-bottom: 1px solid var(--color-border);
    color: var(--color-text);
    font-size: var(--text-sm, 0.75rem);
    font-weight: var(--weight-semibold, 600);
    cursor: pointer;
    text-align: left;
    transition: background var(--transition-fast, 150ms ease);
  }

  .group-header:hover {
    background: var(--overlay-hover);
  }

  .group-header:focus-visible {
    outline: 1px solid var(--color-primary);
    outline-offset: -1px;
  }

  .chevron {
    font-size: 18px;
    color: var(--color-text-dim);
    transition: transform var(--transition-fast, 150ms ease);
  }

  .chevron.expanded {
    transform: rotate(90deg);
  }

  .group-value {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .group-count {
    color: var(--color-text-dim);
    font-family: var(--font-mono, 'JetBrains Mono', ui-monospace, monospace);
    font-size: var(--text-xs, 0.625rem);
    background: var(--color-surface-elevated);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-full, 9999px);
    padding: 0 6px;
    line-height: 1.6;
  }

  @media (prefers-reduced-motion: reduce) {
    .group-header,
    .chevron {
      transition: none;
    }
  }
</style>
