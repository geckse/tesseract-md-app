import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkCollectionSkills, installCollectionSkills } from '../../src/main/collection-skills'

describe('collection-local Tesseract skills', () => {
  let root: string
  let collectionRoot: string
  let bundleRoot: string

  async function writeBundle(version: string, suffix = 'v1'): Promise<void> {
    await fs.mkdir(join(bundleRoot, '.claude-plugin'), { recursive: true })
    await fs.mkdir(join(bundleRoot, 'skills', 'structure-frontmatter'), { recursive: true })
    await fs.mkdir(join(bundleRoot, 'skills', 'wire-relations', 'references'), {
      recursive: true
    })
    await fs.writeFile(
      join(bundleRoot, '.claude-plugin', 'plugin.json'),
      JSON.stringify({ name: 'tesseract', version }),
      'utf-8'
    )
    await fs.writeFile(
      join(bundleRoot, 'skills', 'structure-frontmatter', 'SKILL.md'),
      `---\nname: structure-frontmatter\ndescription: Test\n---\n${suffix}\n`,
      'utf-8'
    )
    await fs.writeFile(
      join(bundleRoot, 'skills', 'wire-relations', 'SKILL.md'),
      `---\nname: wire-relations\ndescription: Test\n---\n${suffix}\n`,
      'utf-8'
    )
    await fs.writeFile(
      join(bundleRoot, 'skills', 'wire-relations', 'references', 'example.md'),
      `reference ${suffix}\n`,
      'utf-8'
    )
  }

  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'tesseract-collection-skills-'))
    collectionRoot = join(root, 'collection')
    bundleRoot = join(root, 'bundle')
    await fs.mkdir(collectionRoot)
    await writeBundle('1.0.0')
  })

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true })
  })

  it('reports missing skills and recommends the portable .agents location', async () => {
    const status = await checkCollectionSkills(collectionRoot, bundleRoot)

    expect(status.state).toBe('missing')
    expect(status.bundleVersion).toBe('1.0.0')
    expect(status.skillCount).toBe(2)
    expect(status.recommendedTargetId).toBe('agents')
    expect(status.targets.map((target) => target.relativePath)).toEqual([
      '.claude/skills',
      '.agents/skills',
      '.gemini/skills'
    ])
  })

  it('recommends an agent directory already present in the collection', async () => {
    await fs.mkdir(join(collectionRoot, '.claude'))

    const status = await checkCollectionSkills(collectionRoot, bundleRoot)

    expect(status.recommendedTargetId).toBe('claude')
  })

  it('installs only the Tesseract skill contents and reports them current', async () => {
    const status = await installCollectionSkills(collectionRoot, 'agents', bundleRoot)

    expect(status.state).toBe('current')
    expect(status.targets.find((target) => target.id === 'agents')?.state).toBe('current')
    expect(
      await fs.readFile(
        join(collectionRoot, '.agents', 'skills', 'structure-frontmatter', 'SKILL.md'),
        'utf-8'
      )
    ).toContain('v1')
    expect(
      await fs.readFile(
        join(collectionRoot, '.agents', 'skills', 'wire-relations', 'references', 'example.md'),
        'utf-8'
      )
    ).toBe('reference v1\n')
    await expect(
      fs.stat(join(collectionRoot, '.agents', 'skills', '.claude-plugin'))
    ).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('detects a bundle version update and becomes current after reinstalling', async () => {
    await installCollectionSkills(collectionRoot, 'claude', bundleRoot)
    await writeBundle('1.1.0')

    const outdated = await checkCollectionSkills(collectionRoot, bundleRoot)
    expect(outdated.state).toBe('outdated')
    expect(outdated.recommendedTargetId).toBe('claude')
    expect(outdated.targets.find((target) => target.id === 'claude')?.state).toBe('outdated')

    const updated = await installCollectionSkills(collectionRoot, 'claude', bundleRoot)
    expect(updated.state).toBe('current')
    expect(updated.bundleVersion).toBe('1.1.0')
  })

  it('detects modified installed content and restores the bundled copy', async () => {
    await installCollectionSkills(collectionRoot, 'gemini', bundleRoot)
    const installedPath = join(
      collectionRoot,
      '.gemini',
      'skills',
      'structure-frontmatter',
      'SKILL.md'
    )
    await fs.writeFile(installedPath, 'locally modified', 'utf-8')

    expect((await checkCollectionSkills(collectionRoot, bundleRoot)).state).toBe('outdated')

    await installCollectionSkills(collectionRoot, 'gemini', bundleRoot)
    expect(await fs.readFile(installedPath, 'utf-8')).toContain('v1')
    expect((await checkCollectionSkills(collectionRoot, bundleRoot)).state).toBe('current')
  })

  it('treats one current agent installation as collection-wide availability', async () => {
    await installCollectionSkills(collectionRoot, 'claude', bundleRoot)
    await fs.mkdir(join(collectionRoot, '.agents', 'skills', 'wire-relations'), {
      recursive: true
    })
    await fs.writeFile(
      join(collectionRoot, '.agents', 'skills', 'wire-relations', 'SKILL.md'),
      'partial',
      'utf-8'
    )

    const status = await checkCollectionSkills(collectionRoot, bundleRoot)

    expect(status.state).toBe('current')
    expect(status.targets.find((target) => target.id === 'agents')?.state).toBe('outdated')
  })

  it.runIf(process.platform !== 'win32')(
    'blocks installation through a symlinked agent directory',
    async () => {
      const outside = join(root, 'outside')
      await fs.mkdir(outside)
      await fs.symlink(outside, join(collectionRoot, '.agents'))

      const status = await checkCollectionSkills(collectionRoot, bundleRoot)
      expect(status.targets.find((target) => target.id === 'agents')?.state).toBe('blocked')
      await expect(installCollectionSkills(collectionRoot, 'agents', bundleRoot)).rejects.toThrow(
        'Refusing to install through a symlink'
      )
      expect(await fs.readdir(outside)).toEqual([])
    }
  )
})
