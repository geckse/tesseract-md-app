import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { VaultWatcher } from '../../src/main/vault-watcher'
import { registerOwnWrite, clearOwnWrites } from '../../src/main/own-writes'
import type { VaultEventBatch } from '../../src/preload/api'

/**
 * End-to-end coverage against the REAL filesystem + REAL chokidar (no mocks),
 * including the symlinked-root case the canonicalization guard exists for.
 * Uses generous polling timeouts so it is robust across platforms.
 */

let vw: VaultWatcher | null = null
const cleanupDirs: string[] = []
const previousPollingSetting = process.env.CHOKIDAR_USEPOLLING

beforeAll(() => {
  // Polling still exercises real chokidar and real filesystem events while
  // remaining reliable in sandboxed macOS runners where FSEvents is withheld.
  process.env.CHOKIDAR_USEPOLLING = 'true'
})

afterAll(() => {
  if (previousPollingSetting === undefined) delete process.env.CHOKIDAR_USEPOLLING
  else process.env.CHOKIDAR_USEPOLLING = previousPollingSetting
})

afterEach(async () => {
  if (vw) await vw.destroy()
  vw = null
  clearOwnWrites()
  for (const d of cleanupDirs.splice(0)) {
    await fs.rm(d, { recursive: true, force: true }).catch(() => {})
  }
})

function waitForBatch(
  batches: VaultEventBatch[],
  predicate: (b: VaultEventBatch) => boolean,
  ms = 5000
): Promise<VaultEventBatch> {
  return new Promise((resolve, reject) => {
    const start = Date.now()
    const iv = setInterval(() => {
      const found = batches.find(predicate)
      if (found) {
        clearInterval(iv)
        resolve(found)
      } else if (Date.now() - start > ms) {
        clearInterval(iv)
        reject(new Error('timeout waiting for batch'))
      }
    }, 50)
  })
}

describe('VaultWatcher real filesystem integration', () => {
  it('reports create/modify/delete and tags own-writes', async () => {
    const root = await fs.mkdtemp(join(tmpdir(), 'mdvdb-vw-'))
    cleanupDirs.push(root)
    const batches: VaultEventBatch[] = []
    vw = new VaultWatcher()
    vw.onBatch((b) => batches.push(b))
    await vw.start(root)
    await new Promise((r) => setTimeout(r, 400))

    const notePath = join(root, 'note.md')
    await fs.writeFile(notePath, '# Hello\n')
    const created = await waitForBatch(batches, (b) =>
      b.events.some((e) => e.path === 'note.md' && e.kind === 'created')
    )
    expect(created.events.find((e) => e.path === 'note.md')!.origin).toBe('external')

    // App-origin modify — must be tagged origin:'app'
    batches.length = 0
    const newContent = '# Hello\n\nmore\n'
    registerOwnWrite(notePath, 'write', newContent)
    await fs.writeFile(notePath, newContent)
    const modified = await waitForBatch(batches, (b) =>
      b.events.some((e) => e.path === 'note.md' && e.kind === 'modified')
    )
    expect(modified.events.find((e) => e.path === 'note.md')!.origin).toBe('app')

    // Ignore rules: .markdownvdb + non-markdown/non-asset must not surface
    batches.length = 0
    await fs.mkdir(join(root, '.markdownvdb'), { recursive: true })
    await fs.writeFile(join(root, '.markdownvdb', 'index'), 'x')
    await fs.writeFile(join(root, 'scratch.json'), '{}')
    await fs.writeFile(join(root, 'second.md'), 'x')
    await waitForBatch(batches, (b) => b.events.some((e) => e.path === 'second.md'))
    const paths = batches.flatMap((b) => b.events.map((e) => e.path))
    expect(paths.some((p) => p.includes('.markdownvdb'))).toBe(false)
    expect(paths).not.toContain('scratch.json')

    batches.length = 0
    await fs.rm(notePath)
    const deleted = await waitForBatch(batches, (b) =>
      b.events.some((e) => e.path === 'note.md' && e.kind === 'deleted')
    )
    expect(deleted.events.find((e) => e.path === 'note.md')!.kind).toBe('deleted')
  }, 20000)

  it('watches through a symlinked root and still matches own-writes', async () => {
    // Real symlink: linkRoot → realRoot. The app hands the watcher the symlink
    // path; FSEvents only fires against the canonical path (the whole reason
    // for the canonicalization guard).
    const realRoot = await fs.mkdtemp(join(tmpdir(), 'mdvdb-real-'))
    const linkRoot = `${realRoot}-link`
    await fs.symlink(realRoot, linkRoot)
    cleanupDirs.push(realRoot, linkRoot)

    const batches: VaultEventBatch[] = []
    vw = new VaultWatcher()
    vw.onBatch((b) => batches.push(b))
    await vw.start(linkRoot)
    await new Promise((r) => setTimeout(r, 400))

    // Status reports the ORIGINAL (symlink) path so the renderer filter matches
    expect(vw.getStatus().root).toBe(linkRoot)

    // Register an own-write against the symlink-based path (what fs handlers use)
    const content = '# via symlink\n'
    registerOwnWrite(join(linkRoot, 'note.md'), 'write', content)
    // Write through the real path
    await fs.writeFile(join(realRoot, 'note.md'), content)

    const batch = await waitForBatch(batches, (b) => b.events.some((e) => e.path === 'note.md'))
    const ev = batch.events.find((e) => e.path === 'note.md')!
    expect(ev.path).toBe('note.md') // relative, canonical-independent
    expect(batch.root).toBe(linkRoot) // reported against the original root
    expect(ev.origin).toBe('app') // own-write matched despite the symlink
  }, 20000)
})
