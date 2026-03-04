/**
 * Global keyboard shortcut system with platform-aware modifier keys.
 *
 * Handles Cmd on macOS, Ctrl on Windows/Linux for the "meta" modifier.
 * Supports shift, alt, and explicit ctrl modifiers.
 *
 * @example
 * ```typescript
 * // Register a shortcut
 * const unregister = shortcutManager.register({
 *   key: 'k',
 *   meta: true, // Cmd+K on Mac, Ctrl+K on Win/Linux
 *   handler: () => console.log('Search opened'),
 * });
 *
 * // Attach to document
 * shortcutManager.attach();
 *
 * // Later: cleanup
 * unregister();
 * shortcutManager.detach();
 * ```
 */

/** Platform type for shortcut handling. */
export type Platform = 'mac' | 'windows' | 'linux';

/** Shortcut handler function. */
export type ShortcutHandler = (event: KeyboardEvent) => void;

/** Shortcut definition with modifier keys. */
export interface Shortcut {
  /** Key to match (case-insensitive, e.g., 'k', 'Escape', 'ArrowUp'). */
  key: string;
  /** Platform-aware meta key (Cmd on Mac, Ctrl on Windows/Linux). */
  meta?: boolean;
  /** Shift modifier. */
  shift?: boolean;
  /** Alt/Option modifier. */
  alt?: boolean;
  /** Explicit Ctrl key (regardless of platform). */
  ctrl?: boolean;
  /** Handler function to execute when shortcut matches. */
  handler: ShortcutHandler;
  /** Whether to preventDefault on the event (default: true). */
  preventDefault?: boolean;
}

/**
 * Keyboard shortcut manager.
 * Handles registration, matching, and execution of keyboard shortcuts.
 */
class ShortcutManager {
  private shortcuts: Shortcut[] = [];
  private platform: Platform;

  constructor() {
    this.platform = detectPlatform();
    this.handleKeydown = this.handleKeydown.bind(this);
  }

  /**
   * Register a keyboard shortcut.
   * @returns Unregister function to remove the shortcut.
   */
  register(shortcut: Shortcut): () => void {
    this.shortcuts.push(shortcut);
    return () => {
      this.shortcuts = this.shortcuts.filter((s) => s !== shortcut);
    };
  }

  /**
   * Handle keydown events and match against registered shortcuts.
   * Call this from your component's keydown listener, or use attach().
   */
  handleKeydown(event: KeyboardEvent): void {
    for (const shortcut of this.shortcuts) {
      if (this.matches(event, shortcut)) {
        if (shortcut.preventDefault !== false) {
          event.preventDefault();
        }
        shortcut.handler(event);
        break; // Only trigger first matching shortcut
      }
    }
  }

  /**
   * Check if a keyboard event matches a shortcut definition.
   */
  private matches(event: KeyboardEvent, shortcut: Shortcut): boolean {
    // Key must match (case-insensitive)
    if (event.key.toLowerCase() !== shortcut.key.toLowerCase()) {
      return false;
    }

    // Platform-aware meta key (Cmd on Mac, Ctrl on Win/Linux)
    const metaPressed = this.platform === 'mac' ? event.metaKey : event.ctrlKey;
    if (shortcut.meta !== undefined) {
      if (shortcut.meta && !metaPressed) return false;
      if (!shortcut.meta && metaPressed) return false;
    }

    // Shift key
    if (shortcut.shift !== undefined) {
      if (shortcut.shift && !event.shiftKey) return false;
      if (!shortcut.shift && event.shiftKey) return false;
    }

    // Alt key
    if (shortcut.alt !== undefined) {
      if (shortcut.alt && !event.altKey) return false;
      if (!shortcut.alt && event.altKey) return false;
    }

    // Explicit Ctrl key
    if (shortcut.ctrl !== undefined) {
      if (shortcut.ctrl && !event.ctrlKey) return false;
      if (!shortcut.ctrl && event.ctrlKey) return false;
    }

    return true;
  }

  /**
   * Attach the shortcut manager to the document.
   * Call this in your component's onMount.
   */
  attach(): void {
    document.addEventListener('keydown', this.handleKeydown);
  }

  /**
   * Detach the shortcut manager from the document.
   * Call this in your component's cleanup/onDestroy.
   */
  detach(): void {
    document.removeEventListener('keydown', this.handleKeydown);
  }

  /**
   * Get the current platform.
   */
  getPlatform(): Platform {
    return this.platform;
  }
}

/**
 * Detect the current platform from navigator.
 */
export function detectPlatform(): Platform {
  const ua = navigator.userAgent.toLowerCase();
  const platform = navigator.platform.toLowerCase();

  if (platform.includes('mac') || ua.includes('mac')) {
    return 'mac';
  } else if (platform.includes('win') || ua.includes('win')) {
    return 'windows';
  } else {
    return 'linux';
  }
}

/**
 * Get a human-readable display string for a keyboard shortcut.
 *
 * @example
 * ```typescript
 * getShortcutDisplay('k', true) // '⌘K' on Mac, 'Ctrl+K' on Windows
 * getShortcutDisplay('b', true, true) // '⌘⇧B' on Mac, 'Ctrl+Shift+B' on Windows
 * ```
 */
export function getShortcutDisplay(
  key: string,
  meta?: boolean,
  shift?: boolean,
  alt?: boolean
): string {
  const platform = detectPlatform();
  const parts: string[] = [];

  if (meta) {
    parts.push(platform === 'mac' ? '⌘' : 'Ctrl');
  }
  if (shift) {
    parts.push(platform === 'mac' ? '⇧' : 'Shift');
  }
  if (alt) {
    parts.push(platform === 'mac' ? '⌥' : 'Alt');
  }

  parts.push(key.toUpperCase());

  return platform === 'mac' ? parts.join('') : parts.join('+');
}

/**
 * Singleton shortcut manager instance.
 * Import this to register shortcuts globally.
 */
export const shortcutManager = new ShortcutManager();
