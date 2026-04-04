/**
 * Theme Tokens — mdvdb
 *
 * Complete light and dark token sets for the theme system.
 * Each key maps to a CSS custom property name (without the -- prefix).
 */

export type ThemeMode = 'light' | 'dark' | 'auto'
export type ResolvedTheme = 'light' | 'dark'

export interface ThemeTokens {
  'color-bg': string
  'color-surface': string
  'color-surface-dark': string
  'color-surface-elevated': string
  'color-canvas': string
  'color-graph-bg': string
  'color-surface-darker': string
  'color-border': string
  'color-border-hover': string
  'color-text': string
  'color-text-dim': string
  'color-text-white': string
  'color-text-syntax': string
  'color-text-muted': string
  'color-text-faint': string
  'color-success': string
  'color-warning': string
  'color-error': string
  'color-info': string
  'color-edge-in': string
  'color-edge-bidi': string
  'scrollbar-thumb': string
  'scrollbar-thumb-hover': string
  'overlay-hover': string
  'overlay-active': string
  'overlay-border': string
  'overlay-scrim': string
}

export const DARK_TOKENS: ThemeTokens = {
  'color-bg': '#0f0f10',
  'color-surface': '#161617',
  'color-surface-dark': '#0c0c0d',
  'color-surface-elevated': '#1e1e20',
  'color-canvas': '#0a0a0a',
  'color-graph-bg': '#0a0a0b',
  'color-surface-darker': '#070708',
  'color-border': '#27272a',
  'color-border-hover': '#3f3f46',
  'color-text': '#e4e4e7',
  'color-text-dim': '#71717a',
  'color-text-white': '#ffffff',
  'color-text-syntax': '#526366',
  'color-text-muted': '#a1a1aa',
  'color-text-faint': '#52525b',
  'color-success': '#34d399',
  'color-warning': '#f59e0b',
  'color-error': '#ef4444',
  'color-info': '#60a5fa',
  'color-edge-in': '#FF6B6B',
  'color-edge-bidi': '#51CF66',
  'scrollbar-thumb': 'rgba(255, 255, 255, 0.10)',
  'scrollbar-thumb-hover': 'rgba(255, 255, 255, 0.20)',
  'overlay-hover': 'rgba(255, 255, 255, 0.06)',
  'overlay-active': 'rgba(255, 255, 255, 0.10)',
  'overlay-border': 'rgba(255, 255, 255, 0.08)',
  'overlay-scrim': 'rgba(0, 0, 0, 0.5)',
}

export const LIGHT_TOKENS: ThemeTokens = {
  'color-bg': '#f6f6f6',
  'color-surface': '#fbfbfb',
  'color-surface-dark': '#eeeeee',
  'color-surface-elevated': '#ffffff',
  'color-canvas': '#ffffff',
  'color-graph-bg': '#e0e0e0',
  'color-surface-darker': '#e3e3e3',
  'color-border': '#e2e2e2',
  'color-border-hover': '#cbcbcb',
  'color-text': '#2c2c2e',
  'color-text-dim': '#7a7a7a',
  'color-text-white': '#1a1a1c',
  'color-text-syntax': '#8c8c8c',
  'color-text-muted': '#6c6c6c',
  'color-text-faint': '#9c9c9c',
  'color-success': '#16a34a',
  'color-warning': '#d97706',
  'color-error': '#dc2626',
  'color-info': '#2563eb',
  'color-edge-in': '#dc2626',
  'color-edge-bidi': '#16a34a',
  'scrollbar-thumb': 'rgba(0, 0, 0, 0.12)',
  'scrollbar-thumb-hover': 'rgba(0, 0, 0, 0.20)',
  'overlay-hover': 'rgba(0, 0, 0, 0.04)',
  'overlay-active': 'rgba(0, 0, 0, 0.06)',
  'overlay-border': 'rgba(0, 0, 0, 0.08)',
  'overlay-scrim': 'rgba(0, 0, 0, 0.3)',
}

/** All token keys */
export const TOKEN_KEYS = Object.keys(DARK_TOKENS) as (keyof ThemeTokens)[]
