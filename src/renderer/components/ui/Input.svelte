<script lang="ts">
  import type { Snippet } from 'svelte';

  interface InputProps {
    value?: string;
    placeholder?: string;
    type?: 'text' | 'search';
    disabled?: boolean;
    icon?: Snippet;
    oninput?: (e: Event) => void;
    onfocus?: (e: FocusEvent) => void;
    onblur?: (e: FocusEvent) => void;
  }

  let {
    value = $bindable(''),
    placeholder = '',
    type = 'text',
    disabled = false,
    icon,
    oninput,
    onfocus,
    onblur,
  }: InputProps = $props();
</script>

<div class="input-wrapper">
  {#if icon}
    <span class="input-icon">
      {@render icon()}
    </span>
  {/if}
  <input
    class="input"
    class:has-icon={!!icon}
    {type}
    {placeholder}
    {disabled}
    bind:value
    {oninput}
    {onfocus}
    {onblur}
  />
</div>

<style>
  .input-wrapper {
    position: relative;
    display: flex;
    align-items: center;
  }

  .input-icon {
    position: absolute;
    left: 12px;
    display: flex;
    align-items: center;
    color: var(--color-text-dim, #71717a);
    pointer-events: none;
    transition: color var(--transition-fast, 150ms ease);
  }

  .input-wrapper:focus-within .input-icon {
    color: var(--color-primary, #00E5FF);
  }

  .input {
    width: 100%;
    padding: 6px 12px;
    background: var(--color-surface-darker, #0a0a0a);
    border: 1px solid var(--color-border, #27272a);
    border-radius: var(--radius-md, 6px);
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    font-size: var(--text-sm, 12px);
    color: var(--color-text-white, #fff);
    outline: none;
    transition: border-color var(--transition-fast, 150ms ease),
                box-shadow var(--transition-fast, 150ms ease);
  }

  .input::placeholder {
    color: var(--color-text-dim, #71717a);
    opacity: 0.5;
  }

  .input:focus {
    border-color: var(--color-primary, #00E5FF);
    box-shadow: 0 0 0 1px var(--color-primary, #00E5FF);
  }

  .input:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .input.has-icon {
    padding-left: 36px;
  }
</style>
