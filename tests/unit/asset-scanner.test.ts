import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { scanAssets, getMimeCategory, type AssetFileNode } from '../../src/main/asset-scanner'
import { writeFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

let testDir: string

beforeEach(async () => {
  testDir = join(tmpdir(), `asset-scanner-test-${randomUUID()}`)
  await mkdir(testDir, { recursive: true })
})

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true })
})

/** Flatten every node in the tree (dirs + files). */
function collectNodes(node: AssetFileNode): AssetFileNode[] {
  return [node, ...node.children.flatMap(collectNodes)]
}

describe('scanAssets', () => {
  it('discovers assets and skips markdown files', async () => {
    await writeFile(join(testDir, 'note.md'), '# hi', 'utf-8')
    await writeFile(join(testDir, 'img.png'), 'fake-png', 'utf-8')
    await writeFile(join(testDir, 'archive.custom'), 'opaque', 'utf-8')
    await writeFile(join(testDir, 'LICENSE'), 'opaque', 'utf-8')

    const result = await scanAssets(testDir)

    expect(result.totalAssets).toBe(3)
    const files = collectNodes(result.root).filter((node) => !node.is_dir)
    expect(files.find((file) => file.path === 'img.png')?.mimeCategory).toBe('image')
    expect(files.find((file) => file.path === 'archive.custom')?.mimeCategory).toBe('other')
    expect(files.find((file) => file.path === 'LICENSE')?.mimeCategory).toBe('other')
  })

  it('returns nested paths joined with forward slashes, never backslashes', async () => {
    await mkdir(join(testDir, 'assets', 'deep'), { recursive: true })
    await writeFile(join(testDir, 'assets', 'img.png'), 'fake', 'utf-8')
    await writeFile(join(testDir, 'assets', 'deep', 'doc.pdf'), 'fake', 'utf-8')

    const result = await scanAssets(testDir)
    const nodes = collectNodes(result.root)

    // Pins the split(sep).join('/') normalization: on Windows, path.relative()
    // yields backslash-separated paths that must never reach the renderer.
    for (const node of nodes) {
      expect(node.path).not.toContain('\\')
    }

    const paths = nodes.map((n) => n.path)
    expect(paths).toContain('assets')
    expect(paths).toContain('assets/img.png')
    expect(paths).toContain('assets/deep')
    expect(paths).toContain('assets/deep/doc.pdf')
    expect(result.totalAssets).toBe(2)
  })

  it('respects .gitignore patterns', async () => {
    await mkdir(join(testDir, 'ignored'), { recursive: true })
    await mkdir(join(testDir, 'kept'), { recursive: true })
    await writeFile(join(testDir, '.gitignore'), 'ignored/\n', 'utf-8')
    await writeFile(join(testDir, 'ignored', 'img.png'), 'fake', 'utf-8')
    await writeFile(join(testDir, 'kept', 'img.png'), 'fake', 'utf-8')

    const result = await scanAssets(testDir)
    const paths = collectNodes(result.root).map((n) => n.path)

    expect(paths).toContain('kept/img.png')
    expect(paths).not.toContain('ignored/img.png')
    expect(result.totalAssets).toBe(1)
  })

  it('skips always-skipped and hidden directories', async () => {
    await mkdir(join(testDir, 'node_modules'), { recursive: true })
    await mkdir(join(testDir, '.markdownvdb'), { recursive: true })
    await writeFile(join(testDir, 'node_modules', 'img.png'), 'fake', 'utf-8')
    await writeFile(join(testDir, '.markdownvdb', 'img.png'), 'fake', 'utf-8')

    const result = await scanAssets(testDir)

    expect(result.totalAssets).toBe(0)
    expect(result.root.children).toHaveLength(0)
  })
})

describe('getMimeCategory', () => {
  it('maps known extensions case-insensitively', () => {
    expect(getMimeCategory('photo.PNG')).toBe('image')
    expect(getMimeCategory('doc.pdf')).toBe('pdf')
    expect(getMimeCategory('clip.mp4')).toBe('video')
    expect(getMimeCategory('clip.M4V')).toBe('video')
    expect(getMimeCategory('clip.ogv')).toBe('video')
    expect(getMimeCategory('clip.mkv')).toBe('video')
    expect(getMimeCategory('clip.mpeg')).toBe('video')
    expect(getMimeCategory('song.mp3')).toBe('audio')
  })

  it('uses other for unknown and extensionless files, and excludes Markdown', () => {
    expect(getMimeCategory('data.xyz')).toBe('other')
    expect(getMimeCategory('README')).toBe('other')
    expect(getMimeCategory('note.md')).toBeNull()
    expect(getMimeCategory('note.MARKDOWN')).toBeNull()
  })
})
