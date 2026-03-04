/**
 * CLI binary detection and command execution.
 *
 * Spawns the `mdvdb` CLI as a child process, passing `--json` and `--root`
 * flags, and parses the JSON output into typed TypeScript objects.
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import {
  CliNotFoundError,
  CliExecutionError,
  CliParseError,
  CliTimeoutError
} from './errors'

const execFileAsync = promisify(execFile)

/** Binary name constant — single place to change if renamed */
const CLI_BINARY_NAME = 'mdvdb'

/** Default timeout for CLI commands (30 seconds) */
const DEFAULT_TIMEOUT_MS = 30_000

/** Default number of retry attempts */
const DEFAULT_RETRIES = 0

/** Base delay for exponential backoff (1 second) */
const BASE_RETRY_DELAY_MS = 1_000

/** Max buffer size for stdout/stderr (10 MB) */
const MAX_BUFFER = 10 * 1024 * 1024

/** Options for execCommand */
export interface ExecCommandOptions {
  timeout?: number
  retries?: number
}

/** Raw output from a CLI command */
export interface ExecRawResult {
  stdout: string
  stderr: string
  exitCode: number
}

/**
 * Sleep for a specified number of milliseconds.
 * Used for exponential backoff between retry attempts.
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Calculate exponential backoff delay for retry attempt.
 * @param attempt - The current attempt number (0-indexed)
 * @returns Delay in milliseconds
 */
function calculateRetryDelay(attempt: number): number {
  // Exponential backoff: 1s, 2s, 4s, 8s, etc.
  return BASE_RETRY_DELAY_MS * Math.pow(2, attempt)
}

/**
 * Find the mdvdb CLI binary on the system PATH.
 * Returns the absolute path to the binary.
 * Throws CliNotFoundError if not found.
 */
export async function findCli(): Promise<string> {
  const whichCmd = process.platform === 'win32' ? 'where' : 'which'

  try {
    const { stdout } = await execFileAsync(whichCmd, [CLI_BINARY_NAME], {
      timeout: 5_000
    })
    const path = stdout.trim().split('\n')[0].trim()
    if (!path) {
      throw new CliNotFoundError()
    }
    return path
  } catch (error) {
    if (error instanceof CliNotFoundError) {
      throw error
    }
    throw new CliNotFoundError()
  }
}

/**
 * Get the version string of the mdvdb CLI.
 * Returns the version (e.g., "0.1.0").
 */
export async function getCliVersion(): Promise<string> {
  const cliPath = await findCli()

  try {
    const { stdout } = await execFileAsync(cliPath, ['--version', '--json'], {
      timeout: 5_000,
      maxBuffer: MAX_BUFFER
    })
    const parsed = JSON.parse(stdout.trim())
    return parsed.version as string
  } catch {
    throw new CliExecutionError('Failed to get CLI version', 1, '')
  }
}

/**
 * Execute a CLI command and parse the JSON output.
 *
 * Spawns `mdvdb <command> --json --root <root> ...args` and parses stdout as JSON.
 * Uses execFile (not exec) to prevent shell injection.
 * Supports automatic retry with exponential backoff for transient failures.
 */
