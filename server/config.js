import { fileURLToPath } from 'node:url'
import os from 'node:os'
import path from 'node:path'
import { loadEnvFile } from './lib/env.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(here, '..')

/**
 * Config comes from .env at the repo root, in both development and deployment.
 * Loaded before anything below is read. Real environment variables still win,
 * so a host-injected value overrides the file without a code change.
 *
 * The same file serves the client: Vite picks up VITE_-prefixed keys from it.
 *
 * Two candidate paths, because a bundled serverless function does not
 * necessarily run from the repo root. `vercel.json` has to name `.env` under
 * `includeFiles` as well, or the file is simply not shipped with the function.
 */
const candidates = [path.join(repoRoot, '.env'), path.join(process.cwd(), '.env')]

export const envFile = (() => {
  for (const candidate of candidates) {
    const result = loadEnvFile(candidate)
    if (result.loaded) return { ...result, path: candidate }
  }
  return { loaded: false, applied: 0, skipped: 0, path: null }
})()

/** Vercel and friends: read-only filesystem, no instance affinity. */
const serverless = Boolean(process.env.VERCEL)

export const config = {
  serverless,
  port: Number(process.env.PORT ?? 4000),

  /** Where the browser runs in development, for CORS. */
  origins: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://localhost:5174')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),

  /**
   * Uploaded photos and whiteboard exports.
   *
   * Only the project directory is writable when running locally. On a
   * serverless host the temp directory is the only writable path, and it is
   * per-instance and short-lived — so this is somewhere to land, not somewhere
   * to keep things. Vercel Blob or GridFS replaces it; see server/README.md.
   */
  uploadDir:
    process.env.UPLOAD_DIR ??
    (serverless ? path.join(os.tmpdir(), 'feedback-uploads') : path.join(here, '.uploads')),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES ?? 10 * 1024 * 1024),

  /**
   * Researcher endpoints read every student's transcript, so they stay shut
   * until a token is set. There is deliberately no default.
   */
  researchToken: process.env.RESEARCH_TOKEN ?? null,

  consentVersion: process.env.CONSENT_VERSION ?? '2026-07-29.placeholder',
}
