# PRD: Light Mode Theme

## Overview

Add a light mode alongside the existing dark mode. The light mode uses a warm beige/cream palette for app chrome (sidebar, header, status bar), white for the canvas/editor area, and appropriately adjusted text, border, and shadow colors. A theme toggle in Settings > Appearance allows switching between light, dark, and system-auto modes. The theme is persisted globally and optionally overridable per-collection.

## Problem Statement

The app is dark-only. Users who work in bright environments, prefer light interfaces, or need to match their OS light theme have no option. A light mode broadens accessibility and comfort. The codebase has ~759 hardcoded dark color references across 64 files, plus CodeMirror, Mermaid, TipTap/ProseMirror, and the 3D graph all embed dark-specific colors. Adding light mode requires systematic tokenization and a runtime theme-switching system.

## Goals

- Light mode with warm beige chrome and white editor canvas
- Dark mode remains the default and unchanged
- Theme toggle: light / dark / auto (follows OS `prefers-color-scheme`)
- Persisted in electron-store, applied before first paint to avoid flash
- Per-collection theme override (optional, same pattern as accent color)
- CodeMirror, TipTap/ProseMirror, Mermaid, and 3D graph all respect the active theme
- Accent color system continues to work in both themes
- All semantic colors (success, warning, error, info) adjusted for contrast in light mode
- WCAG AA contrast ratios met in both modes

## Non-Goals

- **Custom theme editor** -- users cannot create arbitrary themes, only pick light/dark
- **Per-file theme** -- granularity stops at collection level
- **High-contrast mode** -- separate accessibility feature, not in scope
- **Multiple light palettes** -- one light palette for now

## Design: Light Mode Color Palette

The light mode uses a warm beige/cream foundation instead of pure white to reduce harshness.

### Token Mapping

| Token | Dark Value | Light Value | Notes |
|---|---|---|---|
| `--color-bg` | `#0f0f10` | `#f5f0eb` | Warm beige app background |
| `--color-surface` | `#161617` | `#ede8e3` | Panel/sidebar backgrounds (slightly darker beige) |
| `--color-surface-dark` | `#0a0a0a` | `#ffffff` | Editor canvas, deepest content area (white) |
| `--color-border` | `#27272a` | `#d4cfc9` | Warm gray borders |
| `--color-border-hover` | `#3f3f46` | `#b8b2ab` | Darker warm gray on hover |
| `--color-text` | `#e4e4e7` | `#2c2c2e` | Primary text (near-black) |
| `--color-text-dim` | `#71717a` | `#7a756f` | Secondary text (warm gray) |
| `--color-text-white` | `#ffffff` | `#1a1a1c` | Maximum contrast text |
| `--color-text-syntax` | `#526366` | `#8a8580` | Subtle syntax chrome |
| `--color-success` | `#34d399` | `#16a34a` | Darker green for light bg |
| `--color-warning` | `#f59e0b` | `#d97706` | Slightly darker amber |
| `--color-error` | `#ef4444` | `#dc2626` | Slightly darker red |
| `--color-info` | `#60a5fa` | `#2563eb` | Deeper blue |
| `--color-edge-out` | (primary) | (primary) | Follows accent color |
| `--color-edge-in` | `#FF6B6B` | `#dc2626` | Deeper red for visibility |
| `--color-edge-bidi` | `#51CF66` | `#16a34a` | Deeper green |
| `--scrollbar-thumb` | `rgba(255,255,255,0.10)` | `rgba(0,0,0,0.12)` | Inverted overlay |
| `--scrollbar-thumb-hover` | `rgba(255,255,255,0.20)` | `rgba(0,0,0,0.20)` | Inverted overlay |
| `--shadow-glow` | `0 0 10px var(--color-primary-glow)` | `0 0 10px var(--color-primary-glow)` | Same |

### Overlay Inversion

Dark mode uses `rgba(255,255,255, alpha)` for subtle white overlays (hover states, borders, table rows). Light mode must invert these to `rgba(0,0,0, alpha)`. This is the single biggest migration task (~50+ instances).

**New tokens needed:**

| Token | Dark Value | Light Value | Purpose |
|---|---|---|---|
| `--overlay-hover` | `rgba(255,255,255,0.06)` | `rgba(0,0,0,0.04)` | Subtle hover highlight |
| `--overlay-active` | `rgba(255,255,255,0.10)` | `rgba(0,0,0,0.06)` | Active/pressed state |
| `--overlay-border` | `rgba(255,255,255,0.08)` | `rgba(0,0,0,0.08)` | Transparent borders |
| `--overlay-scrim` | `rgba(0,0,0,0.5)` | `rgba(0,0,0,0.3)` | Modal backdrop |

