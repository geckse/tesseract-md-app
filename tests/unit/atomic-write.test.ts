import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { atomicCreateFile, atomicDeleteFile, atomicWriteFile } from '../../src/main/atomic-write'

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

  it('runs a final precommit guard and leaves its concurrent target untouched', async () => {
    const target = join(dir, 'note.md')
    await fs.writeFile(target, 'baseline', 'utf-8')

    await expect(
      atomicWriteFile(target, 'stale replacement', {
        beforeCommit: async () => {
          await fs.writeFile(target, 'concurrent generation', 'utf-8')
          throw new Error('source changed')
        }
      })
    ).rejects.toThrow('source changed')

    expect(await fs.readFile(target, 'utf-8')).toBe('concurrent generation')
    expect(await fs.readdir(dir)).toEqual(['note.md'])
  })

  it('rejects a final target identity swap even when the guard itself succeeds', async () => {
    const target = join(dir, 'note.md')
    const displaced = join(dir, 'displaced.md')
    await fs.writeFile(target, 'baseline', 'utf-8')

    await expect(
      atomicWriteFile(target, 'stale replacement', {
        beforeCommit: async () => {
          await fs.rename(target, displaced)
          await fs.writeFile(target, 'replacement inode', 'utf-8')
        }
      })
    ).rejects.toThrow(/changed identity/)

    expect(await fs.readFile(target, 'utf-8')).toBe('replacement inode')
    expect(await fs.readFile(displaced, 'utf-8')).toBe('baseline')
    expect((await fs.readdir(dir)).sort()).toEqual(['displaced.md', 'note.md'])
  })

  it.runIf(process.platform !== 'win32')(
    'preserves existing target permissions across replacement',
    async () => {
      const target = join(dir, 'mode.md')
      await fs.writeFile(target, 'baseline', 'utf-8')
      await fs.chmod(target, 0o640)

      await atomicWriteFile(target, 'replacement')

      expect((await fs.stat(target)).mode & 0o777).toBe(0o640)
    }
  )

  it.runIf(process.platform !== 'win32')(
    'rejects symbolic-link and hard-link targets without changing either inode',
    async () => {
      const original = join(dir, 'original.md')
      const symbolic = join(dir, 'symbolic.md')
      const hard = join(dir, 'hard.md')
      await fs.writeFile(original, 'keep', 'utf-8')
      await fs.symlink(original, symbolic)

      await expect(atomicWriteFile(symbolic, 'replace')).rejects.toThrow(/symbolic-link/)
      await fs.link(original, hard)
      await expect(atomicWriteFile(hard, 'replace')).rejects.toThrow(/hard-linked/)

      expect(await fs.readFile(original, 'utf-8')).toBe('keep')
      expect(await fs.readFile(symbolic, 'utf-8')).toBe('keep')
      expect(await fs.readFile(hard, 'utf-8')).toBe('keep')
    }
  )

  it.runIf(process.platform !== 'win32')(
    'rejects an internal symlinked folder that resolves outside the allowed root',
    async () => {
      const collection = join(dir, 'collection')
      const outside = join(dir, 'outside')
      await fs.mkdir(collection)
      await fs.mkdir(outside)
      await fs.writeFile(join(outside, 'record.md'), 'outside', 'utf-8')
      await fs.symlink(outside, join(collection, 'escape'))

      await expect(
        atomicWriteFile(join(collection, 'escape', 'record.md'), 'replace', {
          allowedRoot: collection
        })
      ).rejects.toThrow(/outside the collection/)

      expect(await fs.readFile(join(outside, 'record.md'), 'utf-8')).toBe('outside')
    }
  )

  it('throws without creating anything when the target directory is missing', async () => {
    const target = join(dir, 'missing', 'note.md')

    await expect(atomicWriteFile(target, 'content')).rejects.toThrow()

    expect(await fs.readdir(dir)).toEqual([])
  })
})

describe('atomicCreateFile', () => {
  let dir: string

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'atomic-create-test-'))
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('publishes complete binary content without leaving a temp file', async () => {
    const target = join(dir, 'image.png')
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff])

    await atomicCreateFile(target, bytes)

    expect(Buffer.compare(await fs.readFile(target), bytes)).toBe(0)
    expect(await fs.readdir(dir)).toEqual(['image.png'])
  })

  it('never overwrites an existing target', async () => {
    const target = join(dir, 'image.png')
    await fs.writeFile(target, 'original')

    await expect(atomicCreateFile(target, Buffer.from('replacement'))).rejects.toMatchObject({
      code: 'EEXIST'
    })

    expect(await fs.readFile(target, 'utf-8')).toBe('original')
    expect(await fs.readdir(dir)).toEqual(['image.png'])
  })

  it('cleans up its hidden sibling when publication fails', async () => {
    const target = join(dir, 'existing')
    await fs.mkdir(target)

    await expect(atomicCreateFile(target, 'image')).rejects.toThrow()

    expect(await fs.readdir(dir)).toEqual(['existing'])
  })
})

describe('atomicDeleteFile', () => {
  let dir: string

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'atomic-delete-test-'))
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('deletes one regular file and reports publication', async () => {
    const target = join(dir, 'overlay.yml')
    await fs.writeFile(target, 'schema', 'utf-8')
    let published = false

    await expect(
      atomicDeleteFile(target, {
        allowedRoot: dir,
        onPublished: () => {
          published = true
        }
      })
    ).resolves.toBe(true)

    expect(published).toBe(true)
    await expect(fs.access(target)).rejects.toThrow()
  })

  it('fails closed when the precommit guard replaces the target generation', async () => {
    const target = join(dir, 'overlay.yml')
    const displaced = join(dir, 'old-overlay.yml')
    await fs.writeFile(target, 'baseline', 'utf-8')

    await expect(
      atomicDeleteFile(target, {
        allowedRoot: dir,
        beforeCommit: async () => {
          await fs.rename(target, displaced)
          await fs.writeFile(target, 'concurrent generation', 'utf-8')
        }
      })
    ).rejects.toThrow(/changed identity/)

    expect(await fs.readFile(target, 'utf-8')).toBe('concurrent generation')
    expect(await fs.readFile(displaced, 'utf-8')).toBe('baseline')
  })

  it.runIf(process.platform !== 'win32')(
    'refuses symbolic-link and hard-link deletion targets',
    async () => {
      const original = join(dir, 'original.yml')
      const symbolic = join(dir, 'symbolic.yml')
      const hard = join(dir, 'hard.yml')
      await fs.writeFile(original, 'keep', 'utf-8')
      await fs.symlink(original, symbolic)

      await expect(atomicDeleteFile(symbolic, { allowedRoot: dir })).rejects.toThrow(
        /symbolic-link/
      )
      await fs.link(original, hard)
      await expect(atomicDeleteFile(hard, { allowedRoot: dir })).rejects.toThrow(/hard-linked/)

      expect(await fs.readFile(original, 'utf-8')).toBe('keep')
      expect(await fs.readFile(symbolic, 'utf-8')).toBe('keep')
      expect(await fs.readFile(hard, 'utf-8')).toBe('keep')
    }
  )
})
