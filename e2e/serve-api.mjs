/**
 * The API the browser tests run against — never the one you develop on.
 *
 * Started by playwright.config.js. Everything that could reach something real
 * is forced off here, before config.js is read, because the env loader only
 * fills keys that are still undefined (server/lib/env.js): an empty string set
 * here beats whatever `.env.local` holds.
 *
 *   MONGODB_URI     blank → the in-memory store, gone when this process exits
 *   OPENAI_API_KEY  blank → the tutor answers from shared/tutor-scripts.js
 *   SPACES_*        blank → uploads go to $TMPDIR/fe-e2e-uploads, emptied each run
 *
 * The tokens are fixed, known values so global-setup.mjs can bootstrap the
 * first admin; they guard nothing outside this throwaway process.
 */
import fs from 'node:fs/promises'
import { rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { E2E } from './ports.mjs'

// One fixed folder, emptied at every start: a killed run cannot leave more than
// one behind, and no run ever reads another's files.
const uploadDir = path.join(os.tmpdir(), 'fe-e2e-uploads')
await fs.rm(uploadDir, { recursive: true, force: true })
await fs.mkdir(uploadDir, { recursive: true })

Object.assign(process.env, {
  PORT: String(E2E.apiPort),
  MONGODB_URI: '',
  MONGODB_DB: '',
  OPENAI_API_KEY: '',
  GEMINI_API_KEY: '',
  SPACES_KEY: '',
  SPACES_SECRET: '',
  RESEARCH_TOKEN: E2E.researchToken,
  BOOTSTRAP_TOKEN: E2E.bootstrapToken,
  UPLOAD_DIR: uploadDir,
  ALLOWED_ORIGINS: E2E.webOrigin,
  STUDENT_SIGN_IN_REQUIRED: 'true',
})

const { config } = await import('../server/config.js')

// Refuse to start rather than run the suite against anything real.
if (config.mongoUri || config.openai.configured || config.spaces.configured) {
  console.error('[e2e api] refusing to start: a database, model key or bucket is configured')
  process.exit(1)
}

// server/index.js listens, logs which store it is on, and closes on SIGTERM.
await import('../server/index.js')

// Best effort on a clean exit; the next start empties the folder regardless.
process.on('exit', () => rmSync(uploadDir, { recursive: true, force: true }))
