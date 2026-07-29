import { createApp } from './app.js'
import { config, envFile } from './config.js'

const app = createApp()

const server = app.listen(config.port, () => {
  console.log(`[api] listening on http://localhost:${config.port}`)
  console.log(`[api] store: in-memory (set up store/mongo.js when the DB lands)`)

  console.log(
    envFile.loaded
      ? `[api] .env loaded: ${envFile.applied} set, ${envFile.skipped} already in the environment`
      : '[api] no .env found — copy .env.example to .env',
  )

  if (!config.researchToken) {
    console.log('[api] researcher endpoints disabled — set RESEARCH_TOKEN to enable')
  }
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    console.log(`\n[api] ${signal} — closing`)
    server.close(() => process.exit(0))
  })
}
