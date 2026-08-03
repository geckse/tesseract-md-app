/**
 * Dotenv-style config file read/write utilities.
 *
 * Reads and writes KEY=value files (like .markdownvdb/.config),
 * preserving comments, empty lines, and key ordering.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import YAML from 'yaml'

/** Settings UI keys mapped to their canonical YAML paths. Model values remain
 * opaque strings; this map describes configuration plumbing, not models. */
export const SETTINGS_YAML_KEYS: Record<string, string> = {
  MDVDB_EMBEDDING_PROVIDER: 'embedding.provider',
  MDVDB_EMBEDDING_MODEL: 'embedding.model',
  MDVDB_EMBEDDING_DIMENSIONS: 'embedding.dimensions',
  MDVDB_EMBEDDING_BATCH_SIZE: 'embedding.batch_size',
  MDVDB_EMBEDDING_ENDPOINT: 'embedding.endpoint',
  MDVDB_EMBEDDING_PURPOSE_MODE: 'embedding.purpose.mode',
  MDVDB_EMBEDDING_QUERY_PURPOSE: 'embedding.purpose.query',
  MDVDB_EMBEDDING_DOCUMENT_PURPOSE: 'embedding.purpose.document',
  AZURE_OPENAI_AUTH: 'embedding.azure.auth',
  HF_INFERENCE_MODE: 'embedding.huggingface.mode',
  HF_INFERENCE_ENDPOINT: 'embedding.huggingface.endpoint',
  HF_NORMALIZE: 'embedding.huggingface.normalize',
  HF_TRUNCATE: 'embedding.huggingface.truncate',
  HF_TRUNCATION_DIRECTION: 'embedding.huggingface.truncation_direction',
  HF_QUERY_PROMPT_NAME: 'embedding.huggingface.query_prompt_name',
  HF_DOCUMENT_PROMPT_NAME: 'embedding.huggingface.document_prompt_name',
  AWS_BEDROCK_REGION: 'embedding.bedrock.region',
  AWS_BEDROCK_PROFILE: 'embedding.bedrock.profile',
  AWS_BEDROCK_ENDPOINT: 'embedding.bedrock.endpoint',
  AWS_BEDROCK_FORMAT: 'embedding.bedrock.format',
  AWS_BEDROCK_INVOCATION: 'embedding.bedrock.invocation',
  AWS_BEDROCK_REQUEST_TEMPLATE: 'embedding.bedrock.request_template',
  AWS_BEDROCK_EMBEDDINGS_POINTER: 'embedding.bedrock.embeddings_pointer',
  AWS_BEDROCK_ITEM_EMBEDDING_POINTER: 'embedding.bedrock.item_embedding_pointer',
  AWS_BEDROCK_QUERY_PURPOSE: 'embedding.bedrock.query_purpose',
  AWS_BEDROCK_DOCUMENT_PURPOSE: 'embedding.bedrock.document_purpose',
  MDVDB_SEARCH_MODE: 'search.mode',
  MDVDB_SEARCH_DEFAULT_LIMIT: 'search.limit',
  MDVDB_SEARCH_MIN_SCORE: 'search.min_score',
  MDVDB_SEARCH_BOOST_LINKS: 'search.boost_links',
  MDVDB_SEARCH_BOOST_HOPS: 'search.boost_hops',
  MDVDB_SEARCH_EXPAND_GRAPH: 'search.expand_graph',
  MDVDB_SEARCH_EXPAND_LIMIT: 'search.expand_limit',
  MDVDB_SEARCH_DECAY: 'search.decay.enabled',
  MDVDB_SEARCH_DECAY_HALF_LIFE: 'search.decay.half_life',
  MDVDB_SEARCH_DECAY_EXCLUDE: 'search.decay.exclude',
  MDVDB_SEARCH_DECAY_INCLUDE: 'search.decay.include',
  MDVDB_CHUNK_MAX_TOKENS: 'chunking.max_tokens',
  MDVDB_CHUNK_OVERLAP_TOKENS: 'chunking.overlap_tokens',
  MDVDB_CLUSTER_GRANULARITY: 'clustering.granularity'
}

