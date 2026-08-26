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
 * GEMINI_API_KEY in the gitignored `.env.local` (`*.local`) while the shared
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

  /**
   * The tutor's model: Google Gemini, through the Generative Language API.
   *
   * `configured` is the switch services/tutor.js reads. Unset the key and the
   * tutor falls back to the scripted lines in shared/tutor-scripts.js — the app
   * still works end to end, the chat is just canned, which is what a bare
   * checkout and the smoke test both want. `GET /api/health` says which of the
   * two is answering.
   *
   * The key lives in `.env.local`, so it has never been committed. Note what
   * that costs: env files are read in development only, so a deployment
   * answers scripted until `GEMINI_API_KEY` is set in the host's own
   * environment settings (Vercel → Project → Settings → Environment
   * Variables). Everything else here is a knob and belongs in `.env`.
   */
  gemini: {
    apiKey: process.env.GEMINI_API_KEY?.trim() || null,
    /**
     * The `-latest` alias, so a model retirement does not take the tutor down
     * with it — it resolves to `gemini-3.6-flash` today. Pin that exact name
     * while a study is running and the replies have to stay comparable; the
     * trade is that a retired version stops answering (`gemini-2.5-flash` is
     * already a 404 for a new key) where the alias moves on instead.
     */
    model: process.env.GEMINI_MODEL?.trim() || 'gemini-flash-latest',
    /** A student is watching a typing indicator, so this is deliberately short. */
    timeoutMs: Number(process.env.GEMINI_TIMEOUT_MS ?? 20000),
    /**
     * Not the length of the reply — the prompt's word cap does that. This has
     * to cover the model's *thinking as well*, which is billed to the same
     * allowance and spent first: measured at `thinkingLevel: low`, a 400-token
     * allowance left 14 tokens for the answer and truncated it. 2000 leaves
     * room for a few hundred tokens of reasoning and a few sentences of tutor.
     * Lowering it does not save money, it produces cut-off replies.
     */
    maxOutputTokens: Number(process.env.GEMINI_MAX_OUTPUT_TOKENS ?? 2000),
    temperature: Number(process.env.GEMINI_TEMPERATURE ?? 0.6),
    /**
     * How hard the model thinks first, passed to the API verbatim — because the
     * field it goes in changed between model generations and sending the wrong
     * one is a 400 rather than a warning:
     *
     * - 3.x: `{ thinkingLevel: 'low' | 'high' }`. It cannot be switched off.
     * - 2.5: `{ thinkingBudget: <tokens> }`, and `0` switched it off.
     *
     * `low` because a tutor turn is a judgement about one short answer, not a
     * proof, and every thinking token is a token of reply given up. Set
     * `GEMINI_THINKING_LEVEL=` (empty) to send nothing at all and let the model
     * pick its own default; set `GEMINI_THINKING_BUDGET` instead and that wins,
     * for a model old enough to want it.
     */
    thinking: (() => {
      const level = process.env.GEMINI_THINKING_LEVEL?.trim()
      const budget = process.env.GEMINI_THINKING_BUDGET?.trim()
      if (budget) return { thinkingBudget: Number(budget) }
      if (level === '') return null
      return { thinkingLevel: level || 'low' }
    })(),
    get configured() {
      return Boolean(this.apiKey)
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
