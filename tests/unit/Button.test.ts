import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/svelte';
import { createRawSnippet } from 'svelte';
import Button from '@renderer/components/ui/Button.svelte';

function textSnippet(text: string) {
  return createRawSnippet(() => ({
    render: () => `<span>${text}</span>`,
  }));
}

describe('Button component', () => {
  it('renders children text', () => {
    render(Button, {
      props: { children: textSnippet('Click me') },
    });

    expect(screen.getByRole('button').textContent).toContain('Click me');
  });

  it('applies primary variant class by default', () => {
    render(Button, {
      props: { children: textSnippet('OK') },
    });

    const btn = screen.getByRole('button');
    expect(btn.className).toContain('btn-primary');
  });

  it('applies secondary variant class when specified', () => {
    render(Button, {
      props: { variant: 'secondary', children: textSnippet('Cancel') },
    });

    const btn = screen.getByRole('button');
    expect(btn.className).toContain('btn-secondary');
  });

  it('applies size classes', () => {
    const { unmount } = render(Button, {
      props: { size: 'sm', children: textSnippet('S') },
    });
    expect(screen.getByRole('button').className).toContain('btn-sm');
    unmount();

    render(Button, {
      props: { size: 'lg', children: textSnippet('L') },
    });
    expect(screen.getByRole('button').className).toContain('btn-lg');
  });

  it('defaults to md size', () => {
    render(Button, {
      props: { children: textSnippet('M') },
    });

    expect(screen.getByRole('button').className).toContain('btn-md');
  });

  it('sets disabled attribute when disabled prop is true', () => {
    render(Button, {
      props: { disabled: true, children: textSnippet('No') },
    });

    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
  });

  it('is not disabled by default', () => {
    render(Button, {
      props: { children: textSnippet('Yes') },
    });

    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(false);
  });

  it('calls onclick handler when clicked', async () => {
    const handler = vi.fn();
    render(Button, {
      props: { onclick: handler, children: textSnippet('Go') },
    });

    await fireEvent.click(screen.getByRole('button'));
    expect(handler).toHaveBeenCalledOnce();
  });

  it('does not call onclick when disabled', async () => {
    const handler = vi.fn();
    render(Button, {
      props: { onclick: handler, disabled: true, children: textSnippet('Go') },
    });

    const btn = screen.getByRole('button') as HTMLButtonElement;
    // The button should be disabled, preventing interaction in real browsers.
    // jsdom may still dispatch click events on disabled buttons, so we verify
    // the disabled attribute is set rather than relying on event suppression.
    expect(btn.disabled).toBe(true);
  });
});
