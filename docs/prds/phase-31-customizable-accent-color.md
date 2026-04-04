# PRD: Customizable Primary Accent Color

## Overview

Make the primary accent color customizable — both as a global app preference and as a per-collection override. Users can pick from curated presets that guarantee contrast on the dark theme, or choose any color via a free-form picker with automatic brightness enforcement.

## Problem Statement

The primary accent color (`#00E5FF` cyan) is hardcoded across the entire app — CSS tokens, CodeMirror theme, Mermaid diagrams, and the 3D graph. Users who manage multiple collections have no way to visually distinguish them, and users who prefer a different accent color are stuck with cyan. A customizable accent color provides both personalization and a practical visual cue for multi-collection workflows.

## Goals

- Global primary color setting persisted in electron-store, applied on app launch
- Per-collection color override that activates when switching collections
- Color picker UI with curated bright-on-dark presets and a free-form picker
- Automatic brightness enforcement: warn or auto-adjust colors that would be invisible on the `#0f0f10` background
- All existing `var(--color-primary)` usage reacts automatically — no component-level changes needed
- CodeMirror, Mermaid, and 3D graph pick up color changes without editor recreation

## Non-Goals

- **Light theme support** — the app remains dark-only
- **Customizing other colors** (backgrounds, borders, semantic colors) — only the primary accent
- **Per-file color overrides** — granularity stops at collection level
- **Syncing colors across devices** — electron-store is local only

## Technical Design

### Hardcoded Primary Color Locations (Audit)

All locations where `#00E5FF` or its RGBA equivalents currently appear:

| File | What | Fix Strategy |
|---|---|---|
| `src/renderer/styles/tokens.css` (lines 8-11, 35) | CSS variable definitions | Remains the default; overridden at runtime via `setProperty` |
| `src/renderer/styles/app.css` (lines 18-21, 45) | Tailwind `@theme` duplicate | No change needed — runtime `setProperty` on `:root` wins over `@theme` |
| `src/renderer/styles/global.css` | Selection, focus rings, link color (~9 occurrences) | Replace hardcoded hex with `var(--color-primary)` / `var(--color-primary-dark)` / `var(--color-primary-dim)` |
| `src/renderer/lib/editor-theme.ts` (~9 occurrences) | CodeMirror base theme + syntax highlighting | Replace hex literals with `var(--color-primary)` etc. — CM6 themes generate real CSS, so `var()` resolves at paint time |
| `src/renderer/lib/frontmatter-decoration.ts` (2 occurrences) | Frontmatter left-border and key color | Same `var()` replacement |
| `src/renderer/lib/mermaid-renderer.ts` (line 27) | Mermaid `themeVariables.primaryColor` | Read from CSS variable at init time; expose `reinitMermaid()` for color changes |
| `src/renderer/lib/graph-3d-bridge.ts` (line 31) | `ARROW_CYAN` constant | Read from CSS variable via `getComputedStyle` |
| All ~47 Svelte components | `var(--color-primary)` references | Already reactive — no changes needed |

### Color Utility Module

**New file: `src/renderer/lib/color-utils.ts`**

Pure functions, no dependencies:

```typescript
hexToHsl(hex: string): { h: number; s: number; l: number }
hslToHex(h: number, s: number, l: number): string
hexToRgba(hex: string, alpha: number): string
relativeLuminance(hex: string): number          // WCAG formula, 0-1
darken(hex: string, amount: number): string     // darken by percentage
isLuminanceAcceptable(hex: string, min?: number): boolean  // default min: 0.15

derivePrimaryVariants(hex: string): {
  primary: string    // the hex itself
  dark: string       // darken(hex, 20)
  dim: string        // hexToRgba(hex, 0.1)
  glow: string       // hexToRgba(hex, 0.4)
}

PRESET_COLORS: { name: string; hex: string }[]
// Cyan #00E5FF (default), Green #34D399, Purple #A78BFA, Pink #F472B6,
// Orange #FB923C, Yellow #FBBF24, Blue #60A5FA, Red #F87171, Teal #2DD4BF, Lime #A3E635
// All presets must pass luminance check against #0f0f10
```

### Persistence

**Modify: `src/main/store.ts`**

Add to `AppStore` interface and schema:

```typescript
primaryColor: string | null                    // null = default cyan
collectionColors: Record<string, string>       // collectionId → hex
```

Schema entries:
```typescript
primaryColor: { type: ['string', 'null'], default: null }
collectionColors: { type: 'object', default: {} }
```