## Technical Design

### Architecture: Data-Attribute + Runtime CSS Variables

The theme system uses the same pattern as the accent color system: a Svelte store + `document.documentElement.style.setProperty()`.

Additionally, a `data-theme="light|dark"` attribute is set on `<html>` to enable CSS selectors like `[data-theme="light"] .some-class { ... }` for cases where CSS variable overrides alone are insufficient (e.g., Tailwind utilities, conditional styles).

### Theme Token Definition

**New file: `src/renderer/lib/theme-tokens.ts`**

A pure-data module exporting the complete light and dark token sets:

```typescript
export type ThemeMode = 'light' | 'dark' | 'auto'

export interface ThemeTokens {
  'color-bg': string
  'color-surface': string
  'color-surface-dark': string
  'color-border': string
  'color-border-hover': string
  'color-text': string
  'color-text-dim': string
  'color-text-white': string
  'color-text-syntax': string
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

export const DARK_TOKENS: ThemeTokens = { ... }
export const LIGHT_TOKENS: ThemeTokens = { ... }
```

### Persistence

**Modify: `src/main/store.ts`**

Add to `AppStore`:
```typescript
themeMode: ThemeMode   // 'light' | 'dark' | 'auto', default 'dark'
collectionThemes: Record<string, ThemeMode>  // optional per-collection override
```

IPC: `store:get-theme`, `store:set-theme`, `store:get-collection-theme`, `store:set-collection-theme`

Preload: `getTheme()`, `setTheme()`, `getCollectionTheme()`, `setCollectionTheme()`

### Reactive Theme Store

**New file: `src/renderer/stores/theme.ts`**

```typescript
export const globalTheme = writable<ThemeMode>('dark')
export const collectionTheme = writable<ThemeMode | null>(null)
export const systemPreference = writable<'light' | 'dark'>('dark')

export const resolvedTheme = derived(
  [collectionTheme, globalTheme, systemPreference],
  ([$coll, $global, $system]) => {
    const mode = $coll ?? $global
    return mode === 'auto' ? $system : mode
  }
)

export const themeTokens = derived(resolvedTheme, ($theme) =>
  $theme === 'light' ? LIGHT_TOKENS : DARK_TOKENS
)
```

On startup, listen to `window.matchMedia('(prefers-color-scheme: dark)')` for auto mode.

### Theme Applicator

**New file: `src/renderer/lib/apply-theme.ts`**

```typescript
export function applyTheme(tokens: ThemeTokens, mode: 'light' | 'dark'): void {
  const root = document.documentElement
  root.setAttribute('data-theme', mode)
  root.style.setProperty('color-scheme', mode)

  for (const [key, value] of Object.entries(tokens)) {
    root.style.setProperty(`--${key}`, value)
  }
}
```

Called from `App.svelte` via a subscription on `themeTokens` + `resolvedTheme`.

### Flash Prevention

To prevent a flash of the wrong theme on startup, the main process injects a small inline script into the HTML before the renderer loads:

**Modify: `src/main/index.ts`**

Before creating the BrowserWindow, read the persisted theme from electron-store and inject it via `webPreferences.preload` or `webContents.executeJavaScript` before the page loads. Alternatively, the preload script can synchronously set `document.documentElement.setAttribute('data-theme', ...)` since it runs before renderer JS.

The simplest approach: in `src/preload/index.ts`, at the top level (before `contextBridge.exposeInMainWorld`), synchronously read the theme from electron-store via `ipcRenderer.sendSync` and set the data-theme attribute. This runs before any renderer code or CSS is evaluated.

### Hardcoded Color Migration

This is the largest part of the work. All ~759 hardcoded color references must be converted to CSS variables.

#### Phase A: Tokenize White Overlays

The ~50+ `rgba(255, 255, 255, alpha)` patterns must be replaced with the new overlay tokens:

| Pattern | Replace With |
|---|---|
| `rgba(255, 255, 255, 0.02-0.06)` | `var(--overlay-hover)` |
| `rgba(255, 255, 255, 0.08-0.12)` | `var(--overlay-border)` or `var(--overlay-active)` |
| `rgba(255, 255, 255, 0.15-0.20)` | `var(--overlay-active)` or keep as-is with token |
| `rgba(0, 0, 0, 0.3-0.85)` | `var(--overlay-scrim)` |

