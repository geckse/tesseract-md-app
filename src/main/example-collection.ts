/**
 * Creates the optional onboarding example collection.
 *
 * The example is intentionally plain Markdown: users can inspect, edit, move,
 * or delete every file without Tesseract. Existing example folders are reused
 * only when they contain our marker, and user-created folders are never
 * overwritten.
 */

import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import { atomicWriteFile } from './atomic-write'

const EXAMPLE_NAME = 'Tesseract Example'
const MARKER_FILE = '.tesseract-example.json'
const EXAMPLE_SCHEMA_VERSION = 3
const MARKER =
  JSON.stringify({ product: 'tesseract', schemaVersion: EXAMPLE_SCHEMA_VERSION }, null, 2) + '\n'

const markdown = (...lines: string[]): string => `${lines.join('\n')}\n`

export const EXAMPLE_COLLECTION_FILES: Readonly<Record<string, string>> = {
  'Start Here.md': markdown(
    '---',
    'title: Start Here',
    'type: guide',
    'status: ready',
    'tags: [tesseract, welcome]',
    'featured: true',
    '---',
    '',
    '# Welcome to Tesseract',
    '',
    'This small collection is both a playground and a quick guide. Every page is ordinary Markdown, so try editing anything—you cannot break the app.',
    '',
    '## A good five-minute tour',
    '',
    '1. Run **Collection → Sync (Incremental)** to index these notes.',
    '2. Press **Cmd/Ctrl + K** and search for `how do I rediscover forgotten ideas?`.',
    '3. Open [[Guides/Search by meaning|Search by meaning]] to see why that query works.',
    '4. Follow a linked note from the list below, then inspect links and backlinks in the Properties panel.',
    '5. Open the Graph view to see these guide pages as a connected neighborhood.',
    '',
    '## What to explore',
    '',
    '- [[Guides/Search by meaning|Search by meaning]] — semantic, lexical, and hybrid retrieval',
    '- [[Guides/Links, backlinks, and graphs|Links, backlinks, and graphs]] — turn folders into a knowledge network',
    '- [[Guides/Writing and editing|Writing and editing]] — Source, WYSIWYG, Preview, tabs, and split panes',
    '- [[Guides/Properties and table views|Properties and table views]] — structured frontmatter without leaving Markdown',
    '- [[Guides/Local-first by design|Local-first by design]] — what stays on your machine and what can use a provider',
    '- [[Reference/Feature map|Feature map]] — a compact checklist of the wider workspace',
    '',
    '> Tip: Favorite this page from its context menu so it stays close while you explore.'
  ),
  'Guides/Search by meaning.md': markdown(
    '---',
    'title: Search by meaning',
    'type: guide',
    'status: ready',
    'tags: [search, embeddings, discovery]',
    'difficulty: beginner',
    '---',
    '',
    '# Search by meaning',
    '',
    'Keyword search finds the words you typed. Semantic search finds notes that express the same idea with different words. Hybrid search combines both signals.',
    '',
    'After syncing this collection, try these in the Search panel:',
    '',
    '- `how do I rediscover forgotten ideas?` should surface [[Links, backlinks, and graphs]].',
    '- `keep my notes portable` should surface [[Local-first by design]].',
    '- `structured project overview` should surface [[Properties and table views]].',
    '',
    'Use **semantic** mode for concepts, **lexical** mode for exact names, and **hybrid** mode when you want both. Filters can narrow results by frontmatter such as `status=ready` or `type=guide`.',
    '',
    'Search can also expand into linked neighbors. That is useful when the best answer is surrounded by supporting context rather than contained in one file.',
    '',
    'Next: [[Links, backlinks, and graphs]].'
  ),
  'Guides/Links, backlinks, and graphs.md': markdown(
    '---',
    'title: Links, backlinks, and graphs',
    'type: guide',
    'status: ready',
    'tags: [links, graph, navigation]',
    '---',
    '',
    '# Links, backlinks, and graphs',
    '',
    'Type `[[` while editing to link another note. Tesseract resolves wikilinks, shows outgoing links and backlinks, and uses the same relationships in local and global graph views.',
    '',
    'This page is linked from [[../Start Here|Start Here]], points to [[Writing and editing]], and is mentioned by [[../Projects/A small launch plan|A small launch plan]]. Those directions create a useful neighborhood instead of a one-way folder tree.',
    '',
    '## Two graph scales',
    '',
    '- **Local graph**: the current note and its immediate neighborhood.',
    '- **Global graph**: the shape of the whole collection, with folders, topics, and semantic relationships.',
    '',
    '```mermaid',
    'flowchart LR',
    '  Search[Search by meaning] --> Links[Links and backlinks]',
    '  Links --> Writing[Writing and editing]',
    '  Writing --> Properties[Properties and tables]',
    '```',
    '',
    'The Mermaid block above renders in Preview mode. Switch editor modes to compare the source and rendered diagram.'
  ),
  'Guides/Writing and editing.md': markdown(
    '---',
    'title: Writing and editing',
    'type: guide',
    'status: draft',
    'tags: [editor, markdown, workflow]',
    'word_target: 500',
    '---',
    '',
    '# Writing and editing',
    '',
    'Tesseract keeps Markdown at the center while offering three ways to work:',
    '',
    '1. **Source** for direct Markdown editing.',
    '2. **WYSIWYG** for block editing, slash commands, and formatting controls.',
    '3. **Preview** for the final rendered result, including Mermaid and math.',
    '',
    'Open several notes in tabs, drag a tab to create a split pane, or move focused work into another window. Sessions restore across restarts.',
    '',
    '## Try it here',
    '',
    '- [ ] Change this heading',
    '- [ ] Add another link to [[Local-first by design]]',
    '- [ ] Toggle Source, WYSIWYG, and Preview',
    '- [ ] Save with **Cmd/Ctrl + S**',
    '',
    'When an external editor or agent changes the same file, Tesseract watches the collection and helps surface the difference instead of silently discarding work.',
    '',
    'Related: [[Properties and table views]].'
  ),
  'Guides/Properties and table views.md': markdown(
    '---',
    'title: Properties and table views',
    'type: guide',
    'status: ready',
    'tags: [frontmatter, properties, tables]',
    'priority: 1',
    'published: true',
    'reviewed: 2026-01-15',
    '---',
    '',
    '# Properties and table views',
    '',
    'The YAML block above is frontmatter: structured data that travels with the note. Tesseract turns it into editable properties and infers a collection schema from the values it sees.',
    '',
    '| Property | What it demonstrates |',
    '| --- | --- |',
    '| `status` | a reusable workflow state |',
    '| `priority` | a number that can be sorted |',
    '| `published` | a boolean toggle |',
    '| `reviewed` | a date |',
    '| `tags` | a multi-value field |',
    '',
    'Open a folder as a table to compare many notes at once, sort and filter rows, edit cells inline, and save useful table views. The underlying files remain Markdown.',
    '',
    'See the sample records in the `Projects` folder, especially [[../Projects/A small launch plan|A small launch plan]].'
  ),
  'Guides/Local-first by design.md': markdown(
    '---',
    'title: Local-first by design',
    'type: guide',
    'status: ready',
    'tags: [privacy, local-first, markdown]',
    '---',
    '',
    '# Local-first by design',
    '',
    'Your notes, folders, links, and frontmatter stay as files on your machine. There is no Tesseract account and no proprietary document format.',
    '',
    'The local `mdvdb` engine builds the search index and graph data. If you choose OpenAI for embeddings, only the text needed to generate embeddings is sent to that provider. If you choose Ollama, embedding generation can stay local too.',
    '',
    'Tesseract itself checks GitHub for application and CLI releases. You can inspect provider, search, indexing, appearance, and terminal behavior in Settings.',
    '',
    'Because the collection is normal Markdown, other editors, version control, sync tools, and coding agents can work beside Tesseract. The watcher notices those changes.',
    '',
    'Return to [[../Start Here|Start Here]] or continue with [[../Reference/Feature map|Feature map]].'
  ),
  'Reference/Feature map.md': markdown(
    '---',
    'title: Feature map',
    'type: reference',
    'status: ready',
    'tags: [reference, features]',
    '---',
    '',
    '# Feature map',
    '',
    'Use this page as a lightweight checklist while learning the workspace.',
    '',
    '## Discover',
    '',
    '- Semantic, lexical, and hybrid search',
    '- Frontmatter filters and link-neighborhood expansion',
    '- Quick Open, recent files, favorites, and orphan discovery',
    '',
    '## Understand',
    '',
    '- Links, backlinks, headings, and document properties',
    '- Local neighborhood graph and interactive 3D collection graph',
    '- Automatic clusters plus custom topics',
    '',
    '## Create',
    '',
    '- Source, WYSIWYG, and Preview editing',
    '- Tabs, split panes, detachable windows, and session restore',
    '- Images, PDFs, media assets, exports, and an embedded terminal',
    '',
    '## Maintain',
    '',
    '- Incremental sync, reindex, Doctor, and collection information',
    '- File watching, external-change diffs, themes, and per-collection accents',
    '',
    'Start a real task in [[../Projects/A small launch plan|A small launch plan]], then return to [[../Start Here|Start Here]].'
  ),
  'Projects/A small launch plan.md': markdown(
    '---',
    'title: A small launch plan',
    'type: project',
    'status: active',
    'tags: [example, project]',
    'priority: 2',
    'owner: You',
    'due: 2026-08-01',
    '---',
    '',
    '# A small launch plan',
    '',
    'This is sample project data for table views, filters, and backlinks.',
    '',
    '## Outcome',
    '',
    'Turn a folder of durable Markdown into a workspace that is easy to search, connect, and maintain.',
    '',
    '## Next actions',
    '',
    '- [ ] Sync the example collection',
    '- [ ] Search for an idea instead of a filename',
    '- [ ] Inspect the graph described in [[../Guides/Links, backlinks, and graphs|Links, backlinks, and graphs]]',
    '- [ ] Edit a property described in [[../Guides/Properties and table views|Properties and table views]]',
    '- [ ] Create a new note and link it back here',
    '',
    'The plan intentionally links across folders so the graph has a meaningful shape.'
  ),
  '.markdownvdb/config.yaml': ''
}

