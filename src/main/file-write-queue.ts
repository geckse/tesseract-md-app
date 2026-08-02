/**
 * Process-wide serialization for mutations of one collection file.
 *
 * Editor saves, computed-definition flushes, and frontmatter/property writes
 * all pass through this queue. Keeping the entire read/modify/write operation
 * inside one turn prevents two app windows from validating the same source and
 * then replacing each other's changes.
 */
const fileWriteTails = new Map<string, Promise<void>>()

export async function withSerializedFileWrite<T>(
  absolutePath: string,
  operation: () => Promise<T>
): Promise<T> {
  const previous = fileWriteTails.get(absolutePath) ?? Promise.resolve()
  let release!: () => void
  const turn = new Promise<void>((resolve) => {
    release = resolve
  })
  const tail = previous.catch(() => undefined).then(() => turn)
  fileWriteTails.set(absolutePath, tail)

  await previous.catch(() => undefined)
  try {
    return await operation()
  } finally {
    release()
    if (fileWriteTails.get(absolutePath) === tail) fileWriteTails.delete(absolutePath)
  }
}