Files with the most instances:
- `wysiwyg-theme.css` (~20 instances)
- `FileTree.svelte` (~8 instances)
- `LocalGraph.svelte` (~6 instances)
- Various scrollbar styling (~15 instances across 8 files)

#### Phase B: Tokenize Text Colors

Replace hardcoded text grays with CSS variables:

| Hardcoded | Token |
|---|---|
| `#ffffff`, `#fff` | `var(--color-text-white)` |
| `#e4e4e7` | `var(--color-text)` |
| `#a1a1aa` | `var(--color-text-dim)` or new `--color-text-muted` |
| `#71717a` | `var(--color-text-dim)` |
| `#52525b` | New `--color-text-faint` |
| `#7b8a8d`, `#9ca3af`, `#b0b8bf`, `#8c8c96` | Map to existing or new tokens |

#### Phase C: Tokenize Background Colors

| Hardcoded | Token |
|---|---|
| `#0f0f10` | `var(--color-bg)` |
| `#161617` | `var(--color-surface)` |
| `#0a0a0a` | `var(--color-surface-dark)` |
| `#1e1e20` | New `--color-surface-elevated` (popups/tooltips) |

#### Phase D: Tokenize Border Colors

| Hardcoded | Token |
|---|---|
| `#27272a` | `var(--color-border)` |
| `#3f3f46` | `var(--color-border-hover)` |

#### Phase E: CodeMirror Editor Theme

**Modify: `src/renderer/lib/editor-theme.ts`**

Replace all ~40 hardcoded colors with CSS variable references. Since CodeMirror themes generate real CSS rules, `var()` works at paint time.

| What | Current | Replacement |
|---|---|---|
| Editor background | `#0f0f10` | `var(--color-bg)` |
| Editor text | `#e4e4e7` | `var(--color-text)` |
| Gutter background | `#0f0f10` | `var(--color-bg)` |
| Gutter text | `#7b8a8d` | `var(--color-text-dim)` |
| Active line | `rgba(255,255,255,0.03)` | `var(--overlay-hover)` |
| Panel background | `#161617` | `var(--color-surface)` |
| Panel border | `#27272a` | `var(--color-border)` |
| Search input bg | `#0a0a0a` | `var(--color-surface-dark)` |
| Tooltip bg | `#161617` | `var(--color-surface)` |
| Heading colors | `#ffffff`, `#e4e4e7` | `var(--color-text-white)`, `var(--color-text)` |
| Quote text | `#b0b8bf` | New `--color-text-muted` |

#### Phase F: TipTap/ProseMirror wysiwyg-theme.css

Same migration as CodeMirror: replace ~100 hardcoded colors with CSS variable references. Major areas:
- Heading colors (h1-h6)
- Code block backgrounds
- Table styling (borders, headers, cell text)
- Blockquote styling
- Task list checkboxes (the check mark color: `#0f0f10` on checked bg)
- Toolbar/popup backgrounds
- Drag handle colors
- Footnotes
- Highlight/selection colors

#### Phase G: Mermaid Renderer

**Modify: `src/renderer/lib/mermaid-renderer.ts`**

Read all theme colors from CSS variables at init time (same pattern as the accent color fix). The `initMermaid()` function already reads `--color-primary` — extend this to read all theme tokens:

```typescript
const bg = getCssVar('--color-bg') || '#0f0f10'
const surface = getCssVar('--color-surface') || '#161617'
const text = getCssVar('--color-text') || '#e4e4e7'
const border = getCssVar('--color-border') || '#27272a'
const dim = getCssVar('--color-text-dim') || '#71717a'

mermaidModule.default.initialize({
  theme: resolvedTheme === 'light' ? 'neutral' : 'dark',
  themeVariables: {
    background: bg,
    primaryColor: primaryColor,
    primaryTextColor: text,
    primaryBorderColor: border,
    secondaryColor: surface,
    // ...
  }
})
```

Call `reinitMermaid()` when theme changes (already called when accent color changes).

#### Phase H: 3D Graph (GraphView.svelte + graph-3d-bridge.ts)

The 3D graph uses Three.js/force-graph with a dark background. For light mode:

- **Canvas background**: The WebGL scene background must change. Look for `scene.background` or `renderer.setClearColor` in GraphView.svelte or graph-3d-bridge.ts. This is likely set via a CSS background on the container or a Three.js scene color.
- **Node colors**: Node fill colors and text labels need contrast adjustment
- **Edge colors**: Already use CSS variables via `getArrowCyan()` pattern — extend for all edge colors
- **Hover/selection colors**: Glow effects need inversion

