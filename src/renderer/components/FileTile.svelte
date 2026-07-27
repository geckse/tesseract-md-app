<script lang="ts">
  import { workspace } from '../stores/workspace.svelte'
  import type { MimeCategory } from '../types/cli'
  import { fileNameFromReference, formatFileReference } from '../../shared/file-reference'
  import PopoverMenu, { type PopoverMenuItem } from './ui/PopoverMenu.svelte'

  interface Props {
    root: string
    path: string
    raw?: string
    mimeCategory?: MimeCategory
    fileSize?: number
    exists?: boolean
    compact?: boolean
    onunlink?: () => void
  }

  let {
    root,
    path,
    raw,
    mimeCategory = 'other',
    fileSize,
    exists = true,
    compact = false,
    onunlink
  }: Props = $props()

  let tileEl = $state<HTMLButtonElement | null>(null)
  let thumbnail = $state<string | null>(null)
  let menuOpen = $state(false)
  const absolutePath = $derived(`${root.replace(/\/+$/, '')}/${path}`)
  const fileName = $derived(fileNameFromReference(path))

  $effect(() => {
    const requestedPath = absolutePath
    if (!exists) {
      thumbnail = null
      return
    }
    let active = true
    void window.api
      .fileThumbnail(requestedPath, compact ? 64 : 112, compact ? 48 : 72)
      .then((result) => {
        if (active && requestedPath === absolutePath) thumbnail = result
      })
      .catch(() => {
        if (active) thumbnail = null
      })
    return () => {
      active = false
    }
  })

  function iconForCategory(): string {
    switch (mimeCategory) {
      case 'image':
        return 'image'
      case 'pdf':
        return 'picture_as_pdf'
      case 'video':
        return 'videocam'
      case 'audio':
        return 'audiotrack'
      default:
        return 'draft'
    }
  }

  function open(paneId?: string): void {
    if (!exists) return
    workspace.openAssetTab(path, mimeCategory, fileSize, paneId)
  }

  function openOtherPane(): void {
    if (!exists) return
    if (workspace.paneOrder.length < 2) workspace.toggleSplit()
    const source = workspace.defaultEditorPaneId
    const target = workspace.paneOrder.find((paneId) => paneId !== source)
    if (target) open(target)
  }

  const menuItems = $derived.by<PopoverMenuItem[]>(() => [
    { id: 'open', label: 'Open in New Tab', icon: 'tab', disabled: !exists },
    {
      id: 'other-pane',
      label: 'Open in Other Pane',
      icon: 'vertical_split',
      disabled: !exists
    },
    {
      id: 'popup',
      label: 'Open in Popup',
      icon: 'picture_in_picture_alt',
      disabled: !exists
    },
    {
      id: 'default-app',
      label: 'Open in Default App',
      icon: 'open_in_new',
      disabled: !exists,
      separatorBefore: true
    },
    {
      id: 'reveal',
      label: 'Reveal in Finder/File Explorer',
      icon: 'folder_open',
      disabled: !exists
    },
    { id: 'copy-path', label: 'Copy Path', icon: 'content_copy', separatorBefore: true },
    { id: 'copy-relative', label: 'Copy Relative Path', icon: 'content_copy' },
    { id: 'copy-wikilink', label: 'Copy Wikilink', icon: 'link' },
    ...(onunlink
      ? [
          {
            id: 'unlink',
            label: 'Unlink',
            icon: 'link_off',
            danger: true,
            separatorBefore: true
          }
        ]
      : [])
  ])

  function selectMenuItem(id: string): void {
    switch (id) {
      case 'open':
        open()
        break
      case 'other-pane':
        openOtherPane()
        break
      case 'popup':
        if (exists) {
          void window.api.openPopup({
            kind: 'asset',
            filePath: path,
            collectionPath: root,
            mimeCategory
          })
        }
        break
      case 'default-app':
        if (exists) void window.api.openPath(absolutePath)
        break
      case 'reveal':
        if (exists) void window.api.showItemInFolder(absolutePath)
        break
      case 'copy-path':
        void window.api.writeToClipboard(absolutePath)
        break
      case 'copy-relative':
        void window.api.writeToClipboard(path)
        break
      case 'copy-wikilink':
        void window.api.writeToClipboard(raw ?? formatFileReference(path))
        break
      case 'unlink':
        onunlink?.()
        break
    }
  }
</script>

<button
  class="file-tile"
  class:compact
  class:broken={!exists}
  bind:this={tileEl}
  type="button"
  title={exists ? path : `Missing file: ${path}`}
  aria-label={exists ? `Open ${fileName}` : `Missing file ${fileName}`}
  aria-disabled={!exists}
  onclick={(event) => {
    event.stopPropagation()
    open()
  }}
  oncontextmenu={(event) => {
    event.preventDefault()
    event.stopPropagation()
    menuOpen = true
  }}
>
  {#if thumbnail}
    <img src={thumbnail} alt="" draggable="false" />
  {:else}
    <span class="material-symbols-outlined file-icon"
      >{exists ? iconForCategory() : 'broken_image'}</span
    >
  {/if}
  {#if !compact}
    <span class="file-name">{fileName}</span>
  {/if}
</button>

{#if menuOpen && tileEl}
  <PopoverMenu
    anchorEl={tileEl}
    items={menuItems}
    onselect={selectMenuItem}
    ondismiss={() => (menuOpen = false)}
    ariaLabel={`Actions for ${fileName}`}
  />
{/if}

<style>
  .file-tile {
    height: 42px;
    min-width: 72px;
    max-width: 180px;
    padding: 3px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    overflow: hidden;
    border: 1px solid var(--color-border, #3f3f46);
    border-radius: 6px;
    background: var(--color-surface-raised, #202024);
    color: var(--color-text, #e4e4e7);
    cursor: pointer;
    flex: 0 0 auto;
  }

  .file-tile:hover {
    border-color: var(--color-primary, #00e5ff);
    background: var(--color-hover, #27272a);
  }

  .file-tile.compact {
    width: 42px;
    min-width: 42px;
    height: 28px;
    padding: 2px;
    border-radius: 5px;
  }

  .file-tile.broken {
    opacity: 0.65;
    border-style: dashed;
    cursor: not-allowed;
  }

  img {
    width: 52px;
    height: 34px;
    object-fit: contain;
    border-radius: 3px;
    flex: 0 0 auto;
  }

  .compact img {
    width: 36px;
    height: 22px;
  }

  .file-icon {
    width: 34px;
    font-size: 22px;
    color: var(--color-text-dim, #a1a1aa);
    flex: 0 0 auto;
  }

  .compact .file-icon {
    width: 36px;
    font-size: 20px;
  }

  .file-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--text-xs, 0.75rem);
  }
</style>
