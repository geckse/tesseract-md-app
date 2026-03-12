import { describe, it, expect } from 'vitest'
import { slashCommandItems } from '@renderer/lib/tiptap/slash-command-extension'

describe('slashCommandItems', () => {
  it('has at least one item', () => {
    expect(slashCommandItems.length).toBeGreaterThan(0)
  })

  it('every item has label, icon, and command', () => {
    for (const item of slashCommandItems) {
      expect(item.label).toBeTruthy()
      expect(typeof item.label).toBe('string')
      expect(item.icon).toBeTruthy()
      expect(typeof item.icon).toBe('string')
      expect(typeof item.command).toBe('function')
    }
  })

  it('includes expected command types', () => {
    const labels = slashCommandItems.map((i) => i.label)
    expect(labels).toContain('Heading 1')
    expect(labels).toContain('Bullet List')
    expect(labels).toContain('Code Block')
    expect(labels).toContain('Table')
    expect(labels).toContain('Mermaid Diagram')
  })

  it('has unique labels', () => {
    const labels = slashCommandItems.map((i) => i.label)
    expect(new Set(labels).size).toBe(labels.length)
  })
})
