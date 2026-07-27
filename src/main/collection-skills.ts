/**
 * Collection-local Tesseract skill discovery and installation.
 *
 * The app ships the `tesseract-skills` plugin as a read-only resource. Skills
 * are copied into one supported project-local agent directory on explicit user
 * action. Installed files are compared with the bundled files plus a bundle
 * fingerprint, so content changes and version-only updates are both detected.
 */

import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { atomicWriteFile } from './atomic-write'
import type {
  CollectionSkillsStatus,
  CollectionSkillsTarget,
  CollectionSkillsTargetId
} from '../preload/api'

const INSTALL_MARKER = '.tesseract-skills.json'

interface AgentTargetDefinition {
  id: CollectionSkillsTargetId
  label: string
  agentDirectory: string
  relativePath: string
}

const AGENT_TARGETS: readonly AgentTargetDefinition[] = [
  {
    id: 'claude',
    label: 'Claude Code',
    agentDirectory: '.claude',
    relativePath: '.claude/skills'
  },
  {
    id: 'agents',
    label: 'Codex & compatible agents',
    agentDirectory: '.agents',
    relativePath: '.agents/skills'
  },
  {
    id: 'gemini',
    label: 'Gemini CLI',
    agentDirectory: '.gemini',
    relativePath: '.gemini/skills'
  }
]

interface BundleFile {
  relativePath: string
  content: Buffer
  mode: number
}

interface SkillsBundle {
  version: string
  fingerprint: string
  skillNames: string[]
  files: BundleFile[]
}

interface InstallMarker {
  version: string
  fingerprint: string
}

function isNodeError(error: unknown, code: string): boolean {
  return (
    error instanceof Error && 'code' in error && (error as Error & { code?: string }).code === code
  )
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await fs.lstat(path)).isDirectory()
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) return false
    throw error
  }
}

/**
 * Reject symlinks and non-directory components below the trusted collection
 * root. A collection root may itself be a user-selected symlink.
 */
async function hasSafePathChain(root: string, relativePath: string): Promise<boolean> {
  let current = root
  for (const part of relativePath.split('/').filter(Boolean)) {
    current = join(current, part)
    try {
      const stat = await fs.lstat(current)
      if (stat.isSymbolicLink()) return false
      if (current !== join(root, relativePath) && !stat.isDirectory()) return false
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) return true
      throw error
    }
  }
  return true
}

async function collectBundleFiles(
  directory: string,
  base: string,
  output: BundleFile[]
): Promise<void> {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  entries.sort((left, right) => left.name.localeCompare(right.name))

  for (const entry of entries) {
    const absolutePath = join(directory, entry.name)
    if (entry.isSymbolicLink()) {
      throw new Error(`Bundled Tesseract skills contain a symlink: ${absolutePath}`)
    }
    if (entry.isDirectory()) {
      await collectBundleFiles(absolutePath, base, output)
    } else if (entry.isFile()) {
      const stat = await fs.stat(absolutePath)
      output.push({
        relativePath: relative(base, absolutePath).split(sep).join('/'),
        content: await fs.readFile(absolutePath),
        mode: stat.mode
      })
    }
  }
}

async function readSkillsBundle(bundleRoot: string): Promise<SkillsBundle> {
  const skillsRoot = join(bundleRoot, 'skills')
  const manifestPath = join(bundleRoot, '.claude-plugin', 'plugin.json')
  const manifestValue: unknown = JSON.parse(await fs.readFile(manifestPath, 'utf-8'))
  const version =
    typeof manifestValue === 'object' &&
    manifestValue !== null &&
    'version' in manifestValue &&
    typeof manifestValue.version === 'string'
      ? manifestValue.version
      : '0.0.0'

  const skillEntries = await fs.readdir(skillsRoot, { withFileTypes: true })
  const skillNames = skillEntries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => entry.name)
    .sort()

  if (skillNames.length === 0) {
    throw new Error('The bundled tesseract-skills package contains no skills')
  }

  const files: BundleFile[] = []
  for (const skillName of skillNames) {
    const entrypoint = join(skillsRoot, skillName, 'SKILL.md')
    if (!(await fs.stat(entrypoint)).isFile()) {
      throw new Error(`Bundled Tesseract skill is missing SKILL.md: ${skillName}`)
    }
    await collectBundleFiles(join(skillsRoot, skillName), skillsRoot, files)
  }

  const hash = createHash('sha256')
  hash.update(`version\0${version}\0`)
  for (const file of files) {
    hash.update(file.relativePath)
    hash.update('\0')
    hash.update(file.content)
    hash.update('\0')
  }

  return {
    version,
    fingerprint: hash.digest('hex'),
    skillNames,
    files
  }
}