The graph container element's CSS background should use `var(--color-bg)`. The Three.js scene background can read from the CSS variable at initialization.

#### Phase I: Frontmatter Decoration

**Modify: `src/renderer/lib/frontmatter-decoration.ts`**

Replace remaining hardcoded colors:
- Container bg `#0a0a0a` → `var(--color-surface-dark)`
- Border `#27272a` → `var(--color-border)`
- Delimiter `#7b8a8d` → `var(--color-text-dim)`
- Key `#9ca3af` → `var(--color-text-dim)`
- Status `#34d399` → `var(--color-success)`
- Array `#60a5fa` → `var(--color-info)`
- Date `#fdba74` → `var(--color-warning)`

### Accent Color Contrast for Both Themes

The existing accent color system (phase-31) only checks luminance against the dark background. With two themes, an accent color that works on dark may be invisible on light (e.g., bright yellow) and vice versa (e.g., dark navy). The accent color system must be updated to check contrast against **both** theme backgrounds.

**Modify: `src/renderer/lib/color-utils.ts`**

Add WCAG contrast ratio calculation and theme-aware checking:

```typescript
/** WCAG contrast ratio between two colors (1-21). AA large text requires 3:1. */
export function contrastRatio(hex1: string, hex2: string): number

/** Background colors for each theme */
export const THEME_BACKGROUNDS = { dark: '#0f0f10', light: '#f5f0eb' }

/** Check accent against a specific background (3:1 min for UI elements) */
export function isContrastAcceptable(accent: string, bg: string, minRatio?: number): boolean

/** Check accent against BOTH theme backgrounds. Returns per-mode pass/fail + ratios. */
export function checkAccentContrast(hex: string): {
  darkOk: boolean; lightOk: boolean; darkRatio: number; lightRatio: number
}

/** Adjust a color to meet contrast against a given background (brighten for dark bg, darken for light bg) */
export function adjustForContrast(hex: string, bg: string, minRatio?: number): string

/** Suggest the best version of a color for a given background */
export function suggestAccentForBackground(hex: string, bg: string): { color: string; adjusted: boolean }
```

**Modify: `src/renderer/components/ui/ColorPicker.svelte`**

Replace the single luminance warning with per-theme contrast warnings:

- Call `checkAccentContrast(displayColor)` to get `{ darkOk, lightOk, darkRatio, lightRatio }`
- If **both** fail: show "This color has low contrast in both themes" with two auto-adjust buttons
- If **dark only** fails: show "Low contrast on dark backgrounds (ratio: X:1)" with "Adjust for dark" button
- If **light only** fails: show "Low contrast on light backgrounds (ratio: X:1)" with "Adjust for light" button
- Each auto-adjust button calls `adjustForContrast(color, THEME_BACKGROUNDS.dark|light)` and applies the suggested color
- Show the contrast ratio numbers so users understand the tradeoff

Example UI:
```
⚠ Low contrast on light backgrounds (2.1:1)
   [Suggest for light]
✓ Good contrast on dark backgrounds (8.4:1)
```

**Update preset validation**: All `PRESET_COLORS` must pass contrast check against **both** theme backgrounds. If any preset fails on light mode, replace it with an adjusted variant or swap it out.

### Settings UI

**Modify: `src/renderer/components/Settings.svelte`**

Add a theme picker in the Appearance section (both global and per-collection), above or below the accent color picker:

```svelte
<div class="field-group">
  <label class="field-label">Theme</label>
  <div class="theme-picker">
    <button class:active={theme === 'light'} onclick={() => setTheme('light')}>
      <span class="material-symbols-outlined">light_mode</span> Light
    </button>
    <button class:active={theme === 'dark'} onclick={() => setTheme('dark')}>
      <span class="material-symbols-outlined">dark_mode</span> Dark
    </button>
    <button class:active={theme === 'auto'} onclick={() => setTheme('auto')}>
      <span class="material-symbols-outlined">contrast</span> Auto
    </button>
  </div>
</div>
```

### Startup Wiring

**Modify: `src/renderer/App.svelte`**

On mount:
1. Call `loadTheme()` to read from electron-store
2. Listen to `matchMedia('(prefers-color-scheme: dark)')` changes for auto mode
3. Subscribe to `themeTokens` + `resolvedTheme` → call `applyTheme()`
4. When `activeCollectionId` changes → call `loadCollectionTheme(id)`

## Implementation Order

