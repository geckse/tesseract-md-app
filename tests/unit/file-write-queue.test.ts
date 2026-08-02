import { describe, expect, it } from 'vitest'
import { withSerializedFileWrite } from '../../src/main/file-write-queue'

describe('main-process file write queue', () => {
  it('runs same-path mutations in invocation order', async () => {
    const events: string[] = []
    let releaseFirst!: () => void
    let signalFirstStarted!: () => void
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const firstStarted = new Promise<void>((resolve) => {
      signalFirstStarted = resolve
    })

    const first = withSerializedFileWrite('/vault/note.md', async () => {
      events.push('first:start')
      signalFirstStarted()
      await firstGate
      events.push('first:end')
    })
    const second = withSerializedFileWrite('/vault/note.md', async () => {
      events.push('second:start')
      events.push('second:end')
    })

    await firstStarted
    expect(events).toEqual(['first:start'])
    releaseFirst()
    await Promise.all([first, second])
    expect(events).toEqual(['first:start', 'first:end', 'second:start', 'second:end'])
  })

  it('does not make unrelated paths wait for each other', async () => {
    let secondStarted = false
    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    const first = withSerializedFileWrite('/vault/a.md', () => firstGate)
    const second = withSerializedFileWrite('/vault/b.md', async () => {
      secondStarted = true
    })

    await second
    expect(secondStarted).toBe(true)
    releaseFirst()
    await first
  })
})
