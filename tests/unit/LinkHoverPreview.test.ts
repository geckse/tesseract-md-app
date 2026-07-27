import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte'

const navigation = vi.hoisted(() => ({
  resolveHref: vi.fn(),
  resolveWikilinkTarget: vi.fn()
}))

vi.mock('@renderer/lib/link-navigation', () => navigation)
vi.mock('@floating-ui/dom', () => ({
  computePosition: vi.fn().mockResolvedValue({ x: 20, y: 30 }),
  flip: vi.fn(),
  offset: vi.fn(),
  shift: vi.fn()
}))

import LinkHoverPreview from '@renderer/components/LinkHoverPreview.svelte'
import type { MdvdbApi } from '../../src/preload/api'

const api = {
  externalLinkPreview: vi.fn(),
  localLinkPreview: vi.fn()
}

let host: HTMLDivElement

beforeEach(() => {
  vi.clearAllMocks()
  host = document.createElement('div')
  document.body.append(host)
  window.api = api as unknown as MdvdbApi
})

afterEach(() => {
  cleanup()
  host.remove()
  vi.useRealTimers()
})

describe('LinkHoverPreview', () => {
  it('fetches and renders minimal external metadata after hover dwell', async () => {
    const anchor = document.createElement('a')
    anchor.href = 'https://example.com/article'
    anchor.textContent = 'External article'
    host.append(anchor)
    api.externalLinkPreview.mockResolvedValue({
      kind: 'external',
      url: 'https://example.com/article',
      finalUrl: 'https://example.com/article',
      domain: 'example.com',
      title: 'Remote title',
      description: 'Remote description',
      siteName: 'Example'
    })

    render(LinkHoverPreview, {
      props: { container: host, collectionPath: '/collection', hoverDelayMs: 0 }
    })
    await fireEvent.pointerOver(anchor)

    expect(await screen.findByText('Remote title')).toBeTruthy()
    expect(screen.getByText('Remote description')).toBeTruthy()
    expect(api.externalLinkPreview).toHaveBeenCalledWith('https://example.com/article')
    expect(api.localLinkPreview).not.toHaveBeenCalled()
  })

  it('resolves a wikilink and previews only its collection-local Markdown file', async () => {
    const wikilink = document.createElement('span')
    wikilink.className = 'wikilink'
    wikilink.dataset.wikilinkTarget = 'Local note'
    wikilink.textContent = 'Local note'
    host.append(wikilink)
    navigation.resolveWikilinkTarget.mockReturnValue('notes/local-note.md')
    api.localLinkPreview.mockResolvedValue({
      kind: 'local',
      path: 'notes/local-note.md',
      title: 'Local note title',
      description: 'A local summary.',
      modifiedAt: 123
    })

    render(LinkHoverPreview, {
      props: { container: host, collectionPath: '/collection', hoverDelayMs: 0 }
    })
    await fireEvent.pointerOver(wikilink)

    expect(await screen.findByText('Local note title')).toBeTruthy()
    expect(screen.getByText('Collection note')).toBeTruthy()
    expect(api.localLinkPreview).toHaveBeenCalledWith('/collection', 'notes/local-note.md')
    expect(api.externalLinkPreview).not.toHaveBeenCalled()
  })

  it('does not contact a destination when the pointer leaves before the dwell expires', async () => {
    vi.useFakeTimers()
    const anchor = document.createElement('a')
    anchor.href = 'https://example.com/'
    anchor.textContent = 'Too brief'
    host.append(anchor)

    render(LinkHoverPreview, {
      props: { container: host, collectionPath: '/collection', hoverDelayMs: 350 }
    })
    await fireEvent.pointerOver(anchor)
    await vi.advanceTimersByTimeAsync(200)
    await fireEvent.pointerOut(anchor, { relatedTarget: document.body })
    await vi.advanceTimersByTimeAsync(200)

    expect(api.externalLinkPreview).not.toHaveBeenCalled()
    expect(screen.queryByRole('tooltip')).toBeNull()
  })

  it('ignores unsupported schemes', async () => {
    const anchor = document.createElement('a')
    anchor.href = 'mailto:someone@example.com'
    anchor.textContent = 'Email'
    host.append(anchor)

    render(LinkHoverPreview, {
      props: { container: host, collectionPath: '/collection', hoverDelayMs: 0 }
    })
    await fireEvent.pointerOver(anchor)

    expect(api.externalLinkPreview).not.toHaveBeenCalled()
    expect(api.localLinkPreview).not.toHaveBeenCalled()
  })
})
