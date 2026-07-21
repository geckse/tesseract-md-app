/**
 * Svelte action that traps keyboard focus inside a container (for modals).
 *
 * On mount: remembers the previously focused element and focuses the first
 * focusable child (or the container itself). Tab / Shift+Tab cycle within the
 * container. On destroy: restores focus to the previously focused element.
 *
 * Usage: `<div class="modal" use:focusTrap>` — per CLAUDE.md, modals must trap
 * focus and restore it on close.
 */

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(', ')

function focusableChildren(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (el) => !el.hidden && el.getAttribute('aria-hidden') !== 'true'
  )
}

export function focusTrap(container: HTMLElement): { destroy: () => void } {
  const previouslyFocused = document.activeElement as HTMLElement | null

  // Focus the first focusable child (autofocus wins if present), else the container.
  const initial =
    container.querySelector<HTMLElement>('[autofocus], [data-autofocus]') ??
    focusableChildren(container)[0]
  if (initial) {
    initial.focus()
  } else {
    container.tabIndex = -1
    container.focus()
  }

  function handleKeydown(e: KeyboardEvent): void {
    if (e.key !== 'Tab') return
    const focusable = focusableChildren(container)
    if (focusable.length === 0) {
      e.preventDefault()
      return
    }
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = document.activeElement

    if (e.shiftKey) {
      if (active === first || !container.contains(active)) {
        e.preventDefault()
        last.focus()
      }
    } else {
      if (active === last || !container.contains(active)) {
        e.preventDefault()
        first.focus()
      }
    }
  }

  container.addEventListener('keydown', handleKeydown)

  return {
    destroy() {
      container.removeEventListener('keydown', handleKeydown)
      previouslyFocused?.focus()
    }
  }
}
