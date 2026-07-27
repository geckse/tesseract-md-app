import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import ClipboardImageSaveModal from '@renderer/components/ClipboardImageSaveModal.svelte'
import { assetTree, fileTree } from '@renderer/stores/files'

describe('ClipboardImageSaveModal', () => {
  beforeEach(() => {
    fileTree.set({
      root: {
        name: '',
        path: '',
        is_dir: true,
        state: null,
        children: [
          {
            name: 'notes',
            path: 'notes',
            is_dir: true,
            state: null,
            children: []
          }
        ]
      },
      total_files: 0,
      indexed_count: 0,
      modified_count: 0,
      new_count: 0,
      deleted_count: 0
    })
    assetTree.set({
      root: {
        name: '',
        path: '',
        is_dir: true,
        children: [
          {
            name: 'assets',
            path: 'assets',
            is_dir: true,
            children: []
          },
          {
            name: 'notes',
            path: 'notes',
            is_dir: true,
            children: [
              {
                name: 'note-section.png',
                path: 'notes/note-section.png',
                is_dir: false,
                children: [],
                mimeCategory: 'image'
              }
            ]
          }
        ]
      },
      totalAssets: 1,
      scanDurationMs: 1
    })
  })

  it('prefills a numbered filename in the note folder and submits the destination', async () => {
    const onsave = vi.fn().mockResolvedValue(undefined)
    render(ClipboardImageSaveModal, {
      props: {
        baseStem: 'note-section',
        extension: 'png',
        initialDirectory: 'notes',
        onsave,
        oncancel: vi.fn()
      }
    })

    const filename = screen.getByLabelText('Filename') as HTMLInputElement
    await waitFor(() => expect(filename.value).toBe('note-section-1'))
    expect(screen.getByText('/notes/note-section-1.png')).toBeTruthy()

    await fireEvent.click(screen.getByRole('button', { name: 'Save and Insert' }))

    expect(onsave).toHaveBeenCalledWith({
      directory: 'notes',
      filename: 'note-section-1.png',
      relativePath: 'notes/note-section-1.png',
      stem: 'note-section-1'
    })
  })

  it('allows a new folder and recomputes an untouched automatic name', async () => {
    render(ClipboardImageSaveModal, {
      props: {
        baseStem: 'note-section',
        extension: 'png',
        initialDirectory: 'notes',
        onsave: vi.fn().mockResolvedValue(undefined),
        oncancel: vi.fn()
      }
    })

    const folder = screen.getByLabelText('Collection folder')
    await fireEvent.input(folder, { target: { value: 'new/screenshots' } })

    await waitFor(() => {
      expect((screen.getByLabelText('Filename') as HTMLInputElement).value).toBe('note-section')
    })
    expect(screen.getByText('/new/screenshots/note-section.png')).toBeTruthy()
  })

  it('blocks unsafe destinations without invoking the save callback', async () => {
    const onsave = vi.fn()
    render(ClipboardImageSaveModal, {
      props: {
        baseStem: 'note-section',
        extension: 'png',
        initialDirectory: 'notes',
        onsave,
        oncancel: vi.fn()
      }
    })

    await fireEvent.input(screen.getByLabelText('Collection folder'), {
      target: { value: '../outside' }
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Save and Insert' }))

    expect(screen.getByRole('alert').textContent).toMatch(/cannot contain/i)
    expect(onsave).not.toHaveBeenCalled()
  })

  it('keeps the modal open with a friendly collision error and supports retry', async () => {
    const onsave = vi
      .fn()
      .mockRejectedValueOnce(new Error('EEXIST: file already exists'))
      .mockResolvedValueOnce(undefined)
    render(ClipboardImageSaveModal, {
      props: {
        baseStem: 'note-section',
        extension: 'png',
        initialDirectory: 'assets',
        onsave,
        oncancel: vi.fn()
      }
    })

    await fireEvent.click(screen.getByRole('button', { name: 'Save and Insert' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/already exists/i)

    await fireEvent.input(screen.getByLabelText('Filename'), { target: { value: 'custom-name' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Save and Insert' }))
    expect(onsave).toHaveBeenCalledTimes(2)
  })

  it('traps focus and cancels on Escape without saving', async () => {
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    outside.focus()
    const oncancel = vi.fn()
    const onsave = vi.fn()
    const rendered = render(ClipboardImageSaveModal, {
      props: {
        baseStem: 'note',
        extension: 'png',
        initialDirectory: '',
        onsave,
        oncancel
      }
    })

    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('Filename')))
    await fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(oncancel).toHaveBeenCalledOnce()
    expect(onsave).not.toHaveBeenCalled()

    rendered.unmount()
    expect(document.activeElement).toBe(outside)
    outside.remove()
  })
})
