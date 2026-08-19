import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { link, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { join, relative, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import {
  collectionContainingPath,
  markdownPathsFromArguments,
  openMarkdownPath
} from '../../src/main/open-markdown'
import type { Collection } from '../../src/main/store'

let testRoot: string

function collection(id: string, path: string): Collection {
  return { id, name: id, path, addedAt: 1, lastOpenedAt: 1 }
}

function windowManagerStub() {
  return {
    createStandaloneWindow: vi.fn(),
    openCollectionDocument: vi.fn()
  }
}

beforeEach(async () => {
  testRoot = await mkdtemp(join(tmpdir(), 'tesseract-open-markdown-'))
})

afterEach(async () => {
  await rm(testRoot, { recursive: true, force: true })
})

describe('markdownPathsFromArguments', () => {
  it('normalizes relative paths and file URLs while ignoring switches and other extensions', () => {
    const relativeMarkdown = join('notes', 'one.md')
    const absoluteMarkdown = join(testRoot, 'two.MD')
    const fileUrl = pathToFileURL(absoluteMarkdown).href

    expect(
      markdownPathsFromArguments(
        ['--inspect', relativeMarkdown, absoluteMarkdown, fileUrl, 'notes/image.png'],
        testRoot
      )
    ).toEqual([resolve(testRoot, relativeMarkdown), resolve(absoluteMarkdown)])
  })

  it('ignores malformed file URLs', () => {
    expect(markdownPathsFromArguments(['file://%'], testRoot)).toEqual([])
  })
})

describe('collectionContainingPath', () => {
  it('uses path boundaries and picks the most specific collection', () => {
    const root = join(testRoot, 'notes')
    const nested = join(root, 'project')
    const collections = [collection('root', root), collection('nested', nested)]

    expect(collectionContainingPath(join(nested, 'doc.md'), collections)?.id).toBe('nested')
    expect(
      collectionContainingPath(join(testRoot, 'notes-other', 'doc.md'), collections)
    ).toBeNull()
  })
})

describe('openMarkdownPath', () => {
  it('opens a file outside all collections in a standalone window', async () => {
    const filePath = join(testRoot, 'outside.md')
    await writeFile(filePath, '# Outside\n')
    const manager = windowManagerStub()

    await expect(openMarkdownPath(filePath, manager as never, [])).resolves.toBe(true)

    expect(manager.createStandaloneWindow).toHaveBeenCalledWith(await realpath(filePath))
    expect(manager.openCollectionDocument).not.toHaveBeenCalled()
  })

  it('opens a known collection file in the normal collection-aware window', async () => {
    const collectionRoot = join(testRoot, 'collection')
    const filePath = join(collectionRoot, 'folder', 'inside.md')
    await mkdir(join(collectionRoot, 'folder'), { recursive: true })
    await writeFile(filePath, '# Inside\n')
    const manager = windowManagerStub()

    await expect(
      openMarkdownPath(filePath, manager as never, [collection('work', collectionRoot)])
    ).resolves.toBe(true)

    expect(manager.openCollectionDocument).toHaveBeenCalledWith('work', 'folder/inside.md')
    expect(manager.createStandaloneWindow).not.toHaveBeenCalled()
  })

  it('recognizes a collection registered through a symlinked folder', async () => {
    const realRoot = join(testRoot, 'real-collection')
    const aliasRoot = join(testRoot, 'collection-alias')
    const filePath = join(realRoot, 'inside.md')
    await mkdir(realRoot)
    await writeFile(filePath, '# Inside\n')
    await symlink(realRoot, aliasRoot, process.platform === 'win32' ? 'junction' : 'dir')
    const manager = windowManagerStub()

    await openMarkdownPath(filePath, manager as never, [collection('linked', aliasRoot)])

    expect(manager.openCollectionDocument).toHaveBeenCalledWith('linked', 'inside.md')
  })

  it('rejects missing paths, directories, symlinks, hard links, and non-Markdown files', async () => {
    const realFile = join(testRoot, 'real.md')
    const symbolicFile = join(testRoot, 'symbolic.md')
    const hardLinkedFile = join(testRoot, 'hard-linked.md')
    const markdownDirectory = join(testRoot, 'folder.md')
    const textFile = join(testRoot, 'plain.txt')
    await writeFile(realFile, '# Real\n')
    await symlink(realFile, symbolicFile)
    await link(realFile, hardLinkedFile)
    await mkdir(markdownDirectory)
    await writeFile(textFile, 'text')
    const manager = windowManagerStub()

    for (const candidate of [
      join(testRoot, 'missing.md'),
      markdownDirectory,
      symbolicFile,
      hardLinkedFile,
      textFile
    ]) {
      await expect(openMarkdownPath(candidate, manager as never, [])).resolves.toBe(false)
    }

    expect(manager.createStandaloneWindow).not.toHaveBeenCalled()
    expect(manager.openCollectionDocument).not.toHaveBeenCalled()
  })

  it('emits portable slash-separated paths for nested collection documents', async () => {
    const collectionRoot = join(testRoot, 'portable')
    const filePath = join(collectionRoot, 'one', 'two.md')
    await mkdir(join(collectionRoot, 'one'), { recursive: true })
    await writeFile(filePath, '# Portable\n')
    const manager = windowManagerStub()

    await openMarkdownPath(filePath, manager as never, [collection('portable', collectionRoot)])

    const platformRelative = relative(collectionRoot, filePath)
    expect(manager.openCollectionDocument).toHaveBeenCalledWith(
      'portable',
      platformRelative.split(sep).join('/')
    )
  })
})
