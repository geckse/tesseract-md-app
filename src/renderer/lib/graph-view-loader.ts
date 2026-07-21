type ImportedGraphViewModule = typeof import('../components/GraphView.svelte')
type GraphViewModule = ImportedGraphViewModule & { clearGraphStateCache(): void }

let loadedModule: GraphViewModule | null = null
let componentPromise: Promise<ImportedGraphViewModule['default']> | null = null

/**
 * Load the heavyweight graph component on first use. Every graph surface uses
 * this shared promise so split panes and graph popouts never start duplicate
 * module loads.
 */
export function loadGraphViewComponent(): Promise<ImportedGraphViewModule['default']> {
  if (componentPromise) return componentPromise

  componentPromise = import('../components/GraphView.svelte')
    .then((module) => {
      loadedModule = module as GraphViewModule
      return module.default
    })
    .catch((error: unknown) => {
      // A retry should start a fresh import rather than retain a rejected promise.
      componentPromise = null
      throw error
    })

  return componentPromise
}

/** Clear GraphView's remount caches without importing GraphView just to do so. */
export function clearLoadedGraphStateCache(): void {
  loadedModule?.clearGraphStateCache()
}
