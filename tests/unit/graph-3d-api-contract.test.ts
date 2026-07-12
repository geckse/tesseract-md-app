import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

/**
 * API-contract test for the 3d-force-graph builder chain in GraphView.svelte.
 *
 * 3d-force-graph is Kapsule-based: calling a method that doesn't exist throws
 * a TypeError at runtime, mid-chain, inside an async store-subscription
 * callback — the graph never initializes and the view silently shows nothing.
 * `tsc --noEmit` does not typecheck .svelte script blocks and the chain ends
 * in an `as GraphInstance` cast, so nothing static catches it.
 *
 * Regression: `.linkLineDash(...)` (a 2D force-graph API that does not exist
 * on 3d-force-graph) broke graph initialization with no visible error.
 */

const ROOT = path.resolve(__dirname, '../..')

/** Method names declared in the installed graph libraries' type definitions. */
function declaredApiMethods(): Set<string> {
  const dtsFiles = [
    'node_modules/3d-force-graph/dist/3d-force-graph.d.ts',
    'node_modules/three-forcegraph/dist/three-forcegraph.d.ts'
  ]
  const declared = new Set<string>()
  for (const rel of dtsFiles) {
    const file = path.join(ROOT, rel)
    expect(fs.existsSync(file), `${rel} missing — dependency layout changed?`).toBe(true)
    const src = fs.readFileSync(file, 'utf8')
    for (const m of src.matchAll(/^\s+(\w+)\s*[(<]/gm)) declared.add(m[1])
  }
  return declared
}

/** Graph-instance methods GraphView.svelte actually calls. */
function usedGraphMethods(): Set<string> {
  const src = fs.readFileSync(path.join(ROOT, 'src/renderer/components/GraphView.svelte'), 'utf8')
  const used = new Set<string>()

  // The init builder chain: new ForceGraph3D(...)....as GraphInstance
  const start = src.indexOf('new ForceGraph3D(')
  expect(start, 'initializeGraph chain not found — update this test').toBeGreaterThan(-1)
  const end = src.indexOf('as GraphInstance', start)
  expect(end, 'chain terminator cast not found — update this test').toBeGreaterThan(start)
  for (const m of src.slice(start, end).matchAll(/^\s+\.(\w+)\(/gm)) used.add(m[1])

  // Direct calls on the instance elsewhere in the component
  for (const m of src.matchAll(/graph[!?]?\s*\.\s*(\w+)\(/g)) used.add(m[1])

  return used
}

describe('GraphView 3d-force-graph API contract', () => {
  it('only calls methods that exist in the installed 3d-force-graph API', () => {
    const declared = declaredApiMethods()
    const used = usedGraphMethods()

    expect(used.size).toBeGreaterThan(20) // sanity: extraction still finds the chain

    const missing = [...used].filter((name) => !declared.has(name))
    expect(
      missing,
      `GraphView.svelte calls graph methods that do not exist in the installed ` +
        `3d-force-graph/three-forcegraph API and will throw at runtime: ${missing.join(', ')}`
    ).toEqual([])
  })

  it('does not use the 2D-only linkLineDash API', () => {
    // linkLineDash exists only in the 2D force-graph library; on 3d-force-graph
    // it throws and prevents the graph from initializing at all.
    expect(usedGraphMethods().has('linkLineDash')).toBe(false)
  })
})
