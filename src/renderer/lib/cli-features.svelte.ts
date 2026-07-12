/**
 * CLI capability gating (phase 42).
 *
 * The app spawns whatever `mdvdb` binary it finds — features that require a
 * newer CLI (relations / `--populate`) must be gated on its version, or the
 * spawned CLI errors on unknown flags. Rules:
 *  - Unparseable or missing version ⇒ unsupported (safe default).
 *  - Gates CAPABILITIES only (passing `--populate`, offering the Relation
 *    type, the target-folder field, the Referenced-by section) — NEVER
 *    rendering: a `Relation` column arriving from any source must render.
 *
 * Svelte 5 runes singleton (MUST remain a .svelte.ts file).
 */

/** The mdvdb version that ships phase-31 frontmatter relations. */
export const MDVDB_RELATIONS_MIN_VERSION = '0.2.0'

/** Oldest mdvdb version supported by this app release. */
export const MDVDB_MIN_SUPPORTED_VERSION = '0.2.0'

/** Plain numeric semver compare: negative/zero/positive like `a - b`. NaN-safe. */
export function compareSemver(a: string, b: string): number | null {
  const parse = (v: string): number[] | null => {
    const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim())
    if (!m) return null
    return [Number(m[1]), Number(m[2]), Number(m[3])]
  }
  const pa = parse(a)
  const pb = parse(b)
  if (!pa || !pb) return null
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i]
  }
  return 0
}

class CliFeatures {
  /** Detected CLI version (e.g. "0.2.0"), or null while unknown/undetected. */
  version = $state<string | null>(null)

  private initPromise: Promise<void> | null = null

  /** Whether the detected CLI supports phase-31 relations (`--populate` etc.). */
  get supportsRelations(): boolean {
    if (this.version === null) return false
    const cmp = compareSemver(this.version, MDVDB_RELATIONS_MIN_VERSION)
    return cmp !== null && cmp >= 0
  }

  /** Whether the detected CLI is valid semver but too old for this app. */
  get isOutdated(): boolean {
    if (this.version === null) return false
    const cmp = compareSemver(this.version, MDVDB_MIN_SUPPORTED_VERSION)
    return cmp !== null && cmp < 0
  }

  /**
   * Fetch the CLI version once at startup (idempotent). Single-flight:
   * concurrent callers share the in-flight fetch, so awaiting init()
   * guarantees detection has SETTLED — loads whose request shape depends on
   * `supportsRelations` await this instead of racing ahead with a stale
   * `false`. Failures leave `version` null — every capability stays off.
   */
  init(): Promise<void> {
    this.initPromise ??= (async () => {
      try {
        this.version = (await window.api.getCliVersion()) ?? null
      } catch {
        this.version = null
      }
    })()
    return this.initPromise
  }

  /** Test hook: reset detection state. */
  reset(): void {
    this.initPromise = null
    this.version = null
  }
}

/** Singleton CLI feature-gate store. */
export const cliFeatures = new CliFeatures()