const V1_LINK_REPLACEMENTS: ReadonlyArray<readonly [current: string, legacy: string]> = [
  ['[[Guides/Search by meaning|Search by meaning]]', '[[Search by meaning]]'],
  [
    '[[Guides/Links, backlinks, and graphs|Links, backlinks, and graphs]]',
    '[[Links, backlinks, and graphs]]'
  ],
  ['[[Guides/Writing and editing|Writing and editing]]', '[[Writing and editing]]'],
  [
    '[[Guides/Properties and table views|Properties and table views]]',
    '[[Properties and table views]]'
  ],
  ['[[Guides/Local-first by design|Local-first by design]]', '[[Local-first by design]]'],
  ['[[Reference/Feature map|Feature map]]', '[[Feature map]]'],
  ['[[../Start Here|Start Here]]', '[[Start Here]]'],
  ['[[../Projects/A small launch plan|A small launch plan]]', '[[A small launch plan]]'],
  ['[[../Reference/Feature map|Feature map]]', '[[Feature map]]'],
  [
    '[[../Guides/Links, backlinks, and graphs|Links, backlinks, and graphs]]',
    '[[Links, backlinks, and graphs]]'
  ],
  [
    '[[../Guides/Properties and table views|Properties and table views]]',
    '[[Properties and table views]]'
  ]
]

