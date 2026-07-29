import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))

export const config = {
  port: Number(process.env.PORT ?? 4000),

  /** Where the browser runs in development, for CORS. */
  origins: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://localhost:5174')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),

  /** Uploaded photos and whiteboard exports. Swap for GridFS or S3 later. */
  uploadDir: process.env.UPLOAD_DIR ?? path.join(here, '.uploads'),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES ?? 10 * 1024 * 1024),

  /**
   * Researcher endpoints read every student's transcript, so they stay shut
   * until a token is set. There is deliberately no default.
   */
  researchToken: process.env.RESEARCH_TOKEN ?? null,

  consentVersion: process.env.CONSENT_VERSION ?? '2026-07-29.placeholder',
}
