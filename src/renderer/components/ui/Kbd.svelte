<script lang="ts">
  import type { Snippet } from 'svelte';

  interface KbdProps {
    children: Snippet;
  }

  let {
    children,
  }: KbdProps = $props();
</script>

<kbd class="kbd">
  {@render children()}
</kbd>

<style>
  .kbd {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    height: 20px;
    padding: 0 6px;
    border-radius: var(--radius-sm, 2px);
    border: 1px solid var(--color-border, #27272a);
    background: var(--color-surface, #161617);
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: var(--text-xs, 10px);
    font-weight: var(--weight-medium, 500);
    color: var(--color-text-dim, #71717a);
    line-height: 1;
    white-space: nowrap;
  }
</style>
