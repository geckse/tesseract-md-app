import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'
import CustomClusterModal from '@renderer/components/CustomClusterModal.svelte'
import type { TopicDef } from '@renderer/types/cli'

function renderModal(overrides: Partial<Parameters<typeof render>[1]['props']> = {}) {
  const onsave = vi.fn()
  const onclose = vi.fn()
  render(CustomClusterModal, {
    props: {
      existingDef: null,
      existingNames: [],
      onsave,
      onclose,
      ...overrides
    }
  })
  return { onsave, onclose }
}

describe('CustomClusterModal (Topic modal)', () => {
  it('renders name, description, seeds inputs and threshold toggle', () => {
    renderModal()
    expect(screen.getByPlaceholderText('e.g. AI Research')).toBeTruthy()
    expect(
      screen.getByPlaceholderText(
        'Optional — a sentence describing this topic improves matching accuracy'
      )
    ).toBeTruthy()
    expect(
      screen.getByPlaceholderText('e.g. machine learning, neural networks, deep learning')
    ).toBeTruthy()
    expect(screen.getByText('Custom similarity threshold')).toBeTruthy()
  })

  it('emits a TopicDef with description and null threshold when unchecked', async () => {
    const { onsave } = renderModal()
    await fireEvent.input(screen.getByPlaceholderText('e.g. AI Research'), {
      target: { value: 'Rust' }
    })
    await fireEvent.input(
      screen.getByPlaceholderText(
        'Optional — a sentence describing this topic improves matching accuracy'
      ),
      { target: { value: 'Notes about Rust programming' } }
    )
    await fireEvent.click(screen.getByText('Add Topic', { selector: 'button' }))

    expect(onsave).toHaveBeenCalledWith({
      name: 'Rust',
      seeds: [],
      description: 'Notes about Rust programming',
      threshold: null
    })
  })

  it('emits threshold when the toggle is enabled', async () => {
    const { onsave } = renderModal()
    await fireEvent.input(screen.getByPlaceholderText('e.g. AI Research'), {
      target: { value: 'AI' }
    })
    await fireEvent.input(
      screen.getByPlaceholderText('e.g. machine learning, neural networks, deep learning'),
      { target: { value: 'neural nets, transformers' } }
    )
    await fireEvent.click(screen.getByRole('checkbox'))
    await fireEvent.input(screen.getByLabelText('Similarity threshold'), {
      target: { value: '0.45' }
    })
    await fireEvent.click(screen.getByText('Add Topic', { selector: 'button' }))

    expect(onsave).toHaveBeenCalledWith({
      name: 'AI',
      seeds: ['neural nets', 'transformers'],
      description: null,
      threshold: 0.45
    })
  })

  it('rejects a definition with neither seeds nor description', async () => {
    const { onsave } = renderModal()
    await fireEvent.input(screen.getByPlaceholderText('e.g. AI Research'), {
      target: { value: 'Empty' }
    })
    await fireEvent.click(screen.getByText('Add Topic', { selector: 'button' }))

    expect(onsave).not.toHaveBeenCalled()
    expect(screen.getByText('Provide at least one seed phrase or a description.')).toBeTruthy()
  })

  it('rejects names containing ":" or "|" and duplicate names', async () => {
    const { onsave } = renderModal({ existingNames: ['Taken'] })
    const nameInput = screen.getByPlaceholderText('e.g. AI Research')
    const seedsInput = screen.getByPlaceholderText(
      'e.g. machine learning, neural networks, deep learning'
    )
    await fireEvent.input(seedsInput, { target: { value: 'seed' } })

    await fireEvent.input(nameInput, { target: { value: 'bad:name' } })
    await fireEvent.click(screen.getByText('Add Topic', { selector: 'button' }))
    expect(screen.getByText('Name cannot contain ":" or "|".')).toBeTruthy()

    await fireEvent.input(nameInput, { target: { value: 'Taken' } })
    await fireEvent.click(screen.getByText('Add Topic', { selector: 'button' }))
    expect(screen.getByText('A topic named "Taken" already exists.')).toBeTruthy()

    expect(onsave).not.toHaveBeenCalled()
  })

  it('prefills fields when editing an existing topic', () => {
    const existing: TopicDef = {
      name: 'AI',
      seeds: ['nets'],
      description: 'ML notes',
      threshold: 0.4
    }
    renderModal({ existingDef: existing })
    expect(screen.getByText('Edit Topic')).toBeTruthy()
    expect((screen.getByPlaceholderText('e.g. AI Research') as HTMLInputElement).value).toBe('AI')
    expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(true)
    expect(screen.getByText('Save Changes')).toBeTruthy()
  })

  it('calls onclose on Cancel', async () => {
    const { onclose } = renderModal()
    await fireEvent.click(screen.getByText('Cancel'))
    expect(onclose).toHaveBeenCalled()
  })
})
