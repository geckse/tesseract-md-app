/**
 * Markdown → OpenDocument Text (.odt) conversion for File > Export >
 * OpenDocument — LibreOffice's native format.
 *
 * Hand-built ODF 1.2 (content.xml + styles.xml + manifest) from the marked
 * lexer token stream, packaged with the STORED-zip writer. The `mimetype`
 * entry is first and uncompressed as the ODF spec requires. Fidelity limits
 * (phase-43 PRD): images become italic `[image: alt]` placeholders and raw
 * HTML is dropped (same policy as the RTF/plain-text exporters).
 */

import { marked, type Token, type Tokens } from 'marked'
import { stripFrontmatter } from '../markdown-structure'
import { buildZip } from './zip'

export const ODT_MIMETYPE = 'application/vnd.oasis.opendocument.text'

/** Point sizes for H1–H6 (half of the RTF/docx half-point scale). */
const HEADING_SIZES_PT = [24, 20, 17, 15, 14, 13]

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

/**
 * Encode text for a preformatted paragraph: ODF collapses consecutive and
 * leading spaces, so space runs become `<text:s text:c="…"/>` and tabs
 * become `<text:tab/>`.
 */
export function odtPreservedText(text: string): string {
  let out = ''
  let i = 0
  while (i < text.length) {
    const ch = text[i]
    if (ch === '\t') {
      out += '<text:tab/>'
      i++
    } else if (ch === ' ') {
      let j = i
      while (j < text.length && text[j] === ' ') j++
      const count = j - i
      if (i === 0) {
        out += `<text:s text:c="${count}"/>`
      } else if (count > 1) {
        out += ` <text:s text:c="${count - 1}"/>`
      } else {
        out += ' '
      }
      i = j
    } else {
      let j = i
      while (j < text.length && text[j] !== ' ' && text[j] !== '\t') j++
      out += escapeXml(text.slice(i, j))
      i = j
    }
  }
  return out
}

function span(styleName: string, inner: string): string {
  return `<text:span text:style-name="${styleName}">${inner}</text:span>`
}

function inlineTokensToOdt(tokens: Token[] | undefined): string {
  if (!tokens) return ''
  let out = ''
  for (const token of tokens) {
    switch (token.type) {
      case 'text': {
        const t = token as Tokens.Text
        out +=
          t.tokens && t.tokens.length > 0
            ? inlineTokensToOdt(t.tokens)
            : escapeXml(unescapeEntities(t.text).replace(/\n/g, ' '))
        break
      }
      case 'escape':
        out += escapeXml((token as Tokens.Escape).text)
        break
      case 'strong':
        out += span('TBold', inlineTokensToOdt((token as Tokens.Strong).tokens))
        break
      case 'em':
        out += span('TItalic', inlineTokensToOdt((token as Tokens.Em).tokens))
        break
      case 'del':
        out += span('TStrike', inlineTokensToOdt((token as Tokens.Del).tokens))
        break
      case 'codespan':
        out += span('TCode', escapeXml(unescapeEntities((token as Tokens.Codespan).text)))
        break
      case 'link': {
        const link = token as Tokens.Link
        const inner = inlineTokensToOdt(link.tokens)
        // In-document anchors add no information in a flat ODT
        out += link.href.startsWith('#')
          ? inner
          : `<text:a xlink:type="simple" xlink:href="${escapeXml(link.href)}">${inner}</text:a>`
        break
      }
      case 'image': {
        const img = token as Tokens.Image
        if (img.text) out += span('TItalic', escapeXml(`[image: ${img.text}]`))
        break
      }
      case 'br':
        out += '<text:line-break/>'
        break
      case 'html':
        break
      default:
        if ('text' in token && typeof (token as { text?: unknown }).text === 'string') {
          out += escapeXml(unescapeEntities((token as { text: string }).text))
        }
    }
  }
  return out
}

interface OdtContext {
  tableCount: number
}

function listToOdt(list: Tokens.List, ctx: OdtContext): string {
  const styleName = list.ordered ? 'LNum' : 'LBul'
  const start = typeof list.start === 'number' && list.start > 0 ? list.start : 1
  const items = list.items
    .map((item, index) => {
      const task = item.task ? (item.checked ? '☑ ' : '☐ ') : ''
      const inlineParts: string[] = []
      const nestedParts: string[] = []
      for (const child of item.tokens) {
        if (child.type === 'list') {
          nestedParts.push(listToOdt(child as Tokens.List, ctx))
        } else if (child.type === 'text' || child.type === 'paragraph') {
          inlineParts.push(inlineTokensToOdt((child as Tokens.Text).tokens ?? [child]))
        } else {
          nestedParts.push(blockTokensToOdt([child], ctx, {}))
        }
      }
      const startAttr =
        list.ordered && index === 0 && start !== 1 ? ` text:start-value="${start}"` : ''
      return (
        `<text:list-item${startAttr}>` +
        `<text:p text:style-name="Standard">${escapeXml(task)}${inlineParts.join(' ')}</text:p>` +
        nestedParts.join('') +
        '</text:list-item>'
      )
    })
    .join('')
  return `<text:list text:style-name="${styleName}">${items}</text:list>`
}

