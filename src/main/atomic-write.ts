/**
 * Atomic file writes for the main process (data safety).
 *
 * Single owner of the dotfile-temp + rename pattern used by every app write
 * path (frontmatter editor, schema overlay, editor saves, binary assets):
 *  - The temp file lives in the SAME directory as the target, so the final
 *    rename is same-device (a cross-device rename via os.tmpdir would fail)
 *    and readers never observe a truncated/partial file.
 *  - The temp name is a dotfile, so the vault watcher never sees it; the
 *    rename surfaces as a 'change' on the target (chokidar atomic handling).
 *  - On any failure the temp file is cleaned up best-effort and the original
 *    target is left untouched.
 */

import { promises as fs } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, isAbsolute, join, relative } from 'node:path'

export interface AtomicWriteOptions {
  /** Last-moment CAS/dependency check performed after the temporary file is
   * durable and immediately before publication. Throwing leaves the target
   * untouched. */
  beforeCommit?: () => void | Promise<void>
  /** Canonical filesystem boundary for mutation targets. */
  allowedRoot?: string
  /** Publication notification used by callers that must distinguish a failed
   * rename from a post-rename durability error. */
  onPublished?: () => void
}

interface TargetIdentity {
  exists: boolean
  dev: number | null
  ino: number | null
  mode: number | null
}

function pathIsWithin(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate)
  return fromRoot === '' || (!fromRoot.startsWith('..') && !isAbsolute(fromRoot))
}

async function targetIdentity(absPath: string, allowedRoot?: string): Promise<TargetIdentity> {
  const parent = dirname(absPath)
  if (allowedRoot) {
    const [canonicalRoot, canonicalParent] = await Promise.all([
      fs.realpath(allowedRoot),
      fs.realpath(parent)
    ])
    if (!pathIsWithin(canonicalRoot, canonicalParent)) {
      throw new Error('Refusing to write through a symlinked folder outside the collection')
    }
  }

  try {
    const metadata = await fs.lstat(absPath)
    if (metadata.isSymbolicLink()) {
      throw new Error('Refusing to replace a symbolic-link target')
    }
    if (metadata.nlink > 1) {
      throw new Error('Refusing to replace a hard-linked target')
    }
    return {
      exists: true,
      dev: metadata.dev,
      ino: metadata.ino,
      mode: metadata.mode & 0o7777
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { exists: false, dev: null, ino: null, mode: null }
    }
    throw error
  }
}

function sameIdentity(left: TargetIdentity, right: TargetIdentity): boolean {
  return (
    left.exists === right.exists &&
    (!left.exists || (left.dev === right.dev && left.ino === right.ino))
  )
}

async function syncDirectory(path: string): Promise<void> {
  let handle: Awaited<ReturnType<typeof fs.open>> | null = null
  try {
    handle = await fs.open(path, 'r')
    await handle.sync()
  } catch (error) {
    // Directory fsync is unsupported on some Windows/filesystem combinations.
    // Do not make an otherwise atomic write unusable there; POSIX filesystems
    // propagate real durability errors.
    const code = (error as NodeJS.ErrnoException).code
    if (
      process.platform !== 'win32' ||
      (code !== 'EINVAL' && code !== 'ENOTSUP' && code !== 'EPERM' && code !== 'EISDIR')
    ) {
      throw error
    }
  } finally {
    await handle?.close().catch(() => {})
  }
}

/**
 * Write `content` to `absPath` atomically (dotfile temp in the same
 * directory, then rename over the target). Strings are written as UTF-8.
 */
export async function atomicWriteFile(
  absPath: string,
  content: string | Buffer,
  options: AtomicWriteOptions = {}
): Promise<void> {
  const parent = dirname(absPath)
  const tmpPath = join(parent, `.${Date.now()}.${process.pid}.${randomUUID()}.mdvdb.tmp`)
  const identity = await targetIdentity(absPath, options.allowedRoot)
  const mode = identity.mode
  try {
    const temporary = await fs.open(tmpPath, 'wx', mode ?? 0o666)
    try {
      if (typeof content === 'string') {
        await temporary.writeFile(content, 'utf-8')
      } else {
        await temporary.writeFile(content)
      }
      if (mode !== null) await temporary.chmod(mode)
      await temporary.sync()
    } finally {
      await temporary.close()
    }

    // Persist the temporary directory entry before the publication CAS, then
    // persist the rename itself. Readers still see either complete generation.
    await syncDirectory(parent)
    await options.beforeCommit?.()
    const currentIdentity = await targetIdentity(absPath, options.allowedRoot)
    if (!sameIdentity(identity, currentIdentity)) {
      throw new Error('The target file changed identity before the atomic write could commit')
    }
    await fs.rename(tmpPath, absPath)
    options.onPublished?.()
    await syncDirectory(parent)
  } catch (err) {
    await fs.rm(tmpPath, { force: true }).catch(() => {})
    throw err
  }
}

/**
 * Remove one regular file with the same boundary, identity, durability, and
 * publication guarantees as `atomicWriteFile`. The target is inspected before
 * and after the caller's final CAS hook, so symbolic links, hard links, and
 * inode swaps are rejected instead of being followed or deleting a newer
 * generation.
 */
export async function atomicDeleteFile(
  absPath: string,
  options: AtomicWriteOptions = {}
): Promise<boolean> {
  const parent = dirname(absPath)
  const identity = await targetIdentity(absPath, options.allowedRoot)
  if (!identity.exists) return false

  await options.beforeCommit?.()
  const currentIdentity = await targetIdentity(absPath, options.allowedRoot)
  if (!sameIdentity(identity, currentIdentity)) {
    throw new Error('The target file changed identity before the atomic delete could commit')
  }
  await fs.unlink(absPath)
  options.onPublished?.()
  await syncDirectory(parent)
  return true
}

/**
 * Create a file atomically without replacing an existing target.
 *
 * The complete payload is written to a hidden sibling first. A hard link then
 * publishes that inode at `absPath`; link creation is atomic and fails with
 * EEXIST when another file already owns the requested name. Removing the
 * hidden sibling leaves the published target intact.
 */
export async function atomicCreateFile(absPath: string, content: string | Buffer): Promise<void> {
  const tmpPath = join(
    dirname(absPath),
    `.${Date.now()}.${process.pid}.${randomUUID()}.mdvdb-create.tmp`
  )
  try {
    if (typeof content === 'string') {
      await fs.writeFile(tmpPath, content, { encoding: 'utf-8', flag: 'wx' })
    } else {
      await fs.writeFile(tmpPath, content, { flag: 'wx' })
    }
    await fs.link(tmpPath, absPath)
    await fs.rm(tmpPath, { force: true })
  } catch (err) {
    await fs.rm(tmpPath, { force: true }).catch(() => {})
    throw err
  }
}
