import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import Badge from '@renderer/components/ui/Badge.svelte';

function textSnippet(text: string) {
  return createRawSnippet(() => ({
    render: () => `<span>${text}</span>`,
  }));
}

describe('Badge component', () => {
  it('renders children text', () => {
    render(Badge, {
      props: { children: textSnippet('v1.0') },
    });

    expect(screen.getByText('v1.0')).toBeTruthy();
  });

  it('renders as a span element', () => {
    render(Badge, {
      props: { children: textSnippet('tag') },
    });

    const el = screen.getByText('tag');
    // The outer element is a span.badge wrapping an inner span
    expect(el.closest('.badge')!.tagName).toBe('SPAN');
  });

  it('applies default variant class by default', () => {
    render(Badge, {
      props: { children: textSnippet('default') },
    });

    const el = screen.getByText('default').closest('.badge')!;
    expect(el.className).toContain('badge-default');
  });

  it('applies success variant class', () => {
    render(Badge, {
      props: { variant: 'success', children: textSnippet('ok') },
    });

    expect(screen.getByText('ok').closest('.badge')!.className).toContain('badge-success');
  });

  it('applies warning variant class', () => {
    render(Badge, {
      props: { variant: 'warning', children: textSnippet('warn') },
    });

    expect(screen.getByText('warn').closest('.badge')!.className).toContain('badge-warning');
  });

  it('applies info variant class', () => {
    render(Badge, {
      props: { variant: 'info', children: textSnippet('info') },
    });

    expect(screen.getByText('info').closest('.badge')!.className).toContain('badge-info');
  });

  it('applies primary variant class', () => {
    render(Badge, {
      props: { variant: 'primary', children: textSnippet('primary') },
    });

    expect(screen.getByText('primary').closest('.badge')!.className).toContain('badge-primary');
  });

  it('always has the base badge class', () => {
    const variants = ['default', 'success', 'warning', 'info', 'primary'] as const;

    for (const variant of variants) {
      const { unmount } = render(Badge, {
        props: { variant, children: textSnippet(variant) },
      });

      expect(screen.getByText(variant).closest('.badge')!.className).toContain('badge');
      unmount();
    }
  });
});
