import { fileURLToPath } from 'node:url'
import os from 'node:os'
import path from 'node:path'
import { loadEnvFile } from './lib/env.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(here, '..')

/**
 * Config comes from `.env.local` and then `.env`, in development and deployment
 * alike, and is loaded before anything below is read.
 *
 * Precedence runs left to right and the first setter of a key wins, so:
 * real environment variables beat `.env.local`, which beats `.env`. A
 * host-injected value therefore overrides both files with no code change.
 *
 * The split matters. `.env` is committed — that is the only way a serverless
 * deployment reads it — so everything in it is public to anyone with repository
 * access, for good. `.env.local` is gitignored (`*.local`), which makes it the
 * place for credentials such as MONGODB_URI when working locally; in a
 * deployment those come from the host's own environment settings instead.
 *
 * Vite applies the same two files in the same order to VITE_-prefixed keys, so
 * the client and the API never disagree about which value won.
 *
 * Both the repo root and the working directory are tried, because a bundled
 * serverless function does not necessarily run from the root. `vercel.json` has
 * to name `.env` under `includeFiles` too, or the file is not shipped with the
 * function at all.
 */
const candidates = [
  path.join(repoRoot, '.env.local'),
  path.join(process.cwd(), '.env.local'),
  path.join(repoRoot, '.env'),
  path.join(process.cwd(), '.env'),
]

export const envFile = (() => {
  const files = []
  let applied = 0
  let skipped = 0

  // Deduplicated: run from the repo root and both candidates for a name are the
  // same file, which would otherwise be counted twice.
  for (const candidate of new Set(candidates)) {
    const result = loadEnvFile(candidate)
    if (!result.loaded) continue

    files.push(candidate)
    applied += result.applied
    skipped += result.skipped
  }

  return { loaded: files.length > 0, applied, skipped, files }
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
   * Uploaded photos and whiteboard exports, when they are going to local disk.
   *
   * Only used by the disk backend — see `spaces` below and lib/storage.js.
   * Only the project directory is writable when running locally, and on a
   * serverless host the temp directory is the only writable path, which is
   * per-instance and short-lived. So disk is somewhere to land while
   * developing, not somewhere to keep things: a deployment wants Spaces.
   */
  uploadDir:
    process.env.UPLOAD_DIR ??
    (serverless ? path.join(os.tmpdir(), 'dropshot-uploads') : path.join(here, '.uploads')),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES ?? 10 * 1024 * 1024),

  /**
   * DigitalOcean Spaces, which is S3-compatible.
   *
   * `configured` is the switch lib/storage.js reads, and it takes **both**
   * halves of the credential to flip: a key with no secret is a half-finished
   * setup, and silently falling back to disk there would look like it worked
   * right up until the instance recycled and the files were gone.
   *
   * The key and secret are credentials, so they belong in `.env.local` locally
   * and in the host's environment settings once deployed — never in the
   * committed `.env`. The bucket, region and endpoint are just names.
   */
  spaces: {
    key: process.env.SPACES_KEY?.trim() || null,
    secret: process.env.SPACES_SECRET?.trim() || null,
    bucket: process.env.SPACES_BUCKET?.trim() || 'dropshot',
    region: process.env.SPACES_REGION?.trim() || 'sfo3',
    endpoint:
      process.env.SPACES_ENDPOINT?.trim() ||
      `https://${process.env.SPACES_REGION?.trim() || 'sfo3'}.digitaloceanspaces.com`,
    /** How long a read URL stays valid, in seconds. */
    urlTtl: Number(process.env.SPACES_URL_TTL ?? 300),
    get configured() {
      return Boolean(this.key && this.secret)
    },
  },

  /**
   * Researcher endpoints read every student's transcript, so they stay shut
   * until a token is set. There is deliberately no default.
   */
  researchToken: process.env.RESEARCH_TOKEN ?? null,

  consentVersion: process.env.CONSENT_VERSION ?? '2026-07-29.placeholder',

  /** How long a login lasts. Presenting an older token re-authenticates nobody. */
  authTokenTtlDays: Number(process.env.AUTH_TOKEN_TTL_DAYS ?? 30),

  /**
   * Guards the one route that can mint an admin out of nothing:
   * `POST /api/auth/bootstrap`, which also requires that no user exists yet.
   *
   * Without this, an empty database is an open invitation — whoever calls first
   * becomes the admin. It defaults to RESEARCH_TOKEN because that is already
   * the operator secret for this deployment and one fewer value to manage; set
   * BOOTSTRAP_TOKEN to separate the two. Unset both and bootstrap is open,
   * which is what a bare local checkout wants and a deployment must not have —
   * `GET /api/health` warns while that is the case.
   */
  bootstrapToken: process.env.BOOTSTRAP_TOKEN?.trim() || process.env.RESEARCH_TOKEN?.trim() || null,

  /**
   * MongoDB. Unset means the in-memory store: fine locally, and unsafe anywhere
   * more than one instance answers requests — see server/README.md.
   *
   * The connection string carries credentials, so it belongs in `.env.local`
   * locally and in the host's environment settings once deployed. Never in the
   * committed `.env`.
   */
  mongoUri: process.env.MONGODB_URI?.trim() || null,

  /**
   * Optional. Atlas's copy-paste URI names no database, and the driver would
   * quietly use `test`; store/mongo.js resolves this, then a name in the URI
   * path, then its own default.
   */
  mongoDb: process.env.MONGODB_DB?.trim() || null,
}
