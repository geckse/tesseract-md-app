import { describe, it, expect, vi, beforeEach } from 'vitest'
import { get } from 'svelte/store'

// Mock window.api
const mockApi = {
  schema: vi.fn()
}

Object.defineProperty(globalThis, 'window', {
  value: { api: mockApi },
  writable: true
})

import { schema, fetchSchema, clearSchema } from '../../src/renderer/stores/schema'

beforeEach(() => {
  schema.set(null)
  vi.resetAllMocks()
})

describe('schema store', () => {
  const mockSchema = {
    fields: [
      { name: 'title', field_type: 'String', count: 5, examples: ['Hello'] },
      { name: 'tags', field_type: 'List', count: 3, examples: ['rust', 'ai'] }
    ]
  }

  describe('fetchSchema', () => {
    it('populates store with fetched schema', async () => {
      mockApi.schema.mockResolvedValue(mockSchema)

      await fetchSchema('/root')

      expect(get(schema)).toEqual(mockSchema)
      expect(mockApi.schema).toHaveBeenCalledWith('/root', undefined)
    })

    it('passes path parameter to API', async () => {
      mockApi.schema.mockResolvedValue(mockSchema)

      await fetchSchema('/root', 'docs/notes')

      expect(mockApi.schema).toHaveBeenCalledWith('/root', 'docs/notes')
      expect(get(schema)).toEqual(mockSchema)
    })

    it('calls API without path when no path provided', async () => {
      mockApi.schema.mockResolvedValue(mockSchema)

      await fetchSchema('/root')

      expect(mockApi.schema).toHaveBeenCalledWith('/root', undefined)
    })

    it('sets schema to null on error', async () => {
      schema.set(mockSchema as never)
      mockApi.schema.mockRejectedValue(new Error('fail'))

      await fetchSchema('/root')

      expect(get(schema)).toBeNull()
    })

    it('does not let a stale scope response replace the latest schema', async () => {
      let resolveFirst!: (value: typeof mockSchema) => void
      let resolveSecond!: (value: typeof mockSchema) => void
      mockApi.schema
        .mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)))
        .mockReturnValueOnce(new Promise((resolve) => (resolveSecond = resolve)))

      const first = fetchSchema('/first', 'old')
      const second = fetchSchema('/second', 'current')
      const current = { fields: [{ name: 'current', field_type: 'String', count: 1 }] }
      resolveSecond(current as typeof mockSchema)
      await second
      resolveFirst(mockSchema)
      await first

      expect(get(schema)).toEqual(current)
    })

    it('invalidates an in-flight response when schema state is cleared', async () => {
      let resolveSchema!: (value: typeof mockSchema) => void
      mockApi.schema.mockReturnValue(new Promise((resolve) => (resolveSchema = resolve)))

      const loading = fetchSchema('/old')
      clearSchema()
      resolveSchema(mockSchema)
      await loading

      expect(get(schema)).toBeNull()
    })
  })
})
