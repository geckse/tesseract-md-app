import { writable } from 'svelte/store'
import type { Schema } from '../types/cli'

/** Schema for the active collection (fetched on demand). */
export const schema = writable<Schema | null>(null)

let schemaGeneration = 0

/** Fetch schema for a given root, optionally scoped to a path. */
export async function fetchSchema(root: string, path?: string): Promise<void> {
  const generation = ++schemaGeneration
  // Never display field metadata from the previous file/scope while the next
  // request is in flight.
  schema.set(null)
  try {
    const result = await window.api.schema(root, path)
    if (generation !== schemaGeneration) return
    schema.set(result)
  } catch {
    if (generation !== schemaGeneration) return
    schema.set(null)
  }
}

/** Invalidate in-flight schema reads and clear collection-scoped metadata. */
export function clearSchema(): void {
  schemaGeneration++
  schema.set(null)
}