function tableToOdt(table: Tokens.Table, ctx: OdtContext): string {
  ctx.tableCount++
  const name = `Table${ctx.tableCount}`
  const cols = table.header.length
  const cell = (inner: string, styleName: string): string =>
    `<table:table-cell table:style-name="TCell" office:value-type="string">` +
    `<text:p text:style-name="${styleName}">${inner}</text:p></table:table-cell>`

  const headerRow =
    '<table:table-row>' +
    table.header.map((c) => cell(inlineTokensToOdt(c.tokens), 'Table_20_Heading')).join('') +
    '</table:table-row>'
  const bodyRows = table.rows
    .map(
      (row) =>
        '<table:table-row>' +
        row.map((c) => cell(inlineTokensToOdt(c.tokens), 'Table_20_Contents')).join('') +
        '</table:table-row>'
    )
    .join('')

  return (
    `<table:table table:name="${name}">` +
    `<table:table-column table:number-columns-repeated="${cols}"/>` +
    headerRow +
    bodyRows +
    '</table:table>'
  )
}

interface OdtBlockOptions {
  /** Paragraph style for plain paragraphs (e.g. Quotations inside quotes). */
  paragraphStyle?: string
}

function blockTokensToOdt(tokens: Token[], ctx: OdtContext, options: OdtBlockOptions): string {
  const blocks: string[] = []
  for (const token of tokens) {
    switch (token.type) {
      case 'heading': {
        const heading = token as Tokens.Heading
        const level = Math.min(heading.depth, 6)
        blocks.push(
          `<text:h text:style-name="Heading_20_${level}" text:outline-level="${level}">` +
            inlineTokensToOdt(heading.tokens) +
            '</text:h>'
        )
        break
      }
      case 'paragraph': {
        const style = options.paragraphStyle ?? 'Standard'
        blocks.push(
          `<text:p text:style-name="${style}">${inlineTokensToOdt((token as Tokens.Paragraph).tokens)}</text:p>`
        )
        break
      }
      case 'list':
        blocks.push(listToOdt(token as Tokens.List, ctx))
        break
      case 'code': {
        const lines = (token as Tokens.Code).text.split('\n')
        blocks.push(
          lines
            .map(
              (line) =>
                `<text:p text:style-name="Preformatted_20_Text">${odtPreservedText(line)}</text:p>`
            )
            .join('')
        )
        break
      }
      case 'blockquote':
        blocks.push(
          blockTokensToOdt((token as Tokens.Blockquote).tokens, ctx, {
            paragraphStyle: 'Quotations'
          })
        )
        break
      case 'table':
        blocks.push(tableToOdt(token as Tokens.Table, ctx))
        break
      case 'hr':
        blocks.push('<text:p text:style-name="Horizontal_20_Line"/>')
        break
      case 'space':
      case 'html':
        break
      default:
        if ('tokens' in token && Array.isArray((token as { tokens?: Token[] }).tokens)) {
          blocks.push(
            `<text:p text:style-name="Standard">${inlineTokensToOdt((token as { tokens: Token[] }).tokens)}</text:p>`
          )
        }
    }
  }
  return blocks.join('')
}

const OFFICE_NS =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" ' +
  'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" ' +
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" ' +
  'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" ' +
  'xmlns:xlink="http://www.w3.org/1999/xlink"'

