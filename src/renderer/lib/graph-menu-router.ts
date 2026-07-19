import type { GraphMenuAction } from '../stores/graph'

export interface GraphMenuController {
  presentationActive: boolean
  presentationPaused: boolean
  shapesAvailable: boolean
  search: () => void
  recenter: () => void
  toggleLabels: () => void
  toggleLines: () => void
  toggleShapes: () => void
  startPresentation: () => void
  pausePresentation: () => void
  continuePresentation: () => void
  resetPresentation: () => void
  screenshot: (transparent: boolean) => void
}

/** Route a native Graph-menu action through the same controller used by GraphView UI. */
export function routeGraphMenuAction(
  action: GraphMenuAction,
  controller: GraphMenuController
): void {
  switch (action) {
    case 'search':
      controller.search()
      break
    case 'recenter':
      controller.recenter()
      break
    case 'toggle-labels':
      controller.toggleLabels()
      break
    case 'toggle-lines':
      controller.toggleLines()
      break
    case 'toggle-shapes':
      if (controller.shapesAvailable) controller.toggleShapes()
      break
    case 'presentation-toggle':
      if (!controller.presentationActive) controller.startPresentation()
      else if (controller.presentationPaused) controller.continuePresentation()
      else controller.pausePresentation()
      break
    case 'presentation-reset':
      if (controller.presentationActive) controller.resetPresentation()
      break
    case 'screenshot':
      controller.screenshot(false)
      break
    case 'screenshot-transparent':
      controller.screenshot(true)
      break
  }
}
