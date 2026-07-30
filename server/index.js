import { createApp } from './app.js'
import { config, envFile } from './config.js'

const app = createApp()
const store = app.locals.store

const server = app.listen(config.port, () => {
  console.log(`[api] listening on http://localhost:${config.port}`)

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
