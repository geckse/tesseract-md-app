import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'

// Mock window.api before importing components (the cell pulls in workspace +
// picker, which reach for window.api on interaction).
const mockApi = {
  collection: vi.fn().mockResolvedValue({ rows: [], columns: [], total_rows: 0 }),
  search: vi.fn().mockResolvedValue({ results: [] }),
  tree: vi.fn().mockResolvedValue({ root: { name: '.', path: '.', is_dir: true, children: [] } }),
  listRecents: vi.fn().mockResolvedValue([]),
  onFileSavedExternally: vi.fn()
}
Object.defineProperty(window, 'api', { value: mockApi, writable: true })

import RelationCell from '@renderer/components/table/cells/RelationCell.svelte'
import type { CollectionColumn, JsonValue, RelationValue } from '@renderer/types/cli'

function col(overrides: Partial<CollectionColumn> = {}): CollectionColumn {
  return {
    name: 'client',
    field_type: 'Relation',
    description: null,
    occurrence_count: 1,
    sample_values: [],
    allowed_values: null,
    required: false,
    in_schema: true,
    relation_target: 'clients',
    ...overrides
  }
}

function rel(raw: string, overrides: Partial<RelationValue> = {}): RelationValue {
  return {
    raw,
    path: 'clients/acme.md',
    exists: true,
    title: 'Acme Corp',
    frontmatter: {},
    ...overrides
  }
}

function props(value: JsonValue | undefined, overrides: Record<string, unknown> = {}) {
  const oncommit = vi.fn()
  const oncancel = vi.fn()
  return {
    props: {
      column: col(),
      value,
      editing: false,
      readOnly: false,
      oncommit,
      oncancel,
      root: '/vault',
      collectionId: 'c1',
      ...overrides
    },
    oncommit,
    oncancel
  }
}

describe('RelationCell', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders an em-dash for empty values', () => {
    render(RelationCell, props(undefined).props)
    expect(screen.getByText('—')).toBeTruthy()
  })

  it('renders a resolved title chip for a single value', () => {
    render(RelationCell, props('[[clients/acme]]', { relations: [rel('[[clients/acme]]')] }).props)
    expect(screen.getByText('Acme Corp')).toBeTruthy()
  })

  it('renders N chips in source order with duplicates preserved', () => {
    const relations = [
      rel('[[clients/acme|A]]', { path: 'clients/acme.md', title: 'Acme Corp' }),
      rel('[[clients/globex]]', { path: 'clients/globex.md', title: 'Globex' })
    ]
    const { container } = render(
      RelationCell,
      props(['[[clients/acme|A]]', '[[clients/globex]]', '[[clients/acme|A]]'], { relations }).props
    )
    const chips = container.querySelectorAll('.rel-chip')
    expect(chips).toHaveLength(3)
    // Source order: acme, globex, acme (the duplicate falls back to a neutral
    // client parse once the single matching RelationValue is consumed).
    expect(chips[0].textContent).toContain('Acme Corp')
    expect(chips[1].textContent).toContain('Globex')
    expect(chips[2].textContent).toContain('A')
  })

  it('renders a NEUTRAL chip when raw does not match any RelationValue (optimistic window)', () => {
    const { container } = render(
      RelationCell,
      props('[[clients/globex]]', { relations: [rel('[[clients/acme]]')] }).props
    )
    const chip = container.querySelector('.rel-chip')
    expect(chip?.classList.contains('neutral')).toBe(true)
    expect(chip?.classList.contains('broken')).toBe(false)
  })

  it('renders a broken chip for exists:false', () => {
    const { container } = render(
      RelationCell,
      props('[[clients/ghost]]', {
        relations: [
          rel('[[clients/ghost]]', {
            path: 'clients/ghost.md',
            exists: false,
            title: null,
            frontmatter: null
          })
        ]
      }).props
    )
    expect(container.querySelector('.rel-chip.broken')).not.toBeNull()
  })

  it('opens the picker in edit mode and commits [[path-sans-.md]] on pick', async () => {
    const p = props('', { editing: true })
    render(RelationCell, p.props)
    // The picker is rendered (scoped mode fetches the target folder once).
    expect(mockApi.collection).toHaveBeenCalledWith('/vault', 'clients', { recursive: true })

    // Simulate a pick via the picker's list — feed one row through the mock.
    mockApi.collection.mockResolvedValue({
      rows: [
        {
          path: 'clients/acme.md',
          title: 'Acme Corp',
          title_source: 'frontmatter',
          frontmatter: {},
          content_hash: 'h',
          file_size: 1,
          modified_at: 1,
          indexed_at: 1,
          state: 'indexed'
        }
      ],
      columns: [],
      total_rows: 1,
      offset: 0
    })
    // Re-render fresh so the picker sees the row.
    const p2 = props('', { editing: true })
    render(RelationCell, p2.props)
    const option = await screen.findByText('Acme Corp')
    await fireEvent.mouseDown(option)
    expect(p2.oncommit).toHaveBeenCalledWith('[[clients/acme]]')
  })

  it('multi-value edit commits the updated array on remove', async () => {
    const relations = [
      rel('[[clients/acme]]'),
      rel('[[clients/globex]]', { path: 'clients/globex.md', title: 'Globex' })
    ]
    const p = props(['[[clients/acme]]', '[[clients/globex]]'], { relations, editing: true })
    render(RelationCell, p.props)
    await fireEvent.mouseDown(screen.getByLabelText('Remove Acme Corp'))
    expect(p.oncommit).toHaveBeenCalledWith(['[[clients/globex]]'])
  })
})
