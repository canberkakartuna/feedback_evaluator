import { defineConfig, mergeConfig } from 'vite'
import base from '../vite.config.js'
import { E2E } from './ports.mjs'

/**
 * The client as the e2e suite serves it: a production build, previewed on its
 * own port and proxied to the e2e API. A build rather than the dev server, so
 * no test sees an on-demand compile or a dependency re-optimisation reload.
 *
 * Its own outDir and cacheDir, so neither `dist/` nor the dev server's
 * `node_modules/.vite` (which your running `npm run dev` uses) is touched.
 */
export default mergeConfig(
  base,
  defineConfig({
    root: new URL('..', import.meta.url).pathname,
    cacheDir: 'node_modules/.vite-e2e',
    build: { outDir: 'e2e/.build', emptyOutDir: true, chunkSizeWarningLimit: 5000 },
    preview: {
      port: E2E.webPort,
      strictPort: true,
      proxy: { '/api': { target: E2E.apiOrigin, changeOrigin: true } },
    },
  }),
)
