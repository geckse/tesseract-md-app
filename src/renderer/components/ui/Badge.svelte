<script lang="ts">
  import type { Snippet } from 'svelte';

  interface BadgeProps {
    variant?: 'default' | 'success' | 'warning' | 'info' | 'primary';
    children: Snippet;
  }

  let {
    variant = 'default',
    children,
  }: BadgeProps = $props();
</script>

<span class="badge badge-{variant}">
  {@render children()}
</span>

<style>
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 9999px;
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: var(--text-xs, 10px);
    font-weight: var(--weight-medium, 500);
    line-height: 1.4;
    white-space: nowrap;
  }

  /* --- Variants --- */

  .badge-default {
    background: var(--color-surface, #161617);
    color: var(--color-text-dim, #71717a);
    border: 1px solid var(--color-border, #27272a);
  }

  .badge-success {
    background: rgba(52, 211, 153, 0.1);
    color: #34d399;
    border: 1px solid rgba(52, 211, 153, 0.2);
  }

  .badge-warning {
    background: rgba(251, 191, 36, 0.1);
    color: #fbbf24;
    border: 1px solid rgba(251, 191, 36, 0.2);
  }

  .badge-info {
    background: rgba(96, 165, 250, 0.1);
    color: #60a5fa;
    border: 1px solid rgba(96, 165, 250, 0.2);
  }

  .badge-primary {
    background: var(--color-primary-dim, rgba(0, 229, 255, 0.1));
    color: var(--color-primary, #00E5FF);
    border: 1px solid rgba(0, 229, 255, 0.2);
  }
</style>
