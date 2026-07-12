/**
 * Integration tests for the phase-41 batch property converter.
 *
 * Runs `applyPropertyOp`/`previewPropertyOp` against a REAL temp vault on disk
 * (real yaml writes, atomic renames, overlay file), with the electron-touching
 * modules mocked at the boundary:
 *  - store.getCollections → the temp collection
 *  - cli.execCommand → a canned `collection` enumeration of the temp files
 *  - ipc-handlers.withWatcherPaused → passthrough (records pause/resume)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtemp, writeFile, readFile, mkdir, rm, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parse as parseYaml } from 'yaml'

let root: string
let watcherPauses = 0

vi.mock('../../src/main/store', () => ({
  getCollections: () => [{ id: 'c1', path: root, name: 'Temp Vault' }],
  // table-views' legacy-migration path touches electron-store on ENOENT —
  // stub it to an empty store.
  initStore: () => ({ get: () => ({}), set: () => {} })
}))

vi.mock('../../src/main/cli', () => ({
  execCommand: vi.fn(async (command: string, args: string[]) => {
    if (command !== 'collection') throw new Error(`unexpected command: ${command}`)
    void args
    return {
      scope: 'docs/',
      recursive: true,
      columns: [],
      rows: enumeratedRows,
      total_rows: enumeratedRows.length,
      offset: 0
    }
  })
}))

vi.mock('../../src/main/ipc-handlers', () => ({
  withWatcherPaused: async <T,>(_root: string, fn: () => Promise<T>): Promise<T> => {
    watcherPauses++
    return fn()
  }
}))

import { previewPropertyOp, applyPropertyOp } from '../../src/main/property-ops'
import { renamePropertyInViews } from '../../src/main/table-views'
import { OVERLAY_FILENAME } from '../../src/main/schema-overlay'
import type { PropertyOpRequest, PropertyOpProgress } from '../../src/preload/api'
import type { IpcMainInvokeEvent } from 'electron'
import type { WindowManager } from '../../src/main/window-manager'

/** Rows the mocked `mdvdb collection` returns (paths relative to root). */
let enumeratedRows: Array<{ path: string; state: string }> = []

/** Mock IPC event + window manager capturing broadcasts and progress. */
function makeEventAndWindows(): {
  event: IpcMainInvokeEvent
  windowManager: WindowManager
  progress: PropertyOpProgress[]
  broadcasts: Array<{ channel: string; payload: unknown }>
} {
  const progress: PropertyOpProgress[] = []
  const broadcasts: Array<{ channel: string; payload: unknown }> = []
  const event = {
    sender: {
      id: 1,
      isDestroyed: () => false,
      send: (channel: string, payload: PropertyOpProgress) => {
        if (channel === 'schema:property-op-progress') progress.push(payload)
      }
    }
  } as unknown as IpcMainInvokeEvent
  const windowManager = {
    getAllWindows: () => [
      {
        webContents: { id: 2, send: (channel: string, payload: unknown) => broadcasts.push({ channel, payload }) },
        isDestroyed: () => false
      },
      // The sender's own window must NOT receive the broadcast.
      {
        webContents: {
          id: 1,
          send: () => {
            throw new Error('broadcast echoed to the sender window')
          }
        },
        isDestroyed: () => false
      }
    ]
  } as unknown as WindowManager
  return { event, windowManager, progress, broadcasts }
}

function convertReq(over: Partial<PropertyOpRequest> = {}): PropertyOpRequest {
  return {
    collectionId: 'c1',
    scope: 'docs',
    filePath: null,
    key: 'status',
    op: { kind: 'convert', target: 'number' },
    ...over
  }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'property-ops-'))
  await mkdir(join(root, 'docs'), { recursive: true })
  watcherPauses = 0
  enumeratedRows = []
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function seed(path: string, content: string): Promise<void> {
  await writeFile(join(root, path), content, 'utf-8')
}

