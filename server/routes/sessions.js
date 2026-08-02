import express from 'express'
import fs from 'node:fs/promises'
import { config } from '../config.js'
import { activityQuestions, publicActivity } from '../services/delivery.js'
import { badRequest, id, notFound, now, route, shortCode } from '../lib/http.js'

export function sessionRoutes(store) {
  const router = express.Router()

  /**
   * Which activity this session is for.
   *
   * One way in: an `activityId`, clicked from the list at
   * `GET /api/activities/available`. There is no join code — publishing is the
   * whole access decision, so an id that names a published activity is enough
   * and an id that names a draft is refused.
   *
   * A draft is reported as "not open yet" rather than "no such activity",
   * because the only way to be holding an id at all is to have been shown it in
   * a list. The interesting case is a teacher unpublishing between the list and
   * the click, and that student is entitled to know it was withdrawn rather
   * than that it never existed.
   */
  async function resolveActivity(body) {
    if (typeof body?.activityId !== 'string' || !body.activityId.trim()) {
      throw badRequest('"activityId" is required — choose an activity to start')
    }

    const activity = await store.activities.findById(body.activityId)
    if (!activity) throw notFound('No such activity')
    if (activity.status !== 'published') throw badRequest('That activity is not open yet')

    return activity
  }

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

      const activity = await resolveActivity(req.body)
      const questions = await activityQuestions(store, activity.id)
      const active = await store.prompts.active()

      const session = await store.sessions.create({
        id: id('ses'),
        code: shortCode(),
        createdAt: now(),
        endedAt: null,
        activityId: activity.id,
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
          payload: { activityId: activity.id, signedIn: Boolean(session.userId) },
        },
      ])

      res.status(201).json({ session, activity: publicActivity(activity, questions) })
    }),
  )

  /**
   * Everything the client needs to rebuild its state.
   *
   * The activity is loaded through the session rather than passed in, so a
   * resumed session shows the questions it was started against even if the
   * teacher has since edited them — and it keeps working if the activity was
   * unpublished in the meantime, which resolveActivity would refuse.
   */
  async function sessionPayload(session) {
    const activity = session.activityId
      ? await store.activities.findById(session.activityId)
      : null

    return {
      session,
      activity: activity
        ? publicActivity(activity, await activityQuestions(store, activity.id))
        : null,
    }
  }

  router.get(
    '/:sessionId',
    route(async (req, res) => {
      const session = await store.sessions.findById(req.params.sessionId)
      if (!session) throw notFound('No such session')

      const [payload, answers, messages, own] = await Promise.all([
        sessionPayload(session),
        store.answers.listBySession(session.id),
        store.messages.listBySession(session.id),
        store.ownQuestions.listBySession(session.id),
      ])

      res.json({ ...payload, answers, messages, ownQuestions: own })
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
