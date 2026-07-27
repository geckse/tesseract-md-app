import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const electronNet = vi.hoisted(() => ({
  resolveHost: vi.fn(),
  fetch: vi.fn()
}))

vi.mock('electron', () => ({ net: electronNet }))

import {
  clearLinkPreviewCaches,
  externalLinkPreview,
  localLinkPreview
} from '../../src/main/link-preview'

const temporaryDirectories: string[] = []

beforeEach(() => {
  clearLinkPreviewCaches()
  electronNet.resolveHost.mockReset().mockResolvedValue({
    endpoints: [{ address: '93.184.216.34', family: 'ipv4' }]
  })
  electronNet.fetch.mockReset()
})

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  )
})

describe('externalLinkPreview', () => {
  it('fetches a bounded, credential-free HTML prefix and caches parsed metadata', async () => {
    electronNet.fetch.mockResolvedValue(
      new Response(
        `<html><head>
          <meta property="og:title" content="A &amp; B">
          <meta property="og:description" content="Small preview">
          <meta property="og:site_name" content="Example">
        </head><body>This body is irrelevant.</body></html>`,
        { status: 206, headers: { 'content-type': 'text/html; charset=utf-8' } }
      )
    )

    const first = await externalLinkPreview('https://example.com/page#section')
    const second = await externalLinkPreview('https://example.com/page#different')

    expect(first).toEqual({
      kind: 'external',
      url: 'https://example.com/page',
      finalUrl: 'https://example.com/page',
      domain: 'example.com',
      title: 'A & B',
      description: 'Small preview',
      siteName: 'Example'
    })
    expect(second).toEqual(first)
    expect(electronNet.fetch).toHaveBeenCalledTimes(1)
    expect(electronNet.fetch).toHaveBeenCalledWith(
      'https://example.com/page',
      expect.objectContaining({
        method: 'GET',
        redirect: 'manual',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        headers: {
          Accept: 'text/html, application/xhtml+xml;q=0.9',
          Range: 'bytes=0-65535'
        }
      })
    )
  })

  it.each([
    'http://127.0.0.1/secret',
    'http://[::1]/secret',
    'http://localhost/secret',
    'http://printer.local/status',
    'https://example.com:8443/page',
    'file:///etc/passwd',
    'https://user:password@example.com/'
  ])('rejects unsafe URL %s before any request', async (url) => {
    await expect(externalLinkPreview(url)).resolves.toBeNull()
    expect(electronNet.fetch).not.toHaveBeenCalled()
  })

  it('rejects a hostname if any resolved endpoint is non-public', async () => {
    electronNet.resolveHost.mockResolvedValue({
      endpoints: [
        { address: '93.184.216.34', family: 'ipv4' },
        { address: '10.0.0.5', family: 'ipv4' }
      ]
    })

    await expect(externalLinkPreview('https://example.com/')).resolves.toBeNull()
    expect(electronNet.fetch).not.toHaveBeenCalled()
  })

  it('revalidates redirects and refuses a redirect to a local address', async () => {
    electronNet.fetch.mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: 'http://169.254.169.254/latest/meta-data/' }
      })
    )

    await expect(externalLinkPreview('https://example.com/')).resolves.toBeNull()
    expect(electronNet.fetch).toHaveBeenCalledTimes(1)
  })

  it('treats a malformed redirect as an unavailable preview', async () => {
    electronNet.fetch.mockResolvedValue(
      new Response(null, { status: 302, headers: { location: 'http://[invalid' } })
    )

    await expect(externalLinkPreview('https://example.com/')).resolves.toBeNull()
  })

  it('does not parse or return non-HTML responses', async () => {
    electronNet.fetch.mockResolvedValue(
      new Response('{"secret":"value"}', {
        status: 200,
        headers: { 'content-type': 'application/json' }
      })
    )

    await expect(externalLinkPreview('https://example.com/data')).resolves.toBeNull()
  })

  it('requires an explicit HTML content type', async () => {
    electronNet.fetch.mockResolvedValue(new Response('<title>Looks like HTML</title>'))

    await expect(externalLinkPreview('https://example.com/unknown')).resolves.toBeNull()
  })
})

describe('localLinkPreview', () => {
  it('reads title and description from a collection-local Markdown prefix', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tesseract-link-preview-'))
    temporaryDirectories.push(root)
    await writeFile(
      join(root, 'note.md'),
      `---
title: "Local title"
description: A concise local description
---

# Ignored fallback heading

The note body.
`
    )

    const preview = await localLinkPreview(root, 'note.md', [root])

    expect(preview).toEqual({
      kind: 'local',
      path: 'note.md',
      title: 'Local title',
      description: 'A concise local description',
      modifiedAt: expect.any(Number)
    })
  })

  it('rejects unknown collections, traversal, non-Markdown files, and escaping symlinks', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tesseract-link-preview-root-'))
    const outside = await mkdtemp(join(tmpdir(), 'tesseract-link-preview-outside-'))
    temporaryDirectories.push(root, outside)
    await writeFile(join(outside, 'secret.md'), '# Secret\n\nDo not expose this.')
    await writeFile(join(root, 'asset.png'), 'not really an image')
    await symlink(join(outside, 'secret.md'), join(root, 'escape.md'))

    await expect(localLinkPreview(root, 'asset.png', [root])).resolves.toBeNull()
    await expect(localLinkPreview(root, '../secret.md', [root])).resolves.toBeNull()
    await expect(localLinkPreview(root, 'escape.md', [root])).resolves.toBeNull()
    await expect(localLinkPreview(root, 'escape.md', [outside])).resolves.toBeNull()
  })
})
