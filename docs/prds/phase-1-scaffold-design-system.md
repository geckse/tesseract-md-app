# PRD: Project Scaffold & Design System

## Overview

Bootstrap the Electron desktop app with electron-vite, Svelte, TypeScript, and Tailwind CSS. Establish the complete design system from the mockup, base UI components, app shell layout, and the full testing infrastructure (Vitest + Playwright). This phase produces a working Electron window with the design tokens rendered, an empty sidebar shell, and the testing pipeline running — no app functionality yet.

## Problem Statement

mdvdb is a powerful CLI tool but has no graphical interface. End users who want a visual way to browse collections, edit markdown, and manage settings need a desktop app. Before any features can be built, the project needs a solid foundation: build tooling, design system, component library, and automated testing.

## Goals

- Working Electron app window with the dark design system rendered
- Tailwind configuration with exact design tokens from the mockup
- CSS variables for all design tokens (colors, fonts, spacing)
- Base component library (Button, IconButton, Badge, Kbd, Input)
- App shell layout matching the mockup (sidebar, header, content area, status bar)
- Vitest unit test runner with @testing-library/svelte
- Playwright E2E test runner that launches the Electron app
- ESLint + Prettier configured
- All three platforms build without errors (macOS, Windows, Linux)

## Non-Goals

- No CLI integration (Phase 2)
- No collection management (Phase 3)
- No file tree rendering (Phase 4)
- No markdown editing (Phase 5)
- No functional sidebar navigation — just the visual skeleton
- No light mode (dark-mode only for the entire app)

## Technical Design

### Project Structure

```
app/
├── electron.vite.config.ts      # electron-vite configuration
├── package.json                 # Dependencies, scripts
├── tsconfig.json                # TypeScript config
├── tailwind.config.ts           # Tailwind with design tokens
├── playwright.config.ts         # E2E test config
├── .eslintrc.cjs                # ESLint config
├── .prettierrc                  # Prettier config
├── src/
│   ├── main/
│   │   └── index.ts             # Electron main process entry
│   ├── preload/
│   │   └── index.ts             # Context bridge (empty for now)
│   └── renderer/
│       ├── index.html           # HTML entry point
│       ├── App.svelte           # Root component
│       ├── styles/
│       │   ├── variables.css    # CSS custom properties
│       │   ├── global.css       # Global styles, scrollbars, grain texture
│       │   └── tailwind.css     # Tailwind directives
│       └── components/
│           ├── Sidebar.svelte   # Left sidebar shell
│           ├── Header.svelte    # Top header bar
│           ├── StatusBar.svelte # Bottom status bar
│           └── ui/
│               ├── Button.svelte
│               ├── IconButton.svelte
│               ├── Badge.svelte
│               ├── Kbd.svelte
│               └── Input.svelte
├── tests/
│   ├── unit/                    # Vitest unit tests
│   │   ├── Button.test.ts
│   │   ├── Badge.test.ts
│   │   └── design-tokens.test.ts
│   └── e2e/                     # Playwright E2E tests
│       └── app-launch.test.ts
└── resources/
    └── icon.png                 # App icon (cyan database icon)
```

### Design System (from mockup)

**Colors:**
| Token | Value | CSS Variable |
|---|---|---|
| primary | `#00E5FF` | `--color-primary` |
| primary-dark | `#00B8CC` | `--color-primary-dark` |
| primary-dim | `rgba(0, 229, 255, 0.1)` | `--color-primary-dim` |
| background-dark | `#0f0f10` | `--color-bg` |
| surface-dark | `#161617` | `--color-surface` |
| surface-darker | `#0a0a0a` | `--color-surface-darker` |
| border-dark | `#27272a` | `--color-border` |
| text-main | `#e4e4e7` | `--color-text` |
| text-dim | `#71717a` | `--color-text-dim` |
| text-syntax | `#526366` | `--color-text-syntax` |

**Typography:**
| Token | Value | CSS Variable |
|---|---|---|
| font-display | Space Grotesk, sans-serif | `--font-display` |
| font-mono | JetBrains Mono, monospace | `--font-mono` |

**Icons:** Material Symbols Outlined (weight 100-700, fill 0-1)

