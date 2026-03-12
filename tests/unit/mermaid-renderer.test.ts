import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock mermaid module — jsdom can't do real SVG rendering
vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn().mockResolvedValue({ svg: '<svg>mock diagram</svg>' })
  }
}))

import {
  initMermaid,
  renderMermaidDiagram,
  generateMermaidId,
  _resetForTesting
} from '@renderer/lib/mermaid-renderer'

beforeEach(() => {
  _resetForTesting()
  vi.clearAllMocks()
})

describe('initMermaid', () => {
  it('completes without error', async () => {
    await expect(initMermaid()).resolves.toBeUndefined()
  })

  it('only initializes once (idempotent)', async () => {
    const { default: mermaid } = await import('mermaid')
    await initMermaid()
    await initMermaid()
    expect(mermaid.initialize).toHaveBeenCalledTimes(1)
  })
})

describe('generateMermaidId', () => {
  it('produces unique IDs', () => {
    const id1 = generateMermaidId()
    const id2 = generateMermaidId()
    expect(id1).not.toBe(id2)
    expect(id1).toMatch(/^mermaid-diagram-\d+$/)
  })
})

describe('renderMermaidDiagram', () => {
  it('returns svg for valid input', async () => {
    const result = await renderMermaidDiagram('test-1', 'graph TD\n    A --> B')
    expect(result).toEqual({ svg: '<svg>mock diagram</svg>' })
  })

  it('returns error for empty code', async () => {
    const result = await renderMermaidDiagram('test-2', '')
    expect(result).toEqual({ error: 'Empty diagram' })
  })

  it('returns error for whitespace-only code', async () => {
    const result = await renderMermaidDiagram('test-3', '   \n  ')
    expect(result).toEqual({ error: 'Empty diagram' })
  })

  it('returns error for oversized code (>50KB)', async () => {
    const bigCode = 'a'.repeat(51 * 1024)
    const result = await renderMermaidDiagram('test-4', bigCode)
    expect(result).toEqual({ error: 'Diagram code too large' })
  })

  it('returns error when mermaid.render throws', async () => {
    const { default: mermaid } = await import('mermaid')
    vi.mocked(mermaid.render).mockRejectedValueOnce(new Error('Parse error at line 1'))
    const result = await renderMermaidDiagram('test-5', 'invalid syntax!!!')
    expect(result).toEqual({ error: 'Parse error at line 1' })
  })

  it('serializes concurrent calls (queue)', async () => {
    const callOrder: number[] = []
    const { default: mermaid } = await import('mermaid')

    vi.mocked(mermaid.render)
      .mockImplementationOnce(async () => {
        callOrder.push(1)
        await new Promise((r) => setTimeout(r, 10))
        return { svg: '<svg>first</svg>' }
      })
      .mockImplementationOnce(async () => {
        callOrder.push(2)
        return { svg: '<svg>second</svg>' }
      })

    const [r1, r2] = await Promise.all([
      renderMermaidDiagram('q1', 'graph TD\nA-->B'),
      renderMermaidDiagram('q2', 'graph TD\nC-->D')
    ])

    expect(r1).toEqual({ svg: '<svg>first</svg>' })
    expect(r2).toEqual({ svg: '<svg>second</svg>' })
    // First call should complete before second starts
    expect(callOrder).toEqual([1, 2])
  })
})
