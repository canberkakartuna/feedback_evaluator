import { fileURLToPath } from 'node:url'
import os from 'node:os'
import path from 'node:path'
import { loadEnvFile } from './lib/env.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(here, '..')

/**
 * Config comes from `.env.local` and then `.env` — **in development only** —
 * and is loaded before anything below is read.
 *
 * Precedence runs left to right and the first setter of a key wins, so:
 * real environment variables beat `.env.local`, which beats `.env`.
 *
 * The merge exists so local development can keep credentials such as
 * OPENAI_API_KEY in the gitignored `.env.local` (`*.local`) while the shared
 * knobs stay in the committed `.env`. On Vercel neither file is read: the
 * deployment is configured entirely from the project's environment settings
 * (Vercel → Project → Settings → Environment Variables).
 *
 * Vite applies the same two files in the same order to VITE_-prefixed keys, so
 * the client and the API never disagree about which value won.
 *
 * Both the repo root and the working directory are tried, because scripts and
 * tests do not necessarily run from the root.
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

  // Development only. On Vercel the deployment is configured by the host's
  // environment settings, never by files baked into the bundle.
  if (!process.env.VERCEL) {
    // Deduplicated: run from the repo root and both candidates for a name are
    // the same file, which would otherwise be counted twice.
    for (const candidate of new Set(candidates)) {
      const result = loadEnvFile(candidate)
      if (!result.loaded) continue

      files.push(candidate)
      applied += result.applied
      skipped += result.skipped
    }
  }

  return { loaded: files.length > 0, applied, skipped, files }
})()

/** Vercel and friends: read-only filesystem, no instance affinity. */
const serverless = Boolean(process.env.VERCEL)

/**
 * The tutor's model: OpenAI, through the Chat Completions API.
 *
 * `configured` is the switch services/tutor.js reads. Unset the key and the
 * tutor falls back to the scripted lines in shared/tutor-scripts.js — the app
 * still works end to end, the chat is just canned, which is what a bare
 * checkout and the smoke test both want. `GET /api/health` says which of the
 * two is answering.
 *
 * The key lives in `.env.local`, so it has never been committed. Note what
 * that costs: env files are read in development only, so a deployment
 * answers scripted until `OPENAI_API_KEY` is set in the host's own
 * environment settings (Vercel → Project → Settings → Environment
 * Variables). Everything else here is a knob and belongs in `.env`.
 *
 * **Two of the knobs depend on which model family is named**, and the API
 * turns a mismatch into a 400 on every call — which the tutor masks as its
 * scripted fallback, so nothing on screen ever says why. The reasoning models
 * (o-series, gpt-5-*) reject any temperature but the default and take
 * `reasoning_effort`; the non-reasoning models the exact reverse. So the
 * defaults are derived from the model name rather than fixed: point
 * OPENAI_MODEL at either family and a bare switch works. The env vars still
 * override — `OPENAI_TEMPERATURE=` (empty) forces "send nothing", a number
 * forces that number, and the same shape holds for OPENAI_REASONING_EFFORT.
 */
function openaiConfig() {
  /**
   * `gpt-5-mini`: a reasoning model — noticeably better tutoring than the
   * gpt-4o-mini this ran on before, reads the question images well, and still
   * cheap enough for a classroom. `gpt-5` is the premium step up. Pin an exact
   * dated snapshot while a study is running and the replies have to stay
   * comparable; the bare name is an alias that moves to the newest snapshot.
   */
  const model = process.env.OPENAI_MODEL?.trim() || 'gpt-5-mini'
  const reasoningModel = /^(o\d|gpt-5)/.test(model)

  const temperatureEnv = process.env.OPENAI_TEMPERATURE?.trim()
  const effortEnv = process.env.OPENAI_REASONING_EFFORT?.trim()

  return {
    apiKey: process.env.OPENAI_API_KEY?.trim() || null,
    model,
    /** A student is watching a typing indicator, so this is deliberately short. */
    timeoutMs: Number(process.env.OPENAI_TIMEOUT_MS ?? 20000),
    /**
     * Not the length of the reply — the prompt's word cap does that. On the
     * reasoning models this has to cover the model's *reasoning as well*,
     * which is billed to the same allowance and spent first — a tight number
     * truncates the answer rather than saving money, and a truncated answer is
     * treated as a failure and replaced by the scripted line. 4000 leaves
     * comfortable room for low-effort reasoning over a question image plus the
     * reply; on a non-reasoning model it is simply generous headroom.
     */
    maxOutputTokens: Number(process.env.OPENAI_MAX_OUTPUT_TOKENS ?? 4000),
    /** Null omits the field entirely, which is what a reasoning model requires. */
    temperature:
      temperatureEnv === undefined
        ? (reasoningModel ? null : 0.6)
        : temperatureEnv === ''
          ? null
          : Number(temperatureEnv),
    /**
     * How hard a reasoning model thinks first (`minimal`/`low`/`medium`/`high`),
     * sent verbatim as `reasoning_effort`. `low` by default on the reasoning
     * family — every reasoning token is a token of reply given up and a
     * student is waiting — and omitted entirely on the models that reject it.
     */
    reasoningEffort:
      effortEnv === undefined ? (reasoningModel ? 'low' : null) : effortEnv || null,
    get configured() {
      return Boolean(this.apiKey)
    },
  }
}

export const config = {
  serverless,
  port: Number(process.env.PORT ?? 4000),

  /** Where the browser runs in development, for CORS. */
  origins: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://localhost:5174')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean),

  /**
   * The disk fallback, used only when Spaces is not configured.
   *
   * **Never inside the repository.** It used to default to `server/.uploads`,
   * which put student photographs in the working tree — gitignored, but one
   * `git add -f` or a stray archive away from being shared, and confusing to
   * find there at all. It is the system temp directory now, in both
   * environments: somewhere to land while developing or running tests, never
   * somewhere to keep anything. Real uploads go to Spaces.
   */
  uploadDir: process.env.UPLOAD_DIR ?? path.join(os.tmpdir(), 'dropshot-uploads'),
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
    bucket: process.env.SPACES_BUCKET?.trim() || 'mezqr-bucket',
    /**
     * A folder inside a bucket shared with other applications, so everything
     * this one writes sits under one prefix and can be found, listed or purged
     * without touching anybody else's objects.
     */
    prefix: (process.env.SPACES_PREFIX ?? 'dropshot').replace(/^\/+|\/+$/g, ''),
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

  /** The tutor's model — assembled above, where the family rules are explained. */
  openai: openaiConfig(),

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