const V2_TEXT_REPLACEMENTS: ReadonlyArray<readonly [current: string, v2: string]> = [
  [
    '4. Follow a linked note from the list below, then inspect links and backlinks in the Properties panel.',
    '4. Follow a `[[wikilink]]`, then inspect links and backlinks in the Properties panel.'
  ],
  [
    '- [ ] Add another link to [[Local-first by design]]',
    '- [ ] Add a `[[wikilink]]` to [[Local-first by design]]'
  ]
]

/** Exact v2 fixture used to recognize an untouched pre-release guide safely. */
export const V2_EXAMPLE_COLLECTION_FILES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(EXAMPLE_COLLECTION_FILES).map(([path, current]) => [
    path,
    V2_TEXT_REPLACEMENTS.reduce(
      (content, [replacement, v2]) => content.replaceAll(replacement, v2),
      current
    )
  ])
)

/** Exact v1 fixture used to recognize an untouched pre-release guide safely. */
export const LEGACY_EXAMPLE_COLLECTION_FILES: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(V2_EXAMPLE_COLLECTION_FILES).map(([path, v2]) => [
    path,
    V1_LINK_REPLACEMENTS.reduce(
      (content, [replacement, legacy]) => content.replaceAll(replacement, legacy),
      v2
    )
  ])
)

