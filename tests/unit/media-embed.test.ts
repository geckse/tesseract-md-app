import { describe, expect, it, vi } from 'vitest'
import {
  computeRelativeMediaPath,
  inferMediaKind,
  isPublicMediaUrl,
  serializeMediaEmbed
} from '@renderer/lib/media-embed'
import { createWysiwygEditor } from '@renderer/lib/tiptap/editor-factory'

describe('media embeds', () => {
  it('computes collection-relative paths from the current markdown file', () => {
    expect(computeRelativeMediaPath('docs/guides/start.md', 'assets/hero.png')).toBe(
      '../../assets/hero.png'
    )
    expect(computeRelativeMediaPath('docs/start.md', 'docs/screenshot.png')).toBe('screenshot.png')
  })

  it('detects supported media extensions, including URL query strings', () => {
    expect(inferMediaKind('https://cdn.example.test/hero.webp?width=800')).toBe('image')
    expect(inferMediaKind('demo.webm')).toBe('video')
    expect(inferMediaKind('recording.m4a#play')).toBe('audio')
    expect(inferMediaKind('document.pdf')).toBeNull()
  })

  it('only accepts public HTTP URLs', () => {
    expect(isPublicMediaUrl('https://example.test/image.png')).toBe(true)
    expect(isPublicMediaUrl('http://localhost:8080/demo.mp4')).toBe(true)
    expect(isPublicMediaUrl('javascript:alert(1)')).toBe(false)
    expect(isPublicMediaUrl('../image.png')).toBe(false)
  })

  it('serializes images and native audio/video elements safely', () => {
    expect(
      serializeMediaEmbed({ kind: 'image', src: 'assets/my image.png', alt: 'A [draft]' })
    ).toBe('![A \\[draft\\]](<assets/my image.png>)')
    expect(
      serializeMediaEmbed({
        kind: 'video',
        src: 'https://cdn.example.test/demo.mp4?a=1&b=2',
        alt: 'Demo "clip"'
      })
    ).toBe(
      '<video controls src="https://cdn.example.test/demo.mp4?a=1&amp;b=2" title="Demo &quot;clip&quot;"></video>'
    )
  })

  it('round-trips audio and video nodes through the WYSIWYG markdown editor', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const editor = createWysiwygEditor(
      host,
      '<audio controls src="media/theme.mp3" title="Theme"></audio>\n'
    )

    expect(editor.editor.getJSON().content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'mediaEmbed',
          attrs: expect.objectContaining({ kind: 'audio', src: 'media/theme.mp3', alt: 'Theme' })
        })
      ])
    )
    expect(editor.getMarkdown()).toContain(
      '<audio controls src="media/theme.mp3" title="Theme"></audio>'
    )

    editor.destroy()
    host.remove()
  })

  it('resolves existing local audio and video through the streaming scheme', async () => {
    const load = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const editor = createWysiwygEditor(host, '<video controls src="../media/demo.mp4"></video>\n', {
      collectionPath: '/vault',
      currentFilePath: 'docs/note.md'
    })

    await Promise.resolve()
    const video = host.querySelector('video')
    expect(video?.getAttribute('data-original-src')).toBe('../media/demo.mp4')
    expect(video?.getAttribute('src')).toBe(
      `tesseract-media://asset?path=${encodeURIComponent('/vault/media/demo.mp4')}`
    )
    expect(load).toHaveBeenCalled()

    editor.destroy()
    host.remove()
    load.mockRestore()
  })
})
