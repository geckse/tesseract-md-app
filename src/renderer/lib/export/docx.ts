/**
 * Markdown → Word (.docx) conversion for File > Export > Word.
 *
 * Hand-built WordprocessingML (OOXML) from the marked lexer token stream,
 * packaged with the STORED-zip writer — no extra dependencies. Fidelity
 * limits (documented in the phase-43 PRD): images become italic
 * `[image: alt]` placeholders, anchor-only links stay plain text, and raw
 * HTML blocks are dropped (same policy as the RTF/plain-text exporters).
 */

import { marked, type Token, type Tokens } from 'marked'
import { stripFrontmatter } from '../markdown-structure'
import { buildZip } from './zip'

/** Half-point sizes for H1–H6 (matches the RTF exporter's scale). */
const HEADING_SIZES = [48, 40, 34, 30, 28, 26]

const BULLET_NUM_ID = 1
/** Ordered-list numIds are minted per list so each list restarts numbering. */
const FIRST_ORDERED_NUM_ID = 2

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Undo marked's HTML entity escaping before XML-escaping. */
function unescapeEntities(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

interface RunFormat {
  bold?: boolean
  italic?: boolean
  strike?: boolean
  code?: boolean
  hyperlink?: boolean
}

interface DocxContext {
  /** External hyperlink targets in document order; index i → rId{10+i}. */
  hyperlinks: string[]
  /** Start value for each minted ordered-list numId, in mint order. */
  orderedListStarts: number[]
}

function runProperties(fmt: RunFormat): string {
  let props = ''
  if (fmt.hyperlink) props += '<w:rStyle w:val="Hyperlink"/>'
  if (fmt.code) props += '<w:rStyle w:val="CodeChar"/>'
  if (fmt.bold) props += '<w:b/>'
  if (fmt.italic) props += '<w:i/>'
  if (fmt.strike) props += '<w:strike/>'
  return props ? `<w:rPr>${props}</w:rPr>` : ''
}

function textRun(text: string, fmt: RunFormat): string {
  if (text === '') return ''
  // Soft line wraps inside a paragraph render as spaces (marked default).
  const normalized = text.replace(/\n/g, ' ')
  return `<w:r>${runProperties(fmt)}<w:t xml:space="preserve">${escapeXml(normalized)}</w:t></w:r>`
}

function inlineTokensToRuns(tokens: Token[] | undefined, fmt: RunFormat, ctx: DocxContext): string {
  if (!tokens) return ''
  let out = ''
  for (const token of tokens) {
    switch (token.type) {
      case 'text': {
        const t = token as Tokens.Text
        out +=
          t.tokens && t.tokens.length > 0
            ? inlineTokensToRuns(t.tokens, fmt, ctx)
            : textRun(unescapeEntities(t.text), fmt)
        break
      }
      case 'escape':
        out += textRun((token as Tokens.Escape).text, fmt)
        break
      case 'strong':
        out += inlineTokensToRuns((token as Tokens.Strong).tokens, { ...fmt, bold: true }, ctx)
        break
      case 'em':
        out += inlineTokensToRuns((token as Tokens.Em).tokens, { ...fmt, italic: true }, ctx)
        break
      case 'del':
        out += inlineTokensToRuns((token as Tokens.Del).tokens, { ...fmt, strike: true }, ctx)
        break
      case 'codespan':
        out += textRun(unescapeEntities((token as Tokens.Codespan).text), { ...fmt, code: true })
        break
      case 'link': {
        const link = token as Tokens.Link
        if (link.href.startsWith('#')) {
          // In-document anchors add no information in a flat Word doc
          out += inlineTokensToRuns(link.tokens, fmt, ctx)
        } else {
          const relId = 10 + ctx.hyperlinks.length
          ctx.hyperlinks.push(link.href)
          const inner = inlineTokensToRuns(link.tokens, { ...fmt, hyperlink: true }, ctx)
          out += `<w:hyperlink r:id="rId${relId}" w:history="1">${inner}</w:hyperlink>`
        }
        break
      }
      case 'image': {
        const img = token as Tokens.Image
        if (img.text) out += textRun(`[image: ${img.text}]`, { ...fmt, italic: true })
        break
      }
      case 'br':
        out += '<w:r><w:br/></w:r>'
        break
      case 'html':
        break
      default:
        if ('text' in token && typeof (token as { text?: unknown }).text === 'string') {
          out += textRun(unescapeEntities((token as { text: string }).text), fmt)
        }
    }
  }
  return out
}

function paragraph(runs: string, props: string): string {
  return `<w:p>${props ? `<w:pPr>${props}</w:pPr>` : ''}${runs}</w:p>`
}

interface BlockOptions {
  /** Paragraph style applied to plain paragraphs (e.g. inside blockquotes). */
  paragraphStyle?: string
}

function listToXml(list: Tokens.List, depth: number, ctx: DocxContext): string {
  const ilvl = Math.min(depth, 8)
  let numId = BULLET_NUM_ID
  if (list.ordered) {
    numId = FIRST_ORDERED_NUM_ID + ctx.orderedListStarts.length
    const start = typeof list.start === 'number' && list.start > 0 ? list.start : 1
    ctx.orderedListStarts.push(start)
  }
  const numPr = `<w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr>`

  const blocks: string[] = []
  for (const item of list.items) {
    const task = item.task ? textRun(item.checked ? '☑ ' : '☐ ', {}) : ''
    const inlineParts: string[] = []
    const trailing: string[] = []
    for (const child of item.tokens) {
      if (child.type === 'list') {
        trailing.push(listToXml(child as Tokens.List, depth + 1, ctx))
      } else if (child.type === 'text' || child.type === 'paragraph') {
        inlineParts.push(inlineTokensToRuns((child as Tokens.Text).tokens ?? [child], {}, ctx))
      } else {
        trailing.push(blockTokensToXml([child], ctx, {}))
      }
    }
    blocks.push(paragraph(task + inlineParts.join(textRun(' ', {})), numPr))
    blocks.push(...trailing.filter(Boolean))
  }
  return blocks.join('')
}

function tableToXml(table: Tokens.Table, ctx: DocxContext): string {
  const border = 'w:val="single" w:sz="4" w:space="0" w:color="999999"'
  const borders =
    '<w:tblBorders>' +
    ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
      .map((side) => `<w:${side} ${border}/>`)
      .join('') +
    '</w:tblBorders>'
  const cellMargin =
    '<w:tblCellMar>' +
    ['top', 'left', 'bottom', 'right']
      .map((side) => `<w:${side} w:w="80" w:type="dxa"/>`)
      .join('') +
    '</w:tblCellMar>'
  const grid = `<w:tblGrid>${'<w:gridCol/>'.repeat(table.header.length)}</w:tblGrid>`

  const alignFor = (col: number): string => {
    const align = table.align[col]
    return align === 'center' || align === 'right' ? `<w:jc w:val="${align}"/>` : ''
  }
  const cell = (runs: string, col: number): string =>
    `<w:tc><w:tcPr/>${paragraph(runs, alignFor(col))}</w:tc>`

  const headerRow =
    '<w:tr>' +
    table.header
      .map((c, i) => cell(inlineTokensToRuns(c.tokens, { bold: true }, ctx), i))
      .join('') +
    '</w:tr>'
  const bodyRows = table.rows
    .map(
      (row) =>
        '<w:tr>' +
        row.map((c, i) => cell(inlineTokensToRuns(c.tokens, {}, ctx), i)).join('') +
        '</w:tr>'
    )
    .join('')

  // Trailing empty paragraph keeps adjacent tables/blocks from merging
  return `<w:tbl><w:tblPr><w:tblW w:w="0" w:type="auto"/>${borders}${cellMargin}</w:tblPr>${grid}${headerRow}${bodyRows}</w:tbl><w:p/>`
}

function blockTokensToXml(tokens: Token[], ctx: DocxContext, options: BlockOptions): string {
  const blocks: string[] = []
  for (const token of tokens) {
    switch (token.type) {
      case 'heading': {
        const heading = token as Tokens.Heading
        const level = Math.min(heading.depth, 6)
        blocks.push(
          paragraph(
            inlineTokensToRuns(heading.tokens, {}, ctx),
            `<w:pStyle w:val="Heading${level}"/>`
          )
        )
        break
      }
      case 'paragraph': {
        const style = options.paragraphStyle ? `<w:pStyle w:val="${options.paragraphStyle}"/>` : ''
        blocks.push(
          paragraph(inlineTokensToRuns((token as Tokens.Paragraph).tokens, {}, ctx), style)
        )
        break
      }
      case 'list':
        blocks.push(listToXml(token as Tokens.List, 0, ctx))
        break
      case 'code': {
        const lines = (token as Tokens.Code).text.split('\n')
        blocks.push(
          lines
            .map((line) => paragraph(textRun(line, {}), '<w:pStyle w:val="CodeBlock"/>'))
            .join('')
        )
        break
      }
      case 'blockquote':
        blocks.push(
          blockTokensToXml((token as Tokens.Blockquote).tokens, ctx, { paragraphStyle: 'Quote' })
        )
        break
      case 'table':
        blocks.push(tableToXml(token as Tokens.Table, ctx))
        break
      case 'hr':
        blocks.push(
          paragraph(
            '',
            '<w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="999999"/></w:pBdr>'
          )
        )
        break
      case 'space':
      case 'html':
        break
      default:
        if ('tokens' in token && Array.isArray((token as { tokens?: Token[] }).tokens)) {
          blocks.push(
            paragraph(inlineTokensToRuns((token as { tokens: Token[] }).tokens, {}, ctx), '')
          )
        }
    }
  }
  return blocks.join('')
}

function stylesXml(): string {
  const headingStyles = HEADING_SIZES.map(
    (size, i) =>
      `<w:style w:type="paragraph" w:styleId="Heading${i + 1}">` +
      `<w:name w:val="heading ${i + 1}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>` +
      `<w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="${i}"/></w:pPr>` +
      `<w:rPr><w:b/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr>` +
      '</w:style>'
  ).join('')

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/>' +
    '<w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr>' +
    '<w:rPr><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>' +
    headingStyles +
    '<w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/>' +
    '<w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:contextualSpacing/></w:pPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/>' +
    '<w:pPr><w:ind w:left="720"/><w:pBdr><w:left w:val="single" w:sz="12" w:space="8" w:color="CCCCCC"/></w:pBdr></w:pPr>' +
    '<w:rPr><w:color w:val="555555"/></w:rPr></w:style>' +
    '<w:style w:type="paragraph" w:styleId="CodeBlock"><w:name w:val="Code Block"/><w:basedOn w:val="Normal"/>' +
    '<w:pPr><w:spacing w:after="0"/><w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/></w:pPr>' +
    '<w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New"/><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:style>' +
    '<w:style w:type="character" w:styleId="CodeChar"><w:name w:val="Code Char"/>' +
    '<w:rPr><w:rFonts w:ascii="Courier New" w:hAnsi="Courier New" w:cs="Courier New"/><w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/></w:rPr></w:style>' +
    '<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/>' +
    '<w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>' +
    '</w:styles>'
  )
}

