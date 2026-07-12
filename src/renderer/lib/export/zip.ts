/**
 * Minimal ZIP writer for the container-based export formats (docx/odt/epub).
 *
 * All entries are STORED (method 0, no compression) — valid ZIP, and required
 * anyway for the `mimetype` entry that ODF and EPUB mandate as the first,
 * uncompressed entry. Hand-rolled (like the RTF exporter) to avoid a
 * dependency; exports are text documents where compression buys little.
 */

export interface ZipEntry {
  name: string
  data: Uint8Array | string
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    table[i] = c >>> 0
  }
  return table
})()

/** Standard CRC-32 (reflected, poly 0xEDB88320). */
export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

// Fixed DOS timestamp (2026-01-01 00:00) — deterministic output; the archive
// members' mtimes are irrelevant to Word/LibreOffice/EPUB readers.
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1
const DOS_TIME = 0

// General-purpose flag bit 11: entry names are UTF-8.
const FLAGS_UTF8 = 0x0800

/** Build a ZIP archive from entries, preserving their order. */
export function buildZip(entries: ZipEntry[]): Uint8Array {
  const encoder = new TextEncoder()
  const prepared = entries.map((entry) => {
    const data = typeof entry.data === 'string' ? encoder.encode(entry.data) : entry.data
    return { nameBytes: encoder.encode(entry.name), data, crc: crc32(data), offset: 0 }
  })

  const localSize = prepared.reduce((sum, e) => sum + 30 + e.nameBytes.length + e.data.length, 0)
  const centralSize = prepared.reduce((sum, e) => sum + 46 + e.nameBytes.length, 0)
  const out = new Uint8Array(localSize + centralSize + 22)
  const view = new DataView(out.buffer)
  let pos = 0

  const u16 = (value: number): void => {
    view.setUint16(pos, value, true)
    pos += 2
  }
  const u32 = (value: number): void => {
    view.setUint32(pos, value >>> 0, true)
    pos += 4
  }
  const bytes = (data: Uint8Array): void => {
    out.set(data, pos)
    pos += data.length
  }

  // Local file headers + data
  for (const entry of prepared) {
    entry.offset = pos
    u32(0x04034b50)
    u16(20) // version needed to extract
    u16(FLAGS_UTF8)
    u16(0) // method: STORED
    u16(DOS_TIME)
    u16(DOS_DATE)
    u32(entry.crc)
    u32(entry.data.length) // compressed size (= uncompressed for STORED)
    u32(entry.data.length)
    u16(entry.nameBytes.length)
    u16(0) // extra field length
    bytes(entry.nameBytes)
    bytes(entry.data)
  }

  // Central directory
  const centralOffset = pos
  for (const entry of prepared) {
    u32(0x02014b50)
    u16(20) // version made by
    u16(20) // version needed
    u16(FLAGS_UTF8)
    u16(0)
    u16(DOS_TIME)
    u16(DOS_DATE)
    u32(entry.crc)
    u32(entry.data.length)
    u32(entry.data.length)
    u16(entry.nameBytes.length)
    u16(0) // extra
    u16(0) // comment
    u16(0) // disk number start
    u16(0) // internal attributes
    u32(0) // external attributes
    u32(entry.offset)
    bytes(entry.nameBytes)
  }

  // End of central directory
  u32(0x06054b50)
  u16(0) // disk number
  u16(0) // disk with central directory
  u16(prepared.length)
  u16(prepared.length)
  u32(centralSize)
  u32(centralOffset)
  u16(0) // comment length

  return out
}
