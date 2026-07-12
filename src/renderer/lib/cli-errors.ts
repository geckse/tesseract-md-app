/**
 * CLI error classifier — turns raw CLI bridge errors into actionable UI states.
 *
 * The string patterns matched here PIN a cross-repo contract with the Rust
 * CLI's error messages (verbatim fixtures live in tests/unit/cli-errors.test.ts).
 * Rust sources (relative to the mdvdb CLI repo root):
 *   - src/embedding/provider.rs — "OpenAI provider requires OPENAI_API_KEY to be set"
 *   - src/embedding/openai.rs   — "authentication failed (401): invalid API key",
 *                                 "rate limited (429)"
 *   - src/embedding/ollama.rs   — "Cannot connect to Ollama at {host}",
 *                                 "Model {model} not found in Ollama"
 * All of the above are wrapped by src/error.rs as "embedding provider error: {0}".
 * Matching is substring-based so wrapping prefixes and retry decoration from
 * src/main/cli.ts do not break classification.
 */

/** Discriminant for the actionable error states the UI knows how to render. */
export type CliErrorKind =
  | 'missing-key'
  | 'bad-key'
  | 'rate-limit'
  | 'ollama-unreachable'
  | 'ollama-model-missing'
  | 'cli-missing'
  | 'unknown'

/** A CLI error classified into a user-facing title, guidance, and CTA flag. */
export interface ClassifiedError {
  kind: CliErrorKind
  title: string
  message: string
  /** Whether the UI should offer a "fix it in Settings" call to action. */
  settingsCta: boolean
}

/** Settings deep-link for a classified error's CTA button (null when no CTA). */
export interface SettingsCta {
  label: string
  /** Section argument for openSettingsSection('global', section). */
  section: 'embedding' | 'cli'
}

/** Combine an error's message with its stderr (CliExecutionError carries both). */
function haystackFor(err: unknown): string {
  if (err instanceof Error) {
    const stderr = (err as Error & { stderr?: unknown }).stderr
    return typeof stderr === 'string' && stderr.length > 0
      ? `${err.message}\n${stderr}`
      : err.message
  }
  return String(err)
}

/** Classify a CLI bridge error (as thrown by window.api.*) into an actionable state. */
export function classifyCliError(err: unknown): ClassifiedError {
  if (err instanceof Error && err.name === 'CliNotFoundError') {
    return {
      kind: 'cli-missing',
      title: 'mdvdb CLI not found',
      message:
        'The mdvdb CLI binary could not be found on this system. Reinstall it from the CLI settings.',
      settingsCta: true
    }
  }

  const text = haystackFor(err)

  // src/embedding/provider.rs — missing key is detected before any request is made
  if (text.includes('OPENAI_API_KEY')) {
    return {
      kind: 'missing-key',
      title: 'API key missing',
      message:
        'No OpenAI API key is configured. Add your OPENAI_API_KEY in the embedding settings, then run the operation again.',
      settingsCta: true
    }
  }

  // src/embedding/openai.rs — 401 from the provider
  if (text.includes('authentication failed (401)') || text.includes('invalid API key')) {
    return {
      kind: 'bad-key',
      title: 'Invalid API key',
      message:
        'The embedding provider rejected the configured API key (401). Check the key in the embedding settings.',
      settingsCta: true
    }
  }

  // src/embedding/openai.rs — 429 from the provider (transient, retry — no settings fix)
  if (text.includes('rate limited (429)')) {
    return {
      kind: 'rate-limit',
      title: 'Rate limited',
      message:
        'The embedding provider is rate limiting requests (429). Wait a moment and try again.',
      settingsCta: false
    }
  }

  // src/embedding/ollama.rs — connection refused
  if (text.includes('Cannot connect to Ollama')) {
    return {
      kind: 'ollama-unreachable',
      title: 'Ollama unreachable',
      message:
        'Cannot connect to Ollama. Make sure Ollama is running, or check the host in the embedding settings.',
      settingsCta: true
    }
  }

  // src/embedding/ollama.rs — model not pulled
  if (text.includes('not found in Ollama')) {
    const model = text.match(/Model (\S+) not found in Ollama/)?.[1]
    return {
      kind: 'ollama-model-missing',
      title: 'Ollama model missing',
      message: model
        ? `The embedding model "${model}" is not installed in Ollama. Run \`ollama pull ${model}\` or pick another model in the embedding settings.`
        : 'The configured embedding model is not installed in Ollama. Pull it with `ollama pull` or pick another model in the embedding settings.',
      settingsCta: true
    }
  }

  return {
    kind: 'unknown',
    title: 'Command failed',
    message: err instanceof Error ? err.message : String(err),
    settingsCta: false
  }
}

/** Resolve the settings CTA (label + settings section) for a classified error. */
export function settingsCtaFor(error: ClassifiedError): SettingsCta | null {
  if (!error.settingsCta) return null
  if (error.kind === 'cli-missing') {
    return { label: 'Open CLI Settings', section: 'cli' }
  }
  return { label: 'Open Embedding Settings', section: 'embedding' }
}