function stylesXml(): string {
  const headings = HEADING_SIZES_PT.map(
    (size, i) =>
      `<style:style style:name="Heading_20_${i + 1}" style:display-name="Heading ${i + 1}" ` +
      'style:family="paragraph" style:parent-style-name="Standard" style:next-style-name="Standard" ' +
      `style:default-outline-level="${i + 1}">` +
      '<style:paragraph-properties fo:margin-top="0.15in" fo:margin-bottom="0.08in" fo:keep-with-next="always"/>' +
      `<style:text-properties fo:font-size="${size}pt" fo:font-weight="bold"/></style:style>`
  ).join('')

  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<office:document-styles ${OFFICE_NS} office:version="1.2">` +
    '<office:styles>' +
    '<style:style style:name="Standard" style:family="paragraph">' +
    '<style:paragraph-properties fo:margin-bottom="0.08in"/>' +
    '<style:text-properties fo:font-size="12pt"/></style:style>' +
    headings +
    '<style:style style:name="Preformatted_20_Text" style:display-name="Preformatted Text" ' +
    'style:family="paragraph" style:parent-style-name="Standard">' +
    '<style:paragraph-properties fo:margin-bottom="0in" fo:background-color="#f2f2f2"/>' +
    '<style:text-properties fo:font-family="\'Courier New\'" fo:font-size="10pt"/></style:style>' +
    '<style:style style:name="Quotations" style:family="paragraph" style:parent-style-name="Standard">' +
    '<style:paragraph-properties fo:margin-left="0.25in" fo:padding-left="0.1in" ' +
    'fo:border-left="2pt solid #cccccc"/>' +
    '<style:text-properties fo:color="#555555"/></style:style>' +
    '<style:style style:name="Horizontal_20_Line" style:display-name="Horizontal Line" ' +
    'style:family="paragraph" style:parent-style-name="Standard">' +
    '<style:paragraph-properties fo:margin-top="0.08in" fo:margin-bottom="0.08in" ' +
    'fo:border-bottom="1pt solid #999999"/></style:style>' +
    '<style:style style:name="Table_20_Contents" style:display-name="Table Contents" ' +
    'style:family="paragraph" style:parent-style-name="Standard">' +
    '<style:paragraph-properties fo:margin-bottom="0in"/></style:style>' +
    '<style:style style:name="Table_20_Heading" style:display-name="Table Heading" ' +
    'style:family="paragraph" style:parent-style-name="Table_20_Contents">' +
    '<style:text-properties fo:font-weight="bold"/></style:style>' +
    '</office:styles>' +
    '</office:document-styles>'
  )
}

function contentAutomaticStyles(): string {
  const bulletChars = ['•', '◦', '▪']
  const bulletLevels = Array.from({ length: 9 }, (_, i) => {
    const indent = (0.25 * (i + 1)).toFixed(2)
    return (
      `<text:list-level-style-bullet text:level="${i + 1}" text:bullet-char="${bulletChars[i % 3]}">` +
      `<style:list-level-properties text:space-before="${indent}in" text:min-label-width="0.2in"/>` +
      '</text:list-level-style-bullet>'
    )
  }).join('')
  const numberLevels = Array.from({ length: 9 }, (_, i) => {
    const indent = (0.25 * (i + 1)).toFixed(2)
    return (
      `<text:list-level-style-number text:level="${i + 1}" style:num-format="1" style:num-suffix=".">` +
      `<style:list-level-properties text:space-before="${indent}in" text:min-label-width="0.25in"/>` +
      '</text:list-level-style-number>'
    )
  }).join('')

  return (
    '<office:automatic-styles>' +
    '<style:style style:name="TBold" style:family="text">' +
    '<style:text-properties fo:font-weight="bold"/></style:style>' +
    '<style:style style:name="TItalic" style:family="text">' +
    '<style:text-properties fo:font-style="italic"/></style:style>' +
    '<style:style style:name="TStrike" style:family="text">' +
    '<style:text-properties style:text-line-through-style="solid"/></style:style>' +
    '<style:style style:name="TCode" style:family="text">' +
    '<style:text-properties fo:font-family="\'Courier New\'" fo:background-color="#f2f2f2"/></style:style>' +
    '<style:style style:name="TCell" style:family="table-cell">' +
    '<style:table-cell-properties fo:border="0.5pt solid #999999" fo:padding="0.05in"/></style:style>' +
    `<text:list-style style:name="LBul">${bulletLevels}</text:list-style>` +
    `<text:list-style style:name="LNum">${numberLevels}</text:list-style>` +
    '</office:automatic-styles>'
  )
}

const MANIFEST =
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">' +
  `<manifest:file-entry manifest:full-path="/" manifest:media-type="${ODT_MIMETYPE}"/>` +
  '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>' +
  '<manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>' +
  '</manifest:manifest>'

/** Convert markdown (with optional frontmatter) to an .odt file. */
export function markdownToOdt(markdown: string): Uint8Array {
  const body = stripFrontmatter(markdown)
  const tokens = marked.lexer(body)
  const ctx: OdtContext = { tableCount: 0 }
  const content = blockTokensToOdt(tokens, ctx, {})

  const contentXml =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    `<office:document-content ${OFFICE_NS} office:version="1.2">` +
    contentAutomaticStyles() +
    `<office:body><office:text>${content}</office:text></office:body>` +
    '</office:document-content>'

  // The ODF spec requires `mimetype` first and uncompressed (all entries are
  // STORED here, so ordering is the only constraint).
  return buildZip([
    { name: 'mimetype', data: ODT_MIMETYPE },
    { name: 'META-INF/manifest.xml', data: MANIFEST },
    { name: 'content.xml', data: contentXml },
    { name: 'styles.xml', data: stylesXml() }
  ])
}
