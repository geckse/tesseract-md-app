/**
 * Virtual List Utilities
 *
 * Provides utilities for efficiently rendering large lists by only rendering
 * visible items plus a buffer. Uses fixed item heights for accurate calculations.
 */

/**
 * Configuration for a virtual list.
 */
export interface VirtualListConfig {
  /** Height of each item in pixels (must be fixed for accurate calculations). */
  itemHeight: number
  /** Number of items to render above and below the visible area (default: 10). */
  buffer?: number
  /** Total number of items in the list. */
  totalItems: number
}

/**
 * The visible range of items to render.
 */
export interface VisibleRange {
  /** Index of the first item to render (inclusive). */
  start: number
  /** Index of the last item to render (exclusive). */
  end: number
}

/**
 * Virtual list state including visible range and scroll position.
 */
export interface VirtualListState extends VisibleRange {
  /** Total height of the virtual container in pixels. */
  totalHeight: number
  /** Offset from the top for the first rendered item in pixels. */
  offsetY: number
}

/**
 * Calculate which items should be rendered based on scroll position.
 *
 * This function determines the visible range of items plus a buffer above
 * and below to ensure smooth scrolling without pop-in.
 *
 * @param scrollTop - Current vertical scroll position in pixels
 * @param containerHeight - Height of the visible container in pixels
 * @param itemHeight - Fixed height of each item in pixels
 * @param totalItems - Total number of items in the list
 * @param buffer - Number of items to render above/below viewport (default: 10)
 * @returns The range of items to render (start inclusive, end exclusive)
 *
 * @example
 * ```ts
 * const range = calculateVisibleRange(500, 600, 32, 1000, 10)
 * // range = { start: 5, end: 45 }
 * // Renders items 5-44 (visible items ~15-34, plus 10 buffer on each side)
 * ```
 */
export function calculateVisibleRange(
  scrollTop: number,
  containerHeight: number,
  itemHeight: number,
  totalItems: number,
  buffer: number = 10
): VisibleRange {
  // Calculate the index of the first fully visible item
  const firstVisibleIndex = Math.floor(scrollTop / itemHeight)

  // Calculate how many items can fit in the viewport
  const visibleCount = Math.ceil(containerHeight / itemHeight)

  // Add buffer above (but don't go below 0)
  const start = Math.max(0, firstVisibleIndex - buffer)

  // Add visible count plus buffer below (but don't exceed total)
  const end = Math.min(totalItems, firstVisibleIndex + visibleCount + buffer)

  return { start, end }
}

/**
 * Calculate the complete virtual list state including positioning.
 *
 * This function calculates not just the visible range but also the total
 * container height and the offset for the first rendered item.
 *
 * @param scrollTop - Current vertical scroll position in pixels
 * @param containerHeight - Height of the visible container in pixels
 * @param config - Virtual list configuration
 * @returns Complete virtual list state
 *
 * @example
 * ```ts
 * const state = calculateVirtualListState(500, 600, {
 *   itemHeight: 32,
 *   totalItems: 1000,
 *   buffer: 10
 * })
 * // state = {
 * //   start: 5,
 * //   end: 45,
 * //   totalHeight: 32000,
 * //   offsetY: 160
 * // }
 * ```
 */
export function calculateVirtualListState(
  scrollTop: number,
  containerHeight: number,
  config: VirtualListConfig
): VirtualListState {
  const { itemHeight, totalItems, buffer = 10 } = config

  // Calculate visible range
  const range = calculateVisibleRange(
    scrollTop,
    containerHeight,
    itemHeight,
    totalItems,
    buffer
  )

  // Calculate total height of the virtual container
  const totalHeight = totalItems * itemHeight

  // Calculate offset for the first rendered item
  const offsetY = range.start * itemHeight

  return {
    ...range,
    totalHeight,
    offsetY,
  }
}

/**
 * Get the style object for positioning a virtual list item.
 *
 * This function returns the CSS transform to position an item at the
 * correct vertical offset within the virtual list.
 *
 * @param index - Item index in the full list
 * @param itemHeight - Fixed height of each item in pixels
 * @param startIndex - Index of the first rendered item
 * @returns Style object with transform for positioning
 *
 * @example
 * ```ts
 * const style = getItemStyle(20, 32, 10)
 * // style = { transform: 'translateY(640px)' }
 * ```
 */
export function getItemStyle(
  index: number,
  itemHeight: number,
  startIndex: number
): { transform: string } {
  // Calculate the absolute position from the top
  const absoluteY = index * itemHeight

  return {
    transform: `translateY(${absoluteY}px)`,
  }
}

/**
 * Throttle scroll event handler to run at most 60fps.
 *
 * This prevents excessive recalculations during fast scrolling.
 *
 * @param callback - Function to call on scroll
 * @returns Throttled scroll handler
 *
 * @example
 * ```ts
 * const handleScroll = throttleScroll((e) => {
 *   const scrollTop = e.currentTarget.scrollTop
 *   // Update visible range...
 * })
 * ```
 */
export function throttleScroll<T extends Event>(
  callback: (event: T) => void
): (event: T) => void {
  let frameId: number | null = null

  return (event: T) => {
    // If already scheduled, skip this event
    if (frameId !== null) return

    // Schedule callback for next animation frame (~60fps)
    frameId = requestAnimationFrame(() => {
      callback(event)
      frameId = null
    })
  }
}

/**
 * Calculate the index of the item at a given Y coordinate.
 *
 * Useful for click/hover interactions with virtual list items.
 *
 * @param y - Y coordinate relative to the list container
 * @param itemHeight - Fixed height of each item in pixels
 * @returns Item index at the given Y coordinate
 *
 * @example
 * ```ts
 * const index = getItemIndexAtY(500, 32)
 * // index = 15
 * ```
 */
export function getItemIndexAtY(y: number, itemHeight: number): number {
  return Math.floor(y / itemHeight)
}

/**
 * Scroll to a specific item index in a virtual list.
 *
 * @param index - Index of the item to scroll to
 * @param itemHeight - Fixed height of each item in pixels
 * @param containerHeight - Height of the visible container in pixels
 * @param align - How to align the item ('start' | 'center' | 'end', default: 'start')
 * @returns The scroll position to set
 *
 * @example
 * ```ts
 * const scrollTop = scrollToIndex(50, 32, 600, 'center')
 * container.scrollTop = scrollTop
 * ```
 */
export function scrollToIndex(
  index: number,
  itemHeight: number,
  containerHeight: number,
  align: 'start' | 'center' | 'end' = 'start'
): number {
  const itemTop = index * itemHeight

  switch (align) {
    case 'start':
      return itemTop
    case 'center':
      return itemTop - containerHeight / 2 + itemHeight / 2
    case 'end':
      return itemTop - containerHeight + itemHeight
    default:
      return itemTop
  }
}
