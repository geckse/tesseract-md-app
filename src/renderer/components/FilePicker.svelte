<script lang="ts">
  import { onDestroy, onMount, tick } from 'svelte'
  import { computePosition, flip, offset, shift } from '@floating-ui/dom'
  import { flatAssetList, loadAssetTree } from '../stores/files'

  interface Props {
    anchorEl: HTMLElement
    excludePaths?: string[]
    onpick: (paths: string[]) => void
    ondismiss: () => void
  }

  let { anchorEl, excludePaths = [], onpick, ondismiss }: Props = $props()
  let pickerEl = $state<HTMLDivElement | null>(null)
  let search = $state('')
  let selected = $state<Set<string>>(new Set())
  let searchEl = $state<HTMLInputElement | null>(null)

  const excluded = $derived(new Set(excludePaths))
  const candidates = $derived(
    $flatAssetList.filter(
      (file) =>
        !excluded.has(file.path) &&
        (!search.trim() ||
          file.path.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
    )
  )

  function positionPicker(): void {
    if (!pickerEl || !anchorEl) return
    void computePosition(anchorEl, pickerEl, {
      placement: 'bottom-start',
      middleware: [offset(4), flip(), shift({ padding: 8 })]
    }).then(({ x, y }) => {
      if (!pickerEl) return
      pickerEl.style.left = `${x}px`
      pickerEl.style.top = `${y}px`
    })
  }

  function toggle(path: string): void {
    const next = new Set(selected)
    if (next.has(path)) next.delete(path)
    else next.add(path)
    selected = next
  }

  function submit(): void {
    if (selected.size === 0) return
    onpick([...selected])
  }

  function onDocumentPointerDown(event: PointerEvent): void {
    const target = event.target as Node | null
    if (!target || pickerEl?.contains(target) || anchorEl.contains(target)) return
    ondismiss()
  }

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      ondismiss()
    } else if (event.key === 'Enter' && selected.size > 0) {
      event.preventDefault()
      submit()
    }
  }

  onMount(() => {
    positionPicker()
    void tick().then(() => searchEl?.focus())
    document.addEventListener('pointerdown', onDocumentPointerDown, true)
    if ($flatAssetList.length === 0) void loadAssetTree()
  })

  onDestroy(() => {
    document.removeEventListener('pointerdown', onDocumentPointerDown, true)
  })

  $effect(() => {
    void anchorEl
    void candidates.length
    positionPicker()
  })
</script>

<div
  class="file-picker"
  bind:this={pickerEl}
  role="dialog"
  aria-label="Select files"
  tabindex="-1"
  onkeydown={onKeydown}
>
  <div class="search-row">
    <span class="material-symbols-outlined">search</span>
    <input bind:this={searchEl} bind:value={search} placeholder="Search collection files…" />
  </div>

  <div class="file-list" role="listbox" aria-multiselectable="true">
    {#if candidates.length === 0}
      <div class="empty">No available files</div>
    {:else}
      {#each candidates.slice(0, 250) as file (file.path)}
        <button
          type="button"
          class:selected={selected.has(file.path)}
          role="option"
          aria-selected={selected.has(file.path)}
          onclick={() => toggle(file.path)}
        >
          <span class="material-symbols-outlined">
            {selected.has(file.path) ? 'check_box' : 'check_box_outline_blank'}
          </span>
          <span class="file-label">{file.path}</span>
        </button>
      {/each}
    {/if}
  </div>

  <div class="picker-footer">
    <span>{selected.size} selected</span>
    <button class="add-button" type="button" disabled={selected.size === 0} onclick={submit}>
      Add files
    </button>
  </div>
</div>

<style>
  .file-picker {
    position: fixed;
    z-index: var(--z-overlay, 40);
    width: min(380px, calc(100vw - 16px));
    max-height: min(440px, calc(100vh - 16px));
    display: flex;
    flex-direction: column;
    padding: 6px;
    border: 1px solid var(--color-border, #3f3f46);
    border-radius: 8px;
    background: var(--color-surface, #18181b);
    color: var(--color-text, #e4e4e7);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
  }

  .search-row {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 7px;
    border: 1px solid var(--color-border, #3f3f46);
    border-radius: 5px;
  }

  .search-row span {
    font-size: 17px;
    color: var(--color-text-dim, #a1a1aa);
  }

  .search-row input {
    width: 100%;
    border: 0;
    outline: 0;
    background: transparent;
    color: inherit;
    font: inherit;
  }

  .file-list {
    min-height: 80px;
    max-height: 330px;
    overflow: auto;
    padding: 4px 0;
  }

  .file-list button {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 6px 7px;
    border: 0;
    border-radius: 4px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    text-align: left;
  }

  .file-list button:hover,
  .file-list button.selected {
    background: var(--color-hover, #27272a);
  }

  .file-list button .material-symbols-outlined {
    font-size: 17px;
    color: var(--color-primary, #00e5ff);
  }

  .file-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .empty {
    padding: 20px 8px;
    text-align: center;
    color: var(--color-text-dim, #a1a1aa);
  }

  .picker-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 2px 0;
    border-top: 1px solid var(--color-border, #3f3f46);
    color: var(--color-text-dim, #a1a1aa);
    font-size: 12px;
  }

  .add-button {
    border: 0;
    border-radius: 5px;
    padding: 6px 10px;
    background: var(--color-primary, #00e5ff);
    color: #061417;
    font-weight: 600;
    cursor: pointer;
  }

  .add-button:disabled {
    opacity: 0.45;
    cursor: default;
  }
</style>
