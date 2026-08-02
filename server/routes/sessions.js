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
   * Two ways in, because there are two kinds of student: a join **code**, typed
   * off the board by someone with no account, and an **activityId**, clicked
   * from the list a signed-in student gets from their own teacher. They resolve
   * to the same thing, and both refuse an unpublished activity — a draft is
   * work in progress, and a student who reached one would be answering
   * questions their teacher has not finished writing.
   */
  async function resolveActivity(body) {
    const byCode = typeof body?.code === 'string' && Boolean(body.code.trim())

    const activity = byCode
      ? await store.activities.findByCode(body.code)
      : typeof body?.activityId === 'string'
        ? await store.activities.findById(body.activityId)
        : null

    if (!activity) {
      throw notFound(byCode ? 'No activity with that code' : 'No such activity')
    }

    /**
     * An unpublished activity answers differently depending on how it was
     * reached, and the difference is deliberate.
     *
     * A **code** is typed into a public box by someone with no account, so a
     * draft has to be indistinguishable from a code that was never issued —
     * anything else turns the box into a way to discover that a teacher is
     * drafting something. This matches the preview route, which 404s on a draft
     * for the same reason.
     *
     * An **activityId** only ever comes from the list a signed-in student was
     * already shown, so the interesting case there is a teacher unpublishing
     * between the list and the click. That student is entitled to know it was
     * withdrawn rather than that it never existed.
     */
    if (activity.status !== 'published') {
      if (byCode) throw notFound('No activity with that code')
      throw badRequest('That activity is not open yet')
    }

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
          payload: {
            activityId: activity.id,
            signedIn: Boolean(session.userId),
            joinedByCode: typeof req.body.code === 'string',
          },
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

  /** Doc item 3: attach a phone to the session already open on a laptop. */
  router.get(
    '/by-code/:code',
    route(async (req, res) => {
      const session = await store.sessions.findByCode(req.params.code)
      if (!session) throw notFound('No session with that code')
      res.json(await sessionPayload(session))
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