export async function execCommand<T>(
  command: string,
  args: string[],
  root: string,
  options?: ExecCommandOptions
): Promise<T> {
  const cliPath = await findCli()
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT_MS
  const maxRetries = options?.retries ?? DEFAULT_RETRIES
  const fullArgs = [command, '--json', '--root', root, ...args]

  let lastError: Error | undefined
  let attempt = 0

  while (attempt <= maxRetries) {
    let stdout: string
    let stderr: string

    try {
      const result = await execFileAsync(cliPath, fullArgs, {
        timeout,
        maxBuffer: MAX_BUFFER,
        env: { ...process.env }
      })
      stdout = result.stdout
      stderr = result.stderr

      // Handle empty stdout (e.g., init command)
      if (!stdout.trim()) {
        return undefined as unknown as T
      }

      // Parse JSON output
      try {
        return JSON.parse(stdout) as T
      } catch {
        throw new CliParseError(
          `Failed to parse JSON output from '${command}': ${stdout.slice(0, 200)}`
        )
      }
    } catch (error: unknown) {
      const err = error as { killed?: boolean; code?: string; exitCode?: number; stderr?: string }

      // Don't retry parse errors or CliNotFoundError
      if (error instanceof CliParseError || error instanceof CliNotFoundError) {
        throw error
      }

      // Handle timeout
      if (err.killed || err.code === 'ETIMEDOUT') {
        lastError = new CliTimeoutError(
          attempt < maxRetries
            ? `CLI command '${command}' timed out after ${timeout}ms (attempt ${attempt + 1}/${maxRetries + 1}). Retrying...`
            : `CLI command '${command}' timed out after ${timeout}ms. Try increasing the timeout or running the command directly.`
        )
      } else {
        // Handle execution error
        lastError = new CliExecutionError(
          attempt < maxRetries
            ? `CLI command '${command}' failed (attempt ${attempt + 1}/${maxRetries + 1}): ${err.stderr ?? 'unknown error'}. Retrying...`
            : `CLI command '${command}' failed after ${maxRetries + 1} attempts: ${err.stderr ?? 'unknown error'}. Please check the CLI output or try again.`,
          err.exitCode ?? 1,
          err.stderr ?? ''
        )
      }

      // If we've exhausted all retries, throw the last error
      if (attempt >= maxRetries) {
        throw lastError
      }

      // Wait before retrying (exponential backoff)
      const delay = calculateRetryDelay(attempt)
      await sleep(delay)
      attempt++
    }
  }

  // Should never reach here, but TypeScript needs this
  throw lastError ?? new Error('Unexpected error in execCommand')
}

/**
 * Execute a CLI command and return raw output without JSON parsing.
 * Useful for commands that don't support --json or for debugging.
 * Supports automatic retry with exponential backoff for transient failures.
 */
export async function execRaw(
  command: string,
  args: string[],
  root: string,
  options?: ExecCommandOptions
): Promise<ExecRawResult> {
  const cliPath = await findCli()
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT_MS
  const maxRetries = options?.retries ?? DEFAULT_RETRIES
  const fullArgs = [command, '--root', root, ...args]

  let lastError: Error | undefined
  let attempt = 0

  while (attempt <= maxRetries) {
    try {
      const { stdout, stderr } = await execFileAsync(cliPath, fullArgs, {
        timeout,
        maxBuffer: MAX_BUFFER,
        env: { ...process.env }
      })
      return { stdout, stderr, exitCode: 0 }
    } catch (error: unknown) {
      const err = error as { killed?: boolean; code?: string; exitCode?: number; stdout?: string; stderr?: string }

      // Don't retry CliNotFoundError
      if (error instanceof CliNotFoundError) {
        throw error
      }

      // Handle timeout
      if (err.killed || err.code === 'ETIMEDOUT') {
        lastError = new CliTimeoutError(
          attempt < maxRetries
            ? `CLI command '${command}' timed out after ${timeout}ms (attempt ${attempt + 1}/${maxRetries + 1}). Retrying...`
            : `CLI command '${command}' timed out after ${timeout}ms. Try increasing the timeout or running the command directly.`
        )
      } else {
        // Handle execution error
        lastError = new CliExecutionError(
          attempt < maxRetries
            ? `CLI command '${command}' failed (attempt ${attempt + 1}/${maxRetries + 1}): ${err.stderr ?? 'unknown error'}. Retrying...`
            : `CLI command '${command}' failed after ${maxRetries + 1} attempts: ${err.stderr ?? 'unknown error'}. Please check the CLI output or try again.`,
          err.exitCode ?? 1,
          err.stderr ?? ''
        )
      }

      // If we've exhausted all retries, throw the last error
      if (attempt >= maxRetries) {
        throw lastError
      }

      // Wait before retrying (exponential backoff)
      const delay = calculateRetryDelay(attempt)
      await sleep(delay)
      attempt++
    }
  }

  // Should never reach here, but TypeScript needs this
  throw lastError ?? new Error('Unexpected error in execRaw')
}
