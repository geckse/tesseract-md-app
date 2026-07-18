import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/integration/**/*.test.ts'],
    globals: true,
    testTimeout: 60_000,
    hookTimeout: 30_000
  }
})
