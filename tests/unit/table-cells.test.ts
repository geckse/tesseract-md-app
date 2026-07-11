import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'

// Mock window.api before importing components (cells import the table store for valueToString).
// Keep the real jsdom window — floating-ui needs its DOM classes for instanceof checks.
const mockApi = {
  collection: vi.fn(),
  updateFrontmatter: vi.fn(),
  readFile: vi.fn(),
  ingestFile: vi.fn()
}

Object.defineProperty(window, 'api', { value: mockApi, writable: true })

import StringCell from '@renderer/components/table/cells/StringCell.svelte'
import NumberCell from '@renderer/components/table/cells/NumberCell.svelte'
import BooleanCell from '@renderer/components/table/cells/BooleanCell.svelte'
import ListCell from '@renderer/components/table/cells/ListCell.svelte'
import DateCell from '@renderer/components/table/cells/DateCell.svelte'
import MixedCell from '@renderer/components/table/cells/MixedCell.svelte'
import TitleCell from '@renderer/components/table/cells/TitleCell.svelte'
import type { CollectionColumn, CollectionRow, JsonValue } from '../../src/renderer/types/cli'

function col(
  field_type: CollectionColumn['field_type'],
  overrides: Partial<CollectionColumn> = {}
): CollectionColumn {
  return {
    name: 'field',
    field_type,
    description: null,
    occurrence_count: 1,
    sample_values: [],
    allowed_values: null,
    required: false,
    in_schema: true,
    ...overrides
  }
}

function cellProps(
  field_type: CollectionColumn['field_type'],
  value: JsonValue | undefined,
  overrides: Record<string, unknown> = {}
) {
  const oncommit = vi.fn()
  const oncancel = vi.fn()
  const { column: columnOverrides, ...rest } = overrides
  return {
    props: {
      value,
      editing: false,
      readOnly: false,
      oncommit,
      oncancel,
      ...rest,
      column: col(field_type, (columnOverrides as Partial<CollectionColumn>) ?? {})
    },
    oncommit,
    oncancel
  }
}

describe('StringCell', () => {
  it('renders the value as text', () => {
    const { props } = cellProps('String', 'hello world')
    render(StringCell, { props })

    expect(screen.getByText('hello world')).toBeTruthy()
  })

  it('renders an em-dash placeholder for empty values', () => {
    const { props } = cellProps('String', undefined)
    render(StringCell, { props })

    expect(screen.getByText('—')).toBeTruthy()
  })

  it('commits the trimmed draft on Enter', async () => {
    const { props, oncommit } = cellProps('String', 'old', { editing: true })
    const { container } = render(StringCell, { props })
    const input = container.querySelector('input')!

    await fireEvent.input(input, { target: { value: '  new value  ' } })
    await fireEvent.keyDown(input, { key: 'Enter' })

    expect(oncommit).toHaveBeenCalledWith('new value')
  })

  it('commits null when cleared', async () => {
    const { props, oncommit } = cellProps('String', 'old', { editing: true })
    const { container } = render(StringCell, { props })
    const input = container.querySelector('input')!

    await fireEvent.input(input, { target: { value: '' } })
    await fireEvent.keyDown(input, { key: 'Enter' })

    expect(oncommit).toHaveBeenCalledWith(null)
  })

  it('cancels on Escape without committing', async () => {
    const { props, oncommit, oncancel } = cellProps('String', 'old', { editing: true })
    const { container } = render(StringCell, { props })
    const input = container.querySelector('input')!

    await fireEvent.input(input, { target: { value: 'changed' } })
    await fireEvent.keyDown(input, { key: 'Escape' })

    expect(oncancel).toHaveBeenCalled()
    expect(oncommit).not.toHaveBeenCalled()
  })

  it('commits on blur', async () => {
    const { props, oncommit } = cellProps('String', 'old', { editing: true })
    const { container } = render(StringCell, { props })
    const input = container.querySelector('input')!

    await fireEvent.input(input, { target: { value: 'blurred' } })
    await fireEvent.blur(input)

    expect(oncommit).toHaveBeenCalledWith('blurred')
  })

  it('keeps the in-progress draft when the value refreshes in the background', async () => {
    const { props } = cellProps('String', 'old', { editing: true })
    const { container, rerender } = render(StringCell, { props })
    const input = container.querySelector('input')!

    await fireEvent.input(input, { target: { value: 'typing' } })
    await rerender({ value: 'changed elsewhere' })

    expect((container.querySelector('input') as HTMLInputElement).value).toBe('typing')
  })

  describe('select mode (allowed_values)', () => {
    const allowed = { column: { allowed_values: ['draft', 'published'] } }

    it('renders the value as a chip', () => {
      const { props } = cellProps('String', 'draft', allowed)
      render(StringCell, { props })

      expect(screen.getByText('draft').classList.contains('select-chip')).toBe(true)
    })

    it('opens a listbox popover when editing and commits the picked option', async () => {
      const { props, oncommit } = cellProps('String', 'draft', { ...allowed, editing: true })
      render(StringCell, { props })

      expect(screen.getByRole('menu')).toBeTruthy()

      await fireEvent.mouseDown(screen.getByText('published'))

      expect(oncommit).toHaveBeenCalledWith('published')
    })

    it('commits null when Clear is picked', async () => {
      const { props, oncommit } = cellProps('String', 'draft', { ...allowed, editing: true })
      render(StringCell, { props })

      await fireEvent.mouseDown(screen.getByText('Clear'))

      expect(oncommit).toHaveBeenCalledWith(null)
    })
  })
})