describe('previewPropertyOp', () => {
  it('plans against real on-disk frontmatter', async () => {
    await seed('docs/a.md', '---\nstatus: "3"\n---\nBody A\n')
    await seed('docs/b.md', '---\nstatus: drafted\n---\nBody B\n')
    await seed('docs/c.md', '---\ntitle: no status\n---\nBody C\n')
    enumeratedRows = [
      { path: 'docs/a.md', state: 'indexed' },
      { path: 'docs/b.md', state: 'indexed' },
      { path: 'docs/c.md', state: 'new' },
      { path: 'docs/gone.md', state: 'deleted' }
    ]
    const plan = await previewPropertyOp(convertReq())
    expect(plan.files).toHaveLength(3) // deleted row excluded
    expect(plan.totals).toEqual({ convert: 1, unchanged: 0, noValue: 1, skip: 1 })
    expect(plan.schemaPin).toEqual({ scopeKey: 'docs', fieldType: 'number' })
  })
})

describe('applyPropertyOp — convert', () => {
  it('converts convertible files, skips the rest, pins the overlay, streams progress', async () => {
    await seed('docs/a.md', '---\ntitle: A\nstatus: "3"\n---\n\n# Body A\nunchanged text\n')
    await seed('docs/b.md', '---\nstatus: drafted\n---\nBody B\n')
    await seed('docs/c.md', '---\ntitle: C\n---\nBody C\n')
    await seed('docs/broken.md', '---\nstatus: [unclosed\nBody\n')
    enumeratedRows = [
      { path: 'docs/a.md', state: 'indexed' },
      { path: 'docs/b.md', state: 'indexed' },
      { path: 'docs/c.md', state: 'indexed' },
      { path: 'docs/broken.md', state: 'modified' }
    ]
    const { event, windowManager, progress, broadcasts } = makeEventAndWindows()

    const result = await applyPropertyOp(event, windowManager, 'op-1', convertReq())

    // Per-file outcomes: 1 written, 2 skipped (unconvertible / no value),
    // 1 failed (malformed YAML — never modified).
    expect(result.totals).toEqual({ ok: 1, skipped: 2, failed: 1 })
    const byPath = Object.fromEntries(result.entries.map((e) => [e.path, e]))
    expect(byPath['docs/a.md'].status).toBe('ok')
    expect(byPath['docs/b.md']).toEqual({
      path: 'docs/b.md',
      status: 'skipped',
      reason: 'not a number'
    })
    expect(byPath['docs/c.md'].reason).toBe('no value')
    expect(byPath['docs/broken.md'].status).toBe('failed')
    expect(byPath['docs/broken.md'].reason).toMatch(/invalid YAML frontmatter/)

    // Converted on disk: unquoted number, body byte-identical.
    const a = await readFile(join(root, 'docs/a.md'), 'utf-8')
    expect(a).toMatch(/status: 3(\n|$)/)
    expect(a).not.toContain('status: "3"')
    expect(a.endsWith('\n\n# Body A\nunchanged text\n')).toBe(true)

    // Untouched files stay byte-identical.
    expect(await readFile(join(root, 'docs/b.md'), 'utf-8')).toBe('---\nstatus: drafted\n---\nBody B\n')
    expect(await readFile(join(root, 'docs/broken.md'), 'utf-8')).toBe(
      '---\nstatus: [unclosed\nBody\n'
    )

    // Overlay pinned under the scope key (no trailing slash).
    const overlay = parseYaml(await readFile(join(root, OVERLAY_FILENAME), 'utf-8'))
    expect(overlay.scopes.docs.fields.status.field_type).toBe('number')
    expect(result.overlayWritten).toBe(true)

    // Watcher paused once for the whole batch; progress streamed per file.
    expect(watcherPauses).toBe(1)
    expect(progress).toHaveLength(4)
    expect(progress[3]).toEqual({ opId: 'op-1', done: 4, total: 4, path: 'docs/broken.md' })

    // Other windows got exactly one broadcast (only the written file).
    expect(broadcasts.filter((b) => b.channel === 'file:saved-externally')).toHaveLength(1)
  })

  it('converts text→tags with comma splitting and writes a YAML sequence', async () => {
    await seed('docs/a.md', '---\ncategory: "rust, search"\n---\nBody\n')
    enumeratedRows = [{ path: 'docs/a.md', state: 'indexed' }]
    const { event, windowManager } = makeEventAndWindows()
    await applyPropertyOp(
      event,
      windowManager,
      'op-2',
      convertReq({ key: 'category', op: { kind: 'convert', target: 'tags' } })
    )
    const a = await readFile(join(root, 'docs/a.md'), 'utf-8')
    expect(a).toContain('- rust')
    expect(a).toContain('- search')
    const fm = parseYaml(a.split('---')[1])
    expect(fm.category).toEqual(['rust', 'search'])
  })

  it('single-file requests (scope null) touch exactly one file and write no overlay', async () => {
    await seed('root.md', '---\nstatus: "5"\n---\nBody\n')
    const { event, windowManager } = makeEventAndWindows()
    const result = await applyPropertyOp(
      event,
      windowManager,
      'op-3',
      convertReq({ scope: null, filePath: 'root.md' })
    )
    expect(result.totals).toEqual({ ok: 1, skipped: 0, failed: 0 })
    expect(result.overlayWritten).toBe(false)
    await expect(readFile(join(root, OVERLAY_FILENAME), 'utf-8')).rejects.toThrow()
  })

  it('select targets pin allowed_values in the overlay', async () => {
    await seed('docs/a.md', '---\nstatus: drafted\n---\nBody\n')
    enumeratedRows = [{ path: 'docs/a.md', state: 'indexed' }]
    const { event, windowManager } = makeEventAndWindows()
    await applyPropertyOp(
      event,
      windowManager,
      'op-4',
      convertReq({ op: { kind: 'convert', target: 'select', allowedValues: ['drafted', 'published'] } })
    )
    const overlay = parseYaml(await readFile(join(root, OVERLAY_FILENAME), 'utf-8'))
    expect(overlay.scopes.docs.fields.status).toEqual({
      field_type: 'string',
      allowed_values: ['drafted', 'published']
    })
  })

  it('reports unreadable files as failed and continues the batch', async () => {
    await seed('docs/a.md', '---\nstatus: "1"\n---\nA\n')
    await seed('docs/locked.md', '---\nstatus: "2"\n---\nB\n')
    await chmod(join(root, 'docs/locked.md'), 0o000)
    enumeratedRows = [
      { path: 'docs/locked.md', state: 'indexed' },
      { path: 'docs/a.md', state: 'indexed' }
    ]
    const { event, windowManager } = makeEventAndWindows()
    const result = await applyPropertyOp(event, windowManager, 'op-5', convertReq())
    await chmod(join(root, 'docs/locked.md'), 0o644)
    const byPath = Object.fromEntries(result.entries.map((e) => [e.path, e]))
    expect(byPath['docs/locked.md'].status).toBe('failed')
    expect(byPath['docs/a.md'].status).toBe('ok')
    expect(result.totals.failed).toBe(1)
  })

  it('rejects a second concurrent op for the same collection', async () => {
    await seed('docs/a.md', '---\nstatus: "1"\n---\nA\n')
    enumeratedRows = [{ path: 'docs/a.md', state: 'indexed' }]
    const { event, windowManager } = makeEventAndWindows()
    const first = applyPropertyOp(event, windowManager, 'op-6', convertReq())
    await expect(
      applyPropertyOp(event, windowManager, 'op-7', convertReq())
    ).rejects.toThrow(/already running/)
    await first
  })

  it('rejects paths escaping the collection boundary', async () => {
    const { event, windowManager } = makeEventAndWindows()
    const result = await applyPropertyOp(
      event,
      windowManager,
      'op-8',
      convertReq({ scope: null, filePath: '../outside.md' })
    )
    expect(result.entries[0].status).toBe('failed')
    expect(result.entries[0].reason).toMatch(/Access denied/)
  })
})

