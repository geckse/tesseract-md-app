import { describe, it, expect, beforeEach } from 'vitest'
import { focusTrap } from '../../src/renderer/lib/focus-trap'

function pressTab(target: Element, shiftKey = false): void {
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true })
  )
}

describe('focusTrap', () => {
  let outside: HTMLButtonElement
  let container: HTMLDivElement
  let first: HTMLButtonElement
  let middle: HTMLInputElement
  let last: HTMLButtonElement

  beforeEach(() => {
    document.body.innerHTML = ''

    outside = document.createElement('button')
    outside.textContent = 'outside'
    document.body.appendChild(outside)

    container = document.createElement('div')
    first = document.createElement('button')
    first.textContent = 'first'
    middle = document.createElement('input')
    last = document.createElement('button')
    last.textContent = 'last'
    container.append(first, middle, last)
    document.body.appendChild(container)
  })

  it('focuses the first focusable child on mount', () => {
    outside.focus()
    focusTrap(container)

    expect(document.activeElement).toBe(first)
  })

  it('prefers an [autofocus] element on mount', () => {
    middle.setAttribute('autofocus', '')
    focusTrap(container)

    expect(document.activeElement).toBe(middle)
  })

  it('wraps Tab from the last element to the first', () => {
    focusTrap(container)
    last.focus()

    pressTab(last)

    expect(document.activeElement).toBe(first)
  })

  it('wraps Shift+Tab from the first element to the last', () => {
    focusTrap(container)
    first.focus()

    pressTab(first, true)

    expect(document.activeElement).toBe(last)
  })

  it('does not intercept Tab between middle elements', () => {
    focusTrap(container)
    first.focus()

    const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    first.dispatchEvent(event)

    // Not at the boundary — the trap must not preventDefault (browser moves focus natively)
    expect(event.defaultPrevented).toBe(false)
  })

  it('restores focus to the previously focused element on destroy', () => {
    outside.focus()
    const trap = focusTrap(container)
    expect(document.activeElement).toBe(first)

    trap.destroy()

    expect(document.activeElement).toBe(outside)
  })

  it('skips disabled and hidden elements', () => {
    first.disabled = true
    middle.hidden = true
    focusTrap(container)

    expect(document.activeElement).toBe(last)
  })
})
