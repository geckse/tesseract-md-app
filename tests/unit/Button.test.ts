import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import Button from '@renderer/components/ui/Button.svelte';

describe('Button component', () => {
  it('renders children text', () => {
    render(Button, {
      props: { children: createSnippet('Click me') },
    });

    expect(screen.getByRole('button')).toHaveTextContent('Click me');
  });

  it('applies primary variant class by default', () => {
    render(Button, {
      props: { children: createSnippet('OK') },
    });

    const btn = screen.getByRole('button');
    expect(btn.className).toContain('btn-primary');
  });

  it('applies secondary variant class when specified', () => {
    render(Button, {
      props: { variant: 'secondary', children: createSnippet('Cancel') },
    });

    const btn = screen.getByRole('button');
    expect(btn.className).toContain('btn-secondary');
  });

  it('applies size classes', () => {
    const { unmount } = render(Button, {
      props: { size: 'sm', children: createSnippet('S') },
    });
    expect(screen.getByRole('button').className).toContain('btn-sm');
    unmount();

    render(Button, {
      props: { size: 'lg', children: createSnippet('L') },
    });
    expect(screen.getByRole('button').className).toContain('btn-lg');
  });

  it('defaults to md size', () => {
    render(Button, {
      props: { children: createSnippet('M') },
    });

    expect(screen.getByRole('button').className).toContain('btn-md');
  });

  it('sets disabled attribute when disabled prop is true', () => {
    render(Button, {
      props: { disabled: true, children: createSnippet('No') },
    });

    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('is not disabled by default', () => {
    render(Button, {
      props: { children: createSnippet('Yes') },
    });

    expect(screen.getByRole('button')).not.toBeDisabled();
  });

  it('calls onclick handler when clicked', async () => {
    const handler = vi.fn();
    render(Button, {
      props: { onclick: handler, children: createSnippet('Go') },
    });

    await fireEvent.click(screen.getByRole('button'));
    expect(handler).toHaveBeenCalledOnce();
  });

  it('does not call onclick when disabled', async () => {
    const handler = vi.fn();
    render(Button, {
      props: { onclick: handler, disabled: true, children: createSnippet('Go') },
    });

    await fireEvent.click(screen.getByRole('button'));
    expect(handler).not.toHaveBeenCalled();
  });
});

/**
 * Helper to create a Svelte 5 snippet that renders plain text.
 * In the testing-library context we pass a callback that populates the target.
 */
function createSnippet(text: string) {
  return ((target: HTMLElement) => {
    target.textContent = text;
  }) as any;
}
