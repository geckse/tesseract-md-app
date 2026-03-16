import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { shortcutManager, detectPlatform, getShortcutDisplay } from '@renderer/lib/shortcuts'
import type { Shortcut } from '@renderer/lib/shortcuts'

describe('detectPlatform', () => {
  const originalNavigator = global.navigator
  const _originalUserAgent = global.navigator.userAgent

  afterEach(() => {
    Object.defineProperty(global, 'navigator', {
      value: originalNavigator,
      writable: true,
      configurable: true
    })
  })

  it('detects mac platform from navigator.platform', () => {
    Object.defineProperty(global, 'navigator', {
      value: {
        platform: 'MacIntel',
        userAgent: 'Mozilla/5.0'
      },
      writable: true,
      configurable: true
    })

    expect(detectPlatform()).toBe('mac')
  })

  it('detects mac platform from user agent', () => {
    Object.defineProperty(global, 'navigator', {
      value: {
        platform: 'unknown',
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
      },
      writable: true,
      configurable: true
    })

    expect(detectPlatform()).toBe('mac')
  })

  it('detects windows platform from navigator.platform', () => {
    Object.defineProperty(global, 'navigator', {
      value: {
        platform: 'Win32',
        userAgent: 'Mozilla/5.0'
      },
      writable: true,
      configurable: true
    })

    expect(detectPlatform()).toBe('windows')
  })

  it('detects windows platform from user agent', () => {
    Object.defineProperty(global, 'navigator', {
      value: {
        platform: 'unknown',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      },
      writable: true,
      configurable: true
    })

    expect(detectPlatform()).toBe('windows')
  })

  it('defaults to linux for unknown platforms', () => {
    Object.defineProperty(global, 'navigator', {
      value: {
        platform: 'Linux x86_64',
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64)'
      },
      writable: true,
      configurable: true
    })

    expect(detectPlatform()).toBe('linux')
  })
})

describe('getShortcutDisplay', () => {
  const originalNavigator = global.navigator

  afterEach(() => {
    Object.defineProperty(global, 'navigator', {
      value: originalNavigator,
      writable: true,
      configurable: true
    })
  })

  it('displays meta key as ⌘ on mac', () => {
    Object.defineProperty(global, 'navigator', {
      value: { platform: 'MacIntel', userAgent: 'Mac' },
      writable: true,
      configurable: true
    })

    expect(getShortcutDisplay('k', true)).toBe('⌘K')
  })

  it('displays meta key as Ctrl on windows', () => {
    Object.defineProperty(global, 'navigator', {
      value: { platform: 'Win32', userAgent: 'Windows' },
      writable: true,
      configurable: true
    })

    expect(getShortcutDisplay('k', true)).toBe('Ctrl+K')
  })

  it('displays shift key as ⇧ on mac', () => {
    Object.defineProperty(global, 'navigator', {
      value: { platform: 'MacIntel', userAgent: 'Mac' },
      writable: true,
      configurable: true
    })

    expect(getShortcutDisplay('b', true, true)).toBe('⌘⇧B')
  })

  it('displays shift key as Shift on windows', () => {
    Object.defineProperty(global, 'navigator', {
      value: { platform: 'Win32', userAgent: 'Windows' },
      writable: true,
      configurable: true
    })

    expect(getShortcutDisplay('b', true, true)).toBe('Ctrl+Shift+B')
  })

  it('displays alt key as ⌥ on mac', () => {
    Object.defineProperty(global, 'navigator', {
      value: { platform: 'MacIntel', userAgent: 'Mac' },
      writable: true,
      configurable: true
    })

    expect(getShortcutDisplay('f', true, false, true)).toBe('⌘⌥F')
  })

  it('displays alt key as Alt on windows', () => {
    Object.defineProperty(global, 'navigator', {
      value: { platform: 'Win32', userAgent: 'Windows' },
      writable: true,
      configurable: true
    })

    expect(getShortcutDisplay('f', true, false, true)).toBe('Ctrl+Alt+F')
  })

  it('uppercases the key', () => {
    Object.defineProperty(global, 'navigator', {
      value: { platform: 'MacIntel', userAgent: 'Mac' },
      writable: true,
      configurable: true
    })

    expect(getShortcutDisplay('escape')).toBe('ESCAPE')
  })

  it('combines all modifiers on mac', () => {
    Object.defineProperty(global, 'navigator', {
      value: { platform: 'MacIntel', userAgent: 'Mac' },
      writable: true,
      configurable: true
    })

    expect(getShortcutDisplay('x', true, true, true)).toBe('⌘⇧⌥X')
  })

  it('combines all modifiers on windows with + separator', () => {
    Object.defineProperty(global, 'navigator', {
      value: { platform: 'Win32', userAgent: 'Windows' },
      writable: true,
      configurable: true
    })

    expect(getShortcutDisplay('x', true, true, true)).toBe('Ctrl+Shift+Alt+X')
  })
})

