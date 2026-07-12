/**
 * Derive an xterm ITheme from the app's live CSS custom properties.
 *
 * Read from document.documentElement so the theme reacts to light/dark mode
 * switches and to per-collection accent-color overrides.
 */

export interface XtermTheme {
  background?: string
  foreground?: string
  cursor?: string
  cursorAccent?: string
  selectionBackground?: string
  selectionForeground?: string
  black?: string
  red?: string
  green?: string
  yellow?: string
  blue?: string
  magenta?: string
  cyan?: string
  white?: string
  brightBlack?: string
  brightRed?: string
  brightGreen?: string
  brightYellow?: string
  brightBlue?: string
  brightMagenta?: string
  brightCyan?: string
  brightWhite?: string
}

function readVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

function isLightTheme(): boolean {
  if (typeof document === 'undefined') return false
  return document.documentElement.getAttribute('data-theme') === 'light'
}

export function getTerminalTheme(): XtermTheme {
  const light = isLightTheme()

  // Semantic colors from tokens.css
  const background = readVar('--color-surface-dark', light ? '#eeeeee' : '#0c0c0d')
  const foreground = readVar('--color-text', light ? '#27272a' : '#e4e4e7')
  const accent = readVar('--color-primary', light ? '#2563eb' : '#60a5fa')
  const muted = readVar('--color-text-muted', light ? '#71717a' : '#a1a1aa')

  // ANSI palette: use semantic colors where they map cleanly, then fill the
  // rest with conservative defaults that contrast against the chosen bg.
  if (light) {
    return {
      background,
      foreground,
      cursor: accent,
      cursorAccent: background,
      selectionBackground: 'rgba(37, 99, 235, 0.25)',
      selectionForeground: foreground,
      black: '#1f2328',
      red: '#cf222e',
      green: '#116329',
      yellow: '#4d2d00',
      blue: '#0969da',
      magenta: '#8250df',
      cyan: '#1b7c83',
      white: muted,
      brightBlack: '#57606a',
      brightRed: '#a40e26',
      brightGreen: '#1a7f37',
      brightYellow: '#633c01',
      brightBlue: '#218bff',
      brightMagenta: '#a475f9',
      brightCyan: '#3192aa',
      brightWhite: foreground
    }
  }

  return {
    background,
    foreground,
    cursor: accent,
    cursorAccent: background,
    selectionBackground: 'rgba(96, 165, 250, 0.30)',
    selectionForeground: foreground,
    black: '#27272a',
    red: '#f87171',
    green: '#4ade80',
    yellow: '#facc15',
    blue: '#60a5fa',
    magenta: '#c084fc',
    cyan: '#22d3ee',
    white: muted,
    brightBlack: '#52525b',
    brightRed: '#fca5a5',
    brightGreen: '#86efac',
    brightYellow: '#fde047',
    brightBlue: '#93c5fd',
    brightMagenta: '#d8b4fe',
    brightCyan: '#67e8f9',
    brightWhite: '#ffffff'
  }
}
