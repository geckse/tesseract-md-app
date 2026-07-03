import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'
import PopoverMenu from '@renderer/components/ui/PopoverMenu.svelte'

const items = [
  { id: 'one', label: 'One' },
  { id: 'two', label: 'Two', checked: true },
  { id: 'three', label: 'Three', disabled: true },
  { id: 'four', label: 'Four' }
]

let anchorEl: HTMLButtonElement

beforeEach(() => {
  document.body.innerHTML = ''
  anchorEl = document.createElement('button')
  anchorEl.textContent = 'anchor'
  document.body.appendChild(anchorEl)
})

function renderMenu(props: Record<string, unknown> = {}) {
  const onselect = vi.fn()
  const ondismiss = vi.fn()
  const utils = render(PopoverMenu, {
    props: { anchorEl, items, onselect, ondismiss, ...props }
  })
  return { onselect, ondismiss, ...utils }
}

describe('PopoverMenu', () => {
  it('renders all items in a menu', () => {
    renderMenu()

    expect(screen.getByRole('menu')).toBeTruthy()
    expect(screen.getByText('One')).toBeTruthy()
    expect(screen.getByText('Four')).toBeTruthy()
  })

  it('marks checked items with aria-checked and a check icon', () => {
    renderMenu()

    const checkbox = screen.getByRole('menuitemcheckbox')
    expect(checkbox.getAttribute('aria-checked')).toBe('true')
    expect(checkbox.textContent).toContain('check')
  })

  it('dismisses on Escape', async () => {
    const { ondismiss } = renderMenu()

    await fireEvent.keyDown(document, { key: 'Escape' })

    expect(ondismiss).toHaveBeenCalled()
  })

  it('dismisses on pointerdown outside, but not inside or on the anchor', async () => {
    const { ondismiss } = renderMenu()

    await fireEvent.pointerDown(screen.getByText('One'))
    expect(ondismiss).not.toHaveBeenCalled()

    await fireEvent.pointerDown(anchorEl)
    expect(ondismiss).not.toHaveBeenCalled()

    await fireEvent.pointerDown(document.body)
    expect(ondismiss).toHaveBeenCalled()
  })

  it('navigates with arrow keys skipping disabled items and selects with Enter', async () => {
    const { onselect, ondismiss } = renderMenu()

    await fireEvent.keyDown(document, { key: 'ArrowDown' }) // -> one
    await fireEvent.keyDown(document, { key: 'ArrowDown' }) // -> two
    await fireEvent.keyDown(document, { key: 'ArrowDown' }) // -> four (three disabled)
    await fireEvent.keyDown(document, { key: 'Enter' })

    expect(onselect).toHaveBeenCalledWith('four')
    expect(ondismiss).toHaveBeenCalled()
  })

  it('supports Home and End', async () => {
    const { onselect } = renderMenu()

    await fireEvent.keyDown(document, { key: 'End' })
    await fireEvent.keyDown(document, { key: 'Enter' })
    expect(onselect).toHaveBeenCalledWith('four')

    await fireEvent.keyDown(document, { key: 'Home' })
    await fireEvent.keyDown(document, { key: 'Enter' })
    expect(onselect).toHaveBeenCalledWith('one')
  })

  it('selects on mousedown', async () => {
    const { onselect } = renderMenu()

    await fireEvent.mouseDown(screen.getByText('Two'))

    expect(onselect).toHaveBeenCalledWith('two')
  })

  it('keeps the menu open when closeOnSelect is false', async () => {
    const { onselect, ondismiss } = renderMenu({ closeOnSelect: false })

    await fireEvent.mouseDown(screen.getByText('One'))

    expect(onselect).toHaveBeenCalledWith('one')
    expect(ondismiss).not.toHaveBeenCalled()
  })

  it('shows the empty label when there are no items', () => {
    renderMenu({ items: [], emptyLabel: 'No fields yet' })

    expect(screen.getByText('No fields yet')).toBeTruthy()
  })
})
