import { net } from 'electron'
import { open, realpath, stat } from 'node:fs/promises'
import { isIP } from 'node:net'
import { basename, extname, isAbsolute, relative, resolve, sep } from 'node:path'
import type { ExternalLinkPreview, LocalLinkPreview } from '../shared/link-preview'

const MAX_URL_LENGTH = 2048
const MAX_RESPONSE_BYTES = 64 * 1024
const MAX_REDIRECTS = 3
const REQUEST_TIMEOUT_MS = 2200
const MAX_CACHE_ENTRIES = 256
const SUCCESS_TTL_MS = 24 * 60 * 60 * 1000
const FAILURE_TTL_MS = 5 * 60 * 1000

interface CacheEntry<T> {
  value: T | null
  expiresAt: number
}

const externalCache = new Map<string, CacheEntry<ExternalLinkPreview>>()
const externalInFlight = new Map<string, Promise<ExternalLinkPreview | null>>()
const localCache = new Map<string, CacheEntry<LocalLinkPreview>>()

function cacheGet<T>(cache: Map<string, CacheEntry<T>>, key: string): T | null | undefined {
  const entry = cache.get(key)
  if (!entry) return undefined
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key)
    return undefined
  }
  cache.delete(key)
  cache.set(key, entry)
  return entry.value
}

function cacheSet<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  value: T | null,
  ttlMs: number
): void {
  cache.delete(key)
  cache.set(key, { value, expiresAt: Date.now() + ttlMs })
  if (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
}

function normalizeHostname(hostname: string): string {
  return hostname
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
}

function isPublicIpv4(address: string): boolean {
  const octets = address.split('.').map(Number)
  if (
    octets.length !== 4 ||
    octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  )
    return false
  const [a, b, c] = octets
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false
  if (a === 100 && b >= 64 && b <= 127) return false
  if (a === 169 && b === 254) return false
  if (a === 172 && b >= 16 && b <= 31) return false
  if (a === 192 && b === 168) return false
  if (a === 192 && b === 0) return false
  if (a === 192 && b === 88 && c === 99) return false
  if (a === 198 && (b === 18 || b === 19)) return false
  if (a === 192 && b === 0 && c === 2) return false
  if (a === 198 && b === 51 && c === 100) return false
  if (a === 203 && b === 0 && c === 113) return false
  return true
}

function isPublicAddress(address: string): boolean {
  const normalized = normalizeHostname(address)
  const family = isIP(normalized)
  if (family === 4) return isPublicIpv4(normalized)
  if (family !== 6) return false

  const lower = normalized.toLowerCase()
  // Only accept native global-unicast IPv6. This deliberately rejects local,
  // transition, mapped, multicast, and other special-purpose ranges.
  const hextets = lower.split(':')
  const firstHextet = Number.parseInt(hextets[0], 16)
  if (!Number.isFinite(firstHextet) || firstHextet < 0x2000 || firstHextet > 0x3fff) return false
  const secondHextet = Number.parseInt(hextets[1] || '0', 16)
  if (
    firstHextet === 0x2001 &&
    (secondHextet === 0 ||
      secondHextet === 2 ||
      (secondHextet >= 0x10 && secondHextet <= 0x2f) ||
      secondHextet === 0x0db8)
  ) {
    return false
  }
  if (firstHextet === 0x2002) return false
  return true
}

function parseExternalUrl(raw: string): URL | null {
  if (!raw || raw.length > MAX_URL_LENGTH) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (url.username || url.password) return null
  if (
    url.port &&
    !(
      (url.protocol === 'http:' && url.port === '80') ||
      (url.protocol === 'https:' && url.port === '443')
    )
  ) {
    return null
  }
  url.hash = ''

  const hostname = normalizeHostname(url.hostname)
  if (
    !hostname ||
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.lan') ||
    hostname.endsWith('.home')
  ) {
    return null
  }
  const family = isIP(hostname)
  if (family > 0) {
    if (!isPublicAddress(hostname)) return null
  } else if (!hostname.includes('.')) {
    return null
  }
  return url
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolvePromise, rejectPromise) => {
    const timer = setTimeout(() => rejectPromise(new Error('Link preview timed out')), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolvePromise(value)
      },
      (error) => {
        clearTimeout(timer)
        rejectPromise(error)
      }
    )
  })
}

async function validateResolvedHost(url: URL, deadline: number): Promise<boolean> {
  const hostname = normalizeHostname(url.hostname)
  if (isIP(hostname)) return isPublicAddress(hostname)
  const remaining = deadline - Date.now()
  if (remaining <= 0) return false
  try {
    const resolved = await withTimeout(net.resolveHost(hostname), remaining)
    return (
      resolved.endpoints.length > 0 &&
      resolved.endpoints.every((endpoint) => isPublicAddress(endpoint.address))
    )
  } catch {
    return false
  }
}

