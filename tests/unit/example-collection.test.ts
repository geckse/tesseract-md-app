import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, posix } from 'node:path'
import {
  createExampleCollection,
  EXAMPLE_COLLECTION_FILES,
  LEGACY_EXAMPLE_COLLECTION_FILES,
  V2_EXAMPLE_COLLECTION_FILES
} from '../../src/main/example-collection'

const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function testDirectory(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'tesseract-example-test-'))
  cleanup.push(path)
  return path
}

describe('example collection', () => {
  it('creates a connected, initialized Markdown guide', async () => {
    const base = await testDirectory()
    const path = await createExampleCollection(base)

    expect(path).toBe(join(base, 'Tesseract Example'))
    expect(
      Object.keys(EXAMPLE_COLLECTION_FILES).filter((name) => name.endsWith('.md')).length
    ).toBe(8)
    expect(await readFile(join(path, '.markdownvdb', 'config.yaml'), 'utf8')).toBe('')

    const start = await readFile(join(path, 'Start Here.md'), 'utf8')
    expect(start).toContain('[[Guides/Search by meaning|Search by meaning]]')
    expect(start).toContain('Cmd/Ctrl + K')

    const graph = await readFile(join(path, 'Guides', 'Links, backlinks, and graphs.md'), 'utf8')
    expect(graph).toContain('```mermaid')
    expect(graph).toContain('[[Writing and editing]]')

    const properties = await readFile(join(path, 'Guides', 'Properties and table views.md'), 'utf8')
    expect(properties).toContain('published: true')
    expect(properties).toContain('| Property |')
  })

  it('keeps every instructional wikilink connected to a generated Markdown file', () => {
    const generatedPaths = new Set(Object.keys(EXAMPLE_COLLECTION_FILES))

    for (const [source, content] of Object.entries(EXAMPLE_COLLECTION_FILES)) {
      if (!source.endsWith('.md')) continue
      for (const match of content.matchAll(/\[\[([^\]\n]+)\]\]/g)) {
        const target = match[1].split('|', 1)[0].split('#', 1)[0]

        const relativeTarget = posix.normalize(posix.join(posix.dirname(source), target))
        const resolvedTarget = relativeTarget.endsWith('.md')
          ? relativeTarget
          : `${relativeTarget}.md`

        expect(
          generatedPaths.has(resolvedTarget),
          `${source} contains a broken example wikilink: ${match[0]} -> ${resolvedTarget}`
        ).toBe(true)
      }
    }
  })

  it('reuses a marked example without overwriting user edits', async () => {
    const base = await testDirectory()
    const first = await createExampleCollection(base)
    await writeFile(join(first, 'Start Here.md'), '# My edited guide\n', 'utf8')

    const second = await createExampleCollection(base)

    expect(second).toBe(first)
    expect(await readFile(join(second, 'Start Here.md'), 'utf8')).toBe('# My edited guide\n')
  })

  it('migrates an untouched v1 guide to connected links without changing its config', async () => {
    const base = await testDirectory()
    const path = await createExampleCollection(base)

    for (const [relativePath, content] of Object.entries(LEGACY_EXAMPLE_COLLECTION_FILES)) {
      if (relativePath.endsWith('.md')) await writeFile(join(path, relativePath), content, 'utf8')
    }
    await writeFile(
      join(path, '.tesseract-example.json'),
      JSON.stringify({ product: 'tesseract', schemaVersion: 1 }),
      'utf8'
    )
    await writeFile(join(path, '.markdownvdb', 'config.yaml'), 'embedding:\n  provider: mock\n')

    expect(await createExampleCollection(base)).toBe(path)
    expect(await readFile(join(path, 'Start Here.md'), 'utf8')).toBe(
      EXAMPLE_COLLECTION_FILES['Start Here.md']
    )
    expect(await readFile(join(path, '.markdownvdb', 'config.yaml'), 'utf8')).toBe(
      'embedding:\n  provider: mock\n'
    )
    expect(await readFile(join(path, '.tesseract-example.json'), 'utf8')).toContain(
      '"schemaVersion": 3'
    )
  })

  it('migrates an untouched v2 guide that still contains placeholder broken links', async () => {
    const base = await testDirectory()
    const path = await createExampleCollection(base)

    for (const [relativePath, content] of Object.entries(V2_EXAMPLE_COLLECTION_FILES)) {
      if (relativePath.endsWith('.md')) await writeFile(join(path, relativePath), content, 'utf8')
    }
    await writeFile(
      join(path, '.tesseract-example.json'),
      JSON.stringify({ product: 'tesseract', schemaVersion: 2 }),
      'utf8'
    )

    await createExampleCollection(base)

    expect(await readFile(join(path, 'Start Here.md'), 'utf8')).not.toContain('[[wikilink]]')
    expect(await readFile(join(path, 'Guides', 'Writing and editing.md'), 'utf8')).not.toContain(
      '[[wikilink]]'
    )
    expect(await readFile(join(path, '.tesseract-example.json'), 'utf8')).toContain(
      '"schemaVersion": 3'
    )
  })

  it('leaves every file untouched when a v1 guide contains user edits', async () => {
    const base = await testDirectory()
    const path = await createExampleCollection(base)

    for (const [relativePath, content] of Object.entries(LEGACY_EXAMPLE_COLLECTION_FILES)) {
      if (relativePath.endsWith('.md')) await writeFile(join(path, relativePath), content, 'utf8')
    }
    await writeFile(join(path, 'Start Here.md'), '# My edited v1 guide\n', 'utf8')
    await writeFile(
      join(path, '.tesseract-example.json'),
      JSON.stringify({ product: 'tesseract', schemaVersion: 1 }),
      'utf8'
    )

    await createExampleCollection(base)

    expect(await readFile(join(path, 'Start Here.md'), 'utf8')).toBe('# My edited v1 guide\n')
    expect(await readFile(join(path, 'Guides', 'Links, backlinks, and graphs.md'), 'utf8')).toBe(
      LEGACY_EXAMPLE_COLLECTION_FILES['Guides/Links, backlinks, and graphs.md']
    )
    expect(await readFile(join(path, '.tesseract-example.json'), 'utf8')).toContain(
      '"schemaVersion":1'
    )
  })

  it('uses a numbered folder when an unrelated path already has the default name', async () => {
    const base = await testDirectory()
    await mkdir(join(base, 'Tesseract Example'))
    await writeFile(join(base, 'Tesseract Example', 'personal.md'), '# Keep me\n', 'utf8')

    const path = await createExampleCollection(base)

    expect(path).toBe(join(base, 'Tesseract Example 2'))
    expect(await readFile(join(base, 'Tesseract Example', 'personal.md'), 'utf8')).toBe(
      '# Keep me\n'
    )
  })
})
