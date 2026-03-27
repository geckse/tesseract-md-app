/**
 * Bounded stack of recently closed tabs for Cmd+Shift+T reopen.
 *
 * Uses Svelte 5 $state runes for reactivity. MUST remain a .svelte.ts file.
 * Export via singleton class instance — bare $state variables lose reactivity
 * when exported.
 */

import type { DocumentTab } from './workspace.svelte'

/** Information needed to reopen a closed tab. */
export interface ClosedTabEntry {
  /** The document tab state at the time it was closed. */
  tab: DocumentTab
  /** The pane ID the tab was in when closed. */
  paneId: string
  /** Timestamp of when the tab was closed. */
  closedAt: number
}

/** Default maximum number of closed tabs to keep in the stack. */
const DEFAULT_MAX_SIZE = 20

class ClosedTabStack {
  /** Stack of recently closed tabs (most recent at end). */
  stack = $state<ClosedTabEntry[]>([])

  /** Maximum number of entries to keep in the stack. */
  private maxSize: number

  constructor(maxSize: number = DEFAULT_MAX_SIZE) {
    this.maxSize = maxSize
  }

  /** Whether there are any closed tabs to reopen. */
  get canReopen(): boolean {
    return this.stack.length > 0
  }

  /** The number of closed tabs in the stack. */
  get count(): number {
    return this.stack.length
  }

  /**
   * Push a closed tab onto the stack.
   * If the stack exceeds the max size, the oldest entry is removed.
   */
  push(tab: DocumentTab, paneId: string): void {
    const entry: ClosedTabEntry = {
      tab,
      paneId,
      closedAt: Date.now(),
    }

    // If stack is at capacity, remove the oldest entry (front of array)
    if (this.stack.length >= this.maxSize) {
      this.stack = [...this.stack.slice(-(this.maxSize - 1)), entry]
    } else {
      this.stack = [...this.stack, entry]
    }
  }

  /**
   * Pop the most recently closed tab from the stack.
   * Returns the entry, or null if the stack is empty.
   */
  pop(): ClosedTabEntry | null {
    if (this.stack.length === 0) return null

    const entry = this.stack[this.stack.length - 1]
    this.stack = this.stack.slice(0, -1)
    return entry
  }

  /**
   * Peek at the most recently closed tab without removing it.
   * Returns the entry, or null if the stack is empty.
   */
  peek(): ClosedTabEntry | null {
    if (this.stack.length === 0) return null
    return this.stack[this.stack.length - 1]
  }

  /**
   * Remove all entries for a given file path.
   * Useful when a file is permanently deleted.
   */
  removeByFilePath(filePath: string): void {
    this.stack = this.stack.filter((entry) => entry.tab.filePath !== filePath)
  }

  /** Clear all closed tab entries. */
  clear(): void {
    this.stack = []
  }
}

/** Singleton closed tab stack instance. */
export const closedTabs = new ClosedTabStack()
