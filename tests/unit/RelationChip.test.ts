import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/svelte'
import RelationChip from '@renderer/components/RelationChip.svelte'
import type { RelationValue } from '@renderer/types/cli'

function rel(overrides: Partial<RelationValue> = {}): RelationValue {
  return {
    raw: '[[clients/acme]]',
    path: 'clients/acme.md',
    exists: true,
    title: 'Acme Corp',
    frontmatter: { title: 'Acme Corp' },
    ...overrides
  }
}

describe('RelationChip', () => {
  it('renders the server-resolved title for an existing target', () => {
    render(RelationChip, { props: { relation: rel(), raw: '[[clients/acme]]' } })
    expect(screen.getByText('Acme Corp')).toBeTruthy()
  })

  it('falls back to the path basename when the target has no title', () => {
    render(RelationChip, {
      props: { relation: rel({ title: null }), raw: '[[clients/acme]]' }
    })
    expect(screen.getByText('acme')).toBeTruthy()
  })

  it('navigates on click only for existing targets', async () => {
    const onnavigate = vi.fn()
    render(RelationChip, {
      props: { relation: rel(), raw: '[[clients/acme]]', onnavigate }
    })
    await fireEvent.click(screen.getByText('Acme Corp'))
    expect(onnavigate).toHaveBeenCalledWith('clients/acme.md')
  })

  it('renders broken refs with warning styling, a candidate-path tooltip, and no navigation', () => {
    const onnavigate = vi.fn()
    const { container } = render(RelationChip, {
      props: {
        relation: rel({ exists: false, title: null, frontmatter: null, path: 'clients/ghost.md' }),
        raw: '[[clients/ghost]]',
        onnavigate
      }
    })
    const chip = container.querySelector('.rel-chip')
    expect(chip?.classList.contains('broken')).toBe(true)
    expect(chip?.getAttribute('title')).toContain('clients/ghost.md')
    expect(container.querySelector('.rel-chip-link')).toBeNull()
    expect(screen.getByText('link_off')).toBeTruthy()
  })

  it('renders a NEUTRAL (not broken) chip from a client parse when no RelationValue is given', () => {
    const { container } = render(RelationChip, {
      props: { raw: '[[clients/acme|Acme Inc]]' }
    })
    const chip = container.querySelector('.rel-chip')
    expect(chip?.classList.contains('neutral')).toBe(true)
    expect(chip?.classList.contains('broken')).toBe(false)
    expect(screen.getByText('Acme Inc')).toBeTruthy()
    // Neutral chips never navigate (nothing is resolved).
    expect(container.querySelector('.rel-chip-link')).toBeNull()
  })

  it('renders a remove × when onremove is provided and fires it', async () => {
    const onremove = vi.fn()
    render(RelationChip, { props: { relation: rel(), raw: '[[clients/acme]]', onremove } })
    await fireEvent.mouseDown(screen.getByLabelText('Remove Acme Corp'))
    expect(onremove).toHaveBeenCalled()
  })

  it('renders a hover quick-open button that fires onopennewtab with the path', async () => {
    const onopennewtab = vi.fn()
    render(RelationChip, { props: { relation: rel(), raw: '[[clients/acme]]', onopennewtab } })
    await fireEvent.click(screen.getByLabelText('Open Acme Corp in new tab'))
    expect(onopennewtab).toHaveBeenCalledWith('clients/acme.md')
  })

  it('never renders the quick-open button for broken or neutral chips', () => {
    const onopennewtab = vi.fn()
    render(RelationChip, {
      props: {
        relation: rel({ exists: false, title: null, frontmatter: null }),
        raw: '[[clients/ghost]]',
        onopennewtab
      }
    })
    render(RelationChip, { props: { raw: '[[clients/acme]]', onopennewtab } })
    expect(screen.queryByTitle('Open in new tab')).toBeNull()
  })

  it('does not render the quick-open button when onopennewtab is absent', () => {
    render(RelationChip, { props: { relation: rel(), raw: '[[clients/acme]]' } })
    expect(screen.queryByTitle('Open in new tab')).toBeNull()
  })

  it('fires oncontextmenu on right-click and suppresses the native menu', async () => {
    const oncontextmenu = vi.fn()
    const { container } = render(RelationChip, {
      props: { relation: rel(), raw: '[[clients/acme]]', oncontextmenu }
    })
    const chip = container.querySelector('.rel-chip')!
    // fireEvent returns false when preventDefault was called by a handler.
    const notPrevented = await fireEvent.contextMenu(chip)
    expect(oncontextmenu).toHaveBeenCalled()
    expect(notPrevented).toBe(false)
  })
})