function numberingXml(orderedListStarts: number[]): string {
  const bulletChars = ['•', '◦', '▪']
  const levels = (ordered: boolean): string =>
    Array.from({ length: 9 }, (_, lvl) => {
      const indent = `<w:pPr><w:ind w:left="${720 * (lvl + 1)}" w:hanging="360"/></w:pPr>`
      return ordered
        ? `<w:lvl w:ilvl="${lvl}"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%${lvl + 1}."/><w:lvlJc w:val="left"/>${indent}</w:lvl>`
        : `<w:lvl w:ilvl="${lvl}"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="${bulletChars[lvl % 3]}"/><w:lvlJc w:val="left"/>${indent}</w:lvl>`
    }).join('')

  const orderedNums = orderedListStarts
    .map((start, i) => {
      const overrides = Array.from(
        { length: 9 },
        (_, lvl) =>
          `<w:lvlOverride w:ilvl="${lvl}"><w:startOverride w:val="${start}"/></w:lvlOverride>`
      ).join('')
      return `<w:num w:numId="${FIRST_ORDERED_NUM_ID + i}"><w:abstractNumId w:val="1"/>${overrides}</w:num>`
    })
    .join('')

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
    `<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${levels(false)}</w:abstractNum>` +
    `<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${levels(true)}</w:abstractNum>` +
    `<w:num w:numId="${BULLET_NUM_ID}"><w:abstractNumId w:val="0"/></w:num>` +
    orderedNums +
    '</w:numbering>'
  )
}

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
  '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
  '<Default Extension="xml" ContentType="application/xml"/>' +
  '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
  '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
  '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
  '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
  '</Types>'

