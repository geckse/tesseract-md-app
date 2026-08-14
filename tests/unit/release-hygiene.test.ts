import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const appRoot = resolve(__dirname, '../..')

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? sourceFiles(path) : [path]
  })
}

describe('release hygiene', () => {
  it('ships the MIT license in the app repository', () => {
    expect(existsSync(join(appRoot, 'LICENSE'))).toBe(true)
  })

  it('supports macOS 11 and later', () => {
    const pkg = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8'))
    expect(pkg.build.mac.minimumSystemVersion).toBe('11.0')
  })

  it('requires signed production macOS builds and keeps unsigned builds explicit', () => {
    const pkg = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8'))
    expect(pkg.build.mac.forceCodeSigning).toBe(true)
    expect(pkg.scripts['build:mac']).toContain('MACOS_RELEASE_BUILD=true')
    expect(pkg.scripts['build:mac:unsigned']).toContain('CSC_IDENTITY_AUTO_DISCOVERY=false')
  })

  it('keeps the runtime application identity aligned with the packaged Bundle ID', () => {
    const pkg = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8'))
    const main = readFileSync(join(appRoot, 'src/main/index.ts'), 'utf8')
    expect(main).toContain(`electronApp.setAppUserModelId('${pkg.build.appId}')`)
  })

  it('gates releases on tests and verifies the macOS signature and notarization ticket', () => {
    const workflow = readFileSync(join(appRoot, '.github/workflows/build-app.yml'), 'utf8')
    expect(workflow).toContain('needs: checks')
    expect(workflow).toContain('default: mac')
    expect(workflow).toContain('fail-fast: false')
    expect(workflow).toContain("MACOS_RELEASE_BUILD: 'true'")
    expect(workflow).toContain('Authority=Developer ID Application:')
    expect(workflow).toContain('codesign --verify --deep --strict')
    expect(workflow).toContain('xcrun stapler validate')
    expect(workflow).toContain('spctl --assess --type execute')
  })

  it('loads the ESLint flat config as an ES module', () => {
    expect(existsSync(join(appRoot, 'eslint.config.mjs'))).toBe(true)
    expect(existsSync(join(appRoot, 'eslint.config.js'))).toBe(false)
  })

  it('registers synchronous preload IPC before creating the first window', () => {
    const main = readFileSync(join(appRoot, 'src/main/index.ts'), 'utf8')
    expect(main.indexOf('registerStartupIpcHandlers()')).toBeGreaterThan(-1)
    expect(main.indexOf('windowManager.createWindow()')).toBeGreaterThan(
      main.indexOf('registerStartupIpcHandlers()')
    )
    expect(main.indexOf('registerIpcHandlers(windowManager, ptyManager)')).toBeGreaterThan(
      main.indexOf('windowManager.createWindow()')
    )
  })

  it('permits the bundled Material Symbols data font in the renderer CSP', () => {
    const html = readFileSync(join(appRoot, 'src/renderer/index.html'), 'utf8')
    expect(html).toContain("font-src 'self' data:")
  })

  it('contains no stale repository owner strings in app source', () => {
    const stale = /nicholasgriffintn|nickarino/i
    const matches = sourceFiles(join(appRoot, 'src')).filter((path) =>
      stale.test(readFileSync(path, 'utf8'))
    )
    expect(matches).toEqual([])
  })

  it('does not ship a grain or procedural noise overlay in the renderer', () => {
    const forbiddenTexture = /bg-grain|fractalNoise|noiseFilter|--z-grain/
    const matches = sourceFiles(join(appRoot, 'src/renderer')).filter((path) =>
      forbiddenTexture.test(readFileSync(path, 'utf8'))
    )
    expect(matches).toEqual([])
  })

  it('bundles only the app-specific tesseract-skills plugin for project installation', () => {
    const pkg = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8'))
    expect(pkg.build.extraResources).toEqual([
      {
        from: '../tesseract-skills/plugins/tesseract',
        to: 'tesseract-skills'
      },
      {
        from: 'tesseract-skills/plugins/tesseract',
        to: 'tesseract-skills'
      }
    ])

    const releaseWorkflow = readFileSync(join(appRoot, '.github/workflows/build-app.yml'), 'utf8')
    expect(releaseWorkflow).toContain('repository: geckse/tesseract-md-skills')
  })

  it('places the collection skills banner immediately above the footer status bar', () => {
    const app = readFileSync(join(appRoot, 'src/renderer/App.svelte'), 'utf8')
    expect(app).toMatch(/<BottomPanel \/>\s*<CollectionSkillsNotification \/>\s*<StatusBar \/>/)
  })
})
