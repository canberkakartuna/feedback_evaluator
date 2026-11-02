import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApp } from './app.js'
import { config, envFile } from './config.js'

const api = createApp()
const store = api.locals.store

/**
 * Serves the built client too when `dist/` exists (the Docker image), so one
 * process answers both the site and `/api`. On Vercel the CDN serves `dist/`
 * and api/index.js serves the API, so none of this runs there. In development
 * Vite serves the client and there is usually no `dist/`, which leaves this
 * the plain API server it was.
 *
 * The rules mirror vercel.json: hashed `/assets/*` cache forever, and any
 * other non-API GET falls back to index.html for client-side routing.
 */
const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist')
const serveClient = fs.existsSync(path.join(dist, 'index.html'))

const app = express()
app.disable('x-powered-by')

if (serveClient) {
  app.use('/assets', express.static(path.join(dist, 'assets'), { immutable: true, maxAge: '1y' }))
  app.use(express.static(dist, { index: false }))
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next()
    if (req.path.startsWith('/api') || req.path.startsWith('/assets/')) return next()
    res.setHeader('Cache-Control', 'no-cache')
    res.sendFile(path.join(dist, 'index.html'))
  })
}

app.use(api)

const server = app.listen(config.port, () => {
  console.log(`[api] listening on http://localhost:${config.port}`)
  if (serveClient) console.log(`[api] serving the client from ${dist}`)

  console.log(
    store.kind === 'mongo'
      ? `[api] store: mongodb, database "${store.database}" (connects on first use)`
      : '[api] store: in-memory — set MONGODB_URI in .env.local to persist',
  )

  console.log(
    envFile.loaded
      ? `[api] env from ${envFile.files.map((file) => file.split('/').pop()).join(' + ')}: ${envFile.applied} set, ${envFile.skipped} already in the environment`
      : '[api] no .env found — copy .env.example to .env',
  )

  if (!config.researchToken) {
    console.log('[api] researcher endpoints disabled — set RESEARCH_TOKEN to enable')
  }
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`\n[api] ${signal} — closing`)
    server.close(async () => {
      // Hand the connection pool back before going, or every restart under
      // `node --watch` leaves Mongo waiting out a socket timeout.
      await store.close?.()
      process.exit(0)
    })
  })
}
