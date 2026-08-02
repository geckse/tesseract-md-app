import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { assertComputedOutputKeyAbsentOnDisk } from '../../src/main/computed-output-preflight'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'computed-output-preflight-'))
  await mkdir(join(root, 'contacts', 'enterprise'), { recursive: true })
  await mkdir(join(root, 'projects'), { recursive: true })
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('assertComputedOutputKeyAbsentOnDisk', () => {
  it('finds exact top-level keys in current unindexed Markdown below the owner scope', async () => {
    await writeFile(
      join(root, 'contacts', 'new.md'),
      '---\nclient_industry: Manufacturing\n---\nUnindexed\n',
      'utf-8'
    )
    await writeFile(
      join(root, 'contacts', 'enterprise', 'nested.md'),
      '---\nmeta:\n  client_industry: nested-only\n---\nclient_industry: body-only\n',
      'utf-8'
    )
    await writeFile(
      join(root, 'projects', 'sibling.md'),
      '---\nclient_industry: sibling\n---\n',
      'utf-8'
    )

    await expect(
      assertComputedOutputKeyAbsentOnDisk(root, 'contacts', 'client_industry')
    ).rejects.toThrow(/contacts\/new\.md/)
    await expect(
      assertComputedOutputKeyAbsentOnDisk(root, 'contacts', 'unclaimed')
    ).resolves.toBeUndefined()
  })

  it('recognizes BOM/CRLF frontmatter and reports collisions deterministically', async () => {
    await writeFile(
      join(root, 'contacts', 'z.md'),
      '\uFEFF---\r\nclaimed: z\r\n---\r\nBody\r\n',
      'utf-8'
    )
    await writeFile(join(root, 'contacts', 'a.md'), '---\nclaimed: a\n---\n', 'utf-8')

    await expect(assertComputedOutputKeyAbsentOnDisk(root, 'contacts', 'claimed')).rejects.toThrow(
      /contacts\/a\.md, contacts\/z\.md/
    )
  })

  it('fails closed on malformed or non-mapping frontmatter', async () => {
    await writeFile(join(root, 'contacts', 'open.md'), '---\nclaimed: true\n', 'utf-8')
    await expect(assertComputedOutputKeyAbsentOnDisk(root, 'contacts', 'other')).rejects.toThrow(
      /missing its closing/
    )

    await writeFile(join(root, 'contacts', 'open.md'), '---\n- one\n- two\n---\n', 'utf-8')
    await expect(assertComputedOutputKeyAbsentOnDisk(root, 'contacts', 'other')).rejects.toThrow(
      /not a YAML mapping/
    )
  })

  it('skips hidden/built-in ignored trees and never follows directory symlinks', async () => {
    await mkdir(join(root, 'contacts', '.hidden'), { recursive: true })
    await mkdir(join(root, 'contacts', 'node_modules'), { recursive: true })
    await writeFile(
      join(root, 'contacts', '.hidden', 'secret.md'),
      '---\nclaimed: hidden\n---\n',
      'utf-8'
    )
    await writeFile(
      join(root, 'contacts', 'node_modules', 'package.md'),
      '---\nclaimed: dependency\n---\n',
      'utf-8'
    )
    if (process.platform !== 'win32') {
      const outside = await mkdtemp(join(tmpdir(), 'computed-output-outside-'))
      await writeFile(join(outside, 'outside.md'), '---\nclaimed: outside\n---\n', 'utf-8')
      await symlink(outside, join(root, 'contacts', 'linked'))
      try {
        await expect(
          assertComputedOutputKeyAbsentOnDisk(root, 'contacts', 'claimed')
        ).resolves.toBeUndefined()
      } finally {
        await rm(outside, { recursive: true, force: true })
      }
    } else {
      await expect(
        assertComputedOutputKeyAbsentOnDisk(root, 'contacts', 'claimed')
      ).resolves.toBeUndefined()
    }
  })

  it('rejects escaping and symlinked owner scopes before reading them', async () => {
    await expect(
      assertComputedOutputKeyAbsentOnDisk(root, '../outside', 'claimed')
    ).rejects.toThrow(/escapes the collection/)
    if (process.platform !== 'win32') {
      const outside = await mkdtemp(join(tmpdir(), 'computed-output-scope-'))
      await symlink(outside, join(root, 'linked-scope'))
      try {
        await expect(
          assertComputedOutputKeyAbsentOnDisk(root, 'linked-scope', 'claimed')
        ).rejects.toThrow(/symbolic link/)
      } finally {
        await rm(outside, { recursive: true, force: true })
      }
    }
  })
})
