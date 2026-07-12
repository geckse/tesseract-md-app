import { describe, it, expect } from 'vitest'
import { buildZip, crc32 } from '@renderer/lib/export/zip'
import { markdownToDocx } from '@renderer/lib/export/docx'
import { markdownToOdt, odtPreservedText, ODT_MIMETYPE } from '@renderer/lib/export/odt'
import { markdownToEpub, buildNavList, EPUB_MIMETYPE } from '@renderer/lib/export/epub'

/** Parse a STORED-only zip produced by buildZip via its central directory. */
function readZip(bytes: Uint8Array): { names: string[]; entries: Map<string, Uint8Array> } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const eocd = bytes.length - 22
  expect(view.getUint32(eocd, true), 'EOCD signature').toBe(0x06054b50)
  const count = view.getUint16(eocd + 10, true)
  let offset = view.getUint32(eocd + 16, true)
  const names: string[] = []
  const entries = new Map<string, Uint8Array>()
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(offset, true), 'central header signature').toBe(0x02014b50)
    expect(view.getUint16(offset + 10, true), 'compression method').toBe(0) // STORED
    const crc = view.getUint32(offset + 16, true)
    const compressedSize = view.getUint32(offset + 20, true)
    const nameLen = view.getUint16(offset + 28, true)
    const extraLen = view.getUint16(offset + 30, true)
    const commentLen = view.getUint16(offset + 32, true)
    const localOffset = view.getUint32(offset + 42, true)
    const name = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLen))
    const localNameLen = view.getUint16(localOffset + 26, true)
    const localExtraLen = view.getUint16(localOffset + 28, true)
    const dataStart = localOffset + 30 + localNameLen + localExtraLen
    const data = bytes.subarray(dataStart, dataStart + compressedSize)
    expect(crc32(data), `crc of ${name}`).toBe(crc)
    names.push(name)
    entries.set(name, data)
    offset += 46 + nameLen + extraLen + commentLen
  }
  return { names, entries }
}

function entryText(entries: Map<string, Uint8Array>, name: string): string {
  const data = entries.get(name)
  expect(data, `zip entry ${name}`).toBeDefined()
  return new TextDecoder().decode(data)
}

function expectWellFormed(xml: string, label: string): void {
  const doc = new DOMParser().parseFromString(xml, 'text/xml')
  expect(doc.getElementsByTagName('parsererror').length, `${label} well-formed`).toBe(0)
}

describe('zip writer', () => {
  it('computes the standard CRC-32 check value', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
  })

  it('round-trips entries in order as STORED', () => {
    const zip = buildZip([
      { name: 'mimetype', data: 'application/x-test' },
      { name: 'dir/file.xml', data: '<a>ünïcode ✓</a>' },
      { name: 'binary.bin', data: new Uint8Array([0, 1, 2, 255]) }
    ])
    const { names, entries } = readZip(zip)
    expect(names).toEqual(['mimetype', 'dir/file.xml', 'binary.bin'])
    expect(entryText(entries, 'mimetype')).toBe('application/x-test')
    expect(entryText(entries, 'dir/file.xml')).toBe('<a>ünïcode ✓</a>')
    expect([...entries.get('binary.bin')!]).toEqual([0, 1, 2, 255])
  })

  it('places the first entry data at byte 30 + name length (OCF mimetype rule)', () => {
    const zip = buildZip([{ name: 'mimetype', data: 'application/epub+zip' }])
    const name = new TextDecoder().decode(zip.subarray(30, 38))
    const content = new TextDecoder().decode(zip.subarray(38, 58))
    expect(name).toBe('mimetype')
    expect(content).toBe('application/epub+zip')
  })
})

const RICH_MARKDOWN = `---
title: Ignored Frontmatter
---

# Main Title

Intro with **bold**, *italic*, ~~gone~~, \`code\`, a [link](https://example.com)
and an anchor [jump](#details).

## Details

> Quoted wisdom.

- bullet one
- bullet two
  - nested bullet
- [x] done task

1. first
2. second

Between lists.

Hard\\
break line.

3. third continues

| Name | Value |
| --- | ---: |
| Alpha | 1 |

\`\`\`js
  indented()
\`\`\`

![diagram](assets/diagram.png)

---
`

