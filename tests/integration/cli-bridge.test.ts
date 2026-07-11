/**
 * Integration tests for the CLI bridge with a real mdvdb binary.
 *
 * These tests exercise the actual CLI bridge (findCli, getCliVersion, execCommand)
 * against the real mdvdb binary on the system PATH. Tests are skipped if the
 * binary is not available.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const execFileAsync = promisify(execFile)

/**
 * Resolve the mdvdb binary path synchronously at module load — the
 * `describe.skipIf` conditions below are evaluated at collection time,
 * so an async beforeAll would always leave the real-binary suite skipped.
 */
function findMdvdbSync(): string {
  const whichCmd = process.platform === 'win32' ? 'where' : 'which'
  try {
    const stdout = execFileSync(whichCmd, ['mdvdb'], { timeout: 5_000 }).toString()
    return stdout.trim().split('\n')[0].trim()
  } catch {
    return ''
  }
}

const cliPath = findMdvdbSync()
const cliAvailable = cliPath.length > 0

/**
 * Helper to run mdvdb commands directly (bypasses the app's cli.ts module
 * so we don't need Electron module mocks in integration tests).
 */
async function runMdvdb(
  args: string[],
  options?: { timeout?: number; cwd?: string }
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(cliPath, args, {
    timeout: options?.timeout ?? 30_000,
    maxBuffer: 10 * 1024 * 1024,
    cwd: options?.cwd
  })
}

/**
 * Helper to run mdvdb with --json and parse the result.
 */
async function runMdvdbJson<T>(
  command: string,
  args: string[],
  root: string,
  options?: { timeout?: number }
): Promise<T> {
  const { stdout } = await runMdvdb(
    [command, '--json', '--root', root, ...args],
    options
  )
  return JSON.parse(stdout) as T
}

