import express from 'express'
import fs from 'node:fs/promises'
import { config } from '../config.js'
import { publicCourse, topics } from '../services/course.js'
import { badRequest, id, notFound, now, route, shortCode } from '../lib/http.js'

export function sessionRoutes(store) {
  const router = express.Router()

  /** Topics for the entry screen, before any session exists. */
  router.get(
    '/topics',
    route(async (req, res) => {
      res.json({ topics: topics() })
    }),
  )

  /**
   * Starting a session IS the consent record. There is no route that creates a
   * session without it, so the gate cannot be bypassed by calling the API
   * directly — which is the only place a gate actually holds.
   */
  router.post(
    '/',
    route(async (req, res) => {
      if (req.body?.consent !== true) {
        throw badRequest('Consent is required to start a session', {
          field: 'consent',
          expected: true,
        })
      }

      const topicId = req.body.topicId ?? 'all'
      const course = publicCourse(topicId) // throws 404 on an unknown topic
      const active = await store.prompts.active()

      const session = await store.sessions.create({
        id: id('ses'),
        code: shortCode(),
        createdAt: now(),
        endedAt: null,
        topicId,
        /**
         * Null unless the request carried a login token.
         *
         * The link is optional because anonymous work has to keep working — this
         * route is the consent record, and consent does not require an account.
         * When there is an account, the session attaches to it, and that is what
         * lets a teacher see their own students' work through
         * `GET /api/users/:userId/sessions`.
         */
        userId: req.user?.id ?? null,
        consent: {
          given: true,
          at: now(),
          version: config.consentVersion,
        },
        // Room for the study design: which model/prompt this session ran on.
        conditionId: req.body.conditionId ?? 'default',
        promptVersion: active?.versionId ?? null,
        device: typeof req.body.device === 'string' ? req.body.device.slice(0, 200) : null,
      })

      await store.events.insertMany([
        {
          id: id('evt'),
          sessionId: session.id,
          userId: session.userId,
          type: 'session_started',
          at: now(),
          payload: { topicId, signedIn: Boolean(session.userId) },
        },
      ])

      res.status(201).json({ session, course })
    }),
  )

  /** Resume: everything the client needs to rebuild its state. */
  router.get(
    '/:sessionId',
    route(async (req, res) => {
      const session = await store.sessions.findById(req.params.sessionId)
      if (!session) throw notFound('No such session')

      const [answers, messages, own] = await Promise.all([
        store.answers.listBySession(session.id),
        store.messages.listBySession(session.id),
        store.ownQuestions.listBySession(session.id),
      ])

      res.json({
        session,
        course: publicCourse(session.topicId),
        answers,
        messages,
        ownQuestions: own,
      })
    }),
  )

  /** Doc item 3: attach a phone to the session already open on a laptop. */
  router.get(
    '/by-code/:code',
    route(async (req, res) => {
      const session = await store.sessions.findByCode(req.params.code)
      if (!session) throw notFound('No session with that code')
      res.json({ session, course: publicCourse(session.topicId) })
    }),
  )

  router.post(
    '/:sessionId/end',
    route(async (req, res) => {
      const session = await store.sessions.update(req.params.sessionId, { endedAt: now() })
      if (!session) throw notFound('No such session')
      await store.events.insertMany([
        { id: id('evt'), sessionId: session.id, type: 'session_ended', at: now(), payload: {} },
      ])
      res.json({ session })
    }),
  )

  /** "Delete my session" — the withdrawal half of consent. */
  router.delete(
    '/:sessionId',
    route(async (req, res) => {
      const session = await store.sessions.findById(req.params.sessionId)
      if (!session) throw notFound('No such session')

      const removedUploads = await store.uploads.removeBySession(session.id)
      await Promise.all([
        store.answers.removeBySession(session.id),
        store.messages.removeBySession(session.id),
        store.events.removeBySession(session.id),
        store.ownQuestions.removeBySession(session.id),
        store.sessions.remove(session.id),
      ])

      // Files too, or "delete" is a lie.
      await Promise.all(
        removedUploads
          .filter((upload) => upload.path)
          .map((upload) => fs.rm(upload.path, { force: true })),
      )

      res.json({ deleted: true, sessionId: session.id, files: removedUploads.length })
    }),
  )

  return router
}