describe('markdownToDocx', () => {
  const { names, entries } = readZip(markdownToDocx(RICH_MARKDOWN, 'My <Doc> & Title'))

  it('packages all OOXML parts as well-formed XML', () => {
    expect(names).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'word/document.xml',
      'word/_rels/document.xml.rels',
      'word/styles.xml',
      'word/numbering.xml',
      'docProps/core.xml'
    ])
    for (const name of names) {
      expectWellFormed(entryText(entries, name), name)
    }
    expect(entryText(entries, '[Content_Types].xml')).toContain('/word/document.xml')
  })

  it('renders headings, inline formatting, and the escaped title', () => {
    const doc = entryText(entries, 'word/document.xml')
    expect(doc).toContain('<w:pStyle w:val="Heading1"/>')
    expect(doc).toContain('<w:pStyle w:val="Heading2"/>')
    expect(doc).toContain('<w:b/>')
    expect(doc).toContain('<w:i/>')
    expect(doc).toContain('<w:strike/>')
    expect(doc).toContain('<w:rStyle w:val="CodeChar"/>')
    expect(doc).not.toContain('Ignored Frontmatter')
    expect(entryText(entries, 'docProps/core.xml')).toContain(
      '<dc:title>My &lt;Doc&gt; &amp; Title</dc:title>'
    )
  })

  it('turns external links into relationships and keeps anchors plain', () => {
    const doc = entryText(entries, 'word/document.xml')
    const rels = entryText(entries, 'word/_rels/document.xml.rels')
    const match = doc.match(/<w:hyperlink r:id="(rId\d+)"/)
    expect(match).not.toBeNull()
    expect(rels).toContain(`Id="${match![1]}"`)
    expect(rels).toContain('Target="https://example.com"')
    expect(rels).toContain('TargetMode="External"')
    // The anchor link must not create a hyperlink relationship
    expect(rels).not.toContain('#details')
    expect(doc).toContain('jump')
  })

  it('restarts each ordered list with its own numbering instance', () => {
    const doc = entryText(entries, 'word/document.xml')
    const numbering = entryText(entries, 'word/numbering.xml')
    // Bullets share numId 1; the two ordered lists mint 2 and 3
    expect(doc).toContain('<w:numId w:val="1"/>')
    expect(doc).toContain('<w:numId w:val="2"/>')
    expect(doc).toContain('<w:numId w:val="3"/>')
    expect(numbering).toContain('<w:num w:numId="2">')
    expect(numbering).toContain('<w:num w:numId="3">')
    // The `3. third continues` list restarts at 3
    expect(numbering).toContain('<w:startOverride w:val="3"/>')
    // Nested bullet sits one indent level deeper
    expect(doc).toContain('<w:ilvl w:val="1"/>')
    // Checked task
    expect(doc).toContain('☑')
  })

  it('renders tables with bold header cells and images as placeholders', () => {
    const doc = entryText(entries, 'word/document.xml')
    expect(doc).toContain('<w:tbl>')
    expect((doc.match(/<w:tr>/g) ?? []).length).toBe(2)
    expect(doc).toContain('<w:gridCol/><w:gridCol/>')
    // Right-aligned column from `---:`
    expect(doc).toContain('<w:jc w:val="right"/>')
    expect(doc).toContain('[image: diagram]')
  })

  it('preserves code block indentation via xml:space', () => {
    const doc = entryText(entries, 'word/document.xml')
    expect(doc).toContain('<w:pStyle w:val="CodeBlock"/>')
    expect(doc).toContain('<w:t xml:space="preserve">  indented()</w:t>')
  })
})

describe('markdownToOdt', () => {
  const { names, entries } = readZip(markdownToOdt(RICH_MARKDOWN))

  it('places the uncompressed mimetype first (ODF rule)', () => {
    expect(names[0]).toBe('mimetype')
    expect(entryText(entries, 'mimetype')).toBe(ODT_MIMETYPE)
    expect(names).toContain('META-INF/manifest.xml')
    expect(entryText(entries, 'META-INF/manifest.xml')).toContain('content.xml')
    for (const name of names.filter((n) => n !== 'mimetype')) {
      expectWellFormed(entryText(entries, name), name)
    }
  })

  it('renders headings, quotes, links, and inline formatting', () => {
    const content = entryText(entries, 'content.xml')
    expect(content).toContain('text:style-name="Heading_20_1" text:outline-level="1"')
    expect(content).toContain('text:style-name="Quotations"')
    expect(content).toContain('<text:span text:style-name="TBold">bold</text:span>')
    expect(content).toContain('xlink:href="https://example.com"')
    expect(content).not.toContain('Ignored Frontmatter')
    // Anchor link stays plain text
    expect(content).not.toContain('xlink:href="#details"')
    expect(content).toContain('jump')
  })

  it('restarts ordered lists via text:start-value and nests lists in items', () => {
    const content = entryText(entries, 'content.xml')
    expect(content).toContain('<text:list text:style-name="LNum">')
    expect(content).toContain('text:start-value="3"')
    // Nested bullet list lives inside its parent list-item
    expect(content).toMatch(/<text:list-item>[^]*<text:list text:style-name="LBul">/)
    expect(content).toContain('☑')
  })

  it('renders tables with heading cells', () => {
    const content = entryText(entries, 'content.xml')
    expect(content).toContain('table:number-columns-repeated="2"')
    expect(content).toContain('text:style-name="Table_20_Heading"')
    expect(content).toContain('Alpha')
  })

  it('preserves code block whitespace with text:s', () => {
    const content = entryText(entries, 'content.xml')
    expect(content).toContain('text:style-name="Preformatted_20_Text"')
    expect(content).toContain('<text:s text:c="2"/>indented()')
  })

  it('encodes preformatted spaces and tabs', () => {
    expect(odtPreservedText('  lead')).toBe('<text:s text:c="2"/>lead')
    expect(odtPreservedText('a  b')).toBe('a <text:s text:c="1"/>b')
    expect(odtPreservedText('a\tb')).toBe('a<text:tab/>b')
    expect(odtPreservedText('x < y')).toBe('x &lt; y')
  })
})

