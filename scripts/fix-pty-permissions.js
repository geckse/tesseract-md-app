/* eslint-disable @typescript-eslint/no-require-imports */
/**
 * Ensure node-pty's `spawn-helper` prebuilds are executable.
 *
 * node-pty ships prebuilt `spawn-helper` binaries for macOS/Linux that it
 * exec()s on every PTY spawn. npm install can strip the execute bit when
 * unpacking, which makes posix_spawnp fail ("posix_spawnp failed.") and breaks
 * the embedded terminal. We restore the bit after every install.
 *
 * No-op on Windows (no spawn-helper, no POSIX permission bits).
 */
const { chmodSync, existsSync, readdirSync, statSync } = require('node:fs')
const { join } = require('node:path')

if (process.platform === 'win32') {
  process.exit(0)
}

// Base dir is the app root by default; overridable via arg for testing.
const baseDir = process.argv[2] || join(__dirname, '..')
const prebuildsDir = join(baseDir, 'node_modules', 'node-pty', 'prebuilds')

if (!existsSync(prebuildsDir)) {
  // node-pty not installed (or layout changed) — nothing to do.
  process.exit(0)
}

let fixed = 0
for (const platformDir of readdirSync(prebuildsDir)) {
  const helper = join(prebuildsDir, platformDir, 'spawn-helper')
  try {
    if (existsSync(helper) && statSync(helper).isFile()) {
      chmodSync(helper, 0o755)
      fixed++
    }
  } catch (err) {
    console.warn(`[fix-pty-permissions] could not chmod ${helper}: ${err.message}`)
  }
}

if (fixed > 0) {
  console.log(`[fix-pty-permissions] ensured execute bit on ${fixed} spawn-helper binary(ies)`)
}
