/**
 * Vitest global setup — polyfills for jsdom environment.
 */

// ResizeObserver polyfill
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    callback: ResizeObserverCallback
    constructor(callback: ResizeObserverCallback) {
      this.callback = callback
    }
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}

// Element.prototype.scrollIntoView polyfill
if (typeof Element.prototype.scrollIntoView === 'undefined') {
  Element.prototype.scrollIntoView = function () {}
}

// Element.prototype.animate polyfill
if (typeof Element.prototype.animate === 'undefined') {
  Element.prototype.animate = function () {
    return {
      finished: Promise.resolve(),
      cancel: () => {},
      play: () => {},
      pause: () => {},
      reverse: () => {},
      finish: () => {},
      onfinish: null,
      oncancel: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
    } as unknown as Animation
  }
}
