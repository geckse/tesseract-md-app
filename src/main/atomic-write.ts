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
import { dirname, join } from 'node:path'

/**
 * Write `content` to `absPath` atomically (dotfile temp in the same
 * directory, then rename over the target). Strings are written as UTF-8.
 */
export async function atomicWriteFile(absPath: string, content: string | Buffer): Promise<void> {
  const tmpPath = join(dirname(absPath), `.${Date.now()}.${process.pid}.${randomUUID()}.mdvdb.tmp`)
  try {
    if (typeof content === 'string') {
      await fs.writeFile(tmpPath, content, 'utf-8')
    } else {
      await fs.writeFile(tmpPath, content)
    }
    await fs.rename(tmpPath, absPath)
  } catch (err) {
    await fs.rm(tmpPath, { force: true }).catch(() => {})
    throw err
  }
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
