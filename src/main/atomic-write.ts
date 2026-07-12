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
import { dirname, join } from 'node:path'

/**
 * Write `content` to `absPath` atomically (dotfile temp in the same
 * directory, then rename over the target). Strings are written as UTF-8.
 */
export async function atomicWriteFile(absPath: string, content: string | Buffer): Promise<void> {
  const tmpPath = join(dirname(absPath), `.${Date.now()}.${process.pid}.mdvdb.tmp`)
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