| Step | Description | Files | Depends On |
|---|---|---|---|
| 1 | Theme token definitions | `lib/theme-tokens.ts` (new) | -- |
| 2 | Persistence layer | `store.ts`, `ipc-handlers.ts`, `preload/` | -- |
| 3 | Theme store | `stores/theme.ts` (new) | Step 1, 2 |
| 4 | Theme applicator | `lib/apply-theme.ts` (new) | Step 1 |
| 5 | Flash prevention | `preload/index.ts` | Step 2 |
| 6 | New overlay tokens in tokens.css | `styles/tokens.css` | -- |
| 7 | Phase A: Overlay migration | 10+ component files, wysiwyg-theme.css | Step 6 |
| 8 | Phase B-D: Text/bg/border tokenization | 60+ files | Step 6 |
| 9 | Phase E: CodeMirror | `lib/editor-theme.ts` | Step 6 |
| 10 | Phase F: TipTap | `lib/tiptap/wysiwyg-theme.css` | Step 6 |
| 11 | Phase G: Mermaid | `lib/mermaid-renderer.ts` | Step 4 |
| 12 | Phase H: 3D Graph | `GraphView.svelte`, `graph-3d-bridge.ts` | Step 4 |
| 13 | Phase I: Frontmatter | `lib/frontmatter-decoration.ts` | Step 6 |
| 14 | Accent color contrast for both themes | `lib/color-utils.ts`, `components/ui/ColorPicker.svelte` | Step 1 |
| 15 | Validate presets against both backgrounds | `lib/color-utils.ts` tests | Step 14 |
| 16 | Settings UI | `Settings.svelte` | Step 3 |
| 17 | App wiring | `App.svelte` | Step 3, 4 |
| 18 | Collection cleanup | `ipc-handlers.ts` | Step 2 |

Steps 7-13 are the bulk of the work and can largely be done in parallel once Step 6 is complete.
Steps 14-15 can be done in parallel with 7-13.

## Verification

- Toggle to light mode → app chrome is warm beige, editor canvas is white, text is dark
- Toggle to dark mode → everything reverts to current dark look, zero visual regressions
- Toggle to auto → follows OS preference, updates in real-time when OS setting changes
- Accent color picker → works correctly in both themes (presets visible, contrast warnings per-theme)
- Pick a color that fails on light (e.g. bright yellow `#FBBF24`) → light-specific warning with ratio + "Suggest for light" button
- Pick a color that fails on dark (e.g. dark navy `#1e3a5f`) → dark-specific warning with ratio + "Suggest for dark" button
- Click "Suggest for light/dark" → color adjusts to meet 3:1 contrast against that background
- CodeMirror editor → caret, selections, syntax highlighting all correct in both themes
- TipTap editor → headings, code blocks, tables, task checkboxes, links all correct
- Mermaid diagrams → render with correct background and text colors in both themes
- 3D graph → background, node labels, edges all visible in both themes
- Per-collection override → switching collections applies the correct theme
- Restart app → theme persists, no flash of wrong theme
- WCAG AA → spot-check key text/background combinations in both modes

## Testing

- **Unit tests** for `theme-tokens.ts`: both token sets have all required keys, light values are actually light, dark values match current defaults
- **Unit tests** for theme store: resolution logic (collection > global > auto > fallback), system preference detection
- **Unit tests** for store persistence: get/set theme, get/set collection theme
- **Unit tests** for contrast functions: `contrastRatio()` correct for known pairs, `checkAccentContrast()` catches per-theme failures, `adjustForContrast()` meets target ratio, all presets pass both backgrounds
- **Component test** for ColorPicker: shows per-theme contrast warnings, suggest buttons adjust correctly
- **Component test** for theme toggle in Settings: renders 3 buttons, click triggers setTheme
- **Visual regression**: manual check of both themes across all major UI areas

## Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Flash of dark theme on startup | Synchronous theme application in preload script |
| Missed hardcoded colors | Grep audit + visual QA pass in light mode |
| Third-party libs (Mermaid, CM6) ignoring CSS vars | They generate real CSS — `var()` works. Mermaid needs reinit. |
| 3D graph WebGL doesn't use CSS vars | Read computed style at init, re-init on theme change |
| Overlay inversion breaks subtle hover states | QA each component's hover/active states in both themes |
| Accent color contrast differs between themes | `checkAccentContrast()` tests against both backgrounds; ColorPicker shows per-theme warnings with auto-adjust suggestions; presets validated against both |
| Some presets may fail on light background | Validate all 10 presets at implementation time; swap any that fail 3:1 on light for adjusted variants |