Add getter/setter functions following the `getEditorFontSize` / `setEditorFontSize` pattern:
- `getPrimaryColor(): string | null`
- `setPrimaryColor(hex: string | null): void`
- `getCollectionColor(collectionId: string): string | null`
- `setCollectionColor(collectionId: string, hex: string | null): void` — null removes the override
- `getCollectionColors(): Record<string, string>`

**Modify: `src/main/ipc-handlers.ts`**

Four new IPC handlers:
| Channel | Signature | Purpose |
|---|---|---|
| `store:get-primary-color` | `() → string \| null` | Read global accent color |
| `store:set-primary-color` | `(hex: string \| null) → void` | Write global accent color |
| `store:get-collection-color` | `(collectionId: string) → string \| null` | Read per-collection override |
| `store:set-collection-color` | `(collectionId: string, hex: string \| null) → void` | Write/remove per-collection override |

**Modify: `src/preload/api.d.ts` + `src/preload/index.ts`**

Expose the four methods on `MdvdbApi`:
```typescript
getPrimaryColor(): Promise<string | null>
setPrimaryColor(hex: string | null): Promise<void>
getCollectionColor(collectionId: string): Promise<string | null>
setCollectionColor(collectionId: string, hex: string | null): Promise<void>
```

### Reactive Color Store

**New file: `src/renderer/stores/accent-color.ts`**

```typescript
const DEFAULT_PRIMARY = '#00E5FF'

export const globalPrimaryColor = writable<string | null>(null)
export const collectionPrimaryColor = writable<string | null>(null)

// Resolution: collection override > global > default
export const effectivePrimaryColor = derived(
  [collectionPrimaryColor, globalPrimaryColor],
  ([$coll, $global]) => $coll ?? $global ?? DEFAULT_PRIMARY
)

export const primaryVariants = derived(effectivePrimaryColor, derivePrimaryVariants)
```

Exported actions:
- `loadAccentColors()` — reads global color from IPC on startup
- `loadCollectionAccentColor(collectionId)` — reads per-collection override when active collection changes
- `setGlobalAccentColor(hex | null)` — updates store + persists via IPC
- `setCollectionAccentColor(collectionId, hex | null)` — updates store + persists via IPC

### CSS Variable Applicator

**New file: `src/renderer/lib/apply-accent-color.ts`**

```typescript
export function applyAccentColor(variants: { primary; dark; dim; glow }): void {
  const root = document.documentElement.style
  root.setProperty('--color-primary', variants.primary)
  root.setProperty('--color-primary-dark', variants.dark)
  root.setProperty('--color-primary-dim', variants.dim)
  root.setProperty('--color-primary-glow', variants.glow)
  root.setProperty('--color-edge-out', variants.primary)
}
```

Called from `App.svelte` via a `$effect` that subscribes to `primaryVariants`. All Svelte components using `var(--color-primary)` update automatically.

### Hardcoded Color Replacements

**`src/renderer/styles/global.css`** — Replace ~9 hardcoded hex values with CSS variable references:
- `::selection` background → `var(--color-primary)`
- `:focus-visible` outline → `var(--color-primary)`
- Focus box-shadow → `var(--color-primary-dim)`
- Link color → `var(--color-primary)`, hover → `var(--color-primary-dark)`

**`src/renderer/lib/editor-theme.ts`** — Replace ~9 hardcoded values:
- `caretColor`, `borderLeftColor` → `var(--color-primary)`
- Selection background → `var(--color-primary-dim)`
- Search match highlights → `var(--color-primary-dim)`, `var(--color-primary-glow)`
- Link/URL syntax color → `var(--color-primary)`
- Monospace code color/bg → `var(--color-primary)`, `var(--color-primary-dim)`

This works because CodeMirror's `EditorView.theme()` generates real CSS rules — `var()` resolves at browser paint time, not at JS evaluation time. No Compartment swapping or editor recreation needed.

**`src/renderer/lib/frontmatter-decoration.ts`** — 2 replacements:
- `borderLeftColor` → `var(--color-primary)`
- Key `color` → `var(--color-primary)`

**`src/renderer/lib/mermaid-renderer.ts`**:
- Read primary color from `getComputedStyle(document.documentElement).getPropertyValue('--color-primary')` at init time instead of hardcoding
- Export `reinitMermaid()` that resets the cached init promise so the next render uses the new color
- Call `reinitMermaid()` from the accent-color store when the effective color changes

**`src/renderer/lib/graph-3d-bridge.ts`**:
- Replace `const ARROW_CYAN = '#00E5FF'` with a function that reads from `getComputedStyle`
- The graph re-renders on interaction, picking up the new color naturally

### Color Picker Component

