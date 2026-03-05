/**
 * Dotenv-style config file read/write utilities.
 *
 * Reads and writes KEY=value files (like .markdownvdb/.config),
 * preserving comments, empty lines, and key ordering.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * Read a dotenv-style config file into a key-value record.
 * Returns an empty record if the file does not exist.
 */
export async function readConfig(filePath: string): Promise<Record<string, string>> {
  let content: string
  try {
    content = await readFile(filePath, 'utf-8')
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return {}
    }
    throw err
  }

  const result: Record<string, string> = {}
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) continue
    const key = trimmed.slice(0, eqIndex).trim()
    const value = trimmed.slice(eqIndex + 1).trim()
    if (key) {
      result[key] = value
    }
  }
  return result
}

/**
 * Set a single key in a dotenv-style config file.
 * Preserves comments, empty lines, and ordering.
 * Creates parent directories and the file if they don't exist.
 */
export async function writeConfigKey(filePath: string, key: string, value: string): Promise<void> {
  let lines: string[]
  try {
    const content = await readFile(filePath, 'utf-8')
    lines = content.split('\n')
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      await mkdir(dirname(filePath), { recursive: true })
      await writeFile(filePath, `${key}=${value}\n`, 'utf-8')
      return
    }
    throw err
  }

  let found = false
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) continue
    const lineKey = trimmed.slice(0, eqIndex).trim()
    if (lineKey === key) {
      lines[i] = `${key}=${value}`
      found = true
      break
    }
  }

  if (!found) {
    // Append before trailing empty lines
    let insertIndex = lines.length
    while (insertIndex > 0 && lines[insertIndex - 1].trim() === '') {
      insertIndex--
    }
    lines.splice(insertIndex, 0, `${key}=${value}`)
  }

  await writeFile(filePath, lines.join('\n'), 'utf-8')
}

/**
 * Delete a key from a dotenv-style config file.
 * Preserves comments, empty lines, and ordering.
 * No-op if the file or key does not exist.
 */
export async function deleteConfigKey(filePath: string, key: string): Promise<void> {
  let content: string
  try {
    content = await readFile(filePath, 'utf-8')
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return
    }
    throw err
  }

  const lines = content.split('\n')
  const filtered = lines.filter((line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return true
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) return true
    const lineKey = trimmed.slice(0, eqIndex).trim()
    return lineKey !== key
  })

  await writeFile(filePath, filtered.join('\n'), 'utf-8')
}
