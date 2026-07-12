import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'

// Mock window.api on the real jsdom window before store imports
const mockApi = {
  collection: vi.fn(),
  createFile: vi.fn(),
  ingestFile: vi.fn(),
  listTableViews: vi.fn()
}

Object.defineProperty(window, 'api', { value: mockApi, writable: true })

import { workspace } from '@renderer/stores/workspace.svelte'
import { tableStore } from '@renderer/stores/table.svelte'
import TableAddRow from '@renderer/components/table/TableAddRow.svelte'

describe('TableAddRow', () => {
  beforeEach(() => {
    workspace.reset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function setup(variant?: 'row' | 'empty') {
    const tabId = workspace.openTableTab('docs')
    const addRow = vi.spyOn(tableStore, 'addRow')
    const utils = render(TableAddRow, { props: { tabId, ...(variant ? { variant } : {}) } })
    return { tabId, addRow, ...utils }
  }

  it('renders the trigger button and swaps to a focused filename input on click', async () => {
    const { container } = setup()

    const button = screen.getByRole('button', { name: 'Add row' })
    await fireEvent.click(button)

    const input = container.querySelector<HTMLInputElement>('.add-input')!
    expect(input).toBeTruthy()
    expect(input.placeholder).toBe('new-file.md')
    expect(document.activeElement).toBe(input)
  })

  it('Enter commits the typed name via tableStore.addRow and closes the input', async () => {
    const { container, tabId, addRow } = setup()
    addRow.mockResolvedValue({ ok: true })

    await fireEvent.click(screen.getByRole('button', { name: 'Add row' }))
    const input = container.querySelector<HTMLInputElement>('.add-input')!
    await fireEvent.input(input, { target: { value: 'my-note' } })
    await fireEvent.keyDown(input, { key: 'Enter' })

    expect(addRow).toHaveBeenCalledWith(tabId, 'my-note')
    await vi.waitFor(() => expect(container.querySelector('.add-input')).toBeNull())

    // The name must not leak into the next add.
    await fireEvent.click(screen.getByRole('button', { name: 'Add row' }))
    expect(container.querySelector<HTMLInputElement>('.add-input')!.value).toBe('')
  })

  it('Escape cancels without creating anything', async () => {
    const { container, addRow } = setup()

    await fireEvent.click(screen.getByRole('button', { name: 'Add row' }))
    const input = container.querySelector<HTMLInputElement>('.add-input')!
    await fireEvent.input(input, { target: { value: 'draft' } })
    await fireEvent.keyDown(input, { key: 'Escape' })

    expect(container.querySelector('.add-input')).toBeNull()
    expect(screen.getByRole('button', { name: 'Add row' })).toBeTruthy()
    expect(addRow).not.toHaveBeenCalled()
  })

  it('blur closes an empty input but keeps a typed one open', async () => {
    const { container } = setup()

    await fireEvent.click(screen.getByRole('button', { name: 'Add row' }))
    await fireEvent.blur(container.querySelector('.add-input')!)
    expect(container.querySelector('.add-input')).toBeNull()

    await fireEvent.click(screen.getByRole('button', { name: 'Add row' }))
    const input = container.querySelector<HTMLInputElement>('.add-input')!
    await fireEvent.input(input, { target: { value: 'keep-me' } })
    await fireEvent.blur(input)
    expect(container.querySelector('.add-input')).toBeTruthy()
  })

  it('a failed create surfaces the error inline and keeps the input open', async () => {
    const { container, addRow } = setup()
    addRow.mockResolvedValue({ ok: false, error: 'File exists: docs/a.md' })

    await fireEvent.click(screen.getByRole('button', { name: 'Add row' }))
    const input = container.querySelector<HTMLInputElement>('.add-input')!
    await fireEvent.input(input, { target: { value: 'a' } })
    await fireEvent.keyDown(input, { key: 'Enter' })

    const alert = await vi.waitFor(() => {
      const el = screen.getByRole('alert')
      expect(el.textContent).toBe('File exists: docs/a.md')
      return el
    })
    expect(alert).toBeTruthy()
    expect(container.querySelector('.add-input.has-error')).toBeTruthy()
  })

  it('a second Enter while a create is in flight does not double-submit', async () => {
    const { container, addRow } = setup()
    addRow.mockReturnValue(new Promise(() => {})) // never settles

    await fireEvent.click(screen.getByRole('button', { name: 'Add row' }))
    const input = container.querySelector<HTMLInputElement>('.add-input')!
    await fireEvent.input(input, { target: { value: 'slow' } })
    await fireEvent.keyDown(input, { key: 'Enter' })
    await fireEvent.keyDown(input, { key: 'Enter' })

    expect(addRow).toHaveBeenCalledTimes(1)
  })

  it('the empty variant renders the CTA styling with the same reveal behavior', async () => {
    const { container } = setup('empty')

    const button = container.querySelector('button.add-row.empty')!
    expect(button).toBeTruthy()
    await fireEvent.click(button)

    expect(container.querySelector('.add-row.empty .add-input')).toBeTruthy()
  })
})
