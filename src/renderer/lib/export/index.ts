/**
 * File > Save a Copy… / Export ▸ — entry point wired to the native menu.
 *
 * Reads the live buffer of the focused document tab (both editors sync
 * `tab.content` on every change), converts in the renderer, and hands the
 * result to main for the native save dialog + write. PDF is the exception:
 * the renderer builds the standalone HTML and main prints it via a hidden
 * window (`export:pdf`).
 */

import { get } from 'svelte/store'
import { workspace } from '../../stores/workspace.svelte'
import { activeCollection } from '../../stores/collections'
import { buildStandaloneHtml } from './html'
import { markdownToPlainText } from './text'
import { markdownToRtf } from './rtf'
import { markdownToDocx } from './docx'
import { markdownToOdt } from './odt'
import { markdownToEpub } from './epub'

export type ExportFormat = 'markdown' | 'html' | 'pdf' | 'text' | 'rtf' | 'docx' | 'odt' | 'epub'

interface ExportSpec {
  extension: string
  filterName: string
  convert: (markdown: string, title: string, collectionRoot?: string) => string | Uint8Array
}

const EXPORT_SPECS: Record<Exclude<ExportFormat, 'pdf'>, ExportSpec> = {
  // Save a Copy: the raw buffer IS the markdown — frontmatter included
  markdown: { extension: 'md', filterName: 'Markdown', convert: (md) => md },
  html: {
    extension: 'html',
    filterName: 'HTML',
    convert: (md, title, root) => buildStandaloneHtml(title, md, { collectionRoot: root })
  },
  text: { extension: 'txt', filterName: 'Plain Text', convert: (md) => markdownToPlainText(md) },
  rtf: { extension: 'rtf', filterName: 'Rich Text Format', convert: (md) => markdownToRtf(md) },
  docx: {
    extension: 'docx',
    filterName: 'Word Document',
    convert: (md, title) => markdownToDocx(md, title)
  },
  odt: {
    extension: 'odt',
    filterName: 'OpenDocument Text',
    convert: (md) => markdownToOdt(md)
  },
  epub: {
    extension: 'epub',
    filterName: 'EPUB',
    convert: (md, title) =>
      markdownToEpub(md, title, {
        identifier: `urn:uuid:${crypto.randomUUID()}`,
        modified: new Date().toISOString()
      })
  }
}

/**
 * Export the focused document tab in the given format.
 * Silent no-op when the focused tab is not a document with loaded content
 * (menu items stay enabled; the renderer guards).
 */
export async function exportActiveDocument(format: ExportFormat): Promise<void> {
  const tab = workspace.focusedDocumentTab
  if (!tab || tab.content === null) return

  const markdown = tab.content
  const baseName = tab.title.replace(/\.md$/i, '') || 'Untitled'
  const collectionRoot = get(activeCollection)?.path

  try {
    if (format === 'pdf') {
      const html = buildStandaloneHtml(baseName, markdown, { collectionRoot })
      await window.api.exportPdf({ defaultName: `${baseName}.pdf`, html })
      return
    }

    const spec = EXPORT_SPECS[format]
    const content = spec.convert(markdown, baseName, collectionRoot)
    await window.api.exportSave({
      defaultName: `${baseName}.${spec.extension}`,
      content,
      filters: [{ name: spec.filterName, extensions: [spec.extension] }]
    })
  } catch (err) {
    await window.api.showMessage({
      title: 'Export Failed',
      message: err instanceof Error ? err.message : String(err),
      type: 'error'
    })
  }
}
