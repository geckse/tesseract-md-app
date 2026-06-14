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
  <span class="group-value">{group.value || '(empty)'}</span>
  <span class="group-count">{group.rows.length}</span>
</button>

<style>
  .group-header {
    display: flex;
    align-items: center;
    gap: 6px;
    height: 100%;
    padding: 0 var(--space-2);
    box-sizing: border-box;
    background: var(--color-surface-elevated);
    border: none;
    border-bottom: 1px solid var(--color-border);
    color: var(--color-text);
    font-size: var(--text-sm);
    font-weight: var(--weight-semibold);
    cursor: pointer;
    text-align: left;
  }

  .chevron {
    font-size: 18px;
    color: var(--color-text-dim);
    transition: transform var(--transition-fast);
  }

  .chevron.expanded {
    transform: rotate(90deg);
  }

  @media (prefers-reduced-motion: reduce) {
    .chevron {
      transition: none;
    }
  }

  .group-count {
    color: var(--color-text-dim);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
  }
</style>
