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

  it('contains no stale repository owner strings in app source', () => {
    const stale = /nicholasgriffintn|nickarino/i
    const matches = sourceFiles(join(appRoot, 'src')).filter((path) =>
      stale.test(readFileSync(path, 'utf8'))
    )
    expect(matches).toEqual([])
  })
})
