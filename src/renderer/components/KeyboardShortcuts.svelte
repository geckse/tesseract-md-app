<script lang="ts">
  import Kbd from './ui/Kbd.svelte';
  import { getShortcutDisplay } from '../lib/shortcuts';

  interface KeyboardShortcutsProps {
    open: boolean;
    onclose: () => void;
  }

  let { open, onclose }: KeyboardShortcutsProps = $props();

  interface ShortcutEntry {
    label: string;
    keys: string;
  }

  interface ShortcutCategory {
    name: string;
    shortcuts: ShortcutEntry[];
  }

  const categories: ShortcutCategory[] = [
    {
      name: 'Navigation',
      shortcuts: [
        { label: 'Quick Open', keys: getShortcutDisplay('P', true) },
        { label: 'Search', keys: getShortcutDisplay('K', true) },
        { label: 'Graph View', keys: getShortcutDisplay('G', true) },
        { label: 'Close File', keys: getShortcutDisplay('W', true) },
        { label: 'Cycle Focus Forward', keys: 'Tab' },
        { label: 'Cycle Focus Backward', keys: 'Shift+Tab' },
      ],
    },
    {
      name: 'Editing',
      shortcuts: [
        { label: 'Toggle Mode', keys: getShortcutDisplay('E', true) },
        { label: 'Save', keys: getShortcutDisplay('S', true) },
      ],
    },
    {
      name: 'Panels',
      shortcuts: [
        { label: 'Toggle Properties', keys: getShortcutDisplay('B', true, true) },
      ],
    },
  ];

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) {
      onclose();
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && open) {
      onclose();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal-backdrop" onclick={handleBackdropClick}>
    <div class="modal-content" role="dialog" aria-modal="true" aria-label="Keyboard Shortcuts">
      <div class="modal-header">
        <span class="material-symbols-outlined modal-icon">keyboard</span>
        <h2 class="modal-title">Keyboard Shortcuts</h2>
      </div>
      <div class="modal-body">
        {#each categories as category}
          <div class="shortcut-category">
            <h3 class="category-name">{category.name}</h3>
            <div class="shortcut-list">
              {#each category.shortcuts as shortcut}
                <div class="shortcut-row">
                  <span class="shortcut-label">{shortcut.label}</span>
                  <Kbd>{shortcut.keys}</Kbd>
                </div>
              {/each}
            </div>
          </div>
        {/each}
      </div>
      <div class="modal-footer">
        <button class="modal-btn modal-btn-primary" onclick={onclose}>Close</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .modal-content {
    background: var(--color-bg, #09090b);
    border: 1px solid var(--color-border, #27272a);
    border-radius: var(--radius-lg, 8px);
    width: 480px;
    max-width: 90vw;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .modal-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 20px 24px 12px;
  }

  .modal-icon {
    font-size: 24px;
    color: var(--color-text-dim, #71717a);
  }

  .modal-title {
    font-size: var(--text-lg, 16px);
    font-weight: var(--weight-semibold, 600);
    color: var(--color-text, #fafafa);
    margin: 0;
  }

  .modal-body {
    padding: 8px 24px 16px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  .shortcut-category {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .category-name {
    font-size: var(--text-xs, 10px);
    font-weight: var(--weight-semibold, 600);
    color: var(--color-text-dim, #71717a);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin: 0;
  }

  .shortcut-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .shortcut-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 0;
  }

  .shortcut-label {
    font-size: var(--text-sm, 13px);
    color: var(--color-text, #fafafa);
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    padding: 12px 24px 16px;
    border-top: 1px solid var(--color-border, #27272a);
  }

  .modal-btn {
    padding: 6px 16px;
    border-radius: var(--radius-md, 4px);
    font-size: var(--text-sm, 13px);
    font-weight: var(--weight-medium, 500);
    cursor: pointer;
    border: none;
  }

  .modal-btn-primary {
    background: var(--color-accent, #3b82f6);
    color: white;
  }

  .modal-btn-primary:hover {
    opacity: 0.9;
  }
</style>