**Effects:**
- Grain texture overlay: SVG noise filter at 4% opacity, `pointer-events: none`
- Custom scrollbars: 8px width, `#27272a` thumb, `#0f0f10` track, 4px border-radius
- Selection color: `bg-primary text-surface-darker`

### Tailwind Configuration

```typescript
// tailwind.config.ts
export default {
  darkMode: "class",
  content: ["./src/renderer/**/*.{svelte,ts,html}"],
  theme: {
    extend: {
      colors: {
        primary: "#00E5FF",
        "primary-dark": "#00B8CC",
        "primary-dim": "rgba(0, 229, 255, 0.1)",
        "background-dark": "#0f0f10",
        "surface-dark": "#161617",
        "surface-darker": "#0a0a0a",
        "border-dark": "#27272a",
        "text-main": "#e4e4e7",
        "text-dim": "#71717a",
        "text-syntax": "#526366",
      },
      fontFamily: {
        display: ["Space Grotesk", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
    },
  },
}
```

### App Shell Layout

```
┌──────────────────────────────────────────────────────────┐
│ [Sidebar 256px]  │  [Header 56px height]                 │
│                  ├───────────────────────────────────────│
│  Logo + mdvdb    │                                       │
│                  │                                       │
│  COLLECTIONS     │         [Content Area]                │
│  ☆ Favorites     │         (empty for now)               │
│  ◷ Recent        │                                       │
│                  │                                       │
│  KNOWLEDGE BASE  │                                       │
│  (empty list)    │                                       │
│                  │                                       │
│  ──────────────  │                                       │
│  [User area]     ├───────────────────────────────────────│
│                  │  [Status Bar 28px height]              │
└──────────────────┴───────────────────────────────────────┘
```

### Interface Changes

None — this is the initial scaffold. No public API yet.

### New Commands / API / UI

**package.json scripts:**
- `npm run dev` — Start Electron in development mode with hot reload
- `npm run build` — Build for current platform
- `npm run test` — Run Vitest unit tests
- `npm run test:e2e` — Run Playwright E2E tests
- `npm run lint` — ESLint + Prettier check
- `npm run lint:fix` — Auto-fix lint issues

### Migration Strategy

N/A — greenfield project.

## Implementation Steps

1. **Initialize electron-vite project** — Run `npm create @quick-start/electron` with Svelte + TypeScript template. Place in `app/` directory. Configure `electron.vite.config.ts` for the three-directory structure (`src/main`, `src/preload`, `src/renderer`).

2. **Install dependencies** — Add: `tailwindcss`, `postcss`, `autoprefixer`, `@tailwindcss/forms`, `@tailwindcss/container-queries`. Dev deps: `vitest`, `@testing-library/svelte`, `jsdom`, `playwright`, `@playwright/test`, `eslint`, `prettier`, `eslint-plugin-svelte`.

3. **Configure Tailwind** — Create `tailwind.config.ts` with the exact design tokens from the mockup (colors, fonts). Create `postcss.config.js`. Create `src/renderer/styles/tailwind.css` with `@tailwind base/components/utilities` directives.

4. **Create CSS variables file** — `src/renderer/styles/variables.css` exposing all design tokens as `--color-*`, `--font-*` variables. Import in the main entry point.

5. **Create global styles** — `src/renderer/styles/global.css` with: grain texture overlay (`::before` pseudo-element with SVG noise), custom scrollbar styles, selection color, `antialiased` rendering, `html.dark` class on root.

6. **Load fonts** — Add Google Fonts links to `src/renderer/index.html`: Space Grotesk (300-700), JetBrains Mono (400, 500), Material Symbols Outlined.

