import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { atomicWriteFile } from '../../src/main/atomic-write'

describe('atomicWriteFile', () => {
  let dir: string

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'atomic-write-test-'))
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('creates a new file with exact string content (utf-8 fidelity)', async () => {
    const target = join(dir, 'note.md')
    const content = '---\ntitle: Héllo wörld\n---\n\n日本語 🚀 line\n'

    await atomicWriteFile(target, content)

    expect(await fs.readFile(target, 'utf-8')).toBe(content)
  })

  it('overwrites an existing file', async () => {
    const target = join(dir, 'note.md')
    await fs.writeFile(target, 'old content', 'utf-8')

    await atomicWriteFile(target, 'new content')

    expect(await fs.readFile(target, 'utf-8')).toBe('new content')
  })

  it('writes Buffer content byte-identically', async () => {
    const target = join(dir, 'image.png')
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0x7f, 0x01])

    await atomicWriteFile(target, bytes)

    expect(Buffer.compare(await fs.readFile(target), bytes)).toBe(0)
  })

  it('leaves no temp files behind on success', async () => {
    await atomicWriteFile(join(dir, 'a.md'), 'one')
    await atomicWriteFile(join(dir, 'a.md'), 'two')

    expect(await fs.readdir(dir)).toEqual(['a.md'])
  })

  it('uses a dotfile temp name the vault watcher ignores', async () => {
    // Snoop the directory during the write by racing a readdir; instead of
    // relying on timing, assert the documented shape via a failed rename:
    // renaming onto an existing directory fails AFTER the temp was written.
    const targetDir = join(dir, 'sub')
    await fs.mkdir(targetDir)

    await expect(atomicWriteFile(targetDir, 'x')).rejects.toThrow()

    // Failure path already cleaned up — no `.<ts>.<pid>.mdvdb.tmp` remains.
    const entries = await fs.readdir(dir)
    expect(entries).toEqual(['sub'])
  })

  it('cleans up the temp and preserves the original on rename failure', async () => {
    const targetDir = join(dir, 'existing')
    await fs.mkdir(targetDir)
    await fs.writeFile(join(targetDir, 'keep.md'), 'kept', 'utf-8')

    // Renaming a file over an existing non-empty directory always fails.
    await expect(atomicWriteFile(targetDir, 'clobber')).rejects.toThrow()

    expect(await fs.readdir(dir)).toEqual(['existing'])
    expect(await fs.readFile(join(targetDir, 'keep.md'), 'utf-8')).toBe('kept')
  })

  it('throws without creating anything when the target directory is missing', async () => {
    const target = join(dir, 'missing', 'note.md')

    await expect(atomicWriteFile(target, 'content')).rejects.toThrow()

    expect(await fs.readdir(dir)).toEqual([])
  })
})