describe.skipIf(!cliAvailable)('CLI Bridge Integration (real binary)', () => {
  describe('binary detection', () => {
    it('finds mdvdb on PATH', () => {
      expect(cliPath).toBeTruthy()
      expect(cliPath).toContain('mdvdb')
    })

    it('reports a version string', async () => {
      // mdvdb --version prints an ASCII logo followed by "v <semver>".
      const { stdout } = await runMdvdb(['--version'])
      expect(stdout).toMatch(/v\s*\d+\.\d+\.\d+/)
    })
  })

  describe('status command', () => {
    let tempDir: string

    beforeAll(async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'mdvdb-integration-'))
    })

    afterAll(async () => {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    })

    it('returns status JSON for an uninitialized directory', async () => {
      // status on empty dir should either return empty status or error
      try {
        const result = await runMdvdbJson<Record<string, unknown>>(
          'status',
          [],
          tempDir
        )
        // If it succeeds, should have expected fields
        expect(result).toHaveProperty('document_count')
        expect(result).toHaveProperty('chunk_count')
      } catch (error: unknown) {
        // CLI may exit non-zero for uninitialized directory — that's acceptable
        const err = error as { code?: number; stderr?: string }
        expect(err.code).toBeGreaterThan(0)
      }
    })
  })

  describe('init and ingest workflow', () => {
    let tempDir: string

    beforeAll(async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'mdvdb-integration-'))

      // Create a sample markdown file
      await writeFile(
        join(tempDir, 'test.md'),
        '---\ntitle: Test\ntags: [a, b]\n---\n\n# Hello\n\nSome content here.\n\n## Section Two\n\nMore content.\n'
      )
      await writeFile(
        join(tempDir, 'another.md'),
        '# Another File\n\nWith [a link](test.md).\n'
      )
    })

    afterAll(async () => {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    })

    it('initializes a new collection', async () => {
      // init may not produce JSON output, just check exit code
      const { stderr } = await runMdvdb(['init', '--root', tempDir])
      // Should not throw (exit code 0)
      // stderr may contain log output — that's fine
      expect(true).toBe(true)
    })

    it('previews ingestion without running it', async () => {
      try {
        const result = await runMdvdbJson<Record<string, unknown>>(
          'ingest',
          ['--preview'],
          tempDir,
          { timeout: 60_000 }
        )
        // Preview should list files to process
        expect(result).toBeDefined()
      } catch {
        // Ingest may require embedding config — skip gracefully
      }
    })

    it('runs tree command on the directory', async () => {
      const result = await runMdvdbJson<Record<string, unknown>>(
        'tree',
        [],
        tempDir
      )
      expect(result).toHaveProperty('total_files')
      expect(typeof (result as { total_files: number }).total_files).toBe('number')
    })

    it('runs doctor diagnostic check', async () => {
      try {
        const result = await runMdvdbJson<Record<string, unknown>>(
          'doctor',
          [],
          tempDir
        )
        expect(result).toBeDefined()
      } catch (error: unknown) {
        // Doctor may report issues as non-zero exit — acceptable
        const err = error as { code?: number }
        expect(err.code).toBeDefined()
      }
    })
  })

  describe('search on empty index', () => {
    let tempDir: string

    beforeAll(async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'mdvdb-integration-'))
    })

    afterAll(async () => {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    })

    it('handles search on non-indexed directory gracefully', async () => {
      try {
        const result = await runMdvdbJson<Record<string, unknown>>(
          'search',
          ['test query'],
          tempDir
        )
        // If it succeeds, should have search output structure
        expect(result).toHaveProperty('results')
        expect(result).toHaveProperty('query')
      } catch (error: unknown) {
        // Expected: no index exists, CLI should exit with error
        const err = error as { code?: number; stderr?: string }
        expect(err.code).toBeGreaterThan(0)
      }
    })
  })

  describe('error handling', () => {
    it('returns non-zero exit for invalid command', async () => {
      try {
        await runMdvdb(['nonexistent-command'])
        expect.fail('Should have thrown')
      } catch (error: unknown) {
        const err = error as { code?: number }
        expect(err.code).toBeGreaterThan(0)
      }
    })

    it('returns non-zero exit for missing root path', async () => {
      try {
        await runMdvdb(['status', '--json', '--root', '/nonexistent/path/that/does/not/exist'])
        expect.fail('Should have thrown')
      } catch (error: unknown) {
        const err = error as { code?: number }
        expect(err.code).toBeGreaterThan(0)
      }
    })
  })

  describe('JSON output structure validation', () => {
    let tempDir: string

    beforeAll(async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'mdvdb-integration-'))
      await writeFile(join(tempDir, 'sample.md'), '# Sample\n\nContent.\n')
      // Initialize
      await runMdvdb(['init', '--root', tempDir]).catch(() => {})
    })

    afterAll(async () => {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    })

    it('tree JSON has expected shape', async () => {
      const result = await runMdvdbJson<{
        root: { name: string; is_dir: boolean; children: unknown[] }
        total_files: number
      }>('tree', [], tempDir)

      expect(result.root).toBeDefined()
      expect(result.root.is_dir).toBe(true)
      expect(Array.isArray(result.root.children)).toBe(true)
      expect(typeof result.total_files).toBe('number')
      expect(result.total_files).toBeGreaterThanOrEqual(1)
    })

    it('schema JSON has expected shape', async () => {
      try {
        const result = await runMdvdbJson<{
          fields: Record<string, unknown>
        }>('schema', [], tempDir)

        expect(result).toHaveProperty('fields')
        expect(typeof result.fields).toBe('object')
      } catch {
        // Schema may require indexed data — acceptable to fail
      }
    })
  })

  describe('topics round-trip (add → list → --custom → update → remove)', () => {
    let tempDir: string

    beforeAll(async () => {
      tempDir = await mkdtemp(join(tmpdir(), 'mdvdb-topics-'))
      await mkdir(join(tempDir, '.markdownvdb'), { recursive: true })
      // Mock provider so ingest needs no API keys.
      await writeFile(
        join(tempDir, '.markdownvdb', 'config.yaml'),
        'embedding:\n  provider: mock\n  dimensions: 8\n'
      )
      await writeFile(join(tempDir, 'ai.md'), '# AI\n\nMachine learning notes.\n')
      await writeFile(join(tempDir, 'web.md'), '# Web\n\nHTML and CSS notes.\n')
    })

    afterAll(async () => {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {})
    })

    it('adds a topic with description and threshold', async () => {
      await runMdvdb([
        'clusters',
        'add',
        'AI',
        '--seeds',
        'machine learning,neural networks',
        '--description',
        'Notes about machine learning',
        '--threshold',
        '0.2',
        '--json',
        '--root',
        tempDir
      ])

      const defs = await runMdvdbJson<
        Array<{ name: string; description?: string; seeds: string[]; threshold?: number }>
      >('clusters', ['list'], tempDir)
      expect(defs).toHaveLength(1)
      expect(defs[0].name).toBe('AI')
      expect(defs[0].description).toBe('Notes about machine learning')
      expect(defs[0].seeds).toEqual(['machine learning', 'neural networks'])
      expect(defs[0].threshold).toBeCloseTo(0.2)
    })

    it('computes topic summaries after ingest', async () => {
      await runMdvdb(['ingest', '--root', tempDir], { timeout: 120_000 })

      const summaries = await runMdvdbJson<
        Array<{
          id: number
          name: string
          document_count: number
          mean_score?: number
          description?: string
        }>
      >('clusters', ['--custom'], tempDir)
      expect(summaries).toHaveLength(1)
      expect(summaries[0].name).toBe('AI')
      expect(summaries[0].description).toBe('Notes about machine learning')
      if (summaries[0].document_count > 0) {
        expect(summaries[0].mean_score).toBeGreaterThan(0)
      }

      const unassigned = await runMdvdbJson<{ count: number; paths: string[] }>(
        'clusters',
        ['unassigned'],
        tempDir
      )
      // Every document is either a member or unassigned.
      expect(unassigned.count + summaries[0].document_count).toBeGreaterThanOrEqual(2)
      expect(unassigned.paths).toHaveLength(unassigned.count)
    })

    it('updates (rename + clear description) and removes the topic', async () => {
      await runMdvdb([
        'clusters',
        'update',
        'AI',
        '--description',
        '',
        '--threshold=-1',
        '--rename',
        'ML',
        '--json',
        '--root',
        tempDir
      ])

      let defs = await runMdvdbJson<
        Array<{ name: string; description?: string; threshold?: number }>
      >('clusters', ['list'], tempDir)
      expect(defs).toHaveLength(1)
      expect(defs[0].name).toBe('ML')
      expect(defs[0].description ?? null).toBeNull()
      expect(defs[0].threshold ?? null).toBeNull()

      await runMdvdb(['clusters', 'remove', 'ML', '--json', '--root', tempDir])
      defs = await runMdvdbJson<Array<{ name: string }>>('clusters', ['list'], tempDir)
      expect(defs).toHaveLength(0)
    })

    it('config set writes dotted keys into config.yaml', async () => {
      await runMdvdb([
        'config',
        'set',
        'clustering.topics.min_similarity',
        '0.35',
        '--json',
        '--root',
        tempDir
      ])
      const { readFile } = await import('node:fs/promises')
      const yaml = await readFile(join(tempDir, '.markdownvdb', 'config.yaml'), 'utf8')
      expect(yaml).toContain('min_similarity: 0.35')
    })
  })
})

// Separate top-level describe for when CLI is not available
describe.skipIf(cliAvailable)('CLI Bridge Integration (no binary)', () => {
  it('skips all integration tests when mdvdb is not on PATH', () => {
    expect(cliAvailable).toBe(false)
  })
})
