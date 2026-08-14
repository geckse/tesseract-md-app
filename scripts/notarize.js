// electron-builder loads afterSign hooks as CommonJS modules.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawn, spawnSync } = require('node:child_process')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require('node:fs/promises')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const os = require('node:os')
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require('node:path')

const REQUIRED_ENV = ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']
const DEFAULT_NOTARIZATION_TIMEOUT_MINUTES = 90
const NOTARY_POLL_INTERVAL_MS = 30_000
const NOTARY_HEARTBEAT_INTERVAL_MS = 5 * 60_000
const NOTARY_UPLOAD_TIMEOUT_MS = 15 * 60_000
const NOTARY_COMMAND_TIMEOUT_MS = 2 * 60_000

function validateDeveloperIdSignature(output, expectedBundleId, expectedTeamId) {
  const lines = output.split(/\r?\n/)
  const authorities = lines
    .filter((line) => line.startsWith('Authority='))
    .map((line) => line.slice('Authority='.length))
  const identifier = lines
    .find((line) => line.startsWith('Identifier='))
    ?.slice('Identifier='.length)
  const teamIdentifier = lines
    .find((line) => line.startsWith('TeamIdentifier='))
    ?.slice('TeamIdentifier='.length)

  if (!authorities.some((authority) => authority.startsWith('Developer ID Application:'))) {
    throw new Error(
      'Refusing to notarize: the app is not signed with a Developer ID Application certificate.'
    )
  }
  if (identifier !== expectedBundleId) {
    throw new Error(
      `Refusing to notarize: signed bundle ID ${identifier || '<missing>'} does not match ` +
        `${expectedBundleId}.`
    )
  }
  if (teamIdentifier !== expectedTeamId) {
    throw new Error(
      `Refusing to notarize: signing Team ID ${teamIdentifier || '<missing>'} does not match ` +
        `${expectedTeamId}.`
    )
  }
}

function assertDeveloperIdSignature(appPath, expectedBundleId, expectedTeamId) {
  const result = spawnSync('codesign', ['-dv', '--verbose=4', appPath], {
    encoding: 'utf8'
  })
  if (result.error) throw result.error

  const output = `${result.stdout || ''}${result.stderr || ''}`
  if (result.status !== 0) {
    throw new Error(
      `Unable to inspect the macOS app signature (codesign exit ${result.status}):\n${output}`
    )
  }

  validateDeveloperIdSignature(output, expectedBundleId, expectedTeamId)

  const verification = spawnSync(
    'codesign',
    ['--verify', '--deep', '--strict', '--verbose=2', appPath],
    { encoding: 'utf8' }
  )
  if (verification.error) throw verification.error
  if (verification.status !== 0) {
    const verificationOutput = `${verification.stdout || ''}${verification.stderr || ''}`
    throw new Error(
      `Refusing to notarize an invalid app signature (codesign exit ${verification.status}):\n` +
        verificationOutput
    )
  }
}

function redactSecrets(value, secrets) {
  let redacted = value
  for (const secret of secrets) {
    if (secret) redacted = redacted.split(secret).join('***')
  }
  return redacted
}

function runCommand(command, args, { cwd, timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      timeout: timeoutMs,
      killSignal: 'SIGTERM'
    })
    const output = []
    let settled = false

    const collect = (data) => output.push(data.toString())
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    child.on('error', (error) => {
      if (settled) return
      settled = true
      reject(error)
    })
    child.on('close', (code, signal) => {
      if (settled) return
      settled = true
      resolve({ code, signal, output: output.join('') })
    })
  })
}

function notarytoolAuthorizationArgs(credentials) {
  return [
    '--apple-id',
    credentials.appleId,
    '--password',
    credentials.password,
    '--team-id',
    credentials.teamId
  ]
}

function runNotarytool(args, credentials, { timeoutMs, json = true } = {}) {
  const outputArgs = json ? ['--output-format', 'json'] : []
  return runCommand(
    'xcrun',
    ['notarytool', ...args, ...notarytoolAuthorizationArgs(credentials), ...outputArgs],
    { timeoutMs }
  )
}

