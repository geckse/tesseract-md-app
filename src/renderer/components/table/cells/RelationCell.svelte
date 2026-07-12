<script lang="ts">
  import type { RelationValue } from '../../../types/cli'
  import { openResolvedPath, openResolvedPathOtherPane } from '../../../lib/link-navigation'
  import { formatRelationValue } from '../../../lib/relation-format'
  import RelationChip from '../../RelationChip.svelte'
  import RelationPicker from '../../RelationPicker.svelte'
  import PopoverMenu, { type PopoverMenuItem } from '../../ui/PopoverMenu.svelte'
  import { type CellProps, isEmptyValue } from './types'

  let {
    column,
    value,
    editing,
    readOnly,
    oncommit,
    oncancel,
    relations,
    root,
    collectionId
  }: CellProps = $props()

  let cellEl: HTMLDivElement | null = $state(null)

  const isArray = $derived(Array.isArray(value))
  /** The raw string values this cell displays (arrays keep source order + duplicates). */
  const rawValues = $derived.by<string[]>(() => {
    if (isEmptyValue(value)) return []
    if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string')
    return typeof value === 'string' ? [String(value)] : []
  })

  /**
   * Optimistic reconciliation (phase 42 §6.4): a chip renders from the
   * RelationValue whose `raw` equals the current frontmatter value; on
   * mismatch (fresh optimistic edit) the chip falls back to a NEUTRAL
   * client parse until the server confirms. Duplicates consume matching
   * RelationValues in order so `[a, a]` maps 1:1.
   */
  const chips = $derived.by<{ raw: string; relation: RelationValue | null }[]>(() => {
    const pool = [...(relations ?? [])]
    return rawValues.map((raw) => {
      const idx = pool.findIndex((r) => r.raw === raw)
      const relation = idx >= 0 ? pool.splice(idx, 1)[0] : null
      return { raw, relation }
    })
  })

  // openResolvedPath (not bare workspace.openFile): editors don't poll, so
  // skipping the file-store sync opens an empty editor tab.
  function navigate(path: string): void {
    openResolvedPath(path)
  }

  function openInNewTab(path: string): void {
    openResolvedPath(path, { forceNewTab: true })
  }

  /** Paths already linked (excluded from the picker in multi-value add mode). */
  const linkedPaths = $derived(
    (relations ?? []).map((r) => r.path).filter((p): p is string => p !== null)
  )

  function commitSingle(path: string): void {
    oncommit(formatRelationValue(path))
  }

  function addToArray(path: string): void {
    const next = [...rawValues, formatRelationValue(path)]
    oncommit(next)
  }

  function removeAt(index: number): void {
    const next = rawValues.filter((_, i) => i !== index)
    oncommit(next.length === 0 ? null : next)
  }

  function clear(): void {
    oncommit(null)
  }

  /** Right-click context menu, anchored to the chip that was clicked. */
  let menu: { index: number; anchor: HTMLElement } | null = $state(null)

  function openMenu(index: number, e: MouseEvent): void {
    const anchor = (e.currentTarget as HTMLElement | null) ?? cellEl
    if (anchor) menu = { index, anchor }
  }

  // Cell-background right-click: unambiguous only for single-chip cells
  // (chips stop propagation and open their own menu).
  function handleCellContextMenu(e: MouseEvent): void {
    if (chips.length !== 1 || !cellEl) return
    e.preventDefault()
    e.stopPropagation()
    menu = { index: 0, anchor: cellEl }
  }

  const menuItems = $derived.by<PopoverMenuItem[]>(() => {
    if (!menu) return []
    const chip = chips[menu.index]
    const resolved = !!chip?.relation && chip.relation.exists && !!chip.relation.path
    return [
      { id: 'open', label: 'Open', icon: 'arrow_forward', disabled: !resolved },
      { id: 'open-new-tab', label: 'Open in New Tab', icon: 'tab', disabled: !resolved },
      {
        id: 'open-other-pane',
        label: 'Open in Other Pane',
        icon: 'vertical_split',
        disabled: !resolved
      },
      {
        id: 'open-popup',
        label: 'Open in Popup Window',
        icon: 'picture_in_picture_alt',
        disabled: !resolved || !root
      },
      { id: 'copy-link', label: 'Copy Link Text', icon: 'content_copy', separatorBefore: true },
      {
        id: 'unlink',
        label: 'Unlink',
        icon: 'link_off',
        danger: true,
        separatorBefore: true,
        disabled: readOnly
      }
    ]
  })

  function handleMenuSelect(id: string): void {
    const m = menu
    if (!m) return
    const chip = chips[m.index]
    if (!chip) return
    const path = chip.relation?.exists ? chip.relation.path : null
    switch (id) {
      case 'open':
        if (path) openResolvedPath(path)
        break
      case 'open-new-tab':
        if (path) openInNewTab(path)
        break
      case 'open-other-pane':
        if (path) openResolvedPathOtherPane(path)
        break
      case 'open-popup':
        if (path && root) {
          void window.api.openPopup({
            kind: 'document',
            filePath: path,
            collectionId: collectionId ?? undefined,
            collectionPath: root
          })
        }
        break
      case 'copy-link':
        void navigator.clipboard.writeText(chip.raw)
        break
      case 'unlink':
        if (readOnly) break
        if (isArray) removeAt(m.index)
        else oncommit(null)
        break
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="rc" bind:this={cellEl} oncontextmenu={handleCellContextMenu}>
  {#if rawValues.length === 0}
    <span class="empty">—</span>
  {:else}
    <div class="rc-chips" class:multi={isArray}>
      {#each chips as chip, i (i)}
        <RelationChip
          relation={chip.relation}
          raw={chip.raw}
          onnavigate={navigate}
          onopennewtab={editing ? undefined : openInNewTab}
          oncontextmenu={(e) => openMenu(i, e)}
          onremove={editing && isArray && !readOnly ? () => removeAt(i) : undefined}
        />
      {/each}
    </div>
  {/if}

  {#if menu}
    <PopoverMenu
      anchorEl={menu.anchor}
      items={menuItems}
      onselect={handleMenuSelect}
      ondismiss={() => (menu = null)}
      ariaLabel="Relation actions"
    />
  {/if}

  {#if editing && !readOnly && cellEl && root}
    <div class="rc-edit-actions">
      {#if rawValues.length > 0 && !isArray}
        <button class="rc-action" onclick={clear} tabindex="-1">Clear</button>
      {/if}
    </div>
    <RelationPicker
      anchorEl={cellEl}
      {root}
      {collectionId}
      targetFolder={column.relation_target}
      excludePaths={isArray ? linkedPaths : []}
      onpick={(path) => {
        if (isArray) addToArray(path)
        else commitSingle(path)
      }}
      ondismiss={oncancel}
    />
  {/if}
</div>

<style>
  .rc {
    display: flex;
    align-items: center;
    gap: 4px;
    width: 100%;
    height: 100%;
    min-width: 0;
  }

  .rc-chips {
    display: flex;
    align-items: center;
    gap: 4px;
    overflow: hidden;
  }

  .empty {
    color: var(--color-text-faint);
  }

  .rc-edit-actions {
    margin-left: auto;
    display: flex;
    gap: 4px;
  }

  .rc-action {
    background: none;
    border: none;
    color: var(--color-text-dim, #71717a);
    font-size: var(--text-xs, 0.625rem);
    cursor: pointer;
    padding: 0 2px;
  }

  .rc-action:hover {
    color: var(--color-text, #e4e4e7);
  }
</style>