interface ExampleMarker {
  product: string
  schemaVersion: number
}

async function readMarker(path: string): Promise<ExampleMarker | null> {
  try {
    const marker = JSON.parse(await fs.readFile(join(path, MARKER_FILE), 'utf8')) as ExampleMarker
    return marker.product === 'tesseract' && Number.isInteger(marker.schemaVersion) ? marker : null
  } catch {
    return null
  }
}

/**
 * Repair the broken cross-folder links from schema v1 and placeholder links
 * from schema v2, but only when every generated Markdown file matches a known
 * generated version. Any user edit or missing guide aborts before the first write.
 */
async function migrateUntouchedExample(path: string, marker: ExampleMarker): Promise<void> {
  if (marker.schemaVersion !== 1 && marker.schemaVersion !== 2) return

  const markdownFiles = Object.keys(EXAMPLE_COLLECTION_FILES).filter((relativePath) =>
    relativePath.endsWith('.md')
  )
  const contents = new Map<string, string>()
  const recognizedVersions =
    marker.schemaVersion === 1
      ? [LEGACY_EXAMPLE_COLLECTION_FILES, V2_EXAMPLE_COLLECTION_FILES, EXAMPLE_COLLECTION_FILES]
      : [V2_EXAMPLE_COLLECTION_FILES, EXAMPLE_COLLECTION_FILES]

  try {
    for (const relativePath of markdownFiles) {
      const content = await fs.readFile(join(path, relativePath), 'utf8')
      if (!recognizedVersions.some((version) => content === version[relativePath])) return
      contents.set(relativePath, content)
    }
  } catch {
    return
  }

  for (const relativePath of markdownFiles) {
    if (contents.get(relativePath) === EXAMPLE_COLLECTION_FILES[relativePath]) continue
    await atomicWriteFile(join(path, relativePath), EXAMPLE_COLLECTION_FILES[relativePath])
  }
  await atomicWriteFile(join(path, MARKER_FILE), MARKER)
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST'
}

/** Create or reuse a non-overwriting example collection below `baseDirectory`. */
export async function createExampleCollection(baseDirectory: string): Promise<string> {
  await fs.mkdir(baseDirectory, { recursive: true })

  for (let suffix = 1; suffix <= 100; suffix += 1) {
    const name = suffix === 1 ? EXAMPLE_NAME : `${EXAMPLE_NAME} ${suffix}`
    const path = join(baseDirectory, name)

    const marker = await readMarker(path)
    if (marker) {
      await migrateUntouchedExample(path, marker)
      return path
    }

    try {
      await fs.mkdir(path)
    } catch (error) {
      if (isAlreadyExists(error)) continue
      throw error
    }

    try {
      for (const [relativePath, content] of Object.entries(EXAMPLE_COLLECTION_FILES)) {
        const absolutePath = join(path, relativePath)
        await fs.mkdir(dirname(absolutePath), { recursive: true })
        await fs.writeFile(absolutePath, content, { encoding: 'utf8', flag: 'wx' })
      }
      await fs.writeFile(join(path, MARKER_FILE), MARKER, { encoding: 'utf8', flag: 'wx' })
      return path
    } catch (error) {
      await fs.rm(path, { recursive: true, force: true })
      throw error
    }
  }

  throw new Error('Could not find a safe folder name for the Tesseract example collection.')
}