function parseNotarytoolJson(output, operation, secrets = []) {
  try {
    const parsed = JSON.parse(output.trim())
    if (!parsed || typeof parsed !== 'object') throw new Error('not an object')
    return parsed
  } catch {
    throw new Error(
      `Apple notarytool returned invalid JSON while running ${operation}:\n` +
        redactSecrets(output, secrets)
    )
  }
}

function readNotarizationTimeoutMs(rawValue) {
  if (rawValue === undefined || rawValue === '') {
    return DEFAULT_NOTARIZATION_TIMEOUT_MINUTES * 60_000
  }

  const minutes = Number(rawValue)
  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new Error('NOTARIZATION_TIMEOUT_MINUTES must be a positive number.')
  }
  return minutes * 60_000
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function getNotarizationLog(submissionId, credentials, run = runNotarytool) {
  const result = await run(['log', submissionId], credentials, {
    timeoutMs: NOTARY_COMMAND_TIMEOUT_MS,
    json: false
  })
  return result.output
}

async function waitForNotarization({
  submissionId,
  credentials,
  timeoutMs,
  pollIntervalMs = NOTARY_POLL_INTERVAL_MS,
  heartbeatIntervalMs = NOTARY_HEARTBEAT_INTERVAL_MS,
  run = runNotarytool,
  sleep = delay,
  now = Date.now,
  log = console.log,
  warn = console.warn
}) {
  const startedAt = now()
  let nextHeartbeatAt = startedAt
  let previousStatus
  let consecutiveFailures = 0

  while (true) {
    const elapsedMs = now() - startedAt
    if (elapsedMs >= timeoutMs) {
      throw new Error(
        `Apple notarization ${submissionId} timed out after ${Math.round(timeoutMs / 60_000)} ` +
          'minutes. Apple may continue processing it; inspect the submission with notarytool info.'
      )
    }

    const result = await run(['info', submissionId], credentials, {
      timeoutMs: NOTARY_COMMAND_TIMEOUT_MS
    })

    if (result.code !== 0) {
      consecutiveFailures += 1
      const safeOutput = redactSecrets(result.output, Object.values(credentials))
      if (consecutiveFailures >= 3) {
        throw new Error(
          `Unable to read Apple notarization ${submissionId} after 3 attempts:\n${safeOutput}`
        )
      }
      warn(
        `Could not read Apple notarization ${submissionId}; retrying ` +
          `(${consecutiveFailures}/3). ${safeOutput.trim()}`
      )
      await sleep(Math.min(pollIntervalMs, timeoutMs - elapsedMs))
      continue
    }

    consecutiveFailures = 0
    const info = parseNotarytoolJson(result.output, 'info', Object.values(credentials))
    const status = info.status
    const currentTime = now()
    const currentElapsedMs = currentTime - startedAt

    if (status !== previousStatus || currentTime >= nextHeartbeatAt) {
      const elapsedMinutes = Math.floor(currentElapsedMs / 60_000)
      log(
        `Apple notarization ${submissionId}: ${status || '<missing status>'} ` +
          `(${elapsedMinutes}m elapsed)`
      )
      previousStatus = status
      nextHeartbeatAt = currentTime + heartbeatIntervalMs
    }

    if (status === 'Accepted') return

    if (status !== 'In Progress') {
      const diagnostic = await getNotarizationLog(submissionId, credentials, run)
      throw new Error(
        `Apple notarization ${submissionId} finished with status ` +
          `${status || '<missing>'}.\n${redactSecrets(diagnostic, Object.values(credentials))}`
      )
    }

    await sleep(Math.min(pollIntervalMs, timeoutMs - currentElapsedMs))
  }
}

