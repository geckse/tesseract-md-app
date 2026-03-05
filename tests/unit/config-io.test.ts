import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readConfig, writeConfigKey, deleteConfigKey } from '../../src/main/config-io'
import { writeFile, mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

let testDir: string

beforeEach(async () => {
  testDir = join(tmpdir(), `config-io-test-${randomUUID()}`)
  await mkdir(testDir, { recursive: true })
})

afterEach(async () => {
  await rm(testDir, { recursive: true, force: true })
})

describe('readConfig', () => {
  it('returns parsed KEY=value pairs', async () => {
    const file = join(testDir, 'config')
    await writeFile(file, 'FOO=bar\nBAZ=qux\n', 'utf-8')

    const result = await readConfig(file)
    expect(result).toEqual({ FOO: 'bar', BAZ: 'qux' })
  })

  it('returns empty Record for missing file', async () => {
    const result = await readConfig(join(testDir, 'nonexistent'))
    expect(result).toEqual({})
  })

  it('handles values with = signs', async () => {
    const file = join(testDir, 'config')
    await writeFile(file, 'URL=https://example.com?a=1&b=2\n', 'utf-8')

    const result = await readConfig(file)
    expect(result).toEqual({ URL: 'https://example.com?a=1&b=2' })
  })

  it('handles quoted values', async () => {
    const file = join(testDir, 'config')
    await writeFile(file, 'NAME="hello world"\n', 'utf-8')

    const result = await readConfig(file)
    expect(result).toEqual({ NAME: '"hello world"' })
  })

  it('preserves malformed lines as-is (skips them)', async () => {
    const file = join(testDir, 'config')
    await writeFile(file, 'GOOD=value\nno-equals-here\nALSO=ok\n', 'utf-8')

    const result = await readConfig(file)
    expect(result).toEqual({ GOOD: 'value', ALSO: 'ok' })
  })
})

describe('writeConfigKey', () => {
  it('adds new key', async () => {
    const file = join(testDir, 'config')
    await writeFile(file, 'EXISTING=val\n', 'utf-8')

    await writeConfigKey(file, 'NEW', 'stuff')

    const result = await readConfig(file)
    expect(result).toEqual({ EXISTING: 'val', NEW: 'stuff' })
  })

  it('updates existing key in place', async () => {
    const file = join(testDir, 'config')
    await writeFile(file, 'A=1\nB=2\nC=3\n', 'utf-8')

    await writeConfigKey(file, 'B', 'updated')

    const result = await readConfig(file)
    expect(result).toEqual({ A: '1', B: 'updated', C: '3' })
  })

  it('preserves comments and empty lines', async () => {
    const file = join(testDir, 'config')
    const content = '# header comment\nKEY1=val1\n\n# another comment\nKEY2=val2\n'
    await writeFile(file, content, 'utf-8')

    await writeConfigKey(file, 'KEY1', 'new')

    const { readFile: rf } = await import('node:fs/promises')
    const raw = await rf(file, 'utf-8')
    expect(raw).toContain('# header comment')
    expect(raw).toContain('# another comment')
    expect(raw).toContain('KEY1=new')
    expect(raw).toContain('KEY2=val2')
  })

  it('creates directory if missing', async () => {
    const file = join(testDir, 'sub', 'dir', 'config')

    await writeConfigKey(file, 'KEY', 'value')

    const result = await readConfig(file)
    expect(result).toEqual({ KEY: 'value' })
  })

  it('handles values with = signs', async () => {
    const file = join(testDir, 'config')
    await writeFile(file, '', 'utf-8')

    await writeConfigKey(file, 'DSN', 'postgres://host?opt=1')

    const result = await readConfig(file)
    expect(result).toEqual({ DSN: 'postgres://host?opt=1' })
  })
})

describe('deleteConfigKey', () => {
  it('removes key line', async () => {
    const file = join(testDir, 'config')
    await writeFile(file, 'A=1\nB=2\nC=3\n', 'utf-8')

    await deleteConfigKey(file, 'B')

    const result = await readConfig(file)
    expect(result).toEqual({ A: '1', C: '3' })
  })

  it('is a no-op for missing file', async () => {
    await expect(deleteConfigKey(join(testDir, 'nope'), 'KEY')).resolves.toBeUndefined()
  })

  it('is a no-op for missing key', async () => {
    const file = join(testDir, 'config')
    await writeFile(file, 'A=1\n', 'utf-8')

    await deleteConfigKey(file, 'NONEXISTENT')

    const result = await readConfig(file)
    expect(result).toEqual({ A: '1' })
  })

  it('preserves comments and empty lines', async () => {
    const file = join(testDir, 'config')
    await writeFile(file, '# comment\nA=1\n\nB=2\n', 'utf-8')

    await deleteConfigKey(file, 'A')

    const { readFile: rf } = await import('node:fs/promises')
    const raw = await rf(file, 'utf-8')
    expect(raw).toContain('# comment')
    expect(raw).toContain('B=2')
    expect(raw).not.toContain('A=1')
  })
})
