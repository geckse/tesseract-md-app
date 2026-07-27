<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { get } from 'svelte/store'
  import { activeCollection } from '../stores/collections'
  import { workspace, type AssetTab } from '../stores/workspace.svelte'
  import { requestConfirmation } from '../stores/confirmation'
  import { discardImageEdits, imageSaveRequested, markImageSaved } from '../stores/image-editor'
  import {
    aspectRatioForPreset,
    centeredCropForAspect,
    clampCropRect,
    cloneImageRecipe,
    createImageEditDraft,
    cropPixelDimensions,
    imageExtension,
    isIdentityImageRecipe,
    orientedDimensions,
    outputDimensions,
    recipesEqual,
    resizeWithAspect,
    rotateRecipe,
    type CropAspectPreset,
    type ImageEditDraft,
    type ImageEditRecipe,
    type ImageReadResult,
    type NormalizedCropRect
  } from '../../shared/image-edit'

  interface Props {
    filePath: string
    fileSize?: number
    collectionPath?: string
    tabId?: string
  }

  let { filePath, fileSize, collectionPath, tabId }: Props = $props()

  let dataUrl = $state<string | null>(null)
  let source = $state<ImageReadResult | null>(null)
  let loading = $state(true)
  let error = $state<string | null>(null)
  let status = $state<string | null>(null)
  let zoom = $state(1)
  let fitMode = $state<'fit' | 'actual'>('fit')
  let saving = $state(false)
  let activeRequestId = $state<string | null>(null)
  let localDraft = $state<ImageEditDraft>(createImageEditDraft())
  let localDirty = $state(false)
  let localDiskChanged = $state(false)

  let cropMode = $state(false)
  let cropWorking = $state<NormalizedCropRect | null>(null)
  let resizeOpen = $state(false)
  let resizeWidth = $state('')
  let resizeHeight = $state('')
  let resizeError = $state<string | null>(null)

  let stageEl: HTMLDivElement | undefined = $state(undefined)
  let surfaceEl: HTMLDivElement | undefined = $state(undefined)
  let stageWidth = $state(0)
  let stageHeight = $state(0)

  const MIN_ZOOM = 0.1
  const MAX_ZOOM = 10
  const MAX_HISTORY = 50
  const MAX_DIMENSION = 32_768
  const MAX_PIXELS = 100_000_000

  const tab = $derived(
    tabId && workspace.tabs[tabId]?.kind === 'asset' ? (workspace.tabs[tabId] as AssetTab) : null
  )
  const draft = $derived(tab?.imageEditDraft ?? localDraft)
  const recipe = $derived(draft.recipe)
  const isDirty = $derived(tab?.isDirty ?? localDirty)
  const diskChanged = $derived(tab?.diskChanged ?? localDiskChanged)
  const sourceWidth = $derived(source?.width ?? 0)
  const sourceHeight = $derived(source?.height ?? 0)
  const oriented = $derived(
    source
      ? orientedDimensions(source.width, source.height, recipe.rotation)
      : { width: 0, height: 0 }
  )
  const output = $derived(
    source ? outputDimensions(source.width, source.height, recipe) : { width: 0, height: 0 }
  )
  const displayScale = $derived.by(() => {
    if (!oriented.width || !oriented.height) return 1
    if (fitMode === 'actual') return zoom
    const availableWidth = Math.max(1, stageWidth - 48)
    const availableHeight = Math.max(1, stageHeight - 48)
    return Math.min(1, availableWidth / oriented.width, availableHeight / oriented.height)
  })
  const surfaceWidth = $derived(Math.max(1, oriented.width * displayScale))
  const surfaceHeight = $derived(Math.max(1, oriented.height * displayScale))
  const renderedSourceWidth = $derived(Math.max(1, sourceWidth * displayScale))
  const renderedSourceHeight = $derived(Math.max(1, sourceHeight * displayScale))
  const activeCrop = $derived(
    cropMode
      ? (cropWorking ?? { x: 0, y: 0, width: 1, height: 1 })
      : (recipe.crop ?? { x: 0, y: 0, width: 1, height: 1 })
  )

  function absolutePath(): string | null {
    const root = collectionPath || get(activeCollection)?.path
    if (!root) return null
    return `${root.replace(/[\\/]+$/, '')}/${filePath.replace(/^[\\/]+/, '')}`
  }

  function currentDraft(): ImageEditDraft {
    return tab?.imageEditDraft ?? localDraft
  }

  function setDirty(value: boolean): void {
    if (tab) tab.isDirty = value
    else localDirty = value
  }

  function setDiskChanged(value: boolean): void {
    if (tab) tab.diskChanged = value
    else localDiskChanged = value
  }

  function replaceDraft(next: ImageEditDraft): void {
    if (tab) tab.imageEditDraft = next
    else localDraft = next
  }

  function commitRecipe(nextRecipe: ImageEditRecipe): void {
    const current = currentDraft()
    if (recipesEqual(current.recipe, nextRecipe)) return
    replaceDraft({
      ...current,
      recipe: cloneImageRecipe(nextRecipe),
      undoStack: [...current.undoStack, cloneImageRecipe(current.recipe)].slice(-MAX_HISTORY),
      redoStack: []
    })
    setDirty(!isIdentityImageRecipe(nextRecipe))
    status = null
  }

  async function loadImage(): Promise<void> {
    loading = true
    error = null
    try {
      const path = absolutePath()
      if (!path) throw new Error('No active collection')
      const loaded = await window.api.readImage(path)
      source = loaded
      dataUrl = `data:${loaded.mimeType};base64,${loaded.base64}`
      if (tab) tab.fileSize = loaded.size
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
    } finally {
      loading = false
    }
  }

  function handleWheel(event: WheelEvent): void {
    event.preventDefault()
    const delta = event.deltaY > 0 ? -0.1 : 0.1
    zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom + delta * zoom))
    fitMode = 'actual'
  }

  function fitToView(): void {
    zoom = 1
    fitMode = 'fit'
  }

  function actualSize(): void {
    zoom = 1
    fitMode = 'actual'
  }

  function rotate(direction: 'left' | 'right'): void {
    cropMode = false
    resizeOpen = false
    commitRecipe(rotateRecipe(recipe, direction))
  }

  function undo(): void {
    const current = currentDraft()
    const previous = current.undoStack.at(-1)
    if (!previous) return
    replaceDraft({
      ...current,
      recipe: cloneImageRecipe(previous),
      undoStack: current.undoStack.slice(0, -1),
      redoStack: [cloneImageRecipe(current.recipe), ...current.redoStack].slice(0, MAX_HISTORY)
    })
    setDirty(!isIdentityImageRecipe(previous))
    cropMode = false
    resizeOpen = false
  }

  function redo(): void {
    const current = currentDraft()
    const next = current.redoStack[0]
    if (!next) return
    replaceDraft({
      ...current,
      recipe: cloneImageRecipe(next),
      undoStack: [...current.undoStack, cloneImageRecipe(current.recipe)].slice(-MAX_HISTORY),
      redoStack: current.redoStack.slice(1)
    })
    setDirty(!isIdentityImageRecipe(next))
    cropMode = false
    resizeOpen = false
  }

  function resetEdits(): void {
    if (tabId) {
      discardImageEdits(tabId)
    } else {
      localDraft = createImageEditDraft()
      localDirty = false
      localDiskChanged = false
    }
    cropMode = false
    resizeOpen = false
    status = 'Edits reset'
  }

  function beginCrop(): void {
    cropWorking = recipe.crop ? { ...recipe.crop } : { x: 0, y: 0, width: 1, height: 1 }
    cropMode = true
    resizeOpen = false
  }

  function cancelCrop(): void {
    cropMode = false
    cropWorking = null
  }

  function applyCrop(): void {
    if (!cropWorking) return
    const crop = clampCropRect(cropWorking)
    const full =
      Math.abs(crop.x) < 1e-6 &&
      Math.abs(crop.y) < 1e-6 &&
      Math.abs(crop.width - 1) < 1e-6 &&
      Math.abs(crop.height - 1) < 1e-6
    commitRecipe({ ...cloneImageRecipe(recipe), crop: full ? null : crop })
    cropMode = false
    cropWorking = null
  }

  function selectAspect(preset: CropAspectPreset): void {
    const current = currentDraft()
    replaceDraft({ ...current, aspectPreset: preset })
    const aspect = aspectRatioForPreset(preset, sourceWidth, sourceHeight, recipe.rotation)
    if (!aspect || !oriented.width || !oriented.height) return
    cropWorking = centeredCropForAspect(aspect, oriented.width, oriented.height)
  }

  interface DragState {
    mode: 'move' | 'nw' | 'ne' | 'sw' | 'se'
    startX: number
    startY: number
    rect: NormalizedCropRect
    bounds: DOMRect
  }

  let dragState: DragState | null = null

  function beginCropDrag(event: PointerEvent, mode: DragState['mode']): void {
    if (!surfaceEl || !cropWorking) return
    event.preventDefault()
    event.stopPropagation()
    dragState = {
      mode,
      startX: event.clientX,
      startY: event.clientY,
      rect: { ...cropWorking },
      bounds: surfaceEl.getBoundingClientRect()
    }
    window.addEventListener('pointermove', handleCropDrag)
    window.addEventListener('pointerup', endCropDrag, { once: true })
  }

  function handleCropDrag(event: PointerEvent): void {
    if (!dragState) return
    const { mode, rect, bounds } = dragState
    const dx = (event.clientX - dragState.startX) / Math.max(1, bounds.width)
    const dy = (event.clientY - dragState.startY) / Math.max(1, bounds.height)
    const minWidth = Math.max(1 / Math.max(1, oriented.width), 0.005)
    const minHeight = Math.max(1 / Math.max(1, oriented.height), 0.005)

    if (mode === 'move') {
      cropWorking = clampCropRect({ ...rect, x: rect.x + dx, y: rect.y + dy })
      return
    }

    let left = rect.x
    let top = rect.y
    let right = rect.x + rect.width
    let bottom = rect.y + rect.height
    if (mode.includes('w')) left = Math.min(right - minWidth, Math.max(0, left + dx))
    if (mode.includes('e')) right = Math.max(left + minWidth, Math.min(1, right + dx))
    if (mode.includes('n')) top = Math.min(bottom - minHeight, Math.max(0, top + dy))
    if (mode.includes('s')) bottom = Math.max(top + minHeight, Math.min(1, bottom + dy))

    const pixelAspect = aspectRatioForPreset(
      currentDraft().aspectPreset,
      sourceWidth,
      sourceHeight,
      recipe.rotation
    )
    if (pixelAspect) {
      const normalizedAspect = pixelAspect * (oriented.height / oriented.width)
      let width = right - left
      let height = bottom - top
      if (width / height > normalizedAspect) width = height * normalizedAspect
      else height = width / normalizedAspect
      if (mode.includes('w')) left = right - width
      else right = left + width
      if (mode.includes('n')) top = bottom - height
      else bottom = top + height
    }

    cropWorking = clampCropRect({
      x: left,
      y: top,
      width: right - left,
      height: bottom - top
    })
  }

  function endCropDrag(): void {
    dragState = null
    window.removeEventListener('pointermove', handleCropDrag)
  }

  function handleCropKeydown(event: KeyboardEvent): void {
    if (!cropWorking || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      return
    }
    event.preventDefault()
    const pixelStep = event.shiftKey ? 10 : 1
    const dx =
      event.key === 'ArrowLeft'
        ? -pixelStep / oriented.width
        : event.key === 'ArrowRight'
          ? pixelStep / oriented.width
          : 0
    const dy =
      event.key === 'ArrowUp'
        ? -pixelStep / oriented.height
        : event.key === 'ArrowDown'
          ? pixelStep / oriented.height
          : 0
    cropWorking = clampCropRect({ ...cropWorking, x: cropWorking.x + dx, y: cropWorking.y + dy })
  }

  function openResize(): void {
    if (!source) return
    const dimensions = outputDimensions(source.width, source.height, recipe)
    resizeWidth = String(dimensions.width)
    resizeHeight = String(dimensions.height)
    resizeError = null
    resizeOpen = true
    cropMode = false
  }

  function handleResizeInput(changed: 'width' | 'height', value: string): void {
    if (changed === 'width') resizeWidth = value
    else resizeHeight = value
    if (!currentDraft().resizeAspectLocked || !source) return
    const parsed = Number.parseInt(value, 10)
    if (!Number.isFinite(parsed) || parsed < 1) return
    const cropped = cropPixelDimensions(source.width, source.height, recipe)
    const linked = resizeWithAspect(changed, parsed, cropped.width / cropped.height)
    resizeWidth = String(linked.width)
    resizeHeight = String(linked.height)
  }

  function toggleResizeLock(): void {
    const current = currentDraft()
    replaceDraft({ ...current, resizeAspectLocked: !current.resizeAspectLocked })
  }

  function applyResize(): void {
    const width = Number(resizeWidth)
    const height = Number(resizeHeight)
    const extension = imageExtension(filePath)
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 1 ||
      height < 1 ||
      width > MAX_DIMENSION ||
      height > MAX_DIMENSION
    ) {
      resizeError = `Enter whole-number dimensions from 1 to ${MAX_DIMENSION.toLocaleString()}`
      return
    }
    if (width * height > MAX_PIXELS) {
      resizeError = 'The resized image cannot exceed 100 megapixels'
      return
    }
    if (extension === 'ico' && (width > 256 || height > 256)) {
      resizeError = 'ICO images cannot exceed 256 × 256'
      return
    }
    if (source) {
      const cropped = cropPixelDimensions(source.width, source.height, recipe)
      const unchanged = width === cropped.width && height === cropped.height
      commitRecipe({
        ...cloneImageRecipe(recipe),
        width: unchanged ? null : width,
        height: unchanged ? null : height
      })
    }
    resizeOpen = false
  }

  async function saveImage(): Promise<void> {
    if (!source || !isDirty || saving || diskChanged) return
    const path = absolutePath()
    if (!path) return
    const filename = filePath.split('/').pop() ?? filePath
    const confirmed = await requestConfirmation({
      title: `Overwrite ${filename}?`,
      message: `This will overwrite ${filename} with the edited image. This cannot be undone.`,
      confirmLabel: 'Overwrite Image',
      cancelLabel: 'Keep Editing',
      tone: 'danger'
    })
    if (!confirmed) return

    const requestId = crypto.randomUUID()
    activeRequestId = requestId
    saving = true
    error = null
    status = 'Saving image…'
    try {
      const result = await window.api.editImage(path, {
        requestId,
        expectedSha256: source.sha256,
        recipe: cloneImageRecipe(recipe)
      })
      if (tabId) markImageSaved(filePath, tabId, result)
      else {
        localDraft = createImageEditDraft()
        localDirty = false
        localDiskChanged = false
      }
      await loadImage()
      status = 'Image saved'
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('IMAGE_CHANGED')) {
        setDiskChanged(true)
        status = 'The image changed on disk'
      } else if (!message.includes('IMAGE_EDIT_CANCELLED')) {
        error = message
        status = 'Image could not be saved'
      } else {
        status = 'Save cancelled'
      }
    } finally {
      saving = false
      activeRequestId = null
    }
  }

  function cancelSave(): void {
    if (activeRequestId) void window.api.cancelImageEdit(activeRequestId)
  }

  async function applyEditsToLatest(): Promise<void> {
    setDiskChanged(false)
    await loadImage()
    if (error) setDiskChanged(true)
    else status = 'Edits applied to the latest image; review before saving'
  }

  async function discardAndReload(): Promise<void> {
    resetEdits()
    await loadImage()
    status = 'Latest image loaded'
  }

  function openInDefaultApp(): void {
    const path = absolutePath()
    if (path) void window.api.openPath(path)
  }

  function formatSize(bytes?: number): string {
    if (bytes == null) return ''
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  let resizeObserver: ResizeObserver | null = null
  let lastSaveSignal = 0
  let unsubscribeSave: (() => void) | null = null

  onMount(() => {
    if (stageEl && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(([entry]) => {
        stageWidth = entry.contentRect.width
        stageHeight = entry.contentRect.height
      })
      resizeObserver.observe(stageEl)
    } else if (stageEl) {
      stageWidth = stageEl.clientWidth
      stageHeight = stageEl.clientHeight
    }
    unsubscribeSave = imageSaveRequested.subscribe((signal) => {
      if (signal.counter === 0 || signal.counter === lastSaveSignal) return
      lastSaveSignal = signal.counter
      if (signal.tabId && signal.tabId !== tabId) return
      if (!signal.tabId && workspace.focusedTab?.id !== tabId) return
      void saveImage()
    })
  })

  onDestroy(() => {
    resizeObserver?.disconnect()
    unsubscribeSave?.()
    window.removeEventListener('pointermove', handleCropDrag)
    if (activeRequestId) void window.api.cancelImageEdit(activeRequestId)
  })

  $effect(() => {
    void filePath
    void collectionPath
    void tab?.imageRevision
    void loadImage()
  })
</script>

<div class="image-viewer">
  <div class="editor-toolbar" aria-label="Image editing tools">
    <div class="tool-group">
      <button class="tool-btn" onclick={() => rotate('left')} title="Rotate left 90°">
        <span class="material-symbols-outlined">rotate_left</span>
        <span>Left</span>
      </button>
      <button class="tool-btn" onclick={() => rotate('right')} title="Rotate right 90°">
        <span class="material-symbols-outlined">rotate_right</span>
        <span>Right</span>
      </button>
      <button class="tool-btn" class:active={cropMode} onclick={beginCrop}>
        <span class="material-symbols-outlined">crop</span>
        <span>Crop</span>
      </button>
      <button class="tool-btn" class:active={resizeOpen} onclick={openResize}>
        <span class="material-symbols-outlined">aspect_ratio</span>
        <span>Resize</span>
      </button>
    </div>

    <div class="tool-separator"></div>

    <div class="tool-group">
      <button class="icon-tool" onclick={undo} disabled={draft.undoStack.length === 0} title="Undo">
        <span class="material-symbols-outlined">undo</span>
      </button>
      <button class="icon-tool" onclick={redo} disabled={draft.redoStack.length === 0} title="Redo">
        <span class="material-symbols-outlined">redo</span>
      </button>
      <button class="tool-btn" onclick={resetEdits} disabled={!isDirty}>
        <span class="material-symbols-outlined">restart_alt</span>
        <span>Reset</span>
      </button>
    </div>

    <div class="toolbar-spacer"></div>
    <span class="overwrite-notice">
      <span class="material-symbols-outlined">warning</span>
      <span class="notice-text">Saving replaces the original image.</span>
    </span>
    {#if saving}
      <button class="cancel-save-btn" onclick={cancelSave}>Cancel</button>
    {:else}
      <button class="save-btn" onclick={saveImage} disabled={!isDirty || diskChanged}>
        <span class="material-symbols-outlined">save</span>
        <span>Save</span>
      </button>
    {/if}
  </div>

  {#if cropMode}
    <div class="edit-panel crop-panel">
      <span class="panel-label">Aspect</span>
      {#each ['free', 'original', '1:1', '4:3', '3:2', '16:9'] as preset}
        <button
          class="preset-btn"
          class:active={draft.aspectPreset === preset}
          onclick={() => selectAspect(preset as CropAspectPreset)}
        >
          {preset === 'free' ? 'Free' : preset === 'original' ? 'Original' : preset}
        </button>
      {/each}
      <div class="panel-spacer"></div>
      <button class="panel-btn" onclick={cancelCrop}>Cancel</button>
      <button class="panel-btn primary" onclick={applyCrop}>Apply Crop</button>
    </div>
  {:else if resizeOpen}
    <div class="edit-panel resize-panel">
      <label>
        <span>Width</span>
        <input
          type="number"
          min="1"
          max={imageExtension(filePath) === 'ico' ? 256 : MAX_DIMENSION}
          value={resizeWidth}
          oninput={(event) => handleResizeInput('width', event.currentTarget.value)}
        />
      </label>
      <button
        class="lock-btn"
        class:active={draft.resizeAspectLocked}
        onclick={toggleResizeLock}
        title={draft.resizeAspectLocked ? 'Unlock aspect ratio' : 'Lock aspect ratio'}
      >
        <span class="material-symbols-outlined">
          {draft.resizeAspectLocked ? 'link' : 'link_off'}
        </span>
      </button>
      <label>
        <span>Height</span>
        <input
          type="number"
          min="1"
          max={imageExtension(filePath) === 'ico' ? 256 : MAX_DIMENSION}
          value={resizeHeight}
          oninput={(event) => handleResizeInput('height', event.currentTarget.value)}
        />
      </label>
      <span class="resize-unit">px</span>
      {#if resizeError}<span class="validation-error">{resizeError}</span>{/if}
      <div class="panel-spacer"></div>
      <button class="panel-btn" onclick={() => (resizeOpen = false)}>Cancel</button>
      <button class="panel-btn primary" onclick={applyResize}>Apply Resize</button>
    </div>
  {/if}

  {#if diskChanged}
    <div class="conflict-banner" role="alert">
      <span class="material-symbols-outlined">sync_problem</span>
      <span>The image changed on disk while you had unsaved edits.</span>
      <div class="panel-spacer"></div>
      <button onclick={discardAndReload}>Discard edits and reload</button>
      <button class="primary" onclick={applyEditsToLatest}>Apply edits to latest</button>
    </div>
  {/if}

  <div class="image-stage" bind:this={stageEl} onwheel={handleWheel}>
    {#if loading}
      <div class="loading">
        <span class="material-symbols-outlined spinning">progress_activity</span>
        <span>Loading image…</span>
      </div>
    {:else if error && !dataUrl}
      <div class="error-state">
        <span class="material-symbols-outlined">error</span>
        <span>{error}</span>
        <button onclick={loadImage}>Retry</button>
      </div>
    {:else if dataUrl && source}
      <div
        class="image-surface"
        bind:this={surfaceEl}
        style:width={`${surfaceWidth}px`}
        style:height={`${surfaceHeight}px`}
      >
        <img
          src={dataUrl}
          alt={filePath.split('/').pop()}
          style:width={`${renderedSourceWidth}px`}
          style:height={`${renderedSourceHeight}px`}
          style:transform={`translate(-50%, -50%) rotate(${recipe.rotation}deg)`}
          draggable="false"
        />

        {#if recipe.crop || cropMode}
          <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
          <div
            class="crop-selection"
            class:editable={cropMode}
            style:left={`${activeCrop.x * 100}%`}
            style:top={`${activeCrop.y * 100}%`}
            style:width={`${activeCrop.width * 100}%`}
            style:height={`${activeCrop.height * 100}%`}
            role={cropMode ? 'application' : undefined}
            aria-label={cropMode ? 'Crop selection. Use arrow keys to move.' : undefined}
            tabindex={cropMode ? 0 : undefined}
            onkeydown={handleCropKeydown}
            onpointerdown={(event) => cropMode && beginCropDrag(event, 'move')}
          >
            {#if cropMode}
              {#each ['nw', 'ne', 'sw', 'se'] as handle}
                <button
                  class="crop-handle {handle}"
                  aria-label="Resize crop from {handle.toUpperCase()} corner"
                  onpointerdown={(event) =>
                    beginCropDrag(event, handle as Exclude<DragState['mode'], 'move'>)}
                ></button>
              {/each}
              <span class="crop-size">
                {Math.max(1, Math.round(oriented.width * activeCrop.width))} ×
                {Math.max(1, Math.round(oriented.height * activeCrop.height))}
              </span>
            {/if}
          </div>
        {/if}
      </div>
    {/if}
  </div>

  <div class="info-bar">
    <span class="filename">{filePath.split('/').pop()}</span>
    {#if source}
      <span class="dimensions">
        {source.width} × {source.height}
        {#if isDirty}
          <span class="dimension-arrow">→</span>
          <strong>{output.width} × {output.height}</strong>
        {/if}
      </span>
    {/if}
    <span class="size">{formatSize(source?.size ?? fileSize)}</span>
    <span class="status" aria-live="polite">{status ?? ''}</span>
    {#if error && dataUrl}<span class="inline-error">{error}</span>{/if}
    <div class="spacer"></div>
    <button
      class="zoom-btn"
      onclick={openInDefaultApp}
      title="Open in Default App"
      aria-label="Open in Default App"
    >
      <span class="material-symbols-outlined">open_in_new</span>
    </button>
    <button
      class="zoom-btn"
      onclick={fitToView}
      title="Fit to view"
      class:active={fitMode === 'fit'}
    >
      <span class="material-symbols-outlined">fit_screen</span>
    </button>
    <button
      class="zoom-btn"
      onclick={actualSize}
      title="Actual size"
      class:active={fitMode === 'actual' && zoom === 1}
    >
      <span class="material-symbols-outlined">crop_original</span>
    </button>
    {#if fitMode === 'actual'}<span class="zoom-level">{Math.round(zoom * 100)}%</span>{/if}
  </div>
</div>

<style>
  .image-viewer {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: var(--color-surface-dark, #0a0a0a);
    overflow: hidden;
  }

  .editor-toolbar,
  .edit-panel,
  .conflict-banner,
  .info-bar {
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .editor-toolbar {
    min-height: 42px;
    gap: 8px;
    padding: 6px 12px;
    background: var(--color-bg, #0f0f10);
    border-bottom: 1px solid var(--color-border, #27272a);
  }

  .tool-group {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  button {
    font: inherit;
  }

  .tool-btn,
  .icon-tool,
  .panel-btn,
  .preset-btn,
  .lock-btn,
  .zoom-btn,
  .cancel-save-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    min-height: 28px;
    border: 1px solid var(--color-border, #27272a);
    border-radius: 5px;
    background: var(--color-surface, #161617);
    color: var(--color-text-dim, #71717a);
    cursor: pointer;
  }

  .tool-btn {
    padding: 3px 8px;
    font-size: 11px;
  }

  .icon-tool,
  .lock-btn,
  .zoom-btn {
    width: 30px;
    padding: 2px;
  }

  button:hover:not(:disabled),
  button.active {
    color: var(--color-text, #e4e4e7);
    border-color: var(--color-primary, #00e5ff);
  }

  button.active {
    color: var(--color-primary, #00e5ff);
    background: color-mix(in srgb, var(--color-primary, #00e5ff) 10%, transparent);
  }

  button:focus-visible {
    outline: 2px solid var(--color-primary, #00e5ff);
    outline-offset: 2px;
  }

  button:disabled {
    opacity: 0.35;
    cursor: default;
  }

  .material-symbols-outlined {
    font-size: 17px;
  }

  .tool-separator {
    width: 1px;
    height: 24px;
    background: var(--color-border, #27272a);
  }

  .toolbar-spacer,
  .panel-spacer,
  .spacer {
    flex: 1;
  }

  .overwrite-notice {
    display: flex;
    align-items: center;
    gap: 5px;
    color: var(--color-text-dim, #71717a);
    font-size: 11px;
  }

  .overwrite-notice .material-symbols-outlined {
    color: var(--color-warning, #f59e0b);
  }

  .save-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: 30px;
    padding: 4px 12px;
    border: 1px solid var(--color-primary, #00e5ff);
    border-radius: 5px;
    background: var(--color-primary, #00e5ff);
    color: #001014;
    font-size: 12px;
    font-weight: 700;
    cursor: pointer;
  }

  .save-btn:hover:not(:disabled) {
    filter: brightness(1.08);
  }

  .cancel-save-btn {
    padding: 3px 10px;
    color: var(--color-warning, #f59e0b);
  }

  .edit-panel,
  .conflict-banner {
    min-height: 38px;
    gap: 7px;
    padding: 5px 12px;
    background: var(--color-surface, #161617);
    border-bottom: 1px solid var(--color-border, #27272a);
    font-size: 11px;
  }

  .panel-label,
  .resize-panel label span,
  .resize-unit {
    color: var(--color-text-dim, #71717a);
  }

  .preset-btn,
  .panel-btn {
    min-height: 25px;
    padding: 2px 8px;
    font-size: 11px;
  }

  .panel-btn.primary,
  .conflict-banner button.primary {
    border-color: var(--color-primary, #00e5ff);
    color: var(--color-primary, #00e5ff);
  }

  .resize-panel label {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .resize-panel input {
    width: 86px;
    height: 26px;
    padding: 2px 7px;
    border: 1px solid var(--color-border, #27272a);
    border-radius: 4px;
    background: var(--color-surface-dark, #0a0a0a);
    color: var(--color-text, #e4e4e7);
    font-family: var(--font-mono, monospace);
  }

  .validation-error,
  .inline-error {
    color: var(--color-error, #ef4444);
  }

  .conflict-banner {
    color: var(--color-warning, #f59e0b);
    background: color-mix(in srgb, var(--color-warning, #f59e0b) 9%, var(--color-surface, #161617));
  }

  .conflict-banner button {
    padding: 4px 8px;
    border: 1px solid currentColor;
    border-radius: 4px;
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  .image-stage {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: auto;
    padding: 24px;
    background-color: var(--color-surface-dark, #0a0a0a);
    background-image:
      linear-gradient(45deg, rgba(255, 255, 255, 0.025) 25%, transparent 25%),
      linear-gradient(-45deg, rgba(255, 255, 255, 0.025) 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, rgba(255, 255, 255, 0.025) 75%),
      linear-gradient(-45deg, transparent 75%, rgba(255, 255, 255, 0.025) 75%);
    background-size: 20px 20px;
    background-position:
      0 0,
      0 10px,
      10px -10px,
      -10px 0;
  }

  .image-surface {
    position: relative;
    flex: 0 0 auto;
    overflow: hidden;
    box-shadow: 0 8px 30px rgba(0, 0, 0, 0.35);
  }

  .image-surface img {
    position: absolute;
    left: 50%;
    top: 50%;
    max-width: none;
    max-height: none;
    transform-origin: center;
    user-select: none;
    transition: transform 120ms ease-out;
  }

  .crop-selection {
    position: absolute;
    border: 1px solid var(--color-primary, #00e5ff);
    box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.56);
    pointer-events: none;
  }

  .crop-selection.editable {
    pointer-events: auto;
    cursor: move;
  }

  .crop-selection::before,
  .crop-selection::after {
    content: '';
    position: absolute;
    inset: 33.333% 0;
    border-top: 1px solid rgba(255, 255, 255, 0.35);
    border-bottom: 1px solid rgba(255, 255, 255, 0.35);
    pointer-events: none;
  }

  .crop-selection::after {
    inset: 0 33.333%;
    border: 0;
    border-left: 1px solid rgba(255, 255, 255, 0.35);
    border-right: 1px solid rgba(255, 255, 255, 0.35);
  }

  .crop-handle {
    position: absolute;
    width: 12px;
    height: 12px;
    padding: 0;
    border: 2px solid var(--color-primary, #00e5ff);
    border-radius: 2px;
    background: var(--color-surface-dark, #0a0a0a);
  }

  .crop-handle.nw {
    left: -6px;
    top: -6px;
    cursor: nwse-resize;
  }

  .crop-handle.ne {
    right: -6px;
    top: -6px;
    cursor: nesw-resize;
  }

  .crop-handle.sw {
    left: -6px;
    bottom: -6px;
    cursor: nesw-resize;
  }

  .crop-handle.se {
    right: -6px;
    bottom: -6px;
    cursor: nwse-resize;
  }

  .crop-size {
    position: absolute;
    left: 50%;
    bottom: 8px;
    transform: translateX(-50%);
    padding: 2px 5px;
    border-radius: 3px;
    background: rgba(0, 0, 0, 0.72);
    color: white;
    font: 10px var(--font-mono, monospace);
    white-space: nowrap;
    pointer-events: none;
  }

  .loading,
  .error-state {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: var(--color-text-dim, #71717a);
    font-size: 13px;
  }

  .error-state {
    color: var(--color-error, #ef4444);
  }

  .error-state button {
    border: 1px solid currentColor;
    border-radius: 4px;
    background: transparent;
    color: inherit;
    padding: 3px 8px;
    cursor: pointer;
  }

  .spinning {
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }

  .info-bar {
    gap: 12px;
    min-height: 35px;
    padding: 6px 12px;
    background: var(--color-surface, #161617);
    border-top: 1px solid var(--color-border, #27272a);
    font-size: 11px;
    color: var(--color-text-dim, #71717a);
  }

  .filename,
  .zoom-level,
  .dimensions {
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
  }

  .filename {
    color: var(--color-text, #e4e4e7);
  }

  .dimension-arrow {
    padding: 0 4px;
  }

  .dimensions strong {
    color: var(--color-primary, #00e5ff);
  }

  .status {
    color: var(--color-text, #e4e4e7);
  }

  .zoom-btn {
    min-height: 24px;
    height: 24px;
  }

  .zoom-level {
    min-width: 40px;
    text-align: right;
  }

  @media (max-width: 760px) {
    .overwrite-notice .notice-text {
      display: none;
    }

    .tool-btn span:last-child {
      display: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .spinning {
      animation: none;
    }

    .image-surface img {
      transition: none;
    }
  }
</style>
