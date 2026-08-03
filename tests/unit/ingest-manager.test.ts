import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockFindCli = vi.fn()
const mockSpawn = vi.fn()

vi.mock('../../src/main/cli', () => ({
  findCli: (...args: unknown[]) => mockFindCli(...args)
}))

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  const spawn = (...args: unknown[]) => mockSpawn(...args)
  return { ...actual, default: { ...actual, spawn }, spawn }
})

import { IngestProcessManager } from '../../src/main/ingest-manager'

function createChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough
    stderr: PassThrough
    kill: ReturnType<typeof vi.fn>
  }
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.kill = vi.fn().mockReturnValue(true)
  return child
}

const RESULT = {
  files_indexed: 2,
  files_skipped: 1,
  files_removed: 0,
  chunks_created: 3,
  api_calls: 2,
  estimated_input_tokens: 42,
  files_failed: 0,
  errors: [],
  duration_secs: 0.2,
  cancelled: false,
  module_reports: []
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFindCli.mockResolvedValue('/usr/local/bin/mdvdb')
})

describe('IngestProcessManager', () => {
  it('parses partial NDJSON chunks and broadcasts progress before the final result', async () => {
    const child = createChild()
    mockSpawn.mockReturnValue(child)
    const events: Array<{ type: string; [key: string]: unknown }> = []
    const manager = new IngestProcessManager((event) => events.push(event))

    const run = manager.run('/vault', true)
    await Promise.resolve()

    child.stdout.write(
      '{"type":"progress","data":{"phase":"embedding","elapsed_ms":12,"completed_batches":1,'
    )
    child.stdout.write(
      '"total_batches":2,"completed_chunks":2,"total_chunks":3,"estimated_input_tokens":30,"total_estimated_input_tokens":42,"api_calls":1}}\n'
    )
    child.stdout.write(`{"type":"result","data":${JSON.stringify(RESULT)}}\n`)
    child.emit('close', 0)

    await expect(run).resolves.toEqual(RESULT)
    expect(mockSpawn).toHaveBeenCalledWith(
      '/usr/local/bin/mdvdb',
      ['ingest', '--json', '--json-lines', '--root', '/vault', '--reindex'],
      expect.objectContaining({ stdio: ['ignore', 'pipe', 'pipe'] })
    )
    expect(events.map((event) => event.type)).toEqual(['started', 'progress', 'completed'])
    expect(events[1]).toMatchObject({
      root: '/vault',
      reindex: true,
      progress: { phase: 'embedding', completed_chunks: 2, api_calls: 1 }
    })
  })

  it('deduplicates simultaneous runs for the same collection', async () => {
    const child = createChild()
    mockSpawn.mockReturnValue(child)
    const manager = new IngestProcessManager(() => undefined)

    const first = manager.run('/vault', false)
    const second = manager.run('/vault/.', true)
    await Promise.resolve()
    child.stdout.write(`{"type":"result","data":${JSON.stringify(RESULT)}}\n`)
    child.emit('close', 0)

    await expect(Promise.all([first, second])).resolves.toEqual([RESULT, RESULT])
    expect(mockSpawn).toHaveBeenCalledTimes(1)
  })

  it('requests graceful cancellation with SIGINT', async () => {
    const child = createChild()
    mockSpawn.mockReturnValue(child)
    const manager = new IngestProcessManager(() => undefined)

    const run = manager.run('/vault', false)
    await Promise.resolve()
    await expect(manager.cancel('/vault')).resolves.toBe(true)
    expect(child.kill).toHaveBeenCalledWith('SIGINT')

    child.stdout.write(
      `{"type":"result","data":${JSON.stringify({ ...RESULT, cancelled: true })}}\n`
    )
    child.emit('close', 130)
    await expect(run).resolves.toMatchObject({ cancelled: true })
  })

  it('sanitizes fatal stderr before publishing or rejecting it', async () => {
    const child = createChild()
    mockSpawn.mockReturnValue(child)
    const events: Array<{ type: string; [key: string]: unknown }> = []
    const manager = new IngestProcessManager((event) => events.push(event))

    const run = manager.run('/vault', false)
    await Promise.resolve()
    child.stderr.write('Authorization: Bearer private-token')
    child.emit('close', 1)

    await expect(run).rejects.toThrow('Authorization: Bearer <redacted>')
    expect(events.at(-1)).toMatchObject({
      type: 'failed',
      message: 'Authorization: Bearer <redacted>'
    })
  })
})
