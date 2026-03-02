<script lang="ts">
  interface IconButtonProps {
    icon: string;
    title?: string;
    active?: boolean;
    size?: 'sm' | 'md';
    disabled?: boolean;
    onclick?: (e: MouseEvent) => void;
  }

  let {
    icon,
    title = '',
    active = false,
    size = 'md',
    disabled = false,
    onclick,
  }: IconButtonProps = $props();
</script>

<button
  class="icon-btn icon-btn-{size}"
  class:active
  {title}
  {disabled}
  {onclick}
>
  <span class="material-symbols-outlined">{icon}</span>
</button>

<style>
  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    border-radius: var(--radius-md, 6px);
    color: var(--color-text-dim, #71717a);
    cursor: pointer;
    transition: color var(--transition-fast, 150ms ease),
                background var(--transition-fast, 150ms ease);
  }

  .icon-btn:hover:not(:disabled),
  .icon-btn.active {
    color: var(--color-primary, #00E5FF);
    background: var(--color-surface-dark, #0a0a0a);
  }

  .icon-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  /* --- Sizes --- */

  .icon-btn-sm {
    padding: 4px;
  }

  .icon-btn-sm .material-symbols-outlined {
    font-size: 16px;
  }

  .icon-btn-md {
    padding: 8px;
  }

  .icon-btn-md .material-symbols-outlined {
    font-size: 20px;
  }
</style>
