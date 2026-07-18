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
      dispatchEvent: () => true
    } as unknown as Animation
  }
}

// jsdom deliberately leaves canvas unimplemented and logs a noisy error even
// when libraries feature-detect it. A minimal 2D context is enough for xterm's
// module-level color setup; WebGL stays unavailable so components exercise
// their real fallback paths.
if (typeof HTMLCanvasElement !== 'undefined') {
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value(contextId: string) {
      if (contextId !== '2d') return null
      return {
        globalCompositeOperation: 'source-over',
        fillStyle: '#000000',
        createLinearGradient: () => ({ addColorStop() {} }),
        fillRect() {},
        getImageData: () => ({ data: new Uint8ClampedArray([0, 0, 0, 255]) })
      }
    }
  })
}