async function readBoundedHead(response: Response, controller: AbortController): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let total = 0
  let html = ''
  try {
    while (total < MAX_RESPONSE_BYTES) {
      const result = await reader.read()
      if (result.done) break
      const remaining = MAX_RESPONSE_BYTES - total
      const chunk = result.value.subarray(0, remaining)
      total += chunk.byteLength
      html += decoder.decode(chunk, { stream: true })
      if (/<\/head\s*>/i.test(html) || chunk.byteLength < result.value.byteLength) break
    }
    html += decoder.decode()
    const headEnd = html.search(/<\/head\s*>/i)
    return headEnd >= 0 ? html.slice(0, headEnd + 7) : html
  } finally {
    void reader.cancel().catch(() => undefined)
    controller.abort()
  }
}

function decodeHtmlEntities(value: string): string {
  const named: Record<string, string> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: ' ',
    quot: '"'
  }
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (entity, key: string) => {
    if (key[0] === '#') {
      const hex = key[1]?.toLowerCase() === 'x'
      const codePoint = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10)
      if (Number.isFinite(codePoint) && codePoint > 0 && codePoint <= 0x10ffff) {
        try {
          return String.fromCodePoint(codePoint)
        } catch {
          return entity
        }
      }
      return entity
    }
    return named[key.toLowerCase()] ?? entity
  })
}

function cleanMetadata(value: string | undefined, maxLength: number): string | null {
  if (!value) return null
  const cleaned = decodeHtmlEntities(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return null
  return cleaned.slice(0, maxLength)
}

function tagAttributes(source: string): Map<string, string> {
  const attributes = new Map<string, string>()
  const pattern = /([^\s"'=<>`]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
  for (const match of source.matchAll(pattern)) {
    attributes.set(match[1].toLowerCase(), match[2] ?? match[3] ?? match[4] ?? '')
  }
  return attributes
}

function extractExternalMetadata(html: string, sourceUrl: URL): ExternalLinkPreview {
  const metadata = new Map<string, string>()
  for (const match of html.matchAll(/<meta\b([^>]*)>/gi)) {
    const attributes = tagAttributes(match[1])
    const key = (attributes.get('property') ?? attributes.get('name') ?? '').toLowerCase()
    const content = attributes.get('content')
    if (key && content && !metadata.has(key)) metadata.set(key, content)
  }
  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html)
  const title = cleanMetadata(
    metadata.get('og:title') ?? metadata.get('twitter:title') ?? titleMatch?.[1],
    240
  )
  const description = cleanMetadata(
    metadata.get('og:description') ??
      metadata.get('twitter:description') ??
      metadata.get('description'),
    500
  )
  return {
    kind: 'external',
    url: sourceUrl.toString(),
    finalUrl: sourceUrl.toString(),
    domain: normalizeHostname(sourceUrl.hostname),
    title,
    description,
    siteName: cleanMetadata(metadata.get('og:site_name'), 120)
  }
}

async function fetchExternalUncached(initialUrl: URL): Promise<ExternalLinkPreview | null> {
  const deadline = Date.now() + REQUEST_TIMEOUT_MS
  let current = initialUrl

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    if (!(await validateResolvedHost(current, deadline))) return null
    const remaining = deadline - Date.now()
    if (remaining <= 0) return null

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), remaining)
    let response: Response
    try {
      response = await net.fetch(current.toString(), {
        method: 'GET',
        redirect: 'manual',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal: controller.signal,
        headers: {
          Accept: 'text/html, application/xhtml+xml;q=0.9',
          Range: `bytes=0-${MAX_RESPONSE_BYTES - 1}`
        }
      })
    } catch {
      clearTimeout(timer)
      return null
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      clearTimeout(timer)
      controller.abort()
      const location = response.headers.get('location')
      if (!location || redirectCount === MAX_REDIRECTS) return null
      let redirected: URL | null
      try {
        redirected = parseExternalUrl(new URL(location, current).toString())
      } catch {
        return null
      }
      if (!redirected) return null
      current = redirected
      continue
    }

    if (!response.ok) {
      clearTimeout(timer)
      controller.abort()
      return null
    }
    const contentType = response.headers.get('content-type')?.toLowerCase() ?? ''
    if (
      !contentType ||
      (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml'))
    ) {
      clearTimeout(timer)
      controller.abort()
      return null
    }

    try {
      const html = await readBoundedHead(response, controller)
      const preview = extractExternalMetadata(html, current)
      preview.url = initialUrl.toString()
      preview.finalUrl = current.toString()
      return preview
    } catch {
      return null
    } finally {
      clearTimeout(timer)
      controller.abort()
    }
  }
  return null
}

