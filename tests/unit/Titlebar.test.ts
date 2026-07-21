import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const source = readFileSync(
  resolve(__dirname, '../../src/renderer/components/Titlebar.svelte'),
  'utf8'
)

describe('Titlebar', () => {
  it('centers its controls without an asymmetric vertical inset', () => {
    const titlebarRule = source.match(/\.titlebar\s*\{(?<declarations>[\s\S]*?)\}/)?.groups
      ?.declarations

    expect(titlebarRule).toBeDefined()
    expect(titlebarRule).toMatch(/^\s*padding:\s*0 12px;\s*$/m)
  })
})
