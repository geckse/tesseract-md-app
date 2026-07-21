import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/svelte'
import InsertAssetDialog from '@renderer/components/InsertAssetDialog.svelte'
import { assetTree } from '@renderer/stores/files'

describe('InsertAssetDialog', () => {
  beforeEach(() => {
    assetTree.set({
      root: {
        name: '',
        path: '',
        is_dir: true,
        children: [
          {
            name: 'hero.png',
            path: 'assets/hero.png',
            is_dir: false,
            children: [],
            mimeCategory: 'image',
            fileSize: 2048
          },
          {
            name: 'demo.mp4',
            path: 'media/demo.mp4',
            is_dir: false,
            children: [],
            mimeCategory: 'video',
            fileSize: 4096
          },
          {
            name: 'manual.pdf',
            path: 'manual.pdf',
            is_dir: false,
            children: [],
            mimeCategory: 'pdf'
          }
        ]
      },
      totalAssets: 3,
      scanDurationMs: 1
    })
  })

  it('inserts media from the collection with a path relative to the document', async () => {
    const onselect = vi.fn()
    render(InsertAssetDialog, {
      props: { visible: true, currentFilePath: 'docs/note.md', onselect }
    })

    expect(screen.queryByText('manual.pdf')).toBeNull()
    await fireEvent.click(screen.getByRole('option', { name: /hero\.png/ }))
    await fireEvent.input(screen.getByLabelText('Alt text'), { target: { value: 'Hero image' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Insert Media' }))

    expect(onselect).toHaveBeenCalledWith({
      kind: 'image',
      src: '../assets/hero.png',
      alt: 'Hero image'
    })
  })

  it('accepts a public URL and infers its media type', async () => {
    const onselect = vi.fn()
    render(InsertAssetDialog, {
      props: { visible: true, currentFilePath: 'note.md', onselect }
    })

    await fireEvent.click(screen.getByRole('tab', { name: 'Public URL' }))
    await fireEvent.input(screen.getByLabelText('Media URL'), {
      target: { value: 'https://cdn.example.test/demo.webm' }
    })
    await fireEvent.input(screen.getByLabelText('Title'), { target: { value: 'Product demo' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Insert Media' }))

    expect(onselect).toHaveBeenCalledWith({
      kind: 'video',
      src: 'https://cdn.example.test/demo.webm',
      alt: 'Product demo'
    })
  })

  it('rejects non-public URL schemes', async () => {
    render(InsertAssetDialog, { props: { visible: true, currentFilePath: 'note.md' } })

    await fireEvent.click(screen.getByRole('tab', { name: 'Public URL' }))
    await fireEvent.input(screen.getByLabelText('Media URL'), {
      target: { value: 'javascript:alert(1)' }
    })

    expect(screen.getByText('Enter a public http:// or https:// URL.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Insert Media' })).toHaveProperty('disabled', true)
  })

  it('opens existing public media in change mode', async () => {
    const onselect = vi.fn()
    render(InsertAssetDialog, {
      props: {
        visible: true,
        currentFilePath: 'note.md',
        initialMedia: {
          kind: 'image',
          src: 'https://cdn.example.test/old.png',
          alt: 'Old description'
        },
        onselect
      }
    })

    expect(screen.getByRole('tab', { name: 'Public URL' }).getAttribute('aria-selected')).toBe(
      'true'
    )
    expect((screen.getByLabelText('Media URL') as HTMLInputElement).value).toBe(
      'https://cdn.example.test/old.png'
    )
    await fireEvent.input(screen.getByLabelText('Media URL'), {
      target: { value: 'https://cdn.example.test/new.png' }
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Change Media' }))

    expect(onselect).toHaveBeenCalledWith({
      kind: 'image',
      src: 'https://cdn.example.test/new.png',
      alt: 'Old description'
    })
  })
})
