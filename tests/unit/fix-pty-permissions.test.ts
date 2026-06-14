import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, statSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Verifies scripts/fix-pty-permissions.js restores the execute bit on
 * node-pty's spawn-helper binaries. Without it, posix_spawnp fails and the
 * embedded terminal cannot launch a shell.
 */
describe('fix-pty-permissions', () => {
  const scriptPath = join(__dirname, '..', '..', 'scripts', 'fix-pty-permissions.js')
  let work: string

  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), 'pty-perms-'))
  })

  afterEach(() => {
    rmSync(work, { recursive: true, force: true })
  })

  // chmod/permission bits are a no-op on Windows; skip there.
  const maybe = process.platform === 'win32' ? it.skip : it

  maybe('adds the execute bit to spawn-helper in each prebuild dir', () => {
    const prebuilds = join(work, 'node_modules', 'node-pty', 'prebuilds')
    const arch = ['darwin-arm64', 'darwin-x64']
    for (const dir of arch) {
      mkdirSync(join(prebuilds, dir), { recursive: true })
      const helper = join(prebuilds, dir, 'spawn-helper')
      writeFileSync(helper, '#!/bin/sh\n')
      chmodSync(helper, 0o644) // simulate npm stripping the execute bit
    }

    execFileSync('node', [scriptPath, work])

    for (const dir of arch) {
      const mode = statSync(join(prebuilds, dir, 'spawn-helper')).mode
      // owner-execute bit must be set
      expect(mode & 0o100).toBe(0o100)
    }
  })

  maybe('is a no-op when node-pty is absent', () => {
    // No node_modules/node-pty — should exit cleanly without throwing.
    expect(() => execFileSync('node', [scriptPath], { cwd: work })).not.toThrow()
  })
})
