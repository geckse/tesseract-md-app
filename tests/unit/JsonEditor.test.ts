import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/svelte'
import JsonEditor from '@renderer/components/ui/JsonEditor.svelte'

describe('JsonEditor', () => {
  it('syntax-highlights while emitting parsed JSON values', async () => {
    const onValueChange = vi.fn()
    const { container } = render(JsonEditor, {
      props: {
        value: { message: 'hello' },
        ariaLabel: 'payload value',
        onValueChange
      }
    })

    expect(container.querySelector('.key')?.textContent).toBe('"message"')
    expect(container.querySelector('.string')?.textContent).toBe('"hello"')

    const textarea = screen.getByRole('textbox', { name: 'payload value' })
    await fireEvent.input(textarea, { target: { value: '{"count": 3}' } })

    expect(onValueChange).toHaveBeenCalledWith({ count: 3 })
    expect(textarea.getAttribute('aria-invalid')).toBe('false')
  })

  it('shows validation without replacing the last valid value', async () => {
    const onValueChange = vi.fn()
    render(JsonEditor, {
      props: {
        value: { message: 'hello' },
        ariaLabel: 'payload value',
        onValueChange
      }
    })

    const textarea = screen.getByRole('textbox', { name: 'payload value' })
    await fireEvent.input(textarea, { target: { value: '{broken}' } })
    await fireEvent.blur(textarea)

    expect(textarea.getAttribute('aria-invalid')).toBe('true')
    expect((textarea as HTMLTextAreaElement).value).toBe('{broken}')
    expect(screen.getByText('Invalid JSON')).toBeTruthy()
    expect(onValueChange).not.toHaveBeenCalled()
  })
})
