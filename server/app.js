import express from 'express'
import { config } from './config.js'
import { createStore } from './store/index.js'
import { findQuestion, publicCourse, topics } from './services/course.js'
import { ownTutor } from '../shared/course.js'
import { sessionRoutes } from './routes/sessions.js'
import { answerRoutes } from './routes/answers.js'
import { tutorRoutes } from './routes/tutor.js'
import { uploadFileRoutes, uploadRoutes } from './routes/uploads.js'
import { eventRoutes, ownQuestionRoutes, promptRoutes } from './routes/misc.js'
import { researchRoutes } from './routes/research.js'
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
   * Every student route is scoped to a session and a question, so resolving
   * both — and refusing anything that does not exist — happens once here
   * rather than at the top of a dozen handlers.
   */
  async function resolveQuestion(req) {
    const session = await store.sessions.findById(req.params.sessionId)
    if (!session) throw notFound('No such session')

    const questionId = req.params.questionId
    const known = findQuestion(questionId)

    if (known) return { session, question: known }

    const own = await store.ownQuestions.findById(questionId)
    if (own && own.sessionId === session.id) {
      return { session, question: { ...own, rubric: [], tutor: ownTutor } }
    }

    throw notFound('No such question')
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

      if (config.serverless) {
        warnings.push(
          'Uploads are being written to the instance temp directory and will not survive. Move them to Vercel Blob or GridFS.',
        )
      }

      if (!config.researchToken) {
        warnings.push('RESEARCH_TOKEN is unset, so researcher endpoints are disabled.')
      }

      res.json({
        ok: true,
        ready: warnings.length === 0,
        store: store.kind,
        persistent: store.kind !== 'memory',
        database: store.database ?? null,
        databaseReachable: database ? database.ok : null,
        serverless: config.serverless,
        researchEnabled: Boolean(config.researchToken),
        uptime: Math.round(process.uptime()),
        warnings,
      })
    }),
  )

  app.get('/api/course', (req, res, next) => {
    try {
      res.json({ course: publicCourse(req.query.topicId ?? 'all'), topics: topics() })
    } catch (error) {
      next(error)
    }
  })

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