describe('NumberCell', () => {
  it('right-aligns and renders numbers', () => {
    const { props } = cellProps('Number', 42)
    render(NumberCell, { props })

    expect(screen.getByText('42')).toBeTruthy()
  })

  it('commits a real number, not a string', async () => {
    const { props, oncommit } = cellProps('Number', 1, { editing: true })
    const { container } = render(NumberCell, { props })
    const input = container.querySelector('input')!

    await fireEvent.input(input, { target: { value: '3.5' } })
    await fireEvent.keyDown(input, { key: 'Enter' })

    expect(oncommit).toHaveBeenCalledWith(3.5)
  })

  it('rejects non-numeric input by cancelling', async () => {
    const { props, oncommit, oncancel } = cellProps('Number', 1, { editing: true })
    const { container } = render(NumberCell, { props })
    const input = container.querySelector('input')!

    // jsdom lets us set a bogus value on number inputs via fireEvent.input
    await fireEvent.input(input, { target: { value: 'abc' } })
    await fireEvent.keyDown(input, { key: 'Enter' })

    expect(oncommit).not.toHaveBeenCalled()
    expect(oncancel).toHaveBeenCalled()
  })

  it('commits null when cleared', async () => {
    const { props, oncommit } = cellProps('Number', 1, { editing: true })
    const { container } = render(NumberCell, { props })
    const input = container.querySelector('input')!

    await fireEvent.input(input, { target: { value: '' } })
    await fireEvent.keyDown(input, { key: 'Enter' })

    expect(oncommit).toHaveBeenCalledWith(null)
  })
})