export const SETTINGS_SECRET_KEYS = new Set([
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'GEMINI_API_KEY',
  'AZURE_OPENAI_API_KEY',
  'AZURE_OPENAI_ACCESS_TOKEN',
  'HF_TOKEN',
  'AWS_BEARER_TOKEN_BEDROCK',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'OLLAMA_HOST'
])

/**
 * Read a dotenv-style config file into a key-value record.
 * Returns an empty record if the file does not exist.
 */
export async function readConfig(filePath: string): Promise<Record<string, string>> {
  let content: string
  try {
    content = await readFile(filePath, 'utf-8')
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return {}
    }
    throw err
  }

  const result: Record<string, string> = {}
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) continue
    const key = trimmed.slice(0, eqIndex).trim()
    const value = trimmed.slice(eqIndex + 1).trim()
    if (key) {
      result[key] = decodeDotenvValue(value)
    }
  }
  return result
}

function decodeDotenvValue(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value
      .slice(1, -1)
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\')
  }
  return value
}

function valueAtPath(root: unknown, path: string): unknown {
  let value: unknown = root
  for (const part of path.split('.')) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
    value = (value as Record<string, unknown>)[part]
  }
  return value
}

function settingString(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

/** Read canonical YAML plus its adjacent secret .env into the Settings UI's
 * stable key-value shape. */
export async function readSettingsConfig(
  yamlPath: string,
  envPath: string
): Promise<Record<string, string>> {
  let yamlRoot: unknown = {}
  try {
    yamlRoot = YAML.parse(await readFile(yamlPath, 'utf-8')) ?? {}
  } catch (err: unknown) {
    if (
      !(err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT')
    ) {
      throw err
    }
  }
  const result: Record<string, string> = {}
  for (const [settingKey, yamlKey] of Object.entries(SETTINGS_YAML_KEYS)) {
    const value = settingString(valueAtPath(yamlRoot, yamlKey))
    if (value !== undefined) result[settingKey] = value
  }
  return { ...result, ...(await readConfig(envPath)) }
}

/**
 * Set a single key in a dotenv-style config file.
 * Preserves comments, empty lines, and ordering.
 * Creates parent directories and the file if they don't exist.
 */
export async function writeConfigKey(filePath: string, key: string, value: string): Promise<void> {
  let lines: string[]
  try {
    const content = await readFile(filePath, 'utf-8')
    lines = content.split('\n')
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      await mkdir(dirname(filePath), { recursive: true })
      await writeFile(filePath, `${key}=${value}\n`, 'utf-8')
      return
    }
    throw err
  }

  let found = false
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) continue
    const lineKey = trimmed.slice(0, eqIndex).trim()
    if (lineKey === key) {
      lines[i] = `${key}=${value}`
      found = true
      break
    }
  }

  if (!found) {
    // Append before trailing empty lines
    let insertIndex = lines.length
    while (insertIndex > 0 && lines[insertIndex - 1].trim() === '') {
      insertIndex--
    }
    lines.splice(insertIndex, 0, `${key}=${value}`)
  }

  await writeFile(filePath, lines.join('\n'), 'utf-8')
}

/**
 * Delete a key from a dotenv-style config file.
 * Preserves comments, empty lines, and ordering.
 * No-op if the file or key does not exist.
 */
export async function deleteConfigKey(filePath: string, key: string): Promise<void> {
  let content: string
  try {
    content = await readFile(filePath, 'utf-8')
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return
    }
    throw err
  }

  const lines = content.split('\n')
  const filtered = lines.filter((line) => {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) return true
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) return true
    const lineKey = trimmed.slice(0, eqIndex).trim()
    return lineKey !== key
  })

  await writeFile(filePath, filtered.join('\n'), 'utf-8')
}
