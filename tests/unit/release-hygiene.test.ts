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

  it("declares Electron 43's macOS 12 compatibility floor", () => {
    const pkg = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8'))
    expect(pkg.build.mac.minimumSystemVersion).toBe('12.0')
    expect(pkg.devDependencies.electron).toBe('43.4.0')
  })

  it('requires signed production macOS builds and keeps unsigned builds explicit', () => {
    const pkg = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8'))
    expect(pkg.build.mac.forceCodeSigning).toBe(true)
    expect(pkg.scripts['build:mac']).toContain('MACOS_RELEASE_BUILD=true')
    expect(pkg.scripts['build:mac:unsigned']).toContain('CSC_IDENTITY_AUTO_DISCOVERY=false')
  })

  it('uses the static AppImage runtime and explicit Linux desktop metadata', () => {
    const pkg = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8'))
    expect(pkg.build.toolsets.appimage).toBe('1.0.2')
    expect(pkg.build.linux.target).toEqual(['AppImage', 'deb'])
    expect(pkg.build.linux.executableArgs).not.toContain('--no-sandbox')
    expect(pkg.build.linux.desktop.entry.StartupWMClass).toBe(pkg.build.appId)
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
    expect(workflow).toContain("github.event_name == 'push'")
    expect(workflow).toContain('signed macOS and Windows artifacts')
    expect(workflow).toContain("MACOS_RELEASE_BUILD: 'true'")
    expect(workflow).toContain('Authority=Developer ID Application:')
    expect(workflow).toContain('codesign --verify --deep --strict')
    expect(workflow).toContain('xcrun stapler validate')
    expect(workflow).toContain('spctl --assess --type execute')
  })

  it('gates Windows releases on native E2E, signing, package launch, and clean install', () => {
    const pkg = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8'))
    const buildWorkflow = readFileSync(join(appRoot, '.github/workflows/build-app.yml'), 'utf8')
    const testWorkflow = readFileSync(join(appRoot, '.github/workflows/test.yml'), 'utf8')
    const signingConfig = readFileSync(
      join(appRoot, 'scripts/electron-builder.windows.cjs'),
      'utf8'
    )
    const verifier = readFileSync(join(appRoot, 'scripts/verify-windows-artifacts.ps1'), 'utf8')
    const windowsE2e = testWorkflow.slice(
      testWorkflow.indexOf('  e2e-win:'),
      testWorkflow.indexOf('  e2e-linux:')
    )

    expect(pkg.scripts.postinstall).toContain('node_modules/electron/install.js')
    expect(pkg.scripts['build:win']).toContain('electron-builder.windows.cjs')
    expect(windowsE2e.split('\n').slice(0, 3)).toEqual([
      '  e2e-win:',
      '    runs-on: windows-2022',
      '    steps:'
    ])
    expect(windowsE2e).toContain('cargo build --locked --release --no-default-features')
    expect(windowsE2e).toContain('npm run test:integration')
    expect(buildWorkflow).toContain('WINDOWS_RELEASE_BUILD')
    expect(buildWorkflow).toContain('AZURE_ARTIFACT_SIGNING_ENDPOINT')
    expect(buildWorkflow).toContain('windows-clean-install-smoke:')
    expect(buildWorkflow).toContain("$arguments = @{ ArtifactDirectory = 'dist' }")
    expect(buildWorkflow).toContain('InstallNsis = $true')
    expect(buildWorkflow).not.toContain("@('-ArtifactDirectory'")
    expect(signingConfig).toContain('config.forceCodeSigning = true')
    expect(signingConfig).toContain('azureSignOptions')
    expect(verifier).toContain('Get-AuthenticodeSignature')
    expect(verifier).toContain('Assert-X64PortableExecutable')
    expect(verifier).toContain("Start-AppSmoke $installedApplication 'Installed NSIS application'")
  })

  it('builds and verifies non-publishing Linux packages on Ubuntu 22.04 and 24.04', () => {
    const workflow = readFileSync(join(appRoot, '.github/workflows/build-app.yml'), 'utf8')
    const verifier = readFileSync(join(appRoot, 'scripts/verify-linux-artifacts.sh'), 'utf8')
    expect(workflow).toContain('ubuntu-22.04')
    expect(workflow).toContain('runs-on: ubuntu-24.04')
    expect(workflow).toContain('npx electron-builder --linux --x64 --publish never')
    expect(workflow).toContain('scripts/verify-linux-artifacts.sh dist amd64')
    expect(workflow).toContain('name: app-linux-x64')
    expect(workflow).toContain('dist/latest-linux*.yml')
    expect(verifier).toContain('if [[ "$module" == *musl* ]]')
    expect(verifier).toContain('ELF 64-bit LSB shared object, x86-64')
    expect(verifier).toContain('Skipping native module for another platform or architecture')
    expect(verifier).toContain('if ((checked_native_modules == 0))')
    expect(verifier).toContain("smoke_launch 'AppImage' env APPIMAGE_EXTRACT_AND_RUN=1")
    expect(verifier).toContain('smoke_launch \'Installed deb application\' "$installed_executable"')
    expect(workflow).toContain('Install and launch deb on Ubuntu 24.04')
  })

  it('treats Linux Electron E2E on the compatibility baseline as a release gate', () => {
    const pkg = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8'))
    const playwrightVersion = pkg.devDependencies['@playwright/test'].replace(/^[^\d]*/, '')
    const [major, minor] = playwrightVersion.split('.').map(Number)
    const playwrightConfig = readFileSync(join(appRoot, 'playwright.config.ts'), 'utf8')
    const workflow = readFileSync(join(appRoot, '.github/workflows/test.yml'), 'utf8')
    const graphSwitchE2e = readFileSync(
      join(appRoot, 'tests/e2e/graph-collection-switch.test.ts'),
      'utf8'
    )
    const linuxJob = workflow.slice(workflow.indexOf('  e2e-linux:'))
    expect(major > 1 || (major === 1 && minor >= 59)).toBe(true)
    expect(playwrightConfig).toContain("delete process.env['ELECTRON_RUN_AS_NODE']")
    expect(playwrightConfig).toContain("workers: process.env['CI'] ? 1 : 4")
    expect(graphSwitchE2e).toContain("'--enable-unsafe-swiftshader'")
    expect(linuxJob.split('\n').slice(0, 3)).toEqual([
      '  e2e-linux:',
      '    runs-on: ubuntu-22.04',
      '    steps:'
    ])
    expect(linuxJob).toContain('repository: geckse/markdown-vdb')
    expect(linuxJob).toContain("ref: ${{ vars.MDVDB_REF || 'main' }}")
    expect(linuxJob).toContain('cargo build --locked --release')
    expect(linuxJob).toContain('CXX: g++-12')
    expect(linuxJob).toContain('xvfb-run --auto-servernum -- npm run test:e2e')
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
      }
    ])

    const releaseWorkflow = readFileSync(join(appRoot, '.github/workflows/build-app.yml'), 'utf8')
    expect(releaseWorkflow).toContain('repository: geckse/tesseract-md-skills')
    expect(releaseWorkflow).toContain(
      'cp -R tesseract-skills/plugins/tesseract ../tesseract-skills/plugins/'
    )
    expect(releaseWorkflow).toContain(
      '$app_path/Contents/Resources/tesseract-skills/.claude-plugin/plugin.json'
    )
  })

  it('places the collection skills banner immediately above the footer status bar', () => {
    const app = readFileSync(join(appRoot, 'src/renderer/App.svelte'), 'utf8')
    expect(app).toMatch(/<BottomPanel \/>\s*<CollectionSkillsNotification \/>\s*<StatusBar \/>/)
  })
})
