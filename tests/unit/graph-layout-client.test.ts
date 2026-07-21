import { describe, expect, it, vi } from 'vitest'
import { GraphLayoutWorkerClient } from '@renderer/lib/graph-layout-client'
import type { GraphLayoutCommand, GraphLayoutEvent } from '@renderer/lib/graph-layout-protocol'

interface SentMessage {
  command: GraphLayoutCommand
  transfer: readonly Transferable[]
}

class FakeWorker {
  readonly sent: SentMessage[] = []
  readonly terminate = vi.fn()
  private listeners = new Map<string, (event: Event) => void>()

  postMessage(command: GraphLayoutCommand, transfer: readonly Transferable[] = []): void {
    this.sent.push({ command, transfer })
  }

  addEventListener(type: string, listener: (event: Event) => void): void {
    this.listeners.set(type, listener)
  }

  removeEventListener(type: string, listener: (event: Event) => void): void {
    if (this.listeners.get(type) === listener) this.listeners.delete(type)
  }

  emit(event: GraphLayoutEvent): void {
    this.listeners.get('message')?.(new MessageEvent('message', { data: event }))
  }

  fail(message: string): void {
    this.listeners.get('error')?.(new ErrorEvent('error', { message }))
  }
}

describe('GraphLayoutWorkerClient', () => {
  it('assigns request IDs, transfers position buffers, and forwards events', () => {
    const worker = new FakeWorker()
    const client = new GraphLayoutWorkerClient(worker as unknown as Worker)
    const listener = vi.fn<(event: GraphLayoutEvent) => void>()
    client.subscribe(listener)

    const positions = new Float32Array([1, 2, 3])
    expect(
      client.initialize({
        revision: 'r1',
        nodes: [{ id: 'a' }],
        links: [],
        initialPositions: positions,
        autoStart: false
      })
    ).toBe(1)
    expect(client.pause()).toBe(2)
    expect(worker.sent[0].command).toMatchObject({
      type: 'initialize',
      requestId: 1,
      revision: 'r1'
    })
    expect(worker.sent[0].transfer).toEqual([positions.buffer])
    expect(worker.sent[1].command).toEqual({ type: 'pause', requestId: 2 })

    const event: GraphLayoutEvent = {
      type: 'state',
      requestId: 2,
      state: 'paused',
      alpha: 0.5
    }
    worker.emit(event)
    expect(listener).toHaveBeenCalledWith(event)

    const snapshot: GraphLayoutEvent = {
      type: 'snapshot',
      revision: 'r1',
      sequence: 4,
      positions: new Float32Array([3, 2, 1]),
      alpha: 0.25,
      settled: false
    }
    worker.emit(snapshot)
    expect(listener).toHaveBeenCalledWith(snapshot)
    expect(worker.sent.at(-1)?.command).toEqual({
      type: 'snapshot-ack',
      requestId: 3,
      revision: 'r1',
      sequence: 4
    })
    worker.fail('worker crashed')
    expect(listener).toHaveBeenLastCalledWith({
      type: 'error',
      requestId: null,
      message: 'worker crashed'
    })

    client.dispose()
    expect(worker.terminate).toHaveBeenCalledOnce()
    expect(() => client.start()).toThrow('disposed')
  })

  it('supports unsubscribing from worker events', () => {
    const worker = new FakeWorker()
    const client = new GraphLayoutWorkerClient(worker as unknown as Worker)
    const listener = vi.fn<(event: GraphLayoutEvent) => void>()
    const unsubscribe = client.subscribe(listener)
    unsubscribe()

    worker.emit({ type: 'error', requestId: null, message: 'ignored' })
    expect(listener).not.toHaveBeenCalled()
    client.dispose()
  })

  it('acknowledges a snapshot even when a renderer listener throws', () => {
    const worker = new FakeWorker()
    const client = new GraphLayoutWorkerClient(worker as unknown as Worker)
    client.subscribe(() => {
      throw new Error('renderer failed')
    })

    expect(() =>
      worker.emit({
        type: 'snapshot',
        revision: 'r1',
        sequence: 9,
        positions: new Float32Array([1, 2, 3]),
        alpha: 0.2,
        settled: false
      })
    ).toThrow('renderer failed')
    expect(worker.sent.at(-1)?.command).toMatchObject({
      type: 'snapshot-ack',
      revision: 'r1',
      sequence: 9
    })
    client.dispose()
  })
})
