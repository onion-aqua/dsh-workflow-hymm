import { defineConfig } from 'vitest/config'
import { transform } from 'esbuild'
export default defineConfig({
  plugins: [{ name: 'workflow-standard-decorators', enforce: 'pre', async transform(code, id) {
    if (id.replaceAll('\\', '/').endsWith('/src/host/service.ts')) {
      return transform(code, { loader: 'ts', target: 'es2022', format: 'esm' })
    }
  } }],
  test: { include: ['tests/**/*.spec.ts', 'tests/**/*.spec.tsx'], exclude: ['tests/e2e/**'], testTimeout: 30000, hookTimeout: 30000 },
})
