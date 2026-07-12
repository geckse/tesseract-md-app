import { describe, it, expect } from 'vitest'
import {
  classifyCliError,
  settingsCtaFor,
  type ClassifiedError
} from '../../src/renderer/lib/cli-errors'
import { CliNotFoundError, CliExecutionError } from '../../src/main/errors'

/**
 * CROSS-REPO CONTRACT PIN.
 *
 * The fixture strings below are copied VERBATIM from the Rust mdvdb CLI's
 * error messages. If the CLI ever rewords them, classifyCliError silently
 * degrades to 'unknown' and these tests must be updated together with the
 * classifier. Rust sources (mdvdb CLI repo root):
 *   - src/embedding/provider.rs (~line 28)  → RUST_MISSING_KEY
 *   - src/embedding/openai.rs   (~line 109) → RUST_BAD_KEY
 *   - src/embedding/openai.rs   (~line 119) → RUST_RATE_LIMIT
 *   - src/embedding/ollama.rs   (~line 72)  → RUST_OLLAMA_UNREACHABLE
 *   - src/embedding/ollama.rs   (~line 84)  → RUST_OLLAMA_MODEL_MISSING
 * All are wrapped by src/error.rs's thiserror Display as
 * "embedding provider error: {0}" before reaching stderr.
 */
const RUST_MISSING_KEY = 'OpenAI provider requires OPENAI_API_KEY to be set'
const RUST_BAD_KEY = 'authentication failed (401): invalid API key'
const RUST_RATE_LIMIT = 'rate limited (429)'
const RUST_OLLAMA_UNREACHABLE = 'Cannot connect to Ollama at http://localhost:11434'
const RUST_OLLAMA_MODEL_MISSING = 'Model nomic-embed-text not found in Ollama'

/** Rust src/error.rs Display prefix for Error::EmbeddingProvider. */
const RUST_DISPLAY_PREFIX = 'embedding provider error: '

/** Wrap a raw stderr line the way src/main/cli.ts builds CliExecutionError. */
function execError(stderr: string): CliExecutionError {
  return new CliExecutionError(
    `CLI command 'ingest' failed after 3 attempts: ${stderr}. Please check the CLI output or try again.`,
    1,
    stderr
  )
}

describe('classifyCliError', () => {
  it('classifies the verbatim missing OPENAI_API_KEY message as missing-key', () => {
    const result = classifyCliError(execError(RUST_DISPLAY_PREFIX + RUST_MISSING_KEY))
    expect(result.kind).toBe('missing-key')
    expect(result.settingsCta).toBe(true)
    expect(result.title).toBe('API key missing')
    expect(result.message).toContain('OPENAI_API_KEY')
  })

  it('classifies the verbatim 401 message as bad-key', () => {
    const result = classifyCliError(execError(RUST_DISPLAY_PREFIX + RUST_BAD_KEY))
    expect(result.kind).toBe('bad-key')
    expect(result.settingsCta).toBe(true)
    expect(result.title).toBe('Invalid API key')
  })

  it('classifies the verbatim 429 message as rate-limit WITHOUT a settings CTA', () => {
    const result = classifyCliError(execError(RUST_DISPLAY_PREFIX + RUST_RATE_LIMIT))
    expect(result.kind).toBe('rate-limit')
    expect(result.settingsCta).toBe(false)
    expect(result.message).toMatch(/try again/i)
  })

  it('classifies the verbatim Ollama connect message as ollama-unreachable', () => {
    const result = classifyCliError(execError(RUST_DISPLAY_PREFIX + RUST_OLLAMA_UNREACHABLE))
    expect(result.kind).toBe('ollama-unreachable')
    expect(result.settingsCta).toBe(true)
  })

  it('classifies the verbatim Ollama model message as ollama-model-missing with the model name', () => {
    const result = classifyCliError(execError(RUST_DISPLAY_PREFIX + RUST_OLLAMA_MODEL_MISSING))
    expect(result.kind).toBe('ollama-model-missing')
    expect(result.settingsCta).toBe(true)
    expect(result.message).toContain('nomic-embed-text')
    expect(result.message).toContain('ollama pull nomic-embed-text')
  })

  it('matches patterns present only in stderr, not in the message', () => {
    const err = new CliExecutionError(
      'Failed to get CLI version',
      1,
      RUST_DISPLAY_PREFIX + RUST_MISSING_KEY
    )
    expect(classifyCliError(err).kind).toBe('missing-key')
  })

  it('classifies CliNotFoundError by name as cli-missing', () => {
    const result = classifyCliError(new CliNotFoundError())
    expect(result.kind).toBe('cli-missing')
    expect(result.settingsCta).toBe(true)
    expect(result.message).toMatch(/reinstall/i)
  })

  it('classifies a deserialized-shaped error with name CliNotFoundError as cli-missing', () => {
    // Preload rethrows deserialized errors — simulate the minimal shape it produces
    const err = new Error('mdvdb CLI binary not found on PATH')
    err.name = 'CliNotFoundError'
    expect(classifyCliError(err).kind).toBe('cli-missing')
  })

  it('passes through unknown Error messages verbatim', () => {
    const result = classifyCliError(new Error('something exploded'))
    expect(result.kind).toBe('unknown')
    expect(result.message).toBe('something exploded')
    expect(result.settingsCta).toBe(false)
  })

  it('preserves the index-corrupted text in the unknown passthrough (IngestModal branch depends on it)', () => {
    const result = classifyCliError(execError('Error: index corrupted: bad header magic'))
    expect(result.kind).toBe('unknown')
    expect(result.message.toLowerCase()).toContain('index corrupted')
  })

  it('stringifies non-Error inputs', () => {
    const result = classifyCliError('plain string failure')
    expect(result.kind).toBe('unknown')
    expect(result.message).toBe('plain string failure')
  })
})

describe('settingsCtaFor', () => {
  function classified(kind: ClassifiedError['kind'], settingsCta: boolean): ClassifiedError {
    return { kind, title: 't', message: 'm', settingsCta }
  }

  it('returns embedding-section CTA for provider/key errors', () => {
    for (const kind of [
      'missing-key',
      'bad-key',
      'ollama-unreachable',
      'ollama-model-missing'
    ] as const) {
      expect(settingsCtaFor(classified(kind, true))).toEqual({
        label: 'Open Embedding Settings',
        section: 'embedding'
      })
    }
  })

  it('returns cli-section CTA for cli-missing', () => {
    expect(settingsCtaFor(classified('cli-missing', true))).toEqual({
      label: 'Open CLI Settings',
      section: 'cli'
    })
  })

  it('returns null when settingsCta is false', () => {
    expect(settingsCtaFor(classified('rate-limit', false))).toBeNull()
    expect(settingsCtaFor(classified('unknown', false))).toBeNull()
  })
})
