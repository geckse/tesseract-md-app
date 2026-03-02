import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const tokensCSS = readFileSync(
  resolve(__dirname, '../../src/renderer/styles/tokens.css'),
  'utf-8',
);

/** Extract all `--foo: value` declarations from the CSS source. */
function parseCustomProperties(css: string): Map<string, string> {
  const props = new Map<string, string>();
  const re = /--([\w-]+)\s*:\s*([^;]+);/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    props.set(`--${m[1]}`, m[2].trim());
  }
  return props;
}

const tokens = parseCustomProperties(tokensCSS);

describe('Design Tokens — tokens.css', () => {
  describe('Primary colors', () => {
    it('defines --color-primary as cyan', () => {
      expect(tokens.get('--color-primary')).toBe('#00E5FF');
    });

    it('defines --color-primary-dark', () => {
      expect(tokens.get('--color-primary-dark')).toBe('#00B8CC');
    });

    it('defines --color-primary-dim', () => {
      expect(tokens.get('--color-primary-dim')).toBe('rgba(0, 229, 255, 0.1)');
    });

    it('defines --color-primary-glow', () => {
      expect(tokens.get('--color-primary-glow')).toBe('rgba(0, 229, 255, 0.4)');
    });
  });

  describe('Background colors', () => {
    it('defines --color-bg', () => {
      expect(tokens.get('--color-bg')).toBe('#0f0f10');
    });

    it('defines --color-surface', () => {
      expect(tokens.get('--color-surface')).toBe('#161617');
    });

    it('defines --color-surface-dark', () => {
      expect(tokens.get('--color-surface-dark')).toBe('#0a0a0a');
    });
  });

  describe('Border colors', () => {
    it('defines --color-border', () => {
      expect(tokens.get('--color-border')).toBe('#27272a');
    });

    it('defines --color-border-hover', () => {
      expect(tokens.get('--color-border-hover')).toBe('#3f3f46');
    });
  });

  describe('Text colors', () => {
    it('defines --color-text', () => {
      expect(tokens.get('--color-text')).toBe('#e4e4e7');
    });

    it('defines --color-text-dim', () => {
      expect(tokens.get('--color-text-dim')).toBe('#71717a');
    });

    it('defines --color-text-syntax', () => {
      expect(tokens.get('--color-text-syntax')).toBe('#526366');
    });
  });

  describe('Semantic colors', () => {
    it.each([
      ['--color-success', '#34d399'],
      ['--color-warning', '#f59e0b'],
      ['--color-error', '#ef4444'],
      ['--color-info', '#60a5fa'],
    ])('defines %s as %s', (name, value) => {
      expect(tokens.get(name)).toBe(value);
    });
  });

  describe('Typography', () => {
    it('defines font-display as Space Grotesk', () => {
      expect(tokens.get('--font-display')).toContain('Space Grotesk');
    });

    it('defines font-mono as JetBrains Mono', () => {
      expect(tokens.get('--font-mono')).toContain('JetBrains Mono');
    });

    it('defines all font size tokens', () => {
      const sizes = ['--text-xs', '--text-sm', '--text-base', '--text-lg', '--text-xl', '--text-2xl', '--text-3xl'];
      for (const s of sizes) {
        expect(tokens.has(s), `missing ${s}`).toBe(true);
      }
    });

    it('defines font weight tokens', () => {
      expect(tokens.get('--weight-light')).toBe('300');
      expect(tokens.get('--weight-regular')).toBe('400');
      expect(tokens.get('--weight-medium')).toBe('500');
      expect(tokens.get('--weight-semibold')).toBe('600');
      expect(tokens.get('--weight-bold')).toBe('700');
    });
  });

  describe('Spacing scale', () => {
    it('defines spacing tokens in 4px increments', () => {
      expect(tokens.get('--space-1')).toBe('0.25rem');
      expect(tokens.get('--space-2')).toBe('0.5rem');
      expect(tokens.get('--space-4')).toBe('1rem');
      expect(tokens.get('--space-8')).toBe('2rem');
      expect(tokens.get('--space-16')).toBe('4rem');
    });
  });

  describe('Layout tokens', () => {
    it('defines sidebar width as 256px (16rem)', () => {
      expect(tokens.get('--sidebar-width')).toBe('16rem');
    });

    it('defines header height as 56px (3.5rem)', () => {
      expect(tokens.get('--header-height')).toBe('3.5rem');
    });

    it('defines content max width', () => {
      expect(tokens.get('--content-max-width')).toBe('48rem');
    });
  });

  describe('Border radius', () => {
    it('defines radius tokens', () => {
      expect(tokens.get('--radius-sm')).toBe('0.25rem');
      expect(tokens.get('--radius-md')).toBe('0.375rem');
      expect(tokens.get('--radius-lg')).toBe('0.5rem');
      expect(tokens.get('--radius-full')).toBe('9999px');
    });
  });

  describe('Transitions', () => {
    it('defines fast and normal transitions', () => {
      expect(tokens.get('--transition-fast')).toBe('150ms ease');
      expect(tokens.get('--transition-normal')).toBe('200ms ease');
    });
  });

  describe('Z-index scale', () => {
    it('defines ascending z-index layers', () => {
      const zBase = Number(tokens.get('--z-base'));
      const zSidebar = Number(tokens.get('--z-sidebar'));
      const zHeader = Number(tokens.get('--z-header'));
      const zOverlay = Number(tokens.get('--z-overlay'));
      const zGrain = Number(tokens.get('--z-grain'));

      expect(zBase).toBeLessThan(zSidebar);
      expect(zSidebar).toBeLessThan(zHeader);
      expect(zHeader).toBeLessThan(zOverlay);
      expect(zOverlay).toBeLessThan(zGrain);
    });
  });
});