const ROOT_RELS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
  '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
  '</Relationships>'

function documentRelsXml(hyperlinks: string[]): string {
  const linkRels = hyperlinks
    .map(
      (href, i) =>
        `<Relationship Id="rId${10 + i}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${escapeXml(href)}" TargetMode="External"/>`
    )
    .join('')
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>' +
    linkRels +
    '</Relationships>'
  )
}

function coreXml(title: string): string {
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">' +
    `<dc:title>${escapeXml(title)}</dc:title>` +
    '</cp:coreProperties>'
  )
}

/** Convert markdown (with optional frontmatter) to a .docx file. */
export function markdownToDocx(markdown: string, title: string): Uint8Array {
  const body = stripFrontmatter(markdown)
  const tokens = marked.lexer(body)
  const ctx: DocxContext = { hyperlinks: [], orderedListStarts: [] }
  const content = blockTokensToXml(tokens, ctx, {})

  const sectPr =
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
    '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>'

  const documentXml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<w:body>${content}${sectPr}</w:body></w:document>`

  return buildZip([
    { name: '[Content_Types].xml', data: CONTENT_TYPES },
    { name: '_rels/.rels', data: ROOT_RELS },
    { name: 'word/document.xml', data: documentXml },
    { name: 'word/_rels/document.xml.rels', data: documentRelsXml(ctx.hyperlinks) },
    { name: 'word/styles.xml', data: stylesXml() },
    { name: 'word/numbering.xml', data: numberingXml(ctx.orderedListStarts) },
    { name: 'docProps/core.xml', data: coreXml(title) }
  ])
}