describe('markdownToEpub', () => {
  const epub = markdownToEpub(RICH_MARKDOWN, 'My Book', {
    identifier: 'urn:uuid:00000000-1111-2222-3333-444444444444',
    modified: '2026-07-12T10:20:30.123Z'
  })
  const { names, entries } = readZip(epub)

  it('honors the OCF layout: mimetype first at fixed offsets', () => {
    expect(names[0]).toBe('mimetype')
    expect(new TextDecoder().decode(epub.subarray(30, 38))).toBe('mimetype')
    expect(new TextDecoder().decode(epub.subarray(38, 58))).toBe(EPUB_MIMETYPE)
    expect(entryText(entries, 'META-INF/container.xml')).toContain('full-path="OEBPS/content.opf"')
  })

  it('writes package metadata with a normalized dcterms:modified', () => {
    const opf = entryText(entries, 'OEBPS/content.opf')
    expectWellFormed(opf, 'content.opf')
    expect(opf).toContain('urn:uuid:00000000-1111-2222-3333-444444444444')
    expect(opf).toContain('<dc:title>My Book</dc:title>')
    // Milliseconds stripped for the EPUB timestamp profile
    expect(opf).toContain('>2026-07-12T10:20:30Z</meta>')
    expect(opf).toContain('properties="nav"')
  })

  it('emits well-formed XHTML with slug ids that the nav links to', () => {
    const content = entryText(entries, 'OEBPS/content.xhtml')
    const nav = entryText(entries, 'OEBPS/nav.xhtml')
    expectWellFormed(content, 'content.xhtml')
    expectWellFormed(nav, 'nav.xhtml')
    expect(content).toContain('<h1 id="main-title">Main Title</h1>')
    expect(content).toContain('<h2 id="details">Details</h2>')
    expect(nav).toContain('<a href="content.xhtml#main-title">Main Title</a>')
    // H2 nests under H1 in the toc
    expect(nav).toMatch(
      /<li><a href="content.xhtml#main-title">[^]*<ol><li><a href="content.xhtml#details">/
    )
  })

  it('keeps anchors, flattens relative links, and replaces images', () => {
    const content = entryText(entries, 'OEBPS/content.xhtml')
    expect(content).toContain('<a href="#details">jump</a>')
    expect(content).toContain('<a href="https://example.com">link</a>')
    expect(content).toContain('<em>[image: diagram]</em>')
    expect(content).toContain('<th style="text-align:right">Value</th>')
    expect(content).toContain('☑')
    expect(content).toContain('<br/>')
    expect(content).not.toContain('Ignored Frontmatter')
  })

  it('suffixes duplicate heading slugs like the in-app TOC', () => {
    const dup = markdownToEpub('# Same\n\n# Same\n', 'Dup')
    const { entries: dupEntries } = readZip(dup)
    const content = entryText(dupEntries, 'OEBPS/content.xhtml')
    expect(content).toContain('<h1 id="same">')
    expect(content).toContain('<h1 id="same-1">')
    const nav = entryText(dupEntries, 'OEBPS/nav.xhtml')
    expect(nav).toContain('#same"')
    expect(nav).toContain('#same-1"')
  })

  it('flattens relative markdown links to text (target)', () => {
    const book = markdownToEpub('See [other note](notes/other.md).\n', 'Links')
    const { entries: linkEntries } = readZip(book)
    const content = entryText(linkEntries, 'OEBPS/content.xhtml')
    expect(content).not.toContain('href="notes/other.md"')
    expect(content).toContain('other note (notes/other.md)')
  })

  it('falls back to a single toc entry when there are no headings', () => {
    expect(buildNavList([], 'Plain & Simple')).toBe(
      '<ol><li><a href="content.xhtml">Plain &amp; Simple</a></li></ol>'
    )
    const book = markdownToEpub('Just a paragraph.\n', 'Plain')
    const { entries: plainEntries } = readZip(book)
    expect(entryText(plainEntries, 'OEBPS/nav.xhtml')).toContain(
      '<a href="content.xhtml">Plain</a>'
    )
  })
})
