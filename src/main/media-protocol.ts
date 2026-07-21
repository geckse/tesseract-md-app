import { net, protocol } from 'electron'
import { realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { getCollections } from './store'

const MEDIA_SCHEME = 'tesseract-media'

export function registerLocalMediaScheme(): void {
  protocol?.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true
      }
    }
  ])
}

function isWithinRoot(path: string, root: string): boolean {
  const childPath = relative(root, path)
  return (
    childPath === '' ||
    (childPath !== '..' && !childPath.startsWith(`..${sep}`) && !isAbsolute(childPath))
  )
}

export function resolveLocalMediaPath(
  requestUrl: string,
  collectionPaths: string[]
): string | null {
  try {
    const url = new URL(requestUrl)
    if (url.protocol !== `${MEDIA_SCHEME}:` || url.hostname !== 'asset') return null
    const requestedPath = url.searchParams.get('path')
    if (!requestedPath) return null
    const normalizedPath = resolve(requestedPath)
    return collectionPaths.some((root) => isWithinRoot(normalizedPath, resolve(root)))
      ? normalizedPath
      : null
  } catch {
    return null
  }
}

export function installLocalMediaProtocol(): void {
  if (!protocol) return

  protocol.handle(MEDIA_SCHEME, async (request) => {
    try {
      const collectionPaths = getCollections().map((collection) => collection.path)
      const candidate = resolveLocalMediaPath(request.url, collectionPaths)
      if (!candidate) return new Response('Not found', { status: 404 })

      // Resolve symlinks before serving so a link inside a collection cannot escape it.
      const [realCandidate, ...realRoots] = await Promise.all([
        realpath(candidate),
        ...collectionPaths.map((root) => realpath(root))
      ])
      if (!realRoots.some((root) => isWithinRoot(realCandidate, root))) {
        return new Response('Forbidden', { status: 403 })
      }

      return net.fetch(pathToFileURL(realCandidate).toString(), { headers: request.headers })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}
