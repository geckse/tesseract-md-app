/**
 * Document Cache (LRU)
 *
 * Provides a Least Recently Used (LRU) cache for document contents and editor state.
 * Caches the last 5 opened files to enable instant switching without re-reading from disk.
 * Stores content, cursor position, and scroll position for seamless restoration.
 */

/**
 * Cached document state including content and editor position.
 */
export interface CachedDocument {
  /** File content as a string. */
  content: string
  /** Cursor position in the document. */
  cursor: {
    /** Line number (1-based). */
    line: number
    /** Column number (0-based). */
    column: number
  }
  /** Vertical scroll position in pixels. */
  scrollTop: number
  /** Timestamp when this document was cached (milliseconds since epoch). */
  cachedAt: number
}

/**
 * LRU (Least Recently Used) cache for document contents.
 *
 * Maintains a cache of recently opened documents with a maximum size.
 * When the cache is full, the least recently accessed document is evicted.
 *
 * Uses JavaScript Map's insertion order property: the first entry in the map
 * is the least recently used, and the last entry is the most recently used.
 *
 * @example
 * ```ts
 * const cache = new DocumentCache(5)
 *
 * // Store a document
 * cache.set('README.md', {
 *   content: '# Hello',
 *   cursor: { line: 1, column: 0 },
 *   scrollTop: 0,
 *   cachedAt: Date.now()
 * })
 *
 * // Retrieve a document (moves it to end, marking it as recently used)
 * const doc = cache.get('README.md')
 * if (doc) {
 *   console.log('Cache hit:', doc.content)
 * }
 *
 * // Check if a document is cached
 * if (cache.has('README.md')) {
 *   console.log('Document is in cache')
 * }
 * ```
 */
export class DocumentCache {
  private cache = new Map<string, CachedDocument>()

  /**
   * Create a new document cache.
   *
   * @param maxSize - Maximum number of documents to cache (default: 5)
   */
  constructor(private maxSize: number = 5) {
    if (maxSize < 1) {
      throw new Error('DocumentCache maxSize must be at least 1')
    }
  }

  /**
   * Get a cached document by file path.
   *
   * If the document exists in the cache, it is marked as recently used
   * (moved to the end of the LRU order).
   *
   * @param filePath - Relative file path (e.g., 'docs/README.md')
   * @returns Cached document if found, undefined otherwise
   */
  get(filePath: string): CachedDocument | undefined {
    const value = this.cache.get(filePath)

    if (value) {
      // Move to end (most recently used)
      // Delete and re-add to update insertion order
      this.cache.delete(filePath)
      this.cache.set(filePath, value)
    }

    return value
  }

  /**
   * Store a document in the cache.
   *
   * If the document already exists, it is updated and marked as recently used.
   * If the cache is full, the least recently used document is evicted.
   *
   * @param filePath - Relative file path (e.g., 'docs/README.md')
   * @param document - Document content and editor state to cache
   */
  set(filePath: string, document: CachedDocument): void {
    // Remove if already exists (to update insertion order)
    this.cache.delete(filePath)

    // Add to end (most recently used)
    this.cache.set(filePath, document)

    // Evict oldest entry if over max size
    if (this.cache.size > this.maxSize) {
      const firstKey = this.cache.keys().next().value
      if (firstKey !== undefined) {
        this.cache.delete(firstKey)
      }
    }
  }

  /**
   * Check if a document is in the cache.
   *
   * Note: This does NOT mark the document as recently used.
   * Use get() if you need to access the document.
   *
   * @param filePath - Relative file path
   * @returns True if the document is cached, false otherwise
   */
  has(filePath: string): boolean {
    return this.cache.has(filePath)
  }

  /**
   * Remove a document from the cache.
   *
   * @param filePath - Relative file path
   * @returns True if the document was removed, false if it wasn't in the cache
   */
  delete(filePath: string): boolean {
    return this.cache.delete(filePath)
  }

  /**
   * Clear all documents from the cache.
   */
  clear(): void {
    this.cache.clear()
  }

  /**
   * Get the current number of cached documents.
   *
   * @returns Number of documents in the cache
   */
  get size(): number {
    return this.cache.size
  }

  /**
   * Get all cached file paths in LRU order (oldest first).
   *
   * @returns Array of file paths, from least recently used to most recently used
   */
  keys(): string[] {
    return Array.from(this.cache.keys())
  }

  /**
   * Get all cached documents as [filePath, document] pairs in LRU order.
   *
   * @returns Array of [filePath, document] entries, from least to most recently used
   */
  entries(): [string, CachedDocument][] {
    return Array.from(this.cache.entries())
  }

  /**
   * Get the maximum number of documents this cache can hold.
   *
   * @returns Maximum cache size
   */
  getMaxSize(): number {
    return this.maxSize
  }

  /**
   * Update the cursor position for a cached document without changing its LRU order.
   *
   * This is useful for updating cursor position during editing without
   * triggering a full cache refresh.
   *
   * @param filePath - Relative file path
   * @param cursor - New cursor position
   * @returns True if the document was found and updated, false otherwise
   */
  updateCursor(
    filePath: string,
    cursor: { line: number; column: number }
  ): boolean {
    const doc = this.cache.get(filePath)
    if (!doc) return false

    // Update cursor in place (don't move to end)
    doc.cursor = cursor
    return true
  }

  /**
   * Update the scroll position for a cached document without changing its LRU order.
   *
   * This is useful for updating scroll position during scrolling without
   * triggering a full cache refresh.
   *
   * @param filePath - Relative file path
   * @param scrollTop - New scroll position in pixels
   * @returns True if the document was found and updated, false otherwise
   */
  updateScrollTop(filePath: string, scrollTop: number): boolean {
    const doc = this.cache.get(filePath)
    if (!doc) return false

    // Update scroll in place (don't move to end)
    doc.scrollTop = scrollTop
    return true
  }
}

/**
 * Singleton document cache instance with default settings (max 5 documents).
 *
 * This is the primary cache instance used throughout the application.
 *
 * @example
 * ```ts
 * import { documentCache } from './doc-cache'
 *
 * // Cache a document
 * documentCache.set('README.md', {
 *   content: '# Hello',
 *   cursor: { line: 1, column: 0 },
 *   scrollTop: 0,
 *   cachedAt: Date.now()
 * })
 *
 * // Retrieve later
 * const doc = documentCache.get('README.md')
 * ```
 */
export const documentCache = new DocumentCache(5)
