import { describe, it, expect, beforeEach } from 'vitest'
import { get } from 'svelte/store'
import {
  canGoBack,
  canGoForward,
  recordNavigation,
  goBack,
  goForward,
  setNavigating,
  clearNavigation,
} from '@renderer/stores/navigation'

describe('navigation store', () => {
  beforeEach(() => {
    clearNavigation()
  })

  it('starts with no back/forward available', () => {
    expect(get(canGoBack)).toBe(false)
    expect(get(canGoForward)).toBe(false)
  })

  it('cannot go back after one navigation', () => {
    recordNavigation('file-a.md')
    expect(get(canGoBack)).toBe(false)
    expect(get(canGoForward)).toBe(false)
  })

  it('can go back after two navigations', () => {
    recordNavigation('file-a.md')
    recordNavigation('file-b.md')
    expect(get(canGoBack)).toBe(true)
    expect(get(canGoForward)).toBe(false)
  })

  it('goBack returns the previous path', () => {
    recordNavigation('file-a.md')
    recordNavigation('file-b.md')
    const path = goBack()
    expect(path).toBe('file-a.md')
    expect(get(canGoBack)).toBe(false)
    expect(get(canGoForward)).toBe(true)
  })

  it('goForward returns the path we came back from', () => {
    recordNavigation('file-a.md')
    recordNavigation('file-b.md')
    goBack()
    const path = goForward()
    expect(path).toBe('file-b.md')
    expect(get(canGoBack)).toBe(true)
    expect(get(canGoForward)).toBe(false)
  })

  it('new navigation clears forward stack', () => {
    recordNavigation('file-a.md')
    recordNavigation('file-b.md')
    goBack() // back to a, forward has b
    recordNavigation('file-c.md') // should clear forward
    expect(get(canGoForward)).toBe(false)
    expect(get(canGoBack)).toBe(true)
  })

  it('does not record duplicate consecutive navigations', () => {
    recordNavigation('file-a.md')
    recordNavigation('file-a.md')
    expect(get(canGoBack)).toBe(false)
  })

  it('does not record when navigating flag is set', () => {
    recordNavigation('file-a.md')
    setNavigating(true)
    recordNavigation('file-b.md')
    setNavigating(false)
    expect(get(canGoBack)).toBe(false)
  })

  it('handles multi-step back navigation', () => {
    recordNavigation('a.md')
    recordNavigation('b.md')
    recordNavigation('c.md')
    recordNavigation('d.md')

    expect(goBack()).toBe('c.md')
    expect(goBack()).toBe('b.md')
    expect(goBack()).toBe('a.md')
    expect(goBack()).toBeNull()
    expect(get(canGoBack)).toBe(false)

    expect(goForward()).toBe('b.md')
    expect(goForward()).toBe('c.md')
    expect(goForward()).toBe('d.md')
    expect(goForward()).toBeNull()
    expect(get(canGoForward)).toBe(false)
  })

  it('clearNavigation resets everything', () => {
    recordNavigation('a.md')
    recordNavigation('b.md')
    clearNavigation()
    expect(get(canGoBack)).toBe(false)
    expect(get(canGoForward)).toBe(false)
    expect(goBack()).toBeNull()
  })

  it('recordNavigation with null does not push to stack', () => {
    recordNavigation('a.md')
    recordNavigation(null)
    // null clears current without pushing, so navigating to b.md
    // won't have a.md in the back stack (current was cleared)
    recordNavigation('b.md')
    expect(get(canGoBack)).toBe(false)
  })
})
