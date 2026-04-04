import { writable } from 'svelte/store'
import type { Schema } from '../types/cli'

/** Schema for the active collection (fetched on demand). */
export const schema = writable<Schema | null>(null)

/** Fetch schema for a given root, optionally scoped to a path. */
export async function fetchSchema(root: string, path?: string): Promise<void> {
  try {
    const result = await window.api.schema(root, path)
    schema.set(result)
  } catch {
    schema.set(null)
  }
}
