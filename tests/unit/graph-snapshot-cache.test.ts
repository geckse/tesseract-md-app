import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  GRAPH_WIRE_FORMAT,
  GRAPH_WIRE_VERSION,
  GraphSnapshotCache,
  estimateCompactGraphBytes,
  readGraphIndexRevision,
  validateCompactGraphData
} from '../../src/main/graph-snapshot-cache'
import { CliParseError } from '../../src/main/errors'
import type { CompactGraphData } from '../../src/renderer/types/cli'

const temporaryRoots: string[] = []

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function compactGraph(context = 'complete context'): CompactGraphData {
  return {
    format: GRAPH_WIRE_FORMAT,
    version: GRAPH_WIRE_VERSION,
    nodes: [],
    edges: [
      {
        source: 'a.md',
        target: 'b.md',
        weight: null,
        context_index: 0,
        field: null
      }
    ],
    contexts: [context],
    clusters: [],
    level: 'document'
  }
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true })))
})

describe('compact graph contract validation', () => {
  it('preserves the response-level full context table without expanding edges', () => {
    const context = 'full paragraph '.repeat(1_000)
    const input = compactGraph(context)

    const result = validateCompactGraphData(input)

    expect(result).toBe(input)
    expect(result.contexts[0]).toBe(context)
    expect(result.edges[0].context_index).toBe(0)
    expect(result.edges[0]).not.toHaveProperty('context_text')
  })

  it.each([
    [{ ...compactGraph(), format: 'legacy.graph' }, 'format'],
    [{ ...compactGraph(), version: 2 }, 'version'],
    [{ ...compactGraph(), contexts: [42] }, 'contexts']
  ])('rejects an unsupported or malformed contract (%s)', (input, expectedMessage) => {
    expect(() => validateCompactGraphData(input)).toThrowError(CliParseError)
    expect(() => validateCompactGraphData(input)).toThrow(expectedMessage)
  })

  it('rejects invalid context indices and repeated per-edge context strings', () => {
    const outsideTable = compactGraph()
    outsideTable.edges[0].context_index = 1
    expect(() => validateCompactGraphData(outsideTable)).toThrow('outside the contexts table')

    const expanded = compactGraph()
    expanded.edges[0].context_text = expanded.contexts[0]
    expect(() => validateCompactGraphData(expanded)).toThrow(
      'must reference contexts instead of expanding them'
    )
  })
})

