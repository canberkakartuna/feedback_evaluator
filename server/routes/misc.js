import express from 'express'
import { ownTutor } from '../../shared/course.js'
import { badRequest, id, notFound, now, requireString, route } from '../lib/http.js'

/** Doc item 8: questions the student brings themselves. */
export function ownQuestionRoutes(store) {
  const router = express.Router()

  router.post(
    '/:sessionId/own-questions',
    route(async (req, res) => {
      const session = await store.sessions.findById(req.params.sessionId)
      if (!session) throw notFound('No such session')

      const prompt = requireString(req.body, 'prompt', { max: 2000 })
      const existing = await store.ownQuestions.listBySession(session.id)
      const number = existing.length + 1

      const question = await store.ownQuestions.insert({
        id: `own_${session.id}_${number}`,
        sessionId: session.id,
        code: `OWN-${String(number).padStart(2, '0')}`,
        kind: 'Your question',
        points: 0,
        prompt: prompt.trim(),
        criteriaCount: 0,
        hintCount: ownTutor.hints.length,
        groupId: 'own',
        groupTitle: 'Your own questions',
        createdAt: now(),
      })

      await store.events.insertMany([
        {
          id: id('evt'),
          sessionId: session.id,
          questionId: question.id,
          type: 'student_added_own_question',
          at: now(),
          payload: { chars: prompt.length },
        },
      ])

      res.status(201).json({ question })
    }),
  )

  router.get(
    '/:sessionId/own-questions',
    route(async (req, res) => {
      const session = await store.sessions.findById(req.params.sessionId)
      if (!session) throw notFound('No such session')
      res.json({ questions: await store.ownQuestions.listBySession(session.id) })
    }),
  )

  return router
}

/**
 * Event log. The client batches these, because the interesting measures —
 * time on a question, how long after feedback the next attempt came — are
 * differences between timestamps, not states worth a request each.
 */
export function eventRoutes(store) {
  const router = express.Router()

  router.post(
    '/:sessionId/events',
    route(async (req, res) => {
      const session = await store.sessions.findById(req.params.sessionId)
      if (!session) throw notFound('No such session')

      const incoming = req.body?.events
      if (!Array.isArray(incoming) || !incoming.length) {
        throw badRequest('"events" must be a non-empty array')
      }
      if (incoming.length > 200) throw badRequest('Send at most 200 events per request')

      const docs = incoming.map((event) => {
        if (typeof event?.type !== 'string' || !event.type.trim()) {
          throw badRequest('every event needs a "type"')
        }
        return {
          id: id('evt'),
          sessionId: session.id,
          questionId: event.questionId ?? null,
          type: event.type,
          // Client clocks are not trusted as the record; both are kept.
          at: now(),
          clientAt: typeof event.at === 'string' ? event.at : null,
          payload: event.payload ?? {},
        }
      })

      const written = await store.events.insertMany(docs)
      res.status(201).json({ written })
    }),
  )

  return router
}

/** Doc item 6 and prompt versioning: which prompt a session ran on. */
export function promptRoutes(store) {
  const router = express.Router()

  router.get(
    '/',
    route(async (req, res) => {
      res.json({ active: await store.prompts.active(), versions: await store.prompts.list() })
    }),
  )

  router.post(
    '/',
    route(async (req, res) => {
      const text = requireString(req.body, 'text', { max: 20000 })
      const versions = await store.prompts.list()

      const prompt = await store.prompts.insert({
        versionId: `v${versions.length + 1}`,
        text: text.trim(),
        note: typeof req.body.note === 'string' ? req.body.note.slice(0, 500) : null,
        active: true,
        createdAt: now(),
      })

      res.status(201).json({ prompt })
    }),
  )

  return router
}
