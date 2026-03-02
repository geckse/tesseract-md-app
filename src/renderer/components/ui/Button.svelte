<script lang="ts">
  import type { Snippet } from 'svelte';

  interface ButtonProps {
    variant?: 'primary' | 'secondary';
    size?: 'sm' | 'md' | 'lg';
    disabled?: boolean;
    onclick?: (e: MouseEvent) => void;
    children: Snippet;
  }

  let {
    variant = 'primary',
    size = 'md',
    disabled = false,
    onclick,
    children,
  }: ButtonProps = $props();
</script>

<button
  class="btn btn-{variant} btn-{size}"
  {disabled}
  {onclick}
>
  {@render children()}
</button>

<style>
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    border: none;
    border-radius: var(--radius-sm, 2px);
    font-family: inherit;
    font-weight: var(--weight-bold, 700);
    letter-spacing: 0.05em;
    text-transform: uppercase;
    cursor: pointer;
    transition: background var(--transition-fast, 150ms ease),
                opacity var(--transition-fast, 150ms ease);
    white-space: nowrap;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* --- Variants --- */

  .btn-primary {
    background: var(--color-primary, #00E5FF);
    color: var(--color-surface-dark, #0a0a0a);
  }

  .btn-primary:hover:not(:disabled) {
    background: var(--color-primary-dark, #00B8CC);
  }

  .btn-secondary {
    background: var(--color-surface, #161617);
    color: var(--color-text, #e4e4e7);
    border: 1px solid var(--color-border, #27272a);
  }

  .btn-secondary:hover:not(:disabled) {
    background: var(--color-surface-dark, #0a0a0a);
    border-color: var(--color-border-hover, #3f3f46);
    color: var(--color-text-white, #fff);
  }

  /* --- Sizes --- */

  .btn-sm {
    padding: 4px 12px;
    font-size: var(--text-xs, 10px);
  }

  .btn-md {
    padding: 6px 16px;
    font-size: var(--text-sm, 12px);
  }

  .btn-lg {
    padding: 8px 24px;
    font-size: var(--text-base, 14px);
  }
</style>
