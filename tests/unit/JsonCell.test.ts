import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/svelte'
import JsonCell from '@renderer/components/table/cells/JsonCell.svelte'
import type { CollectionColumn, JsonValue } from '@renderer/types/cli'

const column: CollectionColumn = {
  name: 'payload',
  field_type: 'Json',
  description: null,
  occurrence_count: 1,
  sample_values: [],
  allowed_values: null,
  required: false,
  in_schema: true
}

function props(value: JsonValue, editing = false) {
  return {
    column,
    value,
    editing,
    readOnly: false,
    oncommit: vi.fn(),
    oncancel: vi.fn()
  }
}

describe('JsonCell', () => {
  it('renders JSON with syntax token classes', () => {
    const { container } = render(JsonCell, {
      props: props({ message: 'hello', count: 2, enabled: true })
    })

    expect(container.querySelector('.key')?.textContent).toBe('"message"')
    expect(container.querySelector('.string')?.textContent).toBe('"hello"')
    expect(container.querySelector('.number')?.textContent).toBe('2')
    expect(container.querySelector('.boolean')?.textContent).toBe('true')
  })

  it('commits parsed JSON rather than a raw string', async () => {
    const cell = props({ old: true }, true)
    render(JsonCell, { props: cell })
    const input = screen.getByRole('textbox', { name: 'payload JSON value' })

    await fireEvent.input(input, { target: { value: '{"next":[1,2]}' } })
    await fireEvent.keyDown(input, { key: 'Enter' })

    expect(cell.oncommit).toHaveBeenCalledWith({ next: [1, 2] })
  })

  it('keeps invalid JSON in edit mode without committing it', async () => {
    const cell = props({ old: true }, true)
    render(JsonCell, { props: cell })
    const input = screen.getByRole('textbox', { name: 'payload JSON value' })

    await fireEvent.input(input, { target: { value: '{broken}' } })
    await fireEvent.keyDown(input, { key: 'Enter' })

    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(cell.oncommit).not.toHaveBeenCalled()
  })
})
