<script lang="ts">
  import type { CellProps } from './types'

  let { value, readOnly, oncommit }: CellProps = $props()

  const on = $derived(value === true)
</script>

<button
  class="toggle"
  class:on
  disabled={readOnly}
  aria-pressed={on}
  title={on ? 'true' : 'false'}
  onclick={(e) => {
    e.stopPropagation()
    oncommit(!on)
  }}
>
  <span class="knob"></span>
</button>

<style>
  .toggle {
    width: 32px;
    height: 18px;
    flex-shrink: 0;
    border-radius: var(--radius-full, 9999px);
    background: var(--color-border);
    border: none;
    cursor: pointer;
    position: relative;
    padding: 0;
    transition: background var(--transition-fast, 150ms ease);
  }

  .toggle.on {
    background: var(--color-primary);
  }

  .toggle:disabled {
    cursor: default;
    opacity: 0.5;
  }

  .toggle:focus-visible {
    outline: 1px solid var(--color-primary);
    outline-offset: 2px;
  }

  .knob {
    display: block;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #ffffff;
    position: absolute;
    top: 2px;
    left: 2px;
    transition: transform var(--transition-fast, 150ms ease);
  }

  .toggle.on .knob {
    transform: translateX(14px);
  }

  @media (prefers-reduced-motion: reduce) {
    .toggle,
    .knob {
      transition: none;
    }
  }
</style>