async function stapleApp(appPath, secrets, run = runCommand, sleep = delay) {
  let lastFailure
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const result = await run('xcrun', ['stapler', 'staple', '-v', path.basename(appPath)], {
      cwd: path.dirname(appPath),
      timeoutMs: NOTARY_COMMAND_TIMEOUT_MS
    })
    if (result.code === 0) return

    lastFailure = redactSecrets(result.output, secrets)
    if (attempt < 4) await sleep(1000 * attempt)
  }

  throw new Error(`Failed to staple the notarization ticket after 4 attempts:\n${lastFailure}`)
}

async function notarizeApp(appPath, credentials, timeoutMs) {
  const temporaryDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'tesseract-notary-'))
  const zipPath = path.join(temporaryDirectory, `${path.parse(appPath).name}.zip`)
  const secrets = Object.values(credentials)

  try {
    console.log(`Preparing ${path.basename(appPath)} for Apple notarization...`)
    const archive = await runCommand(
      'ditto',
      ['-c', '-k', '--sequesterRsrc', '--keepParent', path.basename(appPath), zipPath],
      { cwd: path.dirname(appPath), timeoutMs: NOTARY_COMMAND_TIMEOUT_MS }
    )
    if (archive.code !== 0) {
      throw new Error(
        `Failed to archive the macOS app for notarization:\n${redactSecrets(archive.output, secrets)}`
      )
    }

    console.log('Uploading the signed app to Apple...')
    const submission = await runNotarytool(['submit', zipPath, '--no-wait'], credentials, {
      timeoutMs: NOTARY_UPLOAD_TIMEOUT_MS
    })
    if (submission.code !== 0) {
      throw new Error(
        `Apple rejected the notarization upload:\n${redactSecrets(submission.output, secrets)}`
      )
    }

    const submissionInfo = parseNotarytoolJson(submission.output, 'submit', secrets)
    if (typeof submissionInfo.id !== 'string' || submissionInfo.id.length === 0) {
      throw new Error('Apple accepted the notarization upload but returned no submission ID.')
    }

    console.log(`Apple notarization submitted: ${submissionInfo.id}`)
    await waitForNotarization({
      submissionId: submissionInfo.id,
      credentials,
      timeoutMs
    })
    await stapleApp(appPath, secrets)
    console.log(`Apple notarization accepted and stapled: ${submissionInfo.id}`)
  } finally {
    await fs.rm(temporaryDirectory, { recursive: true, force: true })
  }
}

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context
  if (electronPlatformName !== 'darwin') return

  const missing = REQUIRED_ENV.filter((name) => !process.env[name])
  const isReleaseBuild =
    process.env.MACOS_RELEASE_BUILD === 'true' ||
    (process.env.CI && process.env.GITHUB_REF_TYPE === 'tag')

  if (missing.length > 0) {
    // A production build must never silently produce an un-notarized artifact.
    if (isReleaseBuild) {
      throw new Error(
        `Refusing to build an un-notarized mac release artifact: ` +
          `missing ${missing.join(', ')}. Set the APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / ` +
          `APPLE_TEAM_ID secrets on the mac leg of the workflow.`
      )
    }
    // Local / non-release builds: skip silently.
    console.log(`Skipping notarization: ${missing.join(', ')} not set`)
    return
  }

  const appName = context.packager.appInfo.productFilename
  const appBundleId = context.packager.appInfo.id
  const appPath = `${appOutDir}/${appName}.app`
  const credentials = {
    appleId: process.env.APPLE_ID,
    password: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID
  }

  assertDeveloperIdSignature(appPath, appBundleId, credentials.teamId)

  const timeoutMs = readNotarizationTimeoutMs(process.env.NOTARIZATION_TIMEOUT_MINUTES)
  console.log(
    `Notarizing ${appName} with a ${Math.round(timeoutMs / 60_000)} minute processing timeout...`
  )
  await notarizeApp(appPath, credentials, timeoutMs)
}

exports.validateDeveloperIdSignature = validateDeveloperIdSignature
exports.assertDeveloperIdSignature = assertDeveloperIdSignature
exports.parseNotarytoolJson = parseNotarytoolJson
exports.readNotarizationTimeoutMs = readNotarizationTimeoutMs
exports.waitForNotarization = waitForNotarization
