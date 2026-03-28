import { describe, it, expect, beforeEach } from 'vitest'
import { closedTabs } from '@renderer/stores/closed-tabs.svelte'
import type { DocumentTab } from '@renderer/stores/workspace.svelte'

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Create a mock DocumentTab for testing. */
function createMockDocTab(filePath: string, overrides?: Partial<DocumentTab>): DocumentTab {
  return {
    id: `tab-${filePath}`,
    kind: 'document',
    filePath,
    title: filePath.split('/').pop() || filePath,
    isDirty: false,
    editorMode: 'wysiwyg',
    content: null,
    contentLoading: false,
    contentError: null,
    scrollPosition: 0,
    cursorPosition: 0,
    wordCount: 0,
    tokenCount: 0,
    navigation: {
      backStack: [],
      forwardStack: [],
      current: filePath,
    },
    ...overrides,
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('ClosedTabStack', () => {
  beforeEach(() => {
    closedTabs.clear()
  })

  describe('initial state', () => {
    it('starts empty', () => {
      expect(closedTabs.count).toBe(0)
      expect(closedTabs.canReopen).toBe(false)
    })
  })

  describe('push', () => {
    it('adds a closed tab entry to the stack', () => {
      const tab = createMockDocTab('readme.md')
      closedTabs.push(tab, 'pane-1')

      expect(closedTabs.count).toBe(1)
      expect(closedTabs.canReopen).toBe(true)
    })

    it('records the pane ID', () => {
      const tab = createMockDocTab('file.md')
      closedTabs.push(tab, 'pane-123')

      const entry = closedTabs.peek()
      expect(entry).not.toBeNull()
      expect(entry!.paneId).toBe('pane-123')
    })

    it('records the tab state', () => {
      const tab = createMockDocTab('notes.md', {
        isDirty: true,
        editorMode: 'editor',
        scrollPosition: 150,
        cursorPosition: 42,
        wordCount: 100,
        tokenCount: 50,
      })
      closedTabs.push(tab, 'pane-1')

      const entry = closedTabs.peek()
      expect(entry).not.toBeNull()
      expect(entry!.tab.filePath).toBe('notes.md')
      expect(entry!.tab.isDirty).toBe(true)
      expect(entry!.tab.editorMode).toBe('editor')
      expect(entry!.tab.scrollPosition).toBe(150)
      expect(entry!.tab.cursorPosition).toBe(42)
      expect(entry!.tab.wordCount).toBe(100)
      expect(entry!.tab.tokenCount).toBe(50)
    })

    it('records a closedAt timestamp', () => {
      const beforePush = Date.now()
      closedTabs.push(createMockDocTab('file.md'), 'pane-1')
      const afterPush = Date.now()

      const entry = closedTabs.peek()
      expect(entry).not.toBeNull()
      expect(entry!.closedAt).toBeGreaterThanOrEqual(beforePush)
      expect(entry!.closedAt).toBeLessThanOrEqual(afterPush)
    })

    it('can push multiple entries', () => {
      closedTabs.push(createMockDocTab('a.md'), 'pane-1')
      closedTabs.push(createMockDocTab('b.md'), 'pane-1')
      closedTabs.push(createMockDocTab('c.md'), 'pane-1')

      expect(closedTabs.count).toBe(3)
    })
  })

  describe('pop', () => {
    it('returns the most recently closed tab', () => {
      closedTabs.push(createMockDocTab('first.md'), 'pane-1')
      closedTabs.push(createMockDocTab('second.md'), 'pane-1')
      closedTabs.push(createMockDocTab('third.md'), 'pane-1')

      const entry = closedTabs.pop()
      expect(entry).not.toBeNull()
      expect(entry!.tab.filePath).toBe('third.md')
    })

    it('removes the entry from the stack', () => {
      closedTabs.push(createMockDocTab('file.md'), 'pane-1')
      expect(closedTabs.count).toBe(1)

      closedTabs.pop()
      expect(closedTabs.count).toBe(0)
    })

    it('returns null when the stack is empty', () => {
      const result = closedTabs.pop()
      expect(result).toBeNull()
    })

    it('pops in LIFO order', () => {
      closedTabs.push(createMockDocTab('first.md'), 'pane-1')
      closedTabs.push(createMockDocTab('second.md'), 'pane-1')
      closedTabs.push(createMockDocTab('third.md'), 'pane-1')

      expect(closedTabs.pop()!.tab.filePath).toBe('third.md')
      expect(closedTabs.pop()!.tab.filePath).toBe('second.md')
      expect(closedTabs.pop()!.tab.filePath).toBe('first.md')
      expect(closedTabs.pop()).toBeNull()
    })
  })

  describe('peek', () => {
    it('returns the most recent entry without removing it', () => {
      closedTabs.push(createMockDocTab('file.md'), 'pane-1')

      const entry1 = closedTabs.peek()
      const entry2 = closedTabs.peek()

      expect(entry1).not.toBeNull()
      expect(entry2).not.toBeNull()
      expect(entry1!.tab.filePath).toBe('file.md')
      expect(closedTabs.count).toBe(1)
    })

    it('returns null when the stack is empty', () => {
      expect(closedTabs.peek()).toBeNull()
    })
  })

  describe('bounded size', () => {
    it('enforces maximum size of 20 by default', () => {
      // Push 25 entries
      for (let i = 0; i < 25; i++) {
        closedTabs.push(createMockDocTab(`file-${i}.md`), 'pane-1')
      }

      expect(closedTabs.count).toBe(20)
    })

    it('evicts the oldest entry when at capacity', () => {
      // Push entries 0-19 (fills up to max of 20)
      for (let i = 0; i < 20; i++) {
        closedTabs.push(createMockDocTab(`file-${i}.md`), 'pane-1')
      }
      expect(closedTabs.count).toBe(20)

      // Push one more — should evict file-0.md
      closedTabs.push(createMockDocTab('file-20.md'), 'pane-1')
      expect(closedTabs.count).toBe(20)

      // The most recent should be file-20.md
      const newest = closedTabs.peek()
      expect(newest!.tab.filePath).toBe('file-20.md')

      // Pop all and verify file-0.md is gone
      const allPaths: string[] = []
      while (closedTabs.count > 0) {
        const entry = closedTabs.pop()
        allPaths.push(entry!.tab.filePath)
      }
      expect(allPaths).not.toContain('file-0.md')
      expect(allPaths).toContain('file-1.md')
      expect(allPaths).toContain('file-20.md')
    })

    it('keeps most recent entries when capacity is exceeded', () => {
      for (let i = 0; i < 25; i++) {
        closedTabs.push(createMockDocTab(`file-${i}.md`), 'pane-1')
      }

      // Should have entries 5-24 (the 20 most recent)
      const entry = closedTabs.pop()
      expect(entry!.tab.filePath).toBe('file-24.md')
    })
  })

  describe('canReopen', () => {
    it('returns false when stack is empty', () => {
      expect(closedTabs.canReopen).toBe(false)
    })

    it('returns true when stack has entries', () => {
      closedTabs.push(createMockDocTab('file.md'), 'pane-1')
      expect(closedTabs.canReopen).toBe(true)
    })

    it('returns false after popping the last entry', () => {
      closedTabs.push(createMockDocTab('file.md'), 'pane-1')
      closedTabs.pop()
      expect(closedTabs.canReopen).toBe(false)
    })
  })

  describe('count', () => {
    it('tracks the number of entries', () => {
      expect(closedTabs.count).toBe(0)

      closedTabs.push(createMockDocTab('a.md'), 'pane-1')
      expect(closedTabs.count).toBe(1)

      closedTabs.push(createMockDocTab('b.md'), 'pane-1')
      expect(closedTabs.count).toBe(2)

      closedTabs.pop()
      expect(closedTabs.count).toBe(1)
    })
  })

  describe('removeByFilePath', () => {
    it('removes all entries for a given file path', () => {
      closedTabs.push(createMockDocTab('keep.md'), 'pane-1')
      closedTabs.push(createMockDocTab('remove-me.md'), 'pane-1')
      closedTabs.push(createMockDocTab('also-keep.md'), 'pane-1')
      closedTabs.push(createMockDocTab('remove-me.md'), 'pane-2')

      closedTabs.removeByFilePath('remove-me.md')

      expect(closedTabs.count).toBe(2)
      const entry1 = closedTabs.pop()
      const entry2 = closedTabs.pop()
      expect(entry1!.tab.filePath).toBe('also-keep.md')
      expect(entry2!.tab.filePath).toBe('keep.md')
    })

    it('does nothing when file path is not in the stack', () => {
      closedTabs.push(createMockDocTab('a.md'), 'pane-1')
      closedTabs.push(createMockDocTab('b.md'), 'pane-1')

      closedTabs.removeByFilePath('not-found.md')
      expect(closedTabs.count).toBe(2)
    })
  })

  describe('clear', () => {
    it('removes all entries', () => {
      closedTabs.push(createMockDocTab('a.md'), 'pane-1')
      closedTabs.push(createMockDocTab('b.md'), 'pane-1')
      closedTabs.push(createMockDocTab('c.md'), 'pane-1')

      closedTabs.clear()

      expect(closedTabs.count).toBe(0)
      expect(closedTabs.canReopen).toBe(false)
      expect(closedTabs.pop()).toBeNull()
    })

    it('works on an already empty stack', () => {
      expect(() => closedTabs.clear()).not.toThrow()
      expect(closedTabs.count).toBe(0)
    })
  })

  describe('reopen restores correct state', () => {
    it('preserves file path and editor mode', () => {
      const tab = createMockDocTab('important.md', {
        editorMode: 'editor',
      })
      closedTabs.push(tab, 'pane-1')

      const entry = closedTabs.pop()
      expect(entry!.tab.filePath).toBe('important.md')
      expect(entry!.tab.editorMode).toBe('editor')
    })

    it('preserves dirty state', () => {
      const tab = createMockDocTab('unsaved.md', {
        isDirty: true,
        content: '# Unsaved changes',
      })
      closedTabs.push(tab, 'pane-1')

      const entry = closedTabs.pop()
      expect(entry!.tab.isDirty).toBe(true)
      expect(entry!.tab.content).toBe('# Unsaved changes')
    })

    it('preserves scroll and cursor position', () => {
      const tab = createMockDocTab('scrolled.md', {
        scrollPosition: 500,
        cursorPosition: 123,
      })
      closedTabs.push(tab, 'pane-1')

      const entry = closedTabs.pop()
      expect(entry!.tab.scrollPosition).toBe(500)
      expect(entry!.tab.cursorPosition).toBe(123)
    })

    it('preserves navigation history', () => {
      const tab = createMockDocTab('navigated.md', {
        navigation: {
          backStack: ['prev-a.md', 'prev-b.md'],
          forwardStack: ['next-a.md'],
          current: 'navigated.md',
        },
      })
      closedTabs.push(tab, 'pane-1')

      const entry = closedTabs.pop()
      expect(entry!.tab.navigation.backStack).toEqual(['prev-a.md', 'prev-b.md'])
      expect(entry!.tab.navigation.forwardStack).toEqual(['next-a.md'])
      expect(entry!.tab.navigation.current).toBe('navigated.md')
    })

    it('preserves word and token counts', () => {
      const tab = createMockDocTab('counted.md', {
        wordCount: 250,
        tokenCount: 180,
      })
      closedTabs.push(tab, 'pane-1')

      const entry = closedTabs.pop()
      expect(entry!.tab.wordCount).toBe(250)
      expect(entry!.tab.tokenCount).toBe(180)
    })

    it('preserves the original pane ID', () => {
      const tab = createMockDocTab('file.md')
      closedTabs.push(tab, 'specific-pane-id')

      const entry = closedTabs.pop()
      expect(entry!.paneId).toBe('specific-pane-id')
    })

    it('reopens in correct order after multiple closes', () => {
      closedTabs.push(createMockDocTab('first-closed.md'), 'pane-1')
      closedTabs.push(createMockDocTab('second-closed.md'), 'pane-1')
      closedTabs.push(createMockDocTab('third-closed.md'), 'pane-2')

      // Reopening should be most-recent-first (LIFO)
      const entry1 = closedTabs.pop()
      expect(entry1!.tab.filePath).toBe('third-closed.md')
      expect(entry1!.paneId).toBe('pane-2')

      const entry2 = closedTabs.pop()
      expect(entry2!.tab.filePath).toBe('second-closed.md')
      expect(entry2!.paneId).toBe('pane-1')

      const entry3 = closedTabs.pop()
      expect(entry3!.tab.filePath).toBe('first-closed.md')
      expect(entry3!.paneId).toBe('pane-1')
    })
  })
})
