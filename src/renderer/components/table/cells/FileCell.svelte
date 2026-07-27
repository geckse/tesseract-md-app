<script lang="ts">
  import FilePicker from '../../FilePicker.svelte'
  import FileTile from '../../FileTile.svelte'
  import { assetsByPath } from '../../../stores/files'
  import { cliFeatures } from '../../../lib/cli-features.svelte'
  import { formatFileReference, parseFileReference } from '../../../../shared/file-reference'
  import { type CellProps, isEmptyValue } from './types'

  let { value, editing, readOnly, oncommit, oncancel, root }: CellProps = $props()

  let cellEl = $state<HTMLDivElement | null>(null)

  /** Legacy scalar values stay readable; every mutation writes the canonical list. */
  const rawValues = $derived.by<string[]>(() => {
    if (isEmptyValue(value)) return []
    if (Array.isArray(value))
      return value.filter((item): item is string => typeof item === 'string')
    return typeof value === 'string' ? [value] : []
  })

  const references = $derived(
    rawValues.map((raw) => ({
      raw,
      path: parseFileReference(raw, true)
    }))
  )

  const linkedPaths = $derived(
    references.map((reference) => reference.path).filter((path): path is string => path !== null)
  )

  function removeAt(index: number): void {
    oncommit(rawValues.filter((_, candidate) => candidate !== index))
  }

  function addFiles(paths: string[]): void {
    oncommit([...rawValues, ...paths.map(formatFileReference)])
  }
</script>

<div class="file-cell" bind:this={cellEl}>
  {#if references.length === 0}
    <span class="empty">—</span>
  {:else}
    <div class="tiles">
      {#each references as reference, index (index)}
        {@const asset = reference.path ? $assetsByPath.get(reference.path) : undefined}
        <FileTile
          root={root ?? ''}
          path={reference.path ?? reference.raw}
          raw={reference.raw}
          mimeCategory={asset?.mimeCategory ?? 'other'}
          fileSize={asset?.fileSize}
          exists={!!asset}
          compact
          onunlink={readOnly || !cliFeatures.supportsFileFields ? undefined : () => removeAt(index)}
        />
      {/each}
    </div>
  {/if}

  {#if editing && !readOnly && cellEl && root}
    <FilePicker
      anchorEl={cellEl}
      excludePaths={linkedPaths}
      onpick={addFiles}
      ondismiss={oncancel}
    />
  {/if}
</div>

<style>
  .file-cell {
    width: 100%;
    height: 100%;
    min-width: 0;
    display: flex;
    align-items: center;
  }

  .tiles {
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 4px;
    overflow: hidden;
  }

  .empty {
    color: var(--color-text-faint);
  }
</style>