export async function externalLinkPreview(rawUrl: string): Promise<ExternalLinkPreview | null> {
  const url = parseExternalUrl(rawUrl)
  if (!url) return null
  const key = url.toString()
  const cached = cacheGet(externalCache, key)
  if (cached !== undefined) return cached
  const pending = externalInFlight.get(key)
  if (pending) return pending

  const request = fetchExternalUncached(url)
    .then((preview) => {
      cacheSet(externalCache, key, preview, preview ? SUCCESS_TTL_MS : FAILURE_TTL_MS)
      return preview
    })
    .finally(() => externalInFlight.delete(key))
  externalInFlight.set(key, request)
  return request
}

function isWithinRoot(path: string, root: string): boolean {
  const child = relative(root, path)
  return child === '' || (child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child))
}

async function readFilePrefix(path: string, size: number): Promise<string> {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(Math.min(size, MAX_RESPONSE_BYTES))
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    return buffer
      .subarray(0, bytesRead)
      .toString('utf8')
      .replace(/^\uFEFF/, '')
  } finally {
    await handle.close()
  }
}

function yamlScalar(frontmatter: string, key: string): string | null {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`^${escapedKey}\\s*:\\s*(.+)$`, 'im').exec(frontmatter)?.[1]?.trim()
  if (!match || match === '|' || match === '>') return null
  if (match.startsWith('"') && match.endsWith('"')) {
    try {
      const parsed = JSON.parse(match)
      return typeof parsed === 'string' ? parsed : null
    } catch {
      return match.slice(1, -1)
    }
  }
  if (match.startsWith("'") && match.endsWith("'")) {
    return match.slice(1, -1).replace(/''/g, "'")
  }
  return match.replace(/\s+#.*$/, '').trim() || null
}

function stripMarkdown(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/\[\[([^|\]#]+)(?:#[^|\]]*)?(?:\|([^\]]+))?]]/g, (_match, target, display) =>
      String(display ?? target)
    )
    .replace(/<[^>]*>/g, ' ')
    .replace(/^[\s>*#-]+/gm, '')
    .replace(/[`_*~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractLocalMetadata(
  content: string,
  relativePath: string,
  modifiedAt: number
): LocalLinkPreview {
  const frontmatterMatch = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/.exec(content)
  const frontmatter = frontmatterMatch?.[1] ?? ''
  const body = frontmatterMatch ? content.slice(frontmatterMatch[0].length) : content
  const heading = /^#{1,6}\s+(.+)$/m.exec(body)?.[1]
  const fallbackTitle = basename(relativePath).replace(/\.(?:md|markdown)$/i, '')
  const title =
    cleanMetadata(yamlScalar(frontmatter, 'title') ?? heading ?? fallbackTitle, 240) ??
    fallbackTitle

  const frontmatterDescription =
    yamlScalar(frontmatter, 'description') ?? yamlScalar(frontmatter, 'summary')
  let description = cleanMetadata(frontmatterDescription ?? undefined, 500)
  if (!description) {
    const paragraphs = body
      .replace(/```[\s\S]*?```/g, ' ')
      .split(/\r?\n\s*\r?\n/)
      .map(stripMarkdown)
      .filter((paragraph) => paragraph && paragraph !== title)
    description = cleanMetadata(paragraphs[0], 320)
  }

  return {
    kind: 'local',
    path: relativePath.replaceAll('\\', '/'),
    title,
    description,
    modifiedAt
  }
}

export async function localLinkPreview(
  collectionPath: string,
  relativePath: string,
  allowedCollectionPaths: string[]
): Promise<LocalLinkPreview | null> {
  const root = resolve(collectionPath)
  if (!allowedCollectionPaths.some((allowed) => resolve(allowed) === root)) return null
  if (!relativePath || isAbsolute(relativePath)) return null
  if (!['.md', '.markdown'].includes(extname(relativePath).toLowerCase())) return null

  const candidate = resolve(root, relativePath)
  if (!isWithinRoot(candidate, root)) return null
  try {
    const [realRoot, realCandidate] = await Promise.all([realpath(root), realpath(candidate)])
    if (!isWithinRoot(realCandidate, realRoot)) return null
    const metadata = await stat(realCandidate)
    if (!metadata.isFile()) return null

    const key = `${realCandidate}\0${metadata.mtimeMs}\0${metadata.size}`
    const cached = cacheGet(localCache, key)
    if (cached !== undefined) return cached
    const content = await readFilePrefix(realCandidate, metadata.size)
    const preview = extractLocalMetadata(content, relativePath, metadata.mtimeMs)
    cacheSet(localCache, key, preview, SUCCESS_TTL_MS)
    return preview
  } catch {
    return null
  }
}

/** Test/session hook. */
export function clearLinkPreviewCaches(): void {
  externalCache.clear()
  externalInFlight.clear()
  localCache.clear()
}
