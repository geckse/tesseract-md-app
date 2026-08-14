// electron-builder loads afterSign hooks as CommonJS modules.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawnSync } = require('node:child_process')

const REQUIRED_ENV = ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']

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

  assertDeveloperIdSignature(appPath, appBundleId, process.env.APPLE_TEAM_ID)

  console.log(`Notarizing ${appName}...`)

  // @electron/notarize v3 is ESM-only — load it lazily so the CJS hook stays
  // loadable everywhere and skip paths never touch the dependency.
  const { notarize } = await import('@electron/notarize')

  await notarize({
    appBundleId,
    appPath,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID
  })

  console.log('Notarization complete')
}

exports.validateDeveloperIdSignature = validateDeveloperIdSignature
exports.assertDeveloperIdSignature = assertDeveloperIdSignature
