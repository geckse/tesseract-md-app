/**
 * Error classes for CLI bridge operations.
 */

/** Known CLI error types for discriminated unions. */
export type CliErrorType = 'CliNotFoundError' | 'CliExecutionError' | 'CliParseError' | 'CliTimeoutError'

/** Serialized error shape for IPC transport */
export interface SerializedError {
  error: true
  type: CliErrorType
  message: string
  exitCode?: number
  stderr?: string
}

/** Thrown when the mdvdb binary cannot be found on PATH */
export class CliNotFoundError extends Error {
  name = 'CliNotFoundError' as const

  constructor(message = 'mdvdb CLI binary not found on PATH') {
    super(message)
  }

  serialize(): SerializedError {
    return { error: true, type: 'CliNotFoundError', message: this.message }
  }
}

/** Thrown when the CLI process exits with a non-zero exit code */
export class CliExecutionError extends Error {
  name = 'CliExecutionError' as const

  constructor(
    message: string,
    public exitCode: number,
    public stderr: string
  ) {
    super(message)
  }

  serialize(): SerializedError {
    return { error: true, type: 'CliExecutionError', message: this.message, exitCode: this.exitCode, stderr: this.stderr }
  }
}

/** Thrown when CLI JSON output cannot be parsed */
export class CliParseError extends Error {
  name = 'CliParseError' as const

  constructor(message: string) {
    super(message)
  }

  serialize(): SerializedError {
    return { error: true, type: 'CliParseError', message: this.message }
  }
}

/** Thrown when a CLI command exceeds its timeout */
export class CliTimeoutError extends Error {
  name = 'CliTimeoutError' as const

  constructor(message = 'CLI command timed out') {
    super(message)
  }

  serialize(): SerializedError {
    return { error: true, type: 'CliTimeoutError', message: this.message }
  }
}

/** Type guard to check if an unknown error is a serialized CLI error */
export function isSerializedError(value: unknown): value is SerializedError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    (value as SerializedError).error === true &&
    'type' in value &&
    'message' in value &&
    typeof (value as SerializedError).type === 'string' &&
    typeof (value as SerializedError).message === 'string'
  )
}

/** Deserialize an error from IPC transport back into a typed Error instance */
export function deserializeError(err: SerializedError): Error {
  switch (err.type) {
    case 'CliNotFoundError':
      return new CliNotFoundError(err.message)
    case 'CliExecutionError':
      return new CliExecutionError(err.message, err.exitCode ?? 1, err.stderr ?? '')
    case 'CliParseError':
      return new CliParseError(err.message)
    case 'CliTimeoutError':
      return new CliTimeoutError(err.message)
    default:
      return new Error(err.message)
  }
}
