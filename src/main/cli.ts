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

/** Max buffer size for stdout/stderr (10 MB) */
const MAX_BUFFER = 10 * 1024 * 1024

/** Options for execCommand */
export interface ExecCommandOptions {
  timeout?: number
}

/** Raw output from a CLI command */
export interface ExecRawResult {
  stdout: string
  stderr: string
  exitCode: number
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
    const { stdout } = await execFileAsync(cliPath, ['--version'], {
      timeout: 5_000,
      maxBuffer: MAX_BUFFER
    })
    // Output is typically "mdvdb 0.1.0" or just "0.1.0"
    const version = stdout.trim().replace(/^mdvdb\s+/, '')
    return version
  } catch {
    throw new CliExecutionError('Failed to get CLI version', 1, '')
  }
}

/**
 * Execute a CLI command and parse the JSON output.
 *
 * Spawns `mdvdb <command> --json --root <root> ...args` and parses stdout as JSON.
 * Uses execFile (not exec) to prevent shell injection.
 */
export async function execCommand<T>(
  command: string,
  args: string[],
  root: string,
  options?: ExecCommandOptions
): Promise<T> {
  const cliPath = await findCli()
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT_MS
  const fullArgs = [command, '--json', '--root', root, ...args]

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
  } catch (error: unknown) {
    const err = error as { killed?: boolean; code?: string; exitCode?: number; stderr?: string }

    if (err.killed || err.code === 'ETIMEDOUT') {
      throw new CliTimeoutError(
        `CLI command '${command}' timed out after ${timeout}ms`
      )
    }

    throw new CliExecutionError(
      `CLI command '${command}' failed: ${err.stderr ?? 'unknown error'}`,
      err.exitCode ?? 1,
      err.stderr ?? ''
    )
  }

  // Handle empty stdout (e.g., init command)
  if (!stdout.trim()) {
    return undefined as unknown as T
  }

  try {
    return JSON.parse(stdout) as T
  } catch {
    throw new CliParseError(
      `Failed to parse JSON output from '${command}': ${stdout.slice(0, 200)}`
    )
  }
}

/**
 * Execute a CLI command and return raw output without JSON parsing.
 * Useful for commands that don't support --json or for debugging.
 */
export async function execRaw(
  command: string,
  args: string[],
  root: string,
  options?: ExecCommandOptions
): Promise<ExecRawResult> {
  const cliPath = await findCli()
  const timeout = options?.timeout ?? DEFAULT_TIMEOUT_MS
  const fullArgs = [command, '--root', root, ...args]

  try {
    const { stdout, stderr } = await execFileAsync(cliPath, fullArgs, {
      timeout,
      maxBuffer: MAX_BUFFER,
      env: { ...process.env }
    })
    return { stdout, stderr, exitCode: 0 }
  } catch (error: unknown) {
    const err = error as { killed?: boolean; code?: string; exitCode?: number; stdout?: string; stderr?: string }

    if (err.killed || err.code === 'ETIMEDOUT') {
      throw new CliTimeoutError(
        `CLI command '${command}' timed out after ${timeout}ms`
      )
    }

    throw new CliExecutionError(
      `CLI command '${command}' failed: ${err.stderr ?? 'unknown error'}`,
      err.exitCode ?? 1,
      err.stderr ?? ''
    )
  }
}