async function readInstallMarker(skillsRoot: string): Promise<InstallMarker | null> {
  const relativeMarker = relative(skillsRoot, join(skillsRoot, INSTALL_MARKER))
  if (!(await hasSafePathChain(skillsRoot, relativeMarker))) return null
  try {
    const value: unknown = JSON.parse(await fs.readFile(join(skillsRoot, INSTALL_MARKER), 'utf-8'))
    if (
      typeof value === 'object' &&
      value !== null &&
      'version' in value &&
      typeof value.version === 'string' &&
      'fingerprint' in value &&
      typeof value.fingerprint === 'string'
    ) {
      return { version: value.version, fingerprint: value.fingerprint }
    }
  } catch (error) {
    if (!isNodeError(error, 'ENOENT')) {
      // Invalid or unreadable markers fall back to a direct content comparison.
    }
  }
  return null
}

async function installedFilesMatch(
  collectionRoot: string,
  target: AgentTargetDefinition,
  bundle: SkillsBundle
): Promise<boolean> {
  for (const file of bundle.files) {
    const targetRelativePath = `${target.relativePath}/${file.relativePath}`
    if (!(await hasSafePathChain(collectionRoot, targetRelativePath))) return false
    try {
      const installed = await fs.readFile(join(collectionRoot, targetRelativePath))
      if (!installed.equals(file.content)) return false
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) return false
      throw error
    }
  }
  return true
}

async function inspectTarget(
  collectionRoot: string,
  target: AgentTargetDefinition,
  bundle: SkillsBundle
): Promise<CollectionSkillsTarget> {
  const pathChainSafe = await hasSafePathChain(collectionRoot, target.relativePath)
  const agentDirectoryPresent = await isDirectory(join(collectionRoot, target.agentDirectory))
  if (!pathChainSafe) {
    return {
      id: target.id,
      label: target.label,
      relativePath: target.relativePath,
      state: 'blocked',
      installedSkillCount: 0,
      totalSkillCount: bundle.skillNames.length,
      agentDirectoryPresent
    }
  }

  let installedSkillCount = 0
  for (const skillName of bundle.skillNames) {
    const entrypoint = `${target.relativePath}/${skillName}/SKILL.md`
    if (
      (await hasSafePathChain(collectionRoot, entrypoint)) &&
      (await isDirectory(join(collectionRoot, target.relativePath, skillName)))
    ) {
      try {
        if ((await fs.lstat(join(collectionRoot, entrypoint))).isFile()) {
          installedSkillCount++
        }
      } catch (error) {
        if (!isNodeError(error, 'ENOENT')) throw error
      }
    }
  }

  let state: CollectionSkillsTarget['state'] = 'missing'
  if (installedSkillCount > 0) {
    const filesMatch = await installedFilesMatch(collectionRoot, target, bundle)
    const marker = await readInstallMarker(join(collectionRoot, target.relativePath))
    const markerMatches = marker === null || marker.fingerprint === bundle.fingerprint
    state =
      installedSkillCount === bundle.skillNames.length && filesMatch && markerMatches
        ? 'current'
        : 'outdated'
  }

  return {
    id: target.id,
    label: target.label,
    relativePath: target.relativePath,
    state,
    installedSkillCount,
    totalSkillCount: bundle.skillNames.length,
    agentDirectoryPresent
  }
}

function chooseRecommendedTarget(targets: CollectionSkillsTarget[]): CollectionSkillsTargetId {
  const outdated = targets.find((target) => target.state === 'outdated')
  if (outdated) return outdated.id

  const existingAgent = targets.find(
    (target) => target.agentDirectoryPresent && target.state !== 'blocked'
  )
  if (existingAgent) return existingAgent.id

  const portable = targets.find((target) => target.id === 'agents' && target.state !== 'blocked')
  if (portable) return portable.id

  const safe = targets.find((target) => target.state !== 'blocked')
  if (safe) return safe.id

  throw new Error('Every supported collection skill directory is blocked by a symlink')
}

