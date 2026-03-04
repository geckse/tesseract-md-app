import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  calculateVisibleRange,
  calculateVirtualListState,
  getItemStyle,
  throttleScroll,
  getItemIndexAtY,
  scrollToIndex,
  type VirtualListConfig,
  type VisibleRange,
  type VirtualListState
} from '@renderer/lib/virtual-list'

describe('calculateVisibleRange', () => {
  it('calculates basic visible range with default buffer', () => {
    // 500px scrolled, 600px container, 32px items, 1000 total items
    const range = calculateVisibleRange(500, 600, 32, 1000)

    expect(range.start).toBeGreaterThanOrEqual(0)
    expect(range.end).toBeLessThanOrEqual(1000)
    expect(range.end).toBeGreaterThan(range.start)
  })

  it('includes buffer above and below visible range', () => {
    const buffer = 10
    const itemHeight = 32
    const scrollTop = 500
    const containerHeight = 600

    const firstVisibleIndex = Math.floor(scrollTop / itemHeight) // 15
    const visibleCount = Math.ceil(containerHeight / itemHeight) // 19

    const range = calculateVisibleRange(scrollTop, containerHeight, itemHeight, 1000, buffer)

    // Should start at least buffer items before first visible
    expect(range.start).toBeLessThanOrEqual(firstVisibleIndex)
    // Should end at least buffer items after last visible
    expect(range.end).toBeGreaterThanOrEqual(firstVisibleIndex + visibleCount)
  })

  it('does not go below 0 for start index', () => {
    const range = calculateVisibleRange(0, 600, 32, 1000, 10)
    expect(range.start).toBe(0)
  })

  it('does not exceed total items for end index', () => {
    const totalItems = 100
    // Scroll near the end
    const range = calculateVisibleRange(3000, 600, 32, totalItems, 10)
    expect(range.end).toBeLessThanOrEqual(totalItems)
  })

  it('handles zero scroll position', () => {
    const range = calculateVisibleRange(0, 600, 32, 1000, 10)
    expect(range.start).toBe(0)
    expect(range.end).toBeGreaterThan(0)
  })

  it('handles custom buffer size', () => {
    const range1 = calculateVisibleRange(500, 600, 32, 1000, 5)
    const range2 = calculateVisibleRange(500, 600, 32, 1000, 20)

    // Larger buffer should have wider range
    expect(range2.end - range2.start).toBeGreaterThan(range1.end - range1.start)
  })

  it('handles small item height', () => {
    const range = calculateVisibleRange(500, 600, 10, 1000, 5)
    expect(range.start).toBeGreaterThanOrEqual(0)
    expect(range.end).toBeLessThanOrEqual(1000)
  })

  it('handles large item height', () => {
    const range = calculateVisibleRange(500, 600, 100, 1000, 5)
    expect(range.start).toBeGreaterThanOrEqual(0)
    expect(range.end).toBeLessThanOrEqual(1000)
  })

  it('handles single item visible', () => {
    const range = calculateVisibleRange(0, 100, 100, 1000, 0)
    expect(range.start).toBe(0)
    expect(range.end).toBe(1)
  })

  it('handles buffer larger than visible items', () => {
    const range = calculateVisibleRange(500, 100, 32, 1000, 50)
    expect(range.start).toBeGreaterThanOrEqual(0)
    expect(range.end).toBeLessThanOrEqual(1000)
    expect(range.end - range.start).toBeGreaterThan(0)
  })
})