describe('GraphSnapshotCache', () => {
  it('invokes the compact CLI contract with normalized level and path arguments', async () => {
    const response = compactGraph()
    response.level = 'chunk'
    const execute = vi.fn().mockResolvedValue(response)
    const cache = new GraphSnapshotCache({
      execute,
      readRevision: vi.fn().mockResolvedValue('revision-1')
    })

    const result = await cache.get('/vault', 'chunk', 'docs/')

    expect(result).toBe(response)
    expect(execute).toHaveBeenCalledWith(
      ['--compact', '--level', 'chunk', '--path', 'docs/'],
      '/vault',
      expect.any(AbortSignal)
    )
  })

  it('deduplicates concurrent requests and reuses a settled snapshot', async () => {
    const response = compactGraph()
    let resolveExecution: ((value: CompactGraphData) => void) | undefined
    const execute = vi.fn(
      () =>
        new Promise<CompactGraphData>((resolve) => {
          resolveExecution = resolve
        })
    )
    const cache = new GraphSnapshotCache({
      execute,
      readRevision: vi.fn().mockResolvedValue('revision-1')
    })

    const first = cache.get('/vault')
    const second = cache.get('/vault')
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1))
    expect(cache.stats()).toMatchObject({ snapshots: 0, inFlight: 1, active: 1, queued: 0 })

    resolveExecution?.(response)
    const [firstResult, secondResult] = await Promise.all([first, second])
    const cachedResult = await cache.get('/vault')

    expect(firstResult).toBe(response)
    expect(secondResult).toBe(response)
    expect(cachedResult).toBe(response)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(cache.stats()).toMatchObject({ snapshots: 1, inFlight: 0, active: 0, queued: 0 })
  })

  it('never lets an older revision lookup supersede a newer request', async () => {
    const olderRevision = deferred<string>()
    const newerRevision = deferred<string>()
    let revisionRead = 0
    const readRevision = vi.fn(() => {
      revisionRead++
      if (revisionRead === 1) return olderRevision.promise
      if (revisionRead === 2) return newerRevision.promise
      return Promise.resolve('revision-2')
    })
    const response = compactGraph('new revision')
    const execution = deferred<CompactGraphData>()
    const signals: AbortSignal[] = []
    const execute = vi.fn((_args: string[], _root: string, signal?: AbortSignal) => {
      if (signal) signals.push(signal)
      return execution.promise
    })
    const cache = new GraphSnapshotCache({ execute, readRevision })

    const first = cache.get('/vault')
    const second = cache.get('/vault')
    await vi.waitFor(() => expect(readRevision).toHaveBeenCalledTimes(2))

    newerRevision.resolve('revision-2')
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1))
    olderRevision.resolve('revision-1')
    await Promise.resolve()

    expect(execute).toHaveBeenCalledTimes(1)
    expect(signals).toHaveLength(1)
    expect(signals[0].aborted).toBe(false)
    execution.resolve(response)

    await expect(Promise.all([first, second])).resolves.toEqual([response, response])
    expect(execute).toHaveBeenCalledTimes(1)
    expect(signals[0].aborted).toBe(false)
    expect(cache.stats()).toMatchObject({ snapshots: 1, inFlight: 0, active: 0 })
  })

  it('invalidates automatically when the index stat revision changes', async () => {
    let revision = 'revision-1'
    const firstResponse = compactGraph('first')
    const secondResponse = compactGraph('second')
    const execute = vi
      .fn()
      .mockResolvedValueOnce(firstResponse)
      .mockResolvedValueOnce(secondResponse)
    const cache = new GraphSnapshotCache({
      execute,
      readRevision: async () => revision
    })

    expect(await cache.get('/vault')).toBe(firstResponse)
    revision = 'revision-2'
    expect(await cache.get('/vault')).toBe(secondResponse)

    expect(execute).toHaveBeenCalledTimes(2)
    expect(cache.stats()).toMatchObject({ snapshots: 1, inFlight: 0 })
  })

  it('cancels an obsolete graph process when the index revision changes mid-flight', async () => {
    let revision = 'revision-1'
    let secondResolve: ((value: CompactGraphData) => void) | undefined
    const signals: AbortSignal[] = []
    const execute = vi.fn(
      (_args: string[], _root: string, signal?: AbortSignal) =>
        new Promise<CompactGraphData>((resolve, reject) => {
          if (signal) {
            signals.push(signal)
            signal.addEventListener('abort', () => reject(signal.reason), { once: true })
          }
          if (signals.length === 2) secondResolve = resolve
        })
    )
    const cache = new GraphSnapshotCache({
      maxInFlight: 1,
      execute,
      readRevision: async () => revision
    })

    const first = cache.get('/vault')
    const firstRejected = expect(first).rejects.toThrow('revision changed')
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1))
    revision = 'revision-2'
    const second = cache.get('/vault')
    await firstRejected
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2))
    expect(signals[0].aborted).toBe(true)
    secondResolve?.(compactGraph('current'))
    await expect(second).resolves.toMatchObject({ contexts: ['current'] })
  })

  it('rejects a response whose level does not match the requested cache key', async () => {
    const cache = new GraphSnapshotCache({
      execute: vi.fn().mockResolvedValue(compactGraph()),
      readRevision: vi.fn().mockResolvedValue('revision-1')
    })

    await expect(cache.get('/vault', 'chunk')).rejects.toThrow('requested chunk, received document')
    expect(cache.stats()).toMatchObject({ snapshots: 0, inFlight: 0 })
  })

  it('retries instead of returning a snapshot from a changed index revision', async () => {
    const staleResponse = compactGraph('stale')
    const currentResponse = compactGraph('current')
    const readRevision = vi
      .fn()
      .mockResolvedValueOnce('revision-1')
      .mockResolvedValueOnce('revision-2')
      .mockResolvedValue('revision-2')
    const execute = vi
      .fn()
      .mockResolvedValueOnce(staleResponse)
      .mockResolvedValueOnce(currentResponse)
    const cache = new GraphSnapshotCache({ execute, readRevision })

    expect(await cache.get('/vault')).toBe(currentResponse)
    expect(execute).toHaveBeenCalledTimes(2)
    expect(cache.stats().snapshots).toBe(1)

    expect(await cache.get('/vault')).toBe(currentResponse)
    expect(execute).toHaveBeenCalledTimes(2)
    expect(cache.stats().snapshots).toBe(1)
  })

  it('fails clearly when the index never stabilizes within the retry bound', async () => {
    let revision = 0
    const execute = vi.fn().mockResolvedValue(compactGraph())
    const cache = new GraphSnapshotCache({
      execute,
      readRevision: async () => `revision-${++revision}`
    })

    await expect(cache.get('/vault')).rejects.toThrow(
      'Graph index kept changing while the snapshot was generated'
    )
    expect(execute).toHaveBeenCalledTimes(3)
    expect(cache.stats()).toMatchObject({ snapshots: 0, inFlight: 0, active: 0 })
  })

  it('keys snapshots independently by root, level, and path', async () => {
    const execute = vi.fn((args: string[]) => {
      const response = compactGraph()
      response.level = args.includes('chunk') ? 'chunk' : 'document'
      return Promise.resolve(response)
    })
    const cache = new GraphSnapshotCache({
      execute,
      readRevision: vi.fn().mockResolvedValue('revision-1')
    })

    await cache.get('/one', 'document')
    await cache.get('/two', 'document')
    await cache.get('/one', 'chunk')
    await cache.get('/one', 'document', 'docs/')
    await cache.get('/one', 'document')

    expect(execute).toHaveBeenCalledTimes(4)
  })

  it('bounds settled snapshots with LRU eviction', async () => {
    const execute = vi.fn((_args: string[], root: string) => Promise.resolve(compactGraph(root)))
    const cache = new GraphSnapshotCache({
      maxSnapshots: 2,
      execute,
      readRevision: vi.fn().mockResolvedValue('revision-1')
    })

    await cache.get('/one')
    await cache.get('/two')
    await cache.get('/one') // touch /one, making /two the LRU entry
    await cache.get('/three')
    await cache.get('/two') // /two was evicted and must execute again

    expect(cache.stats().snapshots).toBe(2)
    expect(execute).toHaveBeenCalledTimes(4)
  })

  it('also bounds snapshots by estimated retained bytes', async () => {
    const response = compactGraph('x'.repeat(2_000))
    const entryBytes = estimateCompactGraphBytes(response)
    const execute = vi.fn().mockResolvedValue(response)
    const cache = new GraphSnapshotCache({
      maxSnapshots: 10,
      maxSnapshotBytes: entryBytes + 32,
      execute,
      readRevision: vi.fn().mockResolvedValue('revision-1')
    })

    await cache.get('/one')
    await cache.get('/two')
    expect(cache.stats().snapshots).toBe(1)
    expect(cache.stats().snapshotBytes).toBeLessThanOrEqual(entryBytes + 32)
    await cache.get('/one')
    expect(execute).toHaveBeenCalledTimes(3)
  })

  it('queues excess graph processes instead of starting unbounded CLI work', async () => {
    const resolvers = new Map<string, (value: CompactGraphData) => void>()
    const execute = vi.fn(
      (_args: string[], root: string) =>
        new Promise<CompactGraphData>((resolve) => {
          resolvers.set(root, resolve)
        })
    )
    const cache = new GraphSnapshotCache({
      execute,
      readRevision: vi.fn().mockResolvedValue('revision-1')
    })

    const requests = [cache.get('/one'), cache.get('/two'), cache.get('/three')]
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2))
    expect(cache.stats()).toMatchObject({ inFlight: 3, active: 2, queued: 1 })

    resolvers.get('/one')?.(compactGraph('/one'))
    resolvers.get('/two')?.(compactGraph('/two'))
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(3))
    resolvers.get('/three')?.(compactGraph('/three'))
    await Promise.all(requests)
    expect(cache.stats()).toMatchObject({ inFlight: 0, active: 0, queued: 0 })
  })

  it('bounds queued graph processes while preserving in-flight deduplication', async () => {
    const resolvers = new Map<string, (value: CompactGraphData) => void>()
    const execute = vi.fn(
      (_args: string[], root: string) =>
        new Promise<CompactGraphData>((resolve) => {
          resolvers.set(root, resolve)
        })
    )
    const cache = new GraphSnapshotCache({
      maxInFlight: 1,
      maxQueued: 1,
      execute,
      readRevision: vi.fn().mockResolvedValue('revision-1')
    })

    const active = cache.get('/one')
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1))
    const queued = cache.get('/two')
    const queuedDuplicate = cache.get('/two')
    const overflow = cache.get('/three')

    await expect(overflow).rejects.toThrow('Graph snapshot request queue is full')
    expect(cache.stats()).toMatchObject({ inFlight: 2, active: 1, queued: 1 })
    expect(execute).toHaveBeenCalledTimes(1)

    resolvers.get('/one')?.(compactGraph('/one'))
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2))
    resolvers.get('/two')?.(compactGraph('/two'))

    await expect(Promise.all([active, queued, queuedDuplicate])).resolves.toHaveLength(3)
    expect(execute).toHaveBeenCalledTimes(2)
    expect(cache.stats()).toMatchObject({ inFlight: 0, active: 0, queued: 0 })
  })

  it('uses clear as a generation barrier even when an active executor ignores abort', async () => {
    const execution = deferred<CompactGraphData>()
    const execute = vi.fn(() => execution.promise)
    const cache = new GraphSnapshotCache({
      execute,
      readRevision: vi.fn().mockResolvedValue('revision-1')
    })

    const request = cache.get('/vault')
    const rejected = expect(request).rejects.toThrow('Graph snapshot cache cleared')
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1))

    cache.clear()
    execution.resolve(compactGraph('must not be cached'))

    await rejected
    await vi.waitFor(() => expect(cache.stats().active).toBe(0))
    expect(cache.stats()).toMatchObject({ snapshots: 0, inFlight: 0, queued: 0 })
  })

  it('clears failed in-flight requests so a retry can succeed', async () => {
    const execute = vi
      .fn()
      .mockRejectedValueOnce(new Error('CLI failed'))
      .mockResolvedValueOnce(compactGraph('retry'))
    const cache = new GraphSnapshotCache({
      execute,
      readRevision: vi.fn().mockResolvedValue('revision-1')
    })

    await expect(cache.get('/failure')).rejects.toThrow('CLI failed')
    expect(cache.stats().inFlight).toBe(0)
    await cache.get('/failure')
    expect(execute).toHaveBeenCalledTimes(2)
  })
})

describe('readGraphIndexRevision', () => {
  it('changes when the .markdownvdb/index stat changes and handles a missing index', async () => {
    const root = await mkdtemp(join(tmpdir(), 'mdvdb-graph-revision-'))
    temporaryRoots.push(root)

    expect(await readGraphIndexRevision(root)).toBe('missing')

    const indexDir = join(root, '.markdownvdb')
    const indexPath = join(indexDir, 'index')
    await mkdir(indexDir)
    await writeFile(indexPath, 'first')
    const first = await readGraphIndexRevision(root)
    await appendFile(indexPath, '-second')
    const second = await readGraphIndexRevision(root)

    expect(first).not.toBe('missing')
    expect(second).not.toBe(first)
  })
})