describe('ShortcutManager', () => {
  let handler: ReturnType<typeof vi.fn>
  let shortcut: Shortcut

  beforeEach(() => {
    handler = vi.fn()
    shortcut = {
      key: 'k',
      meta: true,
      handler
    }
  })

  afterEach(() => {
    // Clean up any registered shortcuts
    shortcutManager['shortcuts'] = []
  })

  describe('register', () => {
    it('registers a shortcut', () => {
      const unregister = shortcutManager.register(shortcut)

      expect(shortcutManager['shortcuts']).toContain(shortcut)
      unregister()
    })

    it('returns an unregister function that removes the shortcut', () => {
      const unregister = shortcutManager.register(shortcut)
      expect(shortcutManager['shortcuts']).toHaveLength(1)

      unregister()
      expect(shortcutManager['shortcuts']).toHaveLength(0)
    })

    it('allows registering multiple shortcuts', () => {
      const handler2 = vi.fn()
      const shortcut2: Shortcut = { key: 'b', meta: true, handler: handler2 }

      shortcutManager.register(shortcut)
      shortcutManager.register(shortcut2)

      expect(shortcutManager['shortcuts']).toHaveLength(2)
    })
  })

  describe('handleKeydown', () => {
    const originalNavigator = global.navigator

    beforeEach(() => {
      Object.defineProperty(global, 'navigator', {
        value: { platform: 'MacIntel', userAgent: 'Mac' },
        writable: true,
        configurable: true
      })
      // Reset platform detection
      shortcutManager['platform'] = detectPlatform()
    })

    afterEach(() => {
      Object.defineProperty(global, 'navigator', {
        value: originalNavigator,
        writable: true,
        configurable: true
      })
    })

    it('triggers handler when shortcut matches on mac', () => {
      shortcutManager.register(shortcut)

      const event = new KeyboardEvent('keydown', {
        key: 'k',
        metaKey: true
      })

      shortcutManager.handleKeydown(event)
      expect(handler).toHaveBeenCalledOnce()
      expect(handler).toHaveBeenCalledWith(event)
    })

    it('triggers handler when shortcut matches on windows', () => {
      Object.defineProperty(global, 'navigator', {
        value: { platform: 'Win32', userAgent: 'Windows' },
        writable: true,
        configurable: true
      })
      shortcutManager['platform'] = detectPlatform()

      shortcutManager.register(shortcut)

      const event = new KeyboardEvent('keydown', {
        key: 'k',
        ctrlKey: true
      })

      shortcutManager.handleKeydown(event)
      expect(handler).toHaveBeenCalledOnce()
    })

    it('does not trigger when key does not match', () => {
      shortcutManager.register(shortcut)

      const event = new KeyboardEvent('keydown', {
        key: 'j',
        metaKey: true
      })

      shortcutManager.handleKeydown(event)
      expect(handler).not.toHaveBeenCalled()
    })

    it('does not trigger when meta key is missing', () => {
      shortcutManager.register(shortcut)

      const event = new KeyboardEvent('keydown', {
        key: 'k'
      })

      shortcutManager.handleKeydown(event)
      expect(handler).not.toHaveBeenCalled()
    })

    it('matches shift modifier', () => {
      const shiftShortcut: Shortcut = {
        key: 'b',
        meta: true,
        shift: true,
        handler
      }
      shortcutManager.register(shiftShortcut)

      const event = new KeyboardEvent('keydown', {
        key: 'b',
        metaKey: true,
        shiftKey: true
      })

      shortcutManager.handleKeydown(event)
      expect(handler).toHaveBeenCalledOnce()
    })

    it('does not match when shift is required but missing', () => {
      const shiftShortcut: Shortcut = {
        key: 'b',
        meta: true,
        shift: true,
        handler
      }
      shortcutManager.register(shiftShortcut)

      const event = new KeyboardEvent('keydown', {
        key: 'b',
        metaKey: true
      })

      shortcutManager.handleKeydown(event)
      expect(handler).not.toHaveBeenCalled()
    })

    it('matches alt modifier', () => {
      const altShortcut: Shortcut = {
        key: 'f',
        alt: true,
        handler
      }
      shortcutManager.register(altShortcut)

      const event = new KeyboardEvent('keydown', {
        key: 'f',
        altKey: true
      })

      shortcutManager.handleKeydown(event)
      expect(handler).toHaveBeenCalledOnce()
    })

    it('matches explicit ctrl modifier', () => {
      const ctrlShortcut: Shortcut = {
        key: 'c',
        ctrl: true,
        handler
      }
      shortcutManager.register(ctrlShortcut)

      const event = new KeyboardEvent('keydown', {
        key: 'c',
        ctrlKey: true
      })

      shortcutManager.handleKeydown(event)
      expect(handler).toHaveBeenCalledOnce()
    })

    it('matches case-insensitively', () => {
      shortcutManager.register(shortcut)

      const event = new KeyboardEvent('keydown', {
        key: 'K',
        metaKey: true
      })

      shortcutManager.handleKeydown(event)
      expect(handler).toHaveBeenCalledOnce()
    })

    it('only triggers first matching shortcut', () => {
      const handler2 = vi.fn()
      shortcutManager.register(shortcut)
      shortcutManager.register({ ...shortcut, handler: handler2 })

      const event = new KeyboardEvent('keydown', {
        key: 'k',
        metaKey: true
      })

      shortcutManager.handleKeydown(event)
      expect(handler).toHaveBeenCalledOnce()
      expect(handler2).not.toHaveBeenCalled()
    })

    it('prevents default by default', () => {
      shortcutManager.register(shortcut)

      const event = new KeyboardEvent('keydown', {
        key: 'k',
        metaKey: true
      })
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault')

      shortcutManager.handleKeydown(event)
      expect(preventDefaultSpy).toHaveBeenCalled()
    })

    it('does not prevent default when preventDefault is false', () => {
      const noPreventShortcut: Shortcut = {
        ...shortcut,
        preventDefault: false
      }
      shortcutManager.register(noPreventShortcut)

      const event = new KeyboardEvent('keydown', {
        key: 'k',
        metaKey: true
      })
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault')

      shortcutManager.handleKeydown(event)
      expect(preventDefaultSpy).not.toHaveBeenCalled()
    })

    it('handles special keys like Escape', () => {
      const escapeShortcut: Shortcut = {
        key: 'Escape',
        handler
      }
      shortcutManager.register(escapeShortcut)

      const event = new KeyboardEvent('keydown', {
        key: 'Escape'
      })

      shortcutManager.handleKeydown(event)
      expect(handler).toHaveBeenCalledOnce()
    })

    it('handles arrow keys', () => {
      const arrowShortcut: Shortcut = {
        key: 'ArrowDown',
        handler
      }
      shortcutManager.register(arrowShortcut)

      const event = new KeyboardEvent('keydown', {
        key: 'ArrowDown'
      })

      shortcutManager.handleKeydown(event)
      expect(handler).toHaveBeenCalledOnce()
    })
  })

  describe('attach and detach', () => {
    it('attaches keydown listener to document', () => {
      const addEventListenerSpy = vi.spyOn(document, 'addEventListener')

      shortcutManager.attach()
      expect(addEventListenerSpy).toHaveBeenCalledWith('keydown', shortcutManager.handleKeydown)

      addEventListenerSpy.mockRestore()
    })

    it('detaches keydown listener from document', () => {
      const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener')

      shortcutManager.detach()
      expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', shortcutManager.handleKeydown)

      removeEventListenerSpy.mockRestore()
    })
  })

  describe('getPlatform', () => {
    it('returns the detected platform', () => {
      const platform = shortcutManager.getPlatform()
      expect(['mac', 'windows', 'linux']).toContain(platform)
    })
  })
})