describe('calculateVirtualListState', () => {
  it('calculates complete virtual list state', () => {
    const config: VirtualListConfig = {
      itemHeight: 32,
      totalItems: 1000,
      buffer: 10
    }

    const state = calculateVirtualListState(500, 600, config)

    expect(state).toHaveProperty('start')
    expect(state).toHaveProperty('end')
    expect(state).toHaveProperty('totalHeight')
    expect(state).toHaveProperty('offsetY')
  })

  it('calculates correct total height', () => {
    const config: VirtualListConfig = {
      itemHeight: 32,
      totalItems: 1000,
      buffer: 10
    }

    const state = calculateVirtualListState(500, 600, config)
    expect(state.totalHeight).toBe(32000) // 1000 * 32
  })

  it('calculates correct offset for first rendered item', () => {
    const config: VirtualListConfig = {
      itemHeight: 32,
      totalItems: 1000,
      buffer: 10
    }

    const state = calculateVirtualListState(500, 600, config)
    expect(state.offsetY).toBe(state.start * 32)
  })

  it('uses default buffer when not specified', () => {
    const config: VirtualListConfig = {
      itemHeight: 32,
      totalItems: 1000
    }

    const state = calculateVirtualListState(500, 600, config)
    expect(state.start).toBeGreaterThanOrEqual(0)
    expect(state.end).toBeLessThanOrEqual(1000)
  })

  it('handles empty list', () => {
    const config: VirtualListConfig = {
      itemHeight: 32,
      totalItems: 0,
      buffer: 10
    }

    const state = calculateVirtualListState(0, 600, config)
    expect(state.totalHeight).toBe(0)
    expect(state.start).toBe(0)
    expect(state.end).toBe(0)
  })

  it('handles single item list', () => {
    const config: VirtualListConfig = {
      itemHeight: 32,
      totalItems: 1,
      buffer: 10
    }

    const state = calculateVirtualListState(0, 600, config)
    expect(state.totalHeight).toBe(32)
    expect(state.start).toBe(0)
    expect(state.end).toBe(1)
  })

  it('produces consistent state for same inputs', () => {
    const config: VirtualListConfig = {
      itemHeight: 32,
      totalItems: 1000,
      buffer: 10
    }

    const state1 = calculateVirtualListState(500, 600, config)
    const state2 = calculateVirtualListState(500, 600, config)

    expect(state1).toEqual(state2)
  })
})

describe('getItemStyle', () => {
  it('returns correct transform for item at index 0', () => {
    const style = getItemStyle(0, 32, 0)
    expect(style.transform).toBe('translateY(0px)')
  })

  it('returns correct transform for item at arbitrary index', () => {
    const style = getItemStyle(20, 32, 10)
    expect(style.transform).toBe('translateY(640px)') // 20 * 32
  })

  it('calculates absolute position regardless of startIndex', () => {
    const style1 = getItemStyle(20, 32, 0)
    const style2 = getItemStyle(20, 32, 10)
    const style3 = getItemStyle(20, 32, 30)

    // All should have same transform (absolute positioning)
    expect(style1.transform).toBe(style2.transform)
    expect(style2.transform).toBe(style3.transform)
  })

  it('handles large indices', () => {
    const style = getItemStyle(999, 32, 0)
    expect(style.transform).toBe('translateY(31968px)') // 999 * 32
  })

  it('handles different item heights', () => {
    const style1 = getItemStyle(10, 32, 0)
    const style2 = getItemStyle(10, 50, 0)

    expect(style1.transform).toBe('translateY(320px)')
    expect(style2.transform).toBe('translateY(500px)')
  })
})

describe('throttleScroll', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function makeScrollEvent(scrollTop: number): Event {
    const event = new Event('scroll')
    Object.defineProperty(event, 'currentTarget', {
      value: { scrollTop },
      writable: false,
    })
    return event
  }

  it('calls callback on first event with scrollTop', () => {
    const callback = vi.fn()
    const throttled = throttleScroll(callback)

    throttled(makeScrollEvent(42))

    // Callback is scheduled, run animation frame
    vi.runAllTimers()
    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith(42)
  })

  it('throttles multiple rapid events', () => {
    const callback = vi.fn()
    const throttled = throttleScroll(callback)

    // Fire multiple events rapidly
    throttled(makeScrollEvent(10))
    throttled(makeScrollEvent(20))
    throttled(makeScrollEvent(30))

    // Only first event should trigger callback
    vi.runAllTimers()
    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith(10)
  })

  it('allows events after animation frame completes', () => {
    const callback = vi.fn()
    const throttled = throttleScroll(callback)

    // First event
    throttled(makeScrollEvent(100))
    vi.runAllTimers()
    expect(callback).toHaveBeenCalledTimes(1)

    // Second event after frame completes
    throttled(makeScrollEvent(200))
    vi.runAllTimers()
    expect(callback).toHaveBeenCalledTimes(2)
  })

  it('ignores events with null currentTarget', () => {
    const callback = vi.fn()
    const throttled = throttleScroll(callback)

    // Event with no currentTarget
    throttled(new Event('scroll'))
    vi.runAllTimers()

    expect(callback).not.toHaveBeenCalled()
  })
})

