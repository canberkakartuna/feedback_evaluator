import express from 'express'
import { publicQuestion } from '../../shared/activity.js'
import {
  activityScope,
  assertCanAuthor,
  createActivity,
  displayCode,
  loadActivityInScope,
  nextPosition,
  newQuestion,
  parseActivityInput,
  parseQuestionInput,
} from '../services/activities.js'
import { studentActivities } from '../services/delivery.js'
import { requireAuth, requireRole } from '../lib/auth.js'
import { ApiError, badRequest, notFound, now, route } from '../lib/http.js'

/**
 * Authoring: everything a teacher does to build the work before a student sees
 * it, plus the two read paths a student uses to reach it.
 *
 * The split that matters here is **authoring view vs student view**. A teacher
 * reading their own activity gets the whole question back, mark scheme and
 * hints included, because they wrote it. A student gets what
 * shared/activity.js `publicQuestion` leaves behind. Both live in this file so
 * the difference is visible in one screen rather than inferred from two.
 *
 * Route order is load-bearing: `/available` is declared before `/:activityId`,
 * or Express would read "available" as an activity id.
 */
export function activityRoutes(store) {
  const router = express.Router()

  /** Adds the question count without pulling every question body along. */
  const summarise = async (activity) => ({
    ...activity,
    questionCount: await store.questions.count({ activityId: activity.id }),
  })

  /* ------------------------------------------------------------- student read */

  /**
   * What the person looking may start.
   *
   * **Open on purpose.** A student choosing this door has no account by
   * definition, so requiring one would close the door. What comes back is a
   * title, a blurb and a count — never the questions, and never a draft. See
   * studentActivities in services/delivery.js for how a signed-in student is
   * narrowed to their own teacher's work.
   */
  router.get(
    '/available',
    route(async (req, res) => {
      res.json({ activities: await studentActivities(store, req.user) })
    }),
  )

  /* ----------------------------------------------------------------- authoring */

  router.get(
    '/',
    requireAuth,
    requireRole('teacher', 'manager', 'admin'),
    route(async (req, res) => {
      const scope = await activityScope(store, req.user)
      const activities = await store.activities.list(
        scope.all ? {} : { ownerId: scope.ownerIds },
      )

      res.json({
        scope: scope.all ? 'all' : 'own',
        activities: await Promise.all(activities.map(summarise)),
      })
    }),
  )

  router.post(
    '/',
    requireAuth,
    route(async (req, res) => {
      assertCanAuthor(req.user)

      const fields = parseActivityInput(req.body, { forCreate: true })
      const activity = await createActivity(store, { ...fields, ownerId: req.user.id })

      res.status(201).json({ activity: { ...activity, questionCount: 0 } })
    }),
  )

  /** The authoring view: full questions, mark scheme and hints included. */
  router.get(
    '/:activityId',
    requireAuth,
    route(async (req, res) => {
      const { activity } = await loadActivityInScope(store, req.user, req.params.activityId)
      const questions = await store.questions.list({ activityId: activity.id })

      res.json({
        activity,
        questions: questions.map((question, index) => ({
          ...question,
          code: displayCode(question, index),
        })),
      })
    }),
  )

  /**
   * Preview: the same activity as the student will receive it, mark scheme
   * stripped. Worth having as its own route rather than a flag — it is the only
   * way a teacher can confirm by eye that nothing leaked, and the smoke test
   * asserts against exactly what it returns.
   */
  router.get(
    '/:activityId/preview',
    requireAuth,
    route(async (req, res) => {
      const { activity } = await loadActivityInScope(store, req.user, req.params.activityId)
      const questions = await store.questions.list({ activityId: activity.id })

      res.json({
        activity: {
          id: activity.id,
          code: activity.code,
          title: activity.title,
          blurb: activity.blurb,
          status: activity.status,
          questionCount: questions.length,
          questions: questions.map((question, index) =>
            publicQuestion({ ...question, code: displayCode(question, index) }, activity),
          ),
        },
      })
    }),
  )

  router.patch(
    '/:activityId',
    requireAuth,
    route(async (req, res) => {
      const { activity } = await loadActivityInScope(store, req.user, req.params.activityId)

      const patch = parseActivityInput(req.body)
      if (!Object.keys(patch).length) throw badRequest('Nothing to update')

      /**
       * Publishing an empty activity is refused rather than allowed and left to
       * look broken: a student who joins with the code would consent, land on
       * nothing, and have no way to tell whether that is the activity or a bug.
       */
      if (patch.status === 'published' && activity.status !== 'published') {
        const count = await store.questions.count({ activityId: activity.id })
        if (!count) throw badRequest('Add at least one question before publishing')
      }

      const updated = await store.activities.update(activity.id, { ...patch, updatedAt: now() })
      res.json({ activity: await summarise(updated) })
    }),
  )

  /**
   * Deleting is deliberately hard, the same way deleting a user is: an activity
   * students have already worked on is the context for every transcript that
   * came out of it, and removing it would leave those unreadable.
   */
  router.delete(
    '/:activityId',
    requireAuth,
    route(async (req, res) => {
      const { activity } = await loadActivityInScope(store, req.user, req.params.activityId)

      const sessions = await store.sessions.list({ activityId: activity.id, limit: 1 })
      if (sessions.length) {
        throw new ApiError(409, 'Students have already worked on this activity', {
          sessions: sessions.length,
          hint: 'Unpublish it instead — that closes it to new students and keeps the transcripts readable.',
        })
      }

      const questions = await store.questions.removeByActivity(activity.id)
      await store.activities.remove(activity.id)

      res.json({ deleted: true, activityId: activity.id, questions })
    }),
  )

  /* ----------------------------------------------------------------- questions */

  router.post(
    '/:activityId/questions',
    requireAuth,
    route(async (req, res) => {
      const { activity } = await loadActivityInScope(store, req.user, req.params.activityId)

      const existing = await store.questions.list({ activityId: activity.id })
      const fields = parseQuestionInput(req.body, { forCreate: true })

      const question = await store.questions.create(
        newQuestion({ activityId: activity.id, position: nextPosition(existing), ...fields }),
      )

      await store.activities.update(activity.id, { updatedAt: now() })

      res.status(201).json({
        question: { ...question, code: displayCode(question, existing.length) },
      })
    }),
  )

  router.patch(
    '/:activityId/questions/:questionId',
    requireAuth,
    route(async (req, res) => {
      const { activity } = await loadActivityInScope(store, req.user, req.params.activityId)

      const question = await store.questions.findById(req.params.questionId)
      if (!question || question.activityId !== activity.id) throw notFound('No such question')

      const patch = parseQuestionInput(req.body)
      if (!Object.keys(patch).length) throw badRequest('Nothing to update')

      const updated = await store.questions.update(question.id, { ...patch, updatedAt: now() })
      await store.activities.update(activity.id, { updatedAt: now() })

      const siblings = await store.questions.list({ activityId: activity.id })
      const index = siblings.findIndex((entry) => entry.id === updated.id)

      res.json({ question: { ...updated, code: displayCode(updated, index) } })
    }),
  )

  router.delete(
    '/:activityId/questions/:questionId',
    requireAuth,
    route(async (req, res) => {
      const { activity } = await loadActivityInScope(store, req.user, req.params.activityId)

      const question = await store.questions.findById(req.params.questionId)
      if (!question || question.activityId !== activity.id) throw notFound('No such question')

      /**
       * Refused once there is work against it, for the same reason the activity
       * itself is: the transcript names a question id, and a transcript whose
       * question no longer exists cannot be read or labelled.
       *
       * One session on the activity is enough to refuse — an answer can only
       * exist inside a session, so there is nothing a per-question lookup would
       * catch that this does not.
       */
      const sessions = await store.sessions.list({ activityId: activity.id, limit: 1 })
      if (sessions.length) {
        throw new ApiError(409, 'Students have already seen this question', {
          hint: 'Edit the prompt instead, or unpublish the activity.',
        })
      }

      await store.questions.remove(question.id)
      await store.activities.update(activity.id, { updatedAt: now() })

      res.json({ deleted: true, questionId: question.id })
    }),
  )

  /**
   * Reorder by listing every question id in the order wanted.
   *
   * Whole-run rather than a move-one call: the client already holds the list it
   * just dragged, and sending it back means the server never has to reconcile
   * two different ideas of the order. Positions are rewritten 1..n here, which
   * is the one place that renumbering is correct — see store/mongo.js on why
   * `position` is otherwise a float.
   */
  router.post(
    '/:activityId/questions/reorder',
    requireAuth,
    route(async (req, res) => {
      const { activity } = await loadActivityInScope(store, req.user, req.params.activityId)

      const order = req.body?.questionIds
      if (!Array.isArray(order) || !order.length) {
        throw badRequest('"questionIds" must be a non-empty array')
      }

      const existing = await store.questions.list({ activityId: activity.id })
      const known = new Set(existing.map((question) => question.id))

      if (order.length !== existing.length || order.some((entry) => !known.has(entry))) {
        throw badRequest('"questionIds" must list every question in this activity exactly once', {
          expected: existing.length,
          received: order.length,
        })
      }
      if (new Set(order).size !== order.length) {
        throw badRequest('"questionIds" contains a duplicate')
      }

      await Promise.all(
        order.map((questionId, index) =>
          store.questions.update(questionId, { position: index + 1, updatedAt: now() }),
        ),
      )
      await store.activities.update(activity.id, { updatedAt: now() })

      const questions = await store.questions.list({ activityId: activity.id })
      res.json({
        questions: questions.map((question, index) => ({
          ...question,
          code: displayCode(question, index),
        })),
      })
    }),
  )

  return router
}
