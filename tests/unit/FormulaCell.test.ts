import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/svelte'
import FormulaCell from '@renderer/components/table/cells/FormulaCell.svelte'
import { EXACT_NUMBER_KEY } from '../../src/shared/exact-number'
import type {
  CollectionColumn,
  ComputedFieldDiagnostic,
  FormulaResultType,
  FieldType,
  JsonValue
} from '@renderer/types/cli'

function column(
  resultType: FormulaResultType | null,
  fieldType: FieldType = 'Formula'
): CollectionColumn {
  return {
    name: 'total',
    field_type: fieldType,
    description: null,
    occurrence_count: 1,
    sample_values: [],
    allowed_values: null,
    required: false,
    in_schema: true,
    relation_target: null,
    formula: 'price * quantity',
    result_type: resultType
  }
}

function renderCell(
  value: JsonValue | undefined,
  resultType: FormulaResultType,
  computedError?: ComputedFieldDiagnostic,
  fieldType: FieldType = 'Formula'
) {
  return render(FormulaCell, {
    props: {
      column: column(resultType, fieldType),
      value,
      computedError,
      editing: false,
      readOnly: true,
      oncommit: () => {},
      oncancel: () => {}
    }
  })
}

describe('FormulaCell', () => {
  it('renders a read-only number with an fx marker', () => {
    renderCell(19.95, 'Number')
    expect(screen.getByText('ƒx')).toBeTruthy()
    expect(screen.getByText('19.95')).toBeTruthy()
  })

  it('renders an exact decimal marker as its original number token', () => {
    renderCell({ [EXACT_NUMBER_KEY]: '12345678901234567890.12345678' }, 'Number')

    expect(screen.getByText('12345678901234567890.12345678')).toBeTruthy()
    expect(screen.queryByText(EXACT_NUMBER_KEY)).toBeNull()
  })

  it('renders booleans and lists according to the declared result type', () => {
    const boolean = renderCell(true, 'Boolean')
    expect(screen.getByLabelText('True')).toBeTruthy()
    boolean.unmount()

    renderCell(['priority', 'review'], 'List')
    expect(screen.getByText('priority')).toBeTruthy()
    expect(screen.getByText('review')).toBeTruthy()
  })

  it('syntax-highlights JSON formula results', () => {
    const { container } = renderCell({ total: 12, paid: false }, 'Json')

    expect(container.querySelector('.key')?.textContent).toBe('"total"')
    expect(container.querySelector('.number')?.textContent).toBe('12')
    expect(container.querySelector('.boolean')?.textContent).toBe('false')
  })

  it('surfaces a CLI diagnostic instead of a stale value', () => {
    renderCell(undefined, 'Number', {
      module: 'formula',
      field: 'total',
      code: 'division_by_zero',
      message: 'Division by zero',
      span_start: 6,
      span_end: 7
    })

    expect(screen.getByLabelText('Formula error: Division by zero')).toBeTruthy()
    expect(screen.getByText('division_by_zero')).toBeTruthy()
  })

  it('renders shape-preserving Lookup values and Rollup markers', () => {
    const lookup = renderCell(['example.com', 'example.org'], 'Json', undefined, 'Lookup')
    const lookupMarker = screen.getByText('arrow_outward')
    expect(lookupMarker.classList.contains('lookup')).toBe(true)
    expect(lookupMarker.classList.contains('material-symbols-outlined')).toBe(true)
    expect(screen.getByText('example.com')).toBeTruthy()
    lookup.unmount()

    renderCell(42, 'Number', undefined, 'Rollup')
    const rollupMarker = screen.getByText('Σ')
    expect(rollupMarker.classList.contains('lookup')).toBe(false)
    expect(screen.getByText('42')).toBeTruthy()
  })
})