describe('getItemIndexAtY', () => {
  it('returns 0 for Y coordinate 0', () => {
    const index = getItemIndexAtY(0, 32)
    expect(index).toBe(0)
  })

  it('calculates correct index for arbitrary Y coordinate', () => {
    const index = getItemIndexAtY(500, 32)
    expect(index).toBe(15) // Math.floor(500 / 32)
  })

  it('floors fractional results', () => {
    const index = getItemIndexAtY(100, 32)
    expect(index).toBe(3) // Math.floor(100 / 32) = Math.floor(3.125)
  })

  it('handles different item heights', () => {
    const index1 = getItemIndexAtY(500, 32)
    const index2 = getItemIndexAtY(500, 50)

    expect(index1).toBe(15)
    expect(index2).toBe(10)
  })

  it('handles large Y coordinates', () => {
    const index = getItemIndexAtY(10000, 32)
    expect(index).toBe(312) // Math.floor(10000 / 32)
  })

  it('handles small item heights', () => {
    const index = getItemIndexAtY(100, 10)
    expect(index).toBe(10)
  })
})

describe('scrollToIndex', () => {
  it('scrolls to start alignment by default', () => {
    const scrollTop = scrollToIndex(50, 32, 600)
    expect(scrollTop).toBe(1600) // 50 * 32
  })

  it('scrolls to start alignment explicitly', () => {
    const scrollTop = scrollToIndex(50, 32, 600, 'start')
    expect(scrollTop).toBe(1600) // 50 * 32
  })

  it('scrolls to center alignment', () => {
    const scrollTop = scrollToIndex(50, 32, 600, 'center')
    // itemTop = 50 * 32 = 1600
    // center = 1600 - 600/2 + 32/2 = 1600 - 300 + 16 = 1316
    expect(scrollTop).toBe(1316)
  })

  it('scrolls to end alignment', () => {
    const scrollTop = scrollToIndex(50, 32, 600, 'end')
    // itemTop = 50 * 32 = 1600
    // end = 1600 - 600 + 32 = 1032
    expect(scrollTop).toBe(1032)
  })

  it('handles index 0', () => {
    const scrollTop = scrollToIndex(0, 32, 600, 'start')
    expect(scrollTop).toBe(0)
  })

  it('handles different container heights', () => {
    const scrollTop1 = scrollToIndex(50, 32, 400, 'center')
    const scrollTop2 = scrollToIndex(50, 32, 800, 'center')

    // Different container heights should produce different scroll positions for center
    expect(scrollTop1).not.toBe(scrollTop2)
  })

  it('handles different item heights', () => {
    const scrollTop1 = scrollToIndex(50, 32, 600, 'start')
    const scrollTop2 = scrollToIndex(50, 64, 600, 'start')

    expect(scrollTop1).toBe(1600)
    expect(scrollTop2).toBe(3200)
  })

  it('can produce negative scroll for center alignment near top', () => {
    // Item 2 with large container
    const scrollTop = scrollToIndex(2, 32, 1000, 'center')
    // itemTop = 2 * 32 = 64
    // center = 64 - 1000/2 + 32/2 = 64 - 500 + 16 = -420
    expect(scrollTop).toBe(-420)
  })
})
