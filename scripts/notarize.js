const REQUIRED_ENV = ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context
  if (electronPlatformName !== 'darwin') return

  const missing = REQUIRED_ENV.filter((name) => !process.env[name])

  if (missing.length > 0) {
    // A tagged CI build is a release build — it must never silently produce
    // an un-notarized mac artifact. Fail loudly instead.
    if (process.env.CI && process.env.GITHUB_REF_TYPE === 'tag') {
      throw new Error(
        `Refusing to build an un-notarized mac artifact on a tagged CI build: ` +
          `missing ${missing.join(', ')}. Set the APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / ` +
          `APPLE_TEAM_ID secrets on the mac leg of the workflow.`
      )
    }
    // Local / non-release builds: skip silently.
    console.log(`Skipping notarization: ${missing.join(', ')} not set`)
    return
  }

  const appName = context.packager.appInfo.productFilename

  console.log(`Notarizing ${appName}...`)

  // @electron/notarize v3 is ESM-only — load it lazily so the CJS hook stays
  // loadable everywhere and skip paths never touch the dependency.
  const { notarize } = await import('@electron/notarize')

  await notarize({
    appBundleId: 'md.tesseract.app',
    appPath: `${appOutDir}/${appName}.app`,
    appleId: process.env.APPLE_ID,
    appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId: process.env.APPLE_TEAM_ID
  })

  console.log('Notarization complete')
}