7. **Build base UI components** — Create `src/renderer/components/ui/`:
   - `Button.svelte`: primary and secondary variants, size props, Tailwind classes
   - `IconButton.svelte`: icon-only button with hover states
   - `Badge.svelte`: colored status badges (with variant prop for different colors)
   - `Kbd.svelte`: keyboard shortcut display (styled like mockup's `⌘K`)
   - `Input.svelte`: text input with search icon slot, focus ring in primary color

8. **Build Sidebar shell** — `src/renderer/components/Sidebar.svelte`:
   - Fixed 256px width, `bg-surface-darker`, right border
   - Header: 56px height, mdvdb logo (cyan database icon) + "mdvdb" text
   - "Collections" section header with Favorites and Recent nav items (non-functional)
   - "Knowledge Base" section header with empty list
   - Bottom user area (just shows system username or placeholder, no account system)

9. **Build Header shell** — `src/renderer/components/Header.svelte`:
   - 56px height, `bg-background-dark/95 backdrop-blur-md`
   - Left: breadcrumb placeholder ("mdvdb")
   - Right: search input placeholder (disabled), properties toggle button, Edit button

10. **Build StatusBar** — `src/renderer/components/StatusBar.svelte`:
    - 28px height, `bg-surface-darker`, top border
    - Left: "Markdown" label, word count, reading time (all placeholder values)
    - Right: sync status indicator (dim "—"), "UTF-8"

11. **Compose App.svelte** — Wire Sidebar, Header, content area, and StatusBar into the main layout. Apply `bg-grain` class. Set `html` class to `dark`.

12. **Configure Electron main process** — `src/main/index.ts`: create BrowserWindow with `minWidth: 900`, `minHeight: 600`, dark title bar, load the renderer. Enable `contextIsolation` and `nodeIntegration: false`.

13. **Configure testing** — Set up `vitest.config.ts` with jsdom environment and Svelte transform. Set up `playwright.config.ts` targeting the Electron app. Create test directory structure.

14. **Write unit tests** — `tests/unit/design-tokens.test.ts`: verify CSS variables are defined. `tests/unit/Button.test.ts`: render Button, verify correct CSS classes. `tests/unit/Badge.test.ts`: render Badge with variant, verify color.

15. **Write E2E test** — `tests/e2e/app-launch.test.ts`: launch Electron app via Playwright, verify window title, verify sidebar logo text "mdvdb" is visible, verify window dimensions meet minimums, take screenshot.

16. **Configure ESLint + Prettier** — Standard Svelte + TypeScript ESLint config. Prettier with Svelte plugin. Add lint scripts to `package.json`.

## Validation Criteria

- [ ] `npm run dev` opens an Electron window with the dark design system rendered
- [ ] Background color is `#0f0f10`, sidebar is `#0a0a0a`, borders are `#27272a`
- [ ] Fonts loaded: Space Grotesk for body text, JetBrains Mono for mono elements
- [ ] Grain texture overlay visible (subtle noise pattern)
- [ ] Custom scrollbars styled (dark track, zinc thumb)
- [ ] Sidebar shows "mdvdb" logo, "Collections" header, "Knowledge Base" header
- [ ] Status bar visible at bottom with placeholder content
- [ ] `npm run test` passes all unit tests
- [ ] `npm run test:e2e` launches app and passes all E2E assertions
- [ ] `npm run build` succeeds on macOS, Windows, and Linux
- [ ] `npm run lint` passes with zero errors
- [ ] All base components (Button, IconButton, Badge, Kbd, Input) render correctly

## Anti-Patterns to Avoid

- **Do NOT use hardcoded color values in components** — Always reference Tailwind tokens or CSS variables. Every color must come from the design system, never a raw hex value in a component.
- **Do NOT use `nodeIntegration: true`** — The renderer process must be sandboxed. All Node.js access goes through the preload script via `contextBridge`.
- **Do NOT import fonts from npm packages** — Use Google Fonts CDN links in `index.html` for simplicity. Self-hosting fonts adds build complexity without benefit at this stage.
- **Do NOT use Tailwind's built-in dark mode classes** — The app is dark-mode ONLY. Set `class="dark"` on `<html>` and use the design tokens directly. No light mode toggle.
- **Do NOT create a monolithic styles file** — Split into `variables.css` (tokens), `global.css` (resets/scrollbars/grain), `tailwind.css` (directives). Keeps concerns separate.

## Patterns to Follow

- **Design tokens from mockup** — Reference `docs/prds/app/app-mockup-code.html` for exact color values, font sizes, spacing, and component styling. Every visual decision should trace back to this file.
- **Svelte component conventions** — Each component in its own `.svelte` file. Props typed with TypeScript. Use Svelte's reactive declarations (`$:`) for derived state.
- **Tailwind utility-first** — Prefer Tailwind classes over custom CSS. Only use custom CSS for things Tailwind can't express (grain texture, scrollbars, complex pseudo-elements).
- **electron-vite conventions** — Follow the three-directory structure (`src/main`, `src/preload`, `src/renderer`). Use the recommended import aliases.