describe('applyPropertyOp — rename', () => {
  it('moves values to the new key, skips collisions, renames overlay + saved views', async () => {
    await seed('docs/a.md', '---\nstatus: drafted\ntitle: A\n---\nBody A\n')
    await seed('docs/b.md', '---\nstatus: x\nstate: y\n---\nBody B\n')
    enumeratedRows = [
      { path: 'docs/a.md', state: 'indexed' },
      { path: 'docs/b.md', state: 'indexed' }
    ]
    // Pre-seed an overlay entry and a saved view referencing the old key.
    await writeFile(
      join(root, OVERLAY_FILENAME),
      'scopes:\n  docs:\n    fields:\n      status:\n        field_type: string\n',
      'utf-8'
    )
    await mkdir(join(root, '.markdownvdb'), { recursive: true })
    await writeFile(
      join(root, '.markdownvdb', 'table-views.json'),
      JSON.stringify({
        version: 1,
        folders: {
          docs: [
            {
              id: 'v1',
              name: 'By status',
              version: 1,
              config: {
                sort: [{ columnName: 'status', direction: 'asc' }],
                filters: [],
                columns: [{ name: 'status', hidden: false, width: 140, order: 0 }],
                groupBy: 'status',
                collapsedGroups: []
              },
              recursive: false,
              isDefault: false,
              createdAt: 1,
              updatedAt: 1
            }
          ]
        }
      }),
      'utf-8'
    )

    const { event, windowManager } = makeEventAndWindows()
    const result = await applyPropertyOp(
      event,
      windowManager,
      'op-9',
      convertReq({ op: { kind: 'rename', newKey: 'state' } })
    )

    const byPath = Object.fromEntries(result.entries.map((e) => [e.path, e]))
    expect(byPath['docs/a.md'].status).toBe('ok')
    expect(byPath['docs/b.md']).toEqual({
      path: 'docs/b.md',
      status: 'skipped',
      reason: 'target key exists'
    })

    const a = parseYaml((await readFile(join(root, 'docs/a.md'), 'utf-8')).split('---')[1])
    expect(a).toEqual({ state: 'drafted', title: 'A' })

    const overlay = parseYaml(await readFile(join(root, OVERLAY_FILENAME), 'utf-8'))
    expect(overlay.scopes.docs.fields.state.field_type).toBe('string')
    expect(overlay.scopes.docs.fields.status).toBeUndefined()

    const views = JSON.parse(await readFile(join(root, '.markdownvdb', 'table-views.json'), 'utf-8'))
    const view = views.folders.docs[0]
    expect(view.config.sort[0].columnName).toBe('state')
    expect(view.config.columns[0].name).toBe('state')
    expect(view.config.groupBy).toBe('state')
  })

  it('rejects invalid new keys before touching anything', async () => {
    const { event, windowManager } = makeEventAndWindows()
    await expect(
      applyPropertyOp(
        event,
        windowManager,
        'op-10',
        convertReq({ op: { kind: 'rename', newKey: 'bad: key' } })
      )
    ).rejects.toThrow(/YAML special characters/)
    await expect(
      applyPropertyOp(
        event,
        windowManager,
        'op-10b',
        convertReq({ op: { kind: 'rename', newKey: '-leading' } })
      )
    ).rejects.toThrow(/YAML special characters/)
  })

  it('accepts hyphenated new keys ("created-at" style)', async () => {
    await seed('docs/a.md', '---\nstatus: drafted\n---\nBody\n')
    enumeratedRows = [{ path: 'docs/a.md', state: 'indexed' }]
    const { event, windowManager } = makeEventAndWindows()
    const result = await applyPropertyOp(
      event,
      windowManager,
      'op-11',
      convertReq({ op: { kind: 'rename', newKey: 'status-old' } })
    )
    expect(result.totals.ok).toBe(1)
    const fm = parseYaml((await readFile(join(root, 'docs/a.md'), 'utf-8')).split('---')[1])
    expect(fm).toEqual({ 'status-old': 'drafted' })
  })
})

describe('renamePropertyInViews scope filtering', () => {
  it('touches only the scope folder and its descendants', async () => {
    await mkdir(join(root, '.markdownvdb'), { recursive: true })
    const mkView = (col: string) => ({
      id: `v-${col}`,
      name: col,
      version: 1,
      config: {
        sort: [],
        filters: [],
        columns: [{ name: 'status', hidden: false, width: 140, order: 0 }],
        groupBy: null,
        collapsedGroups: []
      },
      recursive: false,
      isDefault: false,
      createdAt: 1,
      updatedAt: 1
    })
    await writeFile(
      join(root, '.markdownvdb', 'table-views.json'),
      JSON.stringify({
        version: 1,
        folders: { docs: [mkView('a')], 'docs/guides': [mkView('b')], other: [mkView('c')] }
      }),
      'utf-8'
    )
    await renamePropertyInViews('c1', 'docs', 'status', 'state')
    const views = JSON.parse(await readFile(join(root, '.markdownvdb', 'table-views.json'), 'utf-8'))
    expect(views.folders['docs'][0].config.columns[0].name).toBe('state')
    expect(views.folders['docs/guides'][0].config.columns[0].name).toBe('state')
    expect(views.folders['other'][0].config.columns[0].name).toBe('status')
  })
})
