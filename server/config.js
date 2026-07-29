import { fileURLToPath } from 'node:url'
import os from 'node:os'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))

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