**New file: `src/renderer/components/ui/ColorPicker.svelte`**

Props:
```typescript
interface ColorPickerProps {
  value: string | null
  defaultColor?: string       // shown when value is null
  onchange: (hex: string | null) => void
  showReset?: boolean
  showInheritedHint?: boolean
}
```

UI layout:
1. **Current swatch** — small circle showing active color, clickable to toggle the picker popover
2. **Preset grid** — 2x5 grid of circular swatches from `PRESET_COLORS`. Active preset gets a ring. Clicking a preset calls `onchange(hex)`
3. **Custom picker** — `<input type="color">` for free-form selection + hex text input for direct entry
4. **Luminance warning** — if the chosen color fails `isLuminanceAcceptable()`, show: "This color may be hard to see" with an "Auto-adjust" button that increases HSL lightness to meet the threshold
5. **Reset button** — when `showReset` is true, "Reset to default" link that calls `onchange(null)`

Popover pattern: absolutely positioned below the swatch, click-outside-to-close.

### Settings UI Integration

**Modify: `src/renderer/components/Settings.svelte`**

**Global Appearance section** (currently has font size only) — add below font size:

```svelte
<div class="field-group">
  <label class="field-label">Primary Accent Color</label>
  <p class="field-hint">Changes the accent color used throughout the app.</p>
  <ColorPicker
    value={globalAccentColor}
    defaultColor="#00E5FF"
    onchange={handleGlobalColorChange}
    showReset={true}
  />
</div>
```

**Collection sections** — add `appearance` to `collectionSections` array:
```typescript
const collectionSections = [
  { id: 'embedding', ... },
  { id: 'search', ... },
  { id: 'chunking', ... },
  { id: 'appearance', label: 'Appearance', icon: 'palette' },
]
```

Add collection appearance section block with ColorPicker showing `showInheritedHint` when no override is set.

### Startup Wiring

**Modify: `src/renderer/App.svelte`**

On mount:
1. Call `loadAccentColors()` to read global color from store
2. Subscribe to `primaryVariants` → call `applyAccentColor()` on each change
3. When `activeCollectionId` changes → call `loadCollectionAccentColor(id)` to load any override

### Collection Removal Cleanup

**Modify: `src/main/ipc-handlers.ts`**

In the `collections:remove` handler, also delete the collection's color entry from `collectionColors`.

## Implementation Order

| Step | Files | Depends On |
|---|---|---|
| 1. Color utils | `lib/color-utils.ts` (new) | — |
| 2. Persistence | `store.ts`, `ipc-handlers.ts`, `preload/index.ts`, `preload/api.d.ts` | — |
| 3. Accent store | `stores/accent-color.ts` (new) | Step 1, 2 |
| 4. CSS applicator + global.css fixes | `lib/apply-accent-color.ts` (new), `styles/global.css` | Step 3 |
| 5. Editor theme fixes | `lib/editor-theme.ts`, `lib/frontmatter-decoration.ts` | — (independent) |
| 6. Mermaid fix | `lib/mermaid-renderer.ts` | — (independent) |
| 7. Graph fix | `lib/graph-3d-bridge.ts` | — (independent) |
| 8. ColorPicker UI | `components/ui/ColorPicker.svelte` (new) | Step 1 |
| 9. Settings integration | `components/Settings.svelte` | Step 3, 8 |
| 10. App wiring | `App.svelte` | Step 3, 4 |
| 11. Collection cleanup | `ipc-handlers.ts` | Step 2 |

Steps 5, 6, 7 are independent and can be done in parallel with steps 3-4.

## Verification

- Change global color in Settings → all UI elements update (sidebar selection, tab underline, editor caret, links, focus rings, graph edges)
- Switch to a collection with a color override → UI updates to the override color
- Switch back to a collection without an override → UI reverts to the global color
- Pick a very dark color (e.g., `#1a0505`) → luminance warning appears, auto-adjust brightens it
- Preset colors all render correctly on the dark background
- CodeMirror caret, selection, and syntax highlighting use the new color
- Mermaid diagrams re-render with the new primary color
- 3D graph arrows use the new color
- Remove a collection → its color override is cleaned up from the store
- Restart the app → colors are restored from electron-store

## Testing

- **Unit tests** for `color-utils.ts`: luminance calculation, hex/HSL round-trip, variant derivation, all presets pass luminance check
- **Unit tests** for accent-color store: effective color resolution (collection > global > default)
- **Unit tests** for store functions: get/set primary color, get/set collection color, removal cleanup
- **Component test** for `ColorPicker.svelte`: renders presets, selection callback, luminance warning, reset button
