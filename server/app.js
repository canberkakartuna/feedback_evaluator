import express from 'express'
import { config } from './config.js'
import { createStore } from './store/index.js'
import { storage } from './lib/storage.js'
import { resolveQuestion as lookupQuestion } from './services/delivery.js'
import { activityRoutes } from './routes/activities.js'
import { sessionRoutes } from './routes/sessions.js'
import { answerRoutes } from './routes/answers.js'
import { tutorRoutes } from './routes/tutor.js'
import { uploadFileRoutes, uploadRoutes } from './routes/uploads.js'
import { eventRoutes, ownQuestionRoutes, promptRoutes } from './routes/misc.js'
import { researchRoutes } from './routes/research.js'
import { authRoutes } from './routes/auth.js'
import { userRoutes } from './routes/users.js'
import { optionalAuth } from './lib/auth.js'
import { ApiError, notFound, route } from './lib/http.js'

export function createApp({ store = createStore() } = {}) {
  const app = express()

  app.disable('x-powered-by')

  // Base64 attachments arrive inside JSON, so the limit allows for the ~4/3
  // expansion on top of the raw file limit.
  app.use(express.json({ limit: Math.ceil((config.maxUploadBytes * 4) / 3) + 1024 * 1024 }))

  app.use((req, res, next) => {
    const origin = req.get('origin')
    if (origin && config.origins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Vary', 'Origin')
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Research-Token')
    }
    if (req.method === 'OPTIONS') {
      res.sendStatus(204)
      return
    }
    next()
  })

  /**
   * The API is served from the same origin as the site, so its responses pass
   * through the same CDN. Vercel's default `public, max-age=0, must-revalidate`
   * is the wrong signal for per-session data: nothing here should ever sit in a
   * shared cache, so say so explicitly.
   */
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0')
    next()
  })

  /**
   * Attaches `req.user` when the request carries a valid login token, and does
   * nothing at all when it does not.
   *
   * Optional on purpose: most of this API is anonymous by design — a student can
   * consent and work through a session without an account, and that has to keep
   * being true. Routes that need an identity say so themselves with
   * `requireAuth`. It also means the researcher endpoints, which send their own
   * token on the same `Authorization` header, are unaffected: it matches no
   * user, `req.user` stays null, and their own check runs.
   */
  app.use('/api', optionalAuth(store))

  /**
   * Every student route is scoped to a session and a question, so resolving
   * both — and refusing anything that does not exist — happens once here
   * rather than at the top of a dozen handlers.
   */
  async function resolveQuestion(req) {
    const session = await store.sessions.findById(req.params.sessionId)
    if (!session) throw notFound('No such session')

    const question = await lookupQuestion(store, session, req.params.questionId)
    if (!question) throw notFound('No such question')

    return { session, question }
  }

  const deps = { resolveQuestion }

  /**
   * `ok` means this instance is answering. `ready` means it is safe to point
   * students at — which on a serverless host it is not until the store and the
   * upload target are both external. A deploy check should gate on `ready`.
   */
  app.get(
    '/api/health',
    route(async (req, res) => {
      const warnings = []

      if (store.kind === 'memory') {
        warnings.push(
          config.serverless
            ? 'In-memory store on a serverless host: every instance has its own copy and loses it on recycle, so sessions will disappear at random. Set MONGODB_URI before real use.'
            : 'In-memory store: everything is lost when the process restarts.',
        )
      }

      // Configured is not the same as reachable, and `ready` is what a deploy
      // check gates on — so actually go and ask.
      const database = store.ping ? await store.ping() : null
      if (database && !database.ok) {
        warnings.push(`MongoDB is configured but unreachable: ${database.error}`)
      }

      /**
       * Uploads outlive the instance only when they leave it. Disk is fine
       * locally and is a data-loss bug on a serverless host, where the temp
       * directory is per-instance and cleared without warning — so the same
       * backend is a note in one place and a warning in the other.
       */
      const files = storage()
      const filesReachable = await files.check()

      if (!filesReachable.ok) {
        warnings.push(`Upload storage is configured but unreachable: ${filesReachable.error}`)
      } else if (files.kind === 'disk' && config.serverless) {
        warnings.push(
          'Uploads are going to the instance temp directory and will not survive. Set SPACES_KEY and SPACES_SECRET.',
        )
      }

      if (!config.researchToken) {
        warnings.push('RESEARCH_TOKEN is unset, so researcher endpoints are disabled.')
      }

      /**
       * A warning rather than a note, because a canned tutor is not a degraded
       * feature — it is the study's independent variable switched off. The chat
       * still answers, the system prompt is still versioned, and nothing in the
       * interface says the model never ran, which is exactly why this has to.
       */
      if (!config.openai.configured) {
        warnings.push(
          'OPENAI_API_KEY is unset, so the tutor answers from the scripted lines in shared/tutor-scripts.js and no model runs.',
        )
      }

      /**
       * Counting users is also the accounts readiness check. Zero means
       * `POST /api/auth/bootstrap` is still open, and if no bootstrap token is
       * configured it is open to whoever calls it first — which on a reachable
       * deployment is a way in, not a convenience.
       */
      const users = database && !database.ok ? null : await store.users.count()

      if (users === 0) {
        warnings.push(
          config.bootstrapToken
            ? 'No users exist yet. POST /api/auth/bootstrap with the bootstrap token to create the first admin.'
            : 'No users exist and no BOOTSTRAP_TOKEN (or RESEARCH_TOKEN) is set, so POST /api/auth/bootstrap will make an admin of whoever calls it first.',
        )
      }

      res.json({
        ok: true,
        ready: warnings.length === 0,
        store: store.kind,
        persistent: store.kind !== 'memory',
        database: store.database ?? null,
        databaseReachable: database ? database.ok : null,
        serverless: config.serverless,
        uploads: files.kind,
        uploadsReachable: filesReachable.ok,
        /** Which of the two writes the tutor's replies — see services/tutor.js. */
        tutor: config.openai.configured ? 'openai' : 'scripted',
        tutorModel: config.openai.configured ? config.openai.model : null,
        researchEnabled: Boolean(config.researchToken),
        users,
        uptime: Math.round(process.uptime()),
        warnings,
      })
    }),
  )

  app.use('/api/auth', authRoutes(store))
  app.use('/api/users', userRoutes(store))
  app.use('/api/activities', activityRoutes(store))
  app.use('/api/sessions', sessionRoutes(store))
  app.use('/api/sessions', answerRoutes(store, deps))
  app.use('/api/sessions', tutorRoutes(store, deps))
  app.use('/api/sessions', uploadRoutes(store, deps))
  app.use('/api/sessions', ownQuestionRoutes(store))
  app.use('/api/sessions', eventRoutes(store))
  app.use('/api/uploads', uploadFileRoutes(store))
  app.use('/api/prompts', promptRoutes(store))
  app.use('/api/research', researchRoutes(store))

  app.use((req, res) => {
    res.status(404).json({ error: { message: `No route for ${req.method} ${req.path}` } })
  })

  // eslint-disable-next-line no-unused-vars
  app.use((error, req, res, next) => {
    if (error instanceof ApiError) {
      res.status(error.status).json({ error: { message: error.message, details: error.details } })
      return
    }

    if (error?.type === 'entity.too.large') {
      res.status(413).json({ error: { message: 'Request body is too large' } })
      return
    }

    if (error instanceof SyntaxError && 'body' in error) {
      res.status(400).json({ error: { message: 'Body is not valid JSON' } })
      return
    }

    console.error('[api] unhandled', error)
    res.status(500).json({ error: { message: 'Something went wrong on the server' } })
  })

  app.locals.store = store
  return app
}
