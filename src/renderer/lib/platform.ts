/**
 * Renderer-side OS platform detection.
 *
 * Prefers the real Node platform exposed by @electron-toolkit/preload
 * (window.electron.process.platform); falls back to user-agent sniffing so
 * unit tests (jsdom) and stripped-down windows still resolve something sane.
 *
 * main.ts stamps the result on <html data-platform="..."> at startup so CSS
 * can vary per platform (macOS traffic-light inset vs Windows/Linux Window
 * Controls Overlay) without JS involvement.
 */

export function platform(): NodeJS.Platform {
  const fromPreload = window.electron?.process?.platform
  if (fromPreload) return fromPreload as NodeJS.Platform

  const ua = navigator.userAgent
  if (/Mac|iPhone|iPad/i.test(ua)) return 'darwin'
  if (/Win/i.test(ua)) return 'win32'
  return 'linux'
}

export function isMac(): boolean {
  return platform() === 'darwin'
}

export function isWindows(): boolean {
  return platform() === 'win32'
}

export function isLinux(): boolean {
  return platform() === 'linux'
}
