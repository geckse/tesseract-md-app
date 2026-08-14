// Keep unsigned smoke builds possible while making production Windows builds
// fail closed unless every Azure Artifact Signing value is present.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const packageJson = require('../package.json')

const releaseBuild = process.env.WINDOWS_RELEASE_BUILD === 'true'
const config = structuredClone(packageJson.build)

if (releaseBuild) {
  const requiredEnvironment = [
    'WINDOWS_PUBLISHER_NAME',
    'AZURE_ARTIFACT_SIGNING_ENDPOINT',
    'AZURE_ARTIFACT_SIGNING_ACCOUNT_NAME',
    'AZURE_ARTIFACT_SIGNING_CERTIFICATE_PROFILE_NAME',
    'AZURE_TENANT_ID',
    'AZURE_CLIENT_ID',
    'AZURE_CLIENT_SECRET'
  ]
  const missing = requiredEnvironment.filter((name) => !process.env[name]?.trim())
  if (missing.length > 0) {
    throw new Error(`Missing production Windows signing configuration: ${missing.join(', ')}`)
  }

  const endpoint = process.env.AZURE_ARTIFACT_SIGNING_ENDPOINT
  if (!endpoint.startsWith('https://') || !endpoint.endsWith('/')) {
    throw new Error('AZURE_ARTIFACT_SIGNING_ENDPOINT must be an HTTPS URL ending in /.')
  }

  config.forceCodeSigning = true
  config.win = {
    ...config.win,
    azureSignOptions: {
      publisherName: process.env.WINDOWS_PUBLISHER_NAME,
      endpoint,
      codeSigningAccountName: process.env.AZURE_ARTIFACT_SIGNING_ACCOUNT_NAME,
      certificateProfileName: process.env.AZURE_ARTIFACT_SIGNING_CERTIFICATE_PROFILE_NAME,
      fileDigest: 'SHA256',
      timestampDigest: 'SHA256',
      timestampRfc3161: 'http://timestamp.acs.microsoft.com'
    }
  }
}

module.exports = config
