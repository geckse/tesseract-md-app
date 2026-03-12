import { describe, it, expect } from 'vitest'
import { serializeMermaidBlock } from '@renderer/lib/tiptap/mermaid-block-extension'

describe('serializeMermaidBlock', () => {
  it('produces correct fenced code block format', () => {
    const code = 'graph TD\n    A --> B'
    const result = serializeMermaidBlock(code)
    expect(result).toBe('```mermaid\ngraph TD\n    A --> B\n```\n')
  })

  it('handles empty code', () => {
    const result = serializeMermaidBlock('')
    expect(result).toBe('```mermaid\n\n```\n')
  })

  it('preserves multi-line code with indentation', () => {
    const code = 'sequenceDiagram\n    Alice->>Bob: Hello\n    Bob-->>Alice: Hi'
    const result = serializeMermaidBlock(code)
    expect(result).toBe(
      '```mermaid\nsequenceDiagram\n    Alice->>Bob: Hello\n    Bob-->>Alice: Hi\n```\n'
    )
  })
})
