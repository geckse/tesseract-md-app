import { describe, it, expect } from 'vitest';
import { editorBaseTheme, editorHighlighting, editorTheme } from '@renderer/lib/editor-theme';

describe('editor-theme', () => {
  describe('editorBaseTheme', () => {
    it('returns an Extension', () => {
      const ext = editorBaseTheme();
      expect(ext).toBeDefined();
    });

    it('returns a consistent value on repeated calls', () => {
      const a = editorBaseTheme();
      const b = editorBaseTheme();
      expect(a).toBe(b);
    });
  });

  describe('editorHighlighting', () => {
    it('returns an Extension', () => {
      const ext = editorHighlighting();
      expect(ext).toBeDefined();
    });
  });

  describe('editorTheme', () => {
    it('returns an array Extension combining base and highlighting', () => {
      const ext = editorTheme();
      expect(ext).toBeDefined();
      expect(Array.isArray(ext)).toBe(true);
    });

    it('includes two entries (base theme + syntax highlighting)', () => {
      const ext = editorTheme();
      expect(ext).toHaveLength(2);
    });
  });
});
