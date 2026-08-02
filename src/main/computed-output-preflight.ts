/**
 * Current-disk collision preflight for computed output keys.
 *
 * The collection/schema CLI view is index-backed, so a newly saved or
 * externally created Markdown file may not be represented yet. Before a
 * create/rename claims an output key, scan its owner subtree directly and
 * fail closed if any explicit top-level frontmatter pair already uses it.
 * This module is read-only: it never follows symlinks and never edits files.
 */

import { promises as fs } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { isMap, parseDocument } from 'yaml'

const BUILTIN_IGNORED_DIRECTORIES = new Set([
  '.claude',
  '.cursor',
  '.vscode',
  '.idea',
  '.git',
  '.markdownvdb',
  '.obsidian',
  'node_modules',
  '__pycache__',
  '.next',
  '.nuxt',
  '.svelte-kit',
  'target',
  'dist',
  'build',
  'out'
])

function insideRoot(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(`${root}${sep}`)
}

function scopeComponents(scope: string | null): string[] {
  if (scope === null) return []
  if (scope === '' || scope.endsWith('/')) {
    throw new Error(`Invalid computed owner scope: "${scope}"`)
  }
  return scope.split('/').filter(Boolean)
}

function ignoredComponent(name: string): boolean {
  return name.startsWith('.') || BUILTIN_IGNORED_DIRECTORIES.has(name)
}

function frontmatterHasOwnKey(content: string, key: string, relativePath: string): boolean {
  const source = content.startsWith('\uFEFF') ? content.slice(1) : content
  const firstLineEnd = source.indexOf('\n')
  if (firstLineEnd < 0 || source.slice(0, firstLineEnd).replace(/\r$/, '') !== '---') return false

  let cursor = firstLineEnd + 1
  let closingStart = -1
  while (cursor <= source.length) {
    const nextLineEnd = source.indexOf('\n', cursor)
    const end = nextLineEnd < 0 ? source.length : nextLineEnd
    if (source.slice(cursor, end).replace(/\r$/, '') === '---') {
      closingStart = cursor
      break
    }
    if (nextLineEnd < 0) break
    cursor = nextLineEnd + 1
  }
  if (closingStart < 0) {
    throw new Error(`Cannot safely inspect ${relativePath}: frontmatter is missing its closing ---`)
  }

  const block = source.slice(firstLineEnd + 1, closingStart)
  const doc = parseDocument(block)
  if (doc.errors.length > 0 || (doc.contents !== null && !isMap(doc.contents))) {
    throw new Error(`Cannot safely inspect ${relativePath}: frontmatter is not a YAML mapping`)
  }
  return doc.contents !== null && doc.hasIn([key])
}

async function assertScopePathIsSafe(root: string, components: string[]): Promise<string | null> {
  let current = root
  for (const component of components) {
    if (component === '.' || component === '..' || ignoredComponent(component)) return null
    current = join(current, component)
    let stat
    try {
      stat = await fs.lstat(current)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
    if (stat.isSymbolicLink()) {
      throw new Error(
        `Cannot safely inspect computed owner scope through symbolic link: ${component}`
      )
    }
    if (!stat.isDirectory()) return null
  }
  return current
}

/**
 * Assert that `key` is absent from every current Markdown owner below `scope`.
 * Paths are reported relative to the collection and sorted deterministically.
 */
export async function assertComputedOutputKeyAbsentOnDisk(
  root: string,
  scope: string | null,
  key: string
): Promise<void> {
  const absoluteRoot = resolve(root)
  const components = scopeComponents(scope)
  const lexicalScope = resolve(absoluteRoot, ...components)
  if (!insideRoot(absoluteRoot, lexicalScope)) {
    throw new Error(`Computed owner scope escapes the collection: "${scope}"`)
  }
  const start = await assertScopePathIsSafe(absoluteRoot, components)
  if (start === null) return

  const collisions: string[] = []
  const pending = [start]
  while (pending.length > 0) {
    const directory = pending.pop()!
    let entries
    try {
      entries = await fs.readdir(directory, { withFileTypes: true })
    } catch (error) {
      throw new Error(
        `Cannot safely inspect computed output owners in ${directory}: ${
          error instanceof Error ? error.message : String(error)
        }`
      )
    }
    entries.sort((left, right) => left.name.localeCompare(right.name))

    for (const entry of entries) {
      if (ignoredComponent(entry.name) || entry.isSymbolicLink()) continue
      const absolutePath = join(directory, entry.name)
      if (entry.isDirectory()) {
        pending.push(absolutePath)
        continue
      }
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue
      const relativePath = absolutePath
        .slice(absoluteRoot.length + 1)
        .split(sep)
        .join('/')
      let content: string
      try {
        content = await fs.readFile(absolutePath, 'utf-8')
      } catch (error) {
        throw new Error(
          `Cannot safely inspect ${relativePath}: ${
            error instanceof Error ? error.message : String(error)
          }`
        )
      }
      if (frontmatterHasOwnKey(content, key, relativePath)) collisions.push(relativePath)
    }
  }

  if (collisions.length > 0) {
    collisions.sort()
    throw new Error(
      `Cannot claim computed field "${key}": existing unowned frontmatter found in ${collisions.join(', ')}`
    )
  }
}
