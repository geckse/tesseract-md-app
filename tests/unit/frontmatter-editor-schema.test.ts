import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/svelte'

// Mock window.api before importing anything
const mockApi = {
  listCollections: vi.fn(),
  getActiveCollection: vi.fn(),
  addCollection: vi.fn(),
  removeCollection: vi.fn(),
  setActiveCollection: vi.fn(),
  status: vi.fn(),
  renameFile: vi.fn(),
}

Object.defineProperty(globalThis, 'window', {
  value: { api: mockApi },
  writable: true,
})

import DocumentHeader from '@renderer/components/wysiwyg/DocumentHeader.svelte'
import type { Schema, SchemaField } from '../../src/renderer/types/cli'

function makeSchemaField(overrides: Partial<SchemaField> & { name: string }): SchemaField {
  return {
    field_type: 'String',
    description: null,
    occurrence_count: 1,
    sample_values: [],
    allowed_values: null,
    required: false,
    ...overrides,
  }
}

function makeSchema(fields: SchemaField[]): Schema {
  return { fields, last_updated: Date.now() }
}

const defaultProps = {
  filePath: 'docs/test.md',
  collectionPath: '/collections/test',
  onFileRenamed: vi.fn(),
}

describe('DocumentHeader schema integration', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('renders with null schema (no regression)', () => {
    const { container } = render(DocumentHeader, {
      props: {
        frontmatterYaml: 'title: Hello',
        onFrontmatterUpdate: vi.fn(),
        schema: null,
        ...defaultProps,
      },
    })

    // Should render the document header with properties
    expect(container.querySelector('.dh')).toBeTruthy()
    const keyInput = screen.getByDisplayValue('Hello')
    expect(keyInput).toBeTruthy()
  })

  it('renders <select> for fields with allowed_values', () => {
    const schema = makeSchema([
      makeSchemaField({
        name: 'status',
        allowed_values: ['draft', 'published', 'archived'],
      }),
    ])

    const { container } = render(DocumentHeader, {
      props: {
        frontmatterYaml: 'status: draft',
        onFrontmatterUpdate: vi.fn(),
        schema,
        ...defaultProps,
      },
    })

    const select = container.querySelector('select.pr-select') as HTMLSelectElement
    expect(select).toBeTruthy()
    expect(select.tagName).toBe('SELECT')

    const options = Array.from(select.querySelectorAll('option'))
    const optionValues = options.map((o) => o.value)
    expect(optionValues).toContain('draft')
    expect(optionValues).toContain('published')
    expect(optionValues).toContain('archived')
  })

  it('renders required indicator for required fields', () => {
    const schema = makeSchema([
      makeSchemaField({ name: 'title', required: true }),
    ])

    const { container } = render(DocumentHeader, {
      props: {
        frontmatterYaml: 'title: My Doc',
        onFrontmatterUpdate: vi.fn(),
        schema,
        ...defaultProps,
      },
    })

    const indicator = container.querySelector('.pr-required')
    expect(indicator).toBeTruthy()
    expect(indicator!.textContent).toBe('*')
  })

  it('sets title attribute from schema field description', () => {
    const schema = makeSchema([
      makeSchemaField({
        name: 'title',
        description: 'The document title',
      }),
    ])

    render(DocumentHeader, {
      props: {
        frontmatterYaml: 'title: Test',
        onFrontmatterUpdate: vi.fn(),
        schema,
        ...defaultProps,
      },
    })

    const keyInput = screen.getByLabelText('Property name')
    expect(keyInput.getAttribute('title')).toBe('The document title')
  })

  it('preserves current value in <select> when it matches allowed_values', () => {
    const schema = makeSchema([
      makeSchemaField({
        name: 'status',
        allowed_values: ['draft', 'published', 'archived'],
      }),
    ])

    const { container } = render(DocumentHeader, {
      props: {
        frontmatterYaml: 'status: published',
        onFrontmatterUpdate: vi.fn(),
        schema,
        ...defaultProps,
      },
    })

    const select = container.querySelector('select.pr-select') as HTMLSelectElement
    expect(select).toBeTruthy()

    const selectedOption = select.querySelector('option[selected]') as HTMLOptionElement
    expect(selectedOption).toBeTruthy()
    expect(selectedOption.value).toBe('published')
  })

  it('preserves current value in <select> even when not in allowed_values', () => {
    const schema = makeSchema([
      makeSchemaField({
        name: 'status',
        allowed_values: ['draft', 'published'],
      }),
    ])

    const { container } = render(DocumentHeader, {
      props: {
        frontmatterYaml: 'status: custom-value',
        onFrontmatterUpdate: vi.fn(),
        schema,
        ...defaultProps,
      },
    })

    const select = container.querySelector('select.pr-select') as HTMLSelectElement
    expect(select).toBeTruthy()

    const options = Array.from(select.querySelectorAll('option'))
    const optionValues = options.map((o) => o.value)
    expect(optionValues).toContain('custom-value')
  })

  it('does not render required indicator for non-required fields', () => {
    const schema = makeSchema([
      makeSchemaField({ name: 'tags', required: false }),
    ])

    const { container } = render(DocumentHeader, {
      props: {
        frontmatterYaml: 'tags: foo',
        onFrontmatterUpdate: vi.fn(),
        schema,
        ...defaultProps,
      },
    })

    const indicator = container.querySelector('.pr-required')
    expect(indicator).toBeFalsy()
  })

  it('renders text input (not select) when no allowed_values', () => {
    const schema = makeSchema([
      makeSchemaField({ name: 'author', allowed_values: null }),
    ])

    render(DocumentHeader, {
      props: {
        frontmatterYaml: 'author: Alice',
        onFrontmatterUpdate: vi.fn(),
        schema,
        ...defaultProps,
      },
    })

    expect(screen.getByDisplayValue('Alice')).toBeTruthy()
  })

  it('renders file name editor with correct name', () => {
    render(DocumentHeader, {
      props: {
        frontmatterYaml: null,
        onFrontmatterUpdate: vi.fn(),
        schema: null,
        ...defaultProps,
      },
    })

    // Should show filename without .md extension
    expect(screen.getByText('test')).toBeTruthy()
    // Should show .md extension
    expect(screen.getByText('.md')).toBeTruthy()
  })

  it('shows add property button', () => {
    render(DocumentHeader, {
      props: {
        frontmatterYaml: null,
        onFrontmatterUpdate: vi.fn(),
        schema: null,
        ...defaultProps,
      },
    })

    expect(screen.getByText('Add property')).toBeTruthy()
  })

  it('shows type icons for properties', () => {
    const { container } = render(DocumentHeader, {
      props: {
        frontmatterYaml: 'count: 42',
        onFrontmatterUpdate: vi.fn(),
        schema: null,
        ...defaultProps,
      },
    })

    // Number type icon should be present
    const typeIcon = container.querySelector('.pr-type-icon')
    expect(typeIcon).toBeTruthy()
  })

  it('detects date type correctly', () => {
    const { container } = render(DocumentHeader, {
      props: {
        frontmatterYaml: 'created: 2024-03-15',
        onFrontmatterUpdate: vi.fn(),
        schema: null,
        ...defaultProps,
      },
    })

    // Should render date picker button
    const calendarBtn = container.querySelector('[aria-label="Open date picker"]')
    expect(calendarBtn).toBeTruthy()
  })

  it('detects datetime type correctly', () => {
    const { container } = render(DocumentHeader, {
      props: {
        frontmatterYaml: 'updated: 2024-03-15T14:30',
        onFrontmatterUpdate: vi.fn(),
        schema: null,
        ...defaultProps,
      },
    })

    // Should render datetime picker button
    const datetimeBtn = container.querySelector('[aria-label="Open date time picker"]')
    expect(datetimeBtn).toBeTruthy()
  })

  it('detects URL type correctly', () => {
    const { container } = render(DocumentHeader, {
      props: {
        frontmatterYaml: 'website: https://example.com',
        onFrontmatterUpdate: vi.fn(),
        schema: null,
        ...defaultProps,
      },
    })

    // Should render open URL button
    const openBtn = container.querySelector('[aria-label="Open URL"]')
    expect(openBtn).toBeTruthy()
  })

  it('detects boolean type correctly', () => {
    const { container } = render(DocumentHeader, {
      props: {
        frontmatterYaml: 'published: true',
        onFrontmatterUpdate: vi.fn(),
        schema: null,
        ...defaultProps,
      },
    })

    // Should render toggle switch
    const toggle = container.querySelector('.pr-toggle')
    expect(toggle).toBeTruthy()
  })

  it('detects tags type correctly', () => {
    const { container } = render(DocumentHeader, {
      props: {
        frontmatterYaml: "tags:\n  - rust\n  - ai",
        onFrontmatterUpdate: vi.fn(),
        schema: null,
        ...defaultProps,
      },
    })

    // Should render tag pills
    const tags = container.querySelectorAll('.pr-tag')
    expect(tags.length).toBe(2)
  })
})
