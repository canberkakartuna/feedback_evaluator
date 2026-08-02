import express from 'express'
import { ownTutor } from '../../shared/tutor-scripts.js'
import { requireAuth, requireRole } from '../lib/auth.js'
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
        markable: false,
        criteriaCount: 0,
        hintCount: ownTutor.hints.length,
        activityId: null,
        activityTitle: 'Your own questions',
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

/**
 * The system prompt every tutor chat runs on, and its version history.
 *
 * One prompt for the whole system, not one per activity — the doc is explicit
 * about that: it is "written once at the top and affects every chatbox". Which
 * is also why writing it is closed to staff and stamped with who did it. A
 * teacher editing this is editing every other teacher's students' feedback too,
 * so the UI says so and the record here shows who to ask about it afterwards.
 *
 * Versions are append-only. `session.promptVersion` is stamped at session
 * creation, so "which prompt produced this feedback?" stays answerable after
 * the prompt has moved on — the question the whole study rests on.
 */
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
    requireAuth,
    requireRole('teacher', 'manager', 'admin'),
    route(async (req, res) => {
      const text = requireString(req.body, 'text', { max: 20000 })
      const versions = await store.prompts.list()

      const prompt = await store.prompts.insert({
        versionId: `v${versions.length + 1}`,
        text: text.trim(),
        note: typeof req.body.note === 'string' ? req.body.note.slice(0, 500) : null,
        active: true,
        createdBy: req.user.id,
        createdByName: req.user.name,
        createdAt: now(),
      })

      res.status(201).json({ prompt })
    }),
  )

  return router
}
