import { describe, it, expect } from 'vitest'
import { isValidUrl } from '../../src/renderer/lib/tiptap/url-validation'

describe('isValidUrl', () => {
  it('rejects javascript: protocol', () => {
    expect(isValidUrl('javascript:alert(1)')).toBe(false)
    expect(isValidUrl('JavaScript:alert(1)')).toBe(false)
    expect(isValidUrl('JAVASCRIPT:void(0)')).toBe(false)
  })

  it('rejects data: protocol', () => {
    expect(isValidUrl('data:text/html,<script>alert(1)</script>')).toBe(false)
    expect(isValidUrl('Data:text/html,...')).toBe(false)
  })

  it('rejects vbscript: protocol', () => {
    expect(isValidUrl('vbscript:MsgBox("XSS")')).toBe(false)
    expect(isValidUrl('VBScript:foo')).toBe(false)
  })

  it('allows https URLs', () => {
    expect(isValidUrl('https://example.com')).toBe(true)
    expect(isValidUrl('https://example.com/path?q=1')).toBe(true)
  })

  it('allows http URLs', () => {
    expect(isValidUrl('http://example.com')).toBe(true)
  })

  it('allows mailto URLs', () => {
    expect(isValidUrl('mailto:user@example.com')).toBe(true)
  })

  it('allows relative paths', () => {
    expect(isValidUrl('./image.png')).toBe(true)
    expect(isValidUrl('../docs/file.md')).toBe(true)
    expect(isValidUrl('/absolute/path.png')).toBe(true)
  })

  it('allows anchor links', () => {
    expect(isValidUrl('#anchor')).toBe(true)
    expect(isValidUrl('#section-2')).toBe(true)
  })

  it('allows bare filenames', () => {
    expect(isValidUrl('image.png')).toBe(true)
    expect(isValidUrl('example.com/path')).toBe(true)
  })

  it('rejects empty strings', () => {
    expect(isValidUrl('')).toBe(false)
    expect(isValidUrl('   ')).toBe(false)
  })
})