describe('BooleanCell', () => {
  it('reflects the value via aria-pressed', () => {
    const { props } = cellProps('Boolean', true)
    render(BooleanCell, { props })

    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('true')
  })

  it('commits the inverted value on click', async () => {
    const { props, oncommit } = cellProps('Boolean', true)
    render(BooleanCell, { props })

    await fireEvent.click(screen.getByRole('button'))

    expect(oncommit).toHaveBeenCalledWith(false)
  })

  it('treats missing values as false and commits true', async () => {
    const { props, oncommit } = cellProps('Boolean', undefined)
    render(BooleanCell, { props })

    await fireEvent.click(screen.getByRole('button'))

    expect(oncommit).toHaveBeenCalledWith(true)
  })

  it('is disabled when readOnly', () => {
    const { props } = cellProps('Boolean', true, { readOnly: true })
    render(BooleanCell, { props })

    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('ListCell', () => {
  it('renders items as chips', () => {
    const { props } = cellProps('List', ['a', 'b'])
    render(ListCell, { props })

    expect(screen.getByText('a')).toBeTruthy()
    expect(screen.getByText('b')).toBeTruthy()
  })

  it('adds a chip on Enter and commits the array on Enter with empty input', async () => {
    const { props, oncommit } = cellProps('List', ['a'], { editing: true })
    const { container } = render(ListCell, { props })
    const input = container.querySelector('input')!

    await fireEvent.input(input, { target: { value: 'b' } })
    await fireEvent.keyDown(input, { key: 'Enter' })
    expect(oncommit).not.toHaveBeenCalled() // first Enter adds the chip
    expect(screen.getByText('b')).toBeTruthy()

    await fireEvent.keyDown(input, { key: 'Enter' })
    expect(oncommit).toHaveBeenCalledWith(['a', 'b'])
  })

  it('removes the last chip with Backspace on empty input', async () => {
    const { props, oncommit } = cellProps('List', ['a', 'b'], { editing: true })
    const { container } = render(ListCell, { props })
    const input = container.querySelector('input')!

    await fireEvent.keyDown(input, { key: 'Backspace' })
    await fireEvent.keyDown(input, { key: 'Enter' })

    expect(oncommit).toHaveBeenCalledWith(['a'])
  })

  it('removes a chip via its remove button', async () => {
    const { props, oncommit } = cellProps('List', ['a', 'b'], { editing: true })
    const { container } = render(ListCell, { props })

    await fireEvent.mouseDown(screen.getByLabelText('Remove a'))
    await fireEvent.keyDown(container.querySelector('input')!, { key: 'Enter' })

    expect(oncommit).toHaveBeenCalledWith(['b'])
  })

  it('commits null when all chips are removed', async () => {
    const { props, oncommit } = cellProps('List', ['a'], { editing: true })
    const { container } = render(ListCell, { props })
    const input = container.querySelector('input')!

    await fireEvent.keyDown(input, { key: 'Backspace' })
    await fireEvent.keyDown(input, { key: 'Enter' })

    expect(oncommit).toHaveBeenCalledWith(null)
  })

  it('includes pending text when committing on blur', async () => {
    const { props, oncommit } = cellProps('List', [], { editing: true })
    const { container } = render(ListCell, { props })
    const input = container.querySelector('input')!

    await fireEvent.input(input, { target: { value: 'typed' } })
    await fireEvent.blur(input)

    expect(oncommit).toHaveBeenCalledWith(['typed'])
  })

  it('cancels on Escape', async () => {
    const { props, oncommit, oncancel } = cellProps('List', ['a'], { editing: true })
    const { container } = render(ListCell, { props })

    await fireEvent.keyDown(container.querySelector('input')!, { key: 'Escape' })

    expect(oncancel).toHaveBeenCalled()
    expect(oncommit).not.toHaveBeenCalled()
  })

  it('keeps in-progress input when the value refreshes in the background', async () => {
    const { props } = cellProps('List', ['a'], { editing: true })
    const { container, rerender } = render(ListCell, { props })
    const input = container.querySelector('input')!

    await fireEvent.input(input, { target: { value: 'b' } })
    await fireEvent.keyDown(input, { key: 'Enter' }) // stage chip 'b' (uncommitted)
    await fireEvent.input(container.querySelector('input')!, { target: { value: 'ty' } })

    // A background table refetch delivers a fresh array identity for the same value.
    await rerender({ value: ['a'] })

    expect((container.querySelector('input') as HTMLInputElement).value).toBe('ty')
    expect(screen.getByText('b')).toBeTruthy() // the staged chip survives too
  })
})

describe('DateCell', () => {
  it('renders a localized date for ISO values', () => {
    const { props } = cellProps('Date', '2026-03-15')
    const { container } = render(DateCell, { props })

    const text = container.querySelector('.date-text')!
    expect(text.textContent).toContain('2026')
    expect(text.getAttribute('title')).toBe('2026-03-15')
  })

  it('opens the calendar picker when editing and commits the picked day', async () => {
    const { props, oncommit } = cellProps('Date', '2026-03-15', { editing: true })
    const { container } = render(DateCell, { props })

    // DatePicker is rendered into the cell; pick the 20th of the visible month
    const days = Array.from(document.querySelectorAll('.dp-day:not(.outside)'))
    expect(days.length).toBeGreaterThan(0)
    const day20 = days.find((d) => d.textContent?.trim() === '20')!

    await fireEvent.mouseDown(day20)
    await fireEvent.click(day20)

    expect(oncommit).toHaveBeenCalledWith('2026-03-20')
    void container
  })

  it('cancels when the picker closes via Escape', async () => {
    const { props, oncancel } = cellProps('Date', '2026-03-15', { editing: true })
    render(DateCell, { props })

    await fireEvent.keyDown(document, { key: 'Escape' })

    expect(oncancel).toHaveBeenCalled()
  })
})

describe('MixedCell', () => {
  it('renders complex values as text', () => {
    const { props } = cellProps('Mixed', { nested: true })
    const { container } = render(MixedCell, { props })

    expect(container.querySelector('.text')!.textContent!.length).toBeGreaterThan(0)
  })

  it('commits the raw string on Enter', async () => {
    const { props, oncommit } = cellProps('Mixed', 'raw', { editing: true })
    const { container } = render(MixedCell, { props })
    const input = container.querySelector('input')!

    await fireEvent.input(input, { target: { value: 'edited' } })
    await fireEvent.keyDown(input, { key: 'Enter' })

    expect(oncommit).toHaveBeenCalledWith('edited')
  })
})

describe('TitleCell', () => {
  function rowFixture(overrides: Partial<CollectionRow> = {}): CollectionRow {
    return {
      path: 'docs/note.md',
      title: 'My Note',
      title_source: 'frontmatter',
      frontmatter: {},
      content_hash: 'abc',
      file_size: 10,
      modified_at: 1,
      indexed_at: 1,
      state: 'indexed',
      ...overrides
    }
  }

  it('renders the title and calls onopen from the pop-out', async () => {
    const onopen = vi.fn()
    render(TitleCell, { props: { row: rowFixture(), onopen, ondelete: vi.fn() } })

    expect(screen.getByText('My Note')).toBeTruthy()
    await fireEvent.click(screen.getByLabelText('Open document'))
    expect(onopen).toHaveBeenCalled()
  })

  it('calls ondelete from the delete action', async () => {
    const ondelete = vi.fn()
    render(TitleCell, { props: { row: rowFixture(), onopen: vi.fn(), ondelete } })

    await fireEvent.click(screen.getByLabelText('Delete file'))
    expect(ondelete).toHaveBeenCalled()
  })

  it('dims filename-derived titles', () => {
    render(TitleCell, {
      props: { row: rowFixture({ title_source: 'filename' }), onopen: vi.fn(), ondelete: vi.fn() }
    })

    expect(screen.getByText('My Note').classList.contains('dim')).toBe(true)
  })

  it('shows state badges and hides delete for deleted rows', () => {
    render(TitleCell, {
      props: { row: rowFixture({ state: 'deleted' }), onopen: vi.fn(), ondelete: vi.fn() }
    })

    expect(screen.getByText('gone')).toBeTruthy()
    expect(screen.queryByLabelText('Delete file')).toBeNull()
  })

  it('shows the new badge for unindexed rows', () => {
    render(TitleCell, {
      props: { row: rowFixture({ state: 'new' }), onopen: vi.fn(), ondelete: vi.fn() }
    })

    expect(screen.getByText('new')).toBeTruthy()
  })
})
