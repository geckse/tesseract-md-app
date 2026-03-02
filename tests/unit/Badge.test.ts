import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import Badge from '@renderer/components/ui/Badge.svelte';

describe('Badge component', () => {
  it('renders children text', () => {
    render(Badge, {
      props: { children: createSnippet('v1.0') },
    });

    expect(screen.getByText('v1.0')).toBeTruthy();
  });

  it('renders as a span element', () => {
    render(Badge, {
      props: { children: createSnippet('tag') },
    });

    const el = screen.getByText('tag');
    expect(el.tagName).toBe('SPAN');
  });

  it('applies default variant class by default', () => {
    render(Badge, {
      props: { children: createSnippet('default') },
    });

    const el = screen.getByText('default');
    expect(el.className).toContain('badge-default');
  });

  it('applies success variant class', () => {
    render(Badge, {
      props: { variant: 'success', children: createSnippet('ok') },
    });

    expect(screen.getByText('ok').className).toContain('badge-success');
  });

  it('applies warning variant class', () => {
    render(Badge, {
      props: { variant: 'warning', children: createSnippet('warn') },
    });

    expect(screen.getByText('warn').className).toContain('badge-warning');
  });

  it('applies info variant class', () => {
    render(Badge, {
      props: { variant: 'info', children: createSnippet('info') },
    });

    expect(screen.getByText('info').className).toContain('badge-info');
  });

  it('applies primary variant class', () => {
    render(Badge, {
      props: { variant: 'primary', children: createSnippet('primary') },
    });

    expect(screen.getByText('primary').className).toContain('badge-primary');
  });

  it('always has the base badge class', () => {
    const variants = ['default', 'success', 'warning', 'info', 'primary'] as const;

    for (const variant of variants) {
      const { unmount } = render(Badge, {
        props: { variant, children: createSnippet(variant) },
      });

      expect(screen.getByText(variant).className).toContain('badge');
      unmount();
    }
  });
});

function createSnippet(text: string) {
  return ((target: HTMLElement) => {
    target.textContent = text;
  }) as any;
}