/** Resolve the tesseract-skills plugin bundled with the development or packaged app. */
export async function resolveTesseractSkillsBundlePath(): Promise<string> {
  const { app } = await import('electron')
  if (app.isPackaged) return join(process.resourcesPath, 'tesseract-skills')

  // The umbrella markdown-vdb checkout keeps tesseract-skills beside `app`.
  // The standalone app CI checks it out inside the app workspace instead.
  const candidates = [
    resolve(app.getAppPath(), 'tesseract-skills', 'plugins', 'tesseract'),
    resolve(app.getAppPath(), '..', 'tesseract-skills', 'plugins', 'tesseract')
  ]
  for (const candidate of candidates) {
    try {
      if ((await fs.stat(join(candidate, '.claude-plugin', 'plugin.json'))).isFile()) {
        return candidate
      }
    } catch (error) {
      if (!isNodeError(error, 'ENOENT')) throw error
    }
  }
  return candidates[0]
}

/** Inspect supported project-local agent skill folders inside one collection. */
export async function checkCollectionSkills(
  collectionRoot: string,
  bundleRoot?: string
): Promise<CollectionSkillsStatus> {
  const normalizedRoot = resolve(collectionRoot)
  const resolvedBundleRoot = bundleRoot ?? (await resolveTesseractSkillsBundlePath())
  const bundle = await readSkillsBundle(resolvedBundleRoot)
  const targets = await Promise.all(
    AGENT_TARGETS.map((target) => inspectTarget(normalizedRoot, target, bundle))
  )

  const state: CollectionSkillsStatus['state'] = targets.some(
    (target) => target.state === 'current'
  )
    ? 'current'
    : targets.some((target) => target.state === 'outdated')
      ? 'outdated'
      : 'missing'

  return {
    state,
    bundleVersion: bundle.version,
    bundleFingerprint: bundle.fingerprint,
    skillCount: bundle.skillNames.length,
    targets,
    recommendedTargetId: chooseRecommendedTarget(targets),
    dismissedForever: false
  }
}

/** Copy the bundled Tesseract skills into one explicitly selected agent folder. */
export async function installCollectionSkills(
  collectionRoot: string,
  targetId: CollectionSkillsTargetId,
  bundleRoot?: string
): Promise<CollectionSkillsStatus> {
  const normalizedRoot = resolve(collectionRoot)
  const target = AGENT_TARGETS.find((candidate) => candidate.id === targetId)
  if (!target) throw new Error(`Unsupported collection skills target: ${targetId}`)
  if (!(await hasSafePathChain(normalizedRoot, target.relativePath))) {
    throw new Error(`Refusing to install through a symlink: ${target.relativePath}`)
  }

  const resolvedBundleRoot = bundleRoot ?? (await resolveTesseractSkillsBundlePath())
  const bundle = await readSkillsBundle(resolvedBundleRoot)
  const skillsRoot = join(normalizedRoot, target.relativePath)
  await fs.mkdir(skillsRoot, { recursive: true })

  for (const file of bundle.files) {
    const destinationRelative = `${target.relativePath}/${file.relativePath}`
    if (!(await hasSafePathChain(normalizedRoot, destinationRelative))) {
      throw new Error(`Refusing to install through a symlink: ${destinationRelative}`)
    }
    const destination = join(normalizedRoot, destinationRelative)
    await fs.mkdir(resolve(destination, '..'), { recursive: true })
    await atomicWriteFile(destination, file.content)
    await fs.chmod(destination, file.mode & 0o777)
  }

  const marker: InstallMarker = {
    version: bundle.version,
    fingerprint: bundle.fingerprint
  }
  await atomicWriteFile(join(skillsRoot, INSTALL_MARKER), `${JSON.stringify(marker, null, 2)}\n`)

  const status = await checkCollectionSkills(normalizedRoot, resolvedBundleRoot)
  const installedTarget = status.targets.find((candidate) => candidate.id === targetId)
  if (installedTarget?.state !== 'current') {
    throw new Error(
      `Tesseract skills could not be verified in ${target.relativePath}; the banner will remain available`
    )
  }
  return status
}
