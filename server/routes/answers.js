import express from 'express'
import { MODE_IDS } from '../../shared/answer.js'
import { answerKey, evaluateAnswer } from '../../shared/marking.js'
import { answerShape } from '../services/tutor.js'
import { SELF_MARKS } from '../../shared/marks.js'
import { badRequest, id, notFound, now, route } from '../lib/http.js'

export function answerRoutes(store, { resolveQuestion }) {
  const router = express.Router()

  /**
   * One answer per question, so switching mode clears what the old one held.
   * The client asks for the same thing, but the rule belongs here: it is what
   * guarantees a stored answer is never two answers at once.
   */
  router.put(
    '/:sessionId/answers/:questionId',
    route(async (req, res) => {
      const { session, question } = await resolveQuestion(req)

      const current = await store.answers.find(session.id, question.id)
      const patch = {}

      if (req.body.mode !== undefined) {
        if (!MODE_IDS.includes(req.body.mode)) {
          throw badRequest(`"mode" must be one of: ${MODE_IDS.join(', ')}`)
        }
        patch.mode = req.body.mode

        if (current && current.mode !== req.body.mode) {
          patch.draft = ''
          patch.strokes = []
          patch.attachments = []
          patch.feedback = null
          patch.feedbackFor = null
          patch.status = 'new'
        }
      }

      if (req.body.draft !== undefined) {
        if (typeof req.body.draft !== 'string') throw badRequest('"draft" must be a string')
        if (req.body.draft.length > 20000) throw badRequest('"draft" is too long')
        patch.draft = req.body.draft
      }

      if (req.body.strokes !== undefined) {
        if (!Array.isArray(req.body.strokes)) throw badRequest('"strokes" must be an array')
        if (req.body.strokes.length > 5000) throw badRequest('too many strokes')
        patch.strokes = req.body.strokes
      }

      if (req.body.selfMark !== undefined) {
        if (req.body.selfMark !== null && !SELF_MARKS.includes(req.body.selfMark)) {
          throw badRequest(`"selfMark" must be null or one of: ${SELF_MARKS.join(', ')}`)
        }
        patch.selfMark = req.body.selfMark
      }

      const answer = await store.answers.upsert(session.id, question.id, patch)

      const events = [
        {
          id: id('evt'),
          sessionId: session.id,
          questionId: question.id,
          type: 'answer_saved',
          at: now(),
          payload: { mode: answer.mode, words: (answer.draft ?? '').trim().split(/\s+/).filter(Boolean).length },
        },
      ]

      if (req.body.selfMark !== undefined) {
        events.push({
          id: id('evt'),
          sessionId: session.id,
          questionId: question.id,
          type: 'student_marked_question',
          at: now(),
          payload: { selfMark: req.body.selfMark },
        })
      }

      await store.events.insertMany(events)
      res.json({ answer })
    }),
  )

  router.get(
    '/:sessionId/answers/:questionId',
    route(async (req, res) => {
      const { session, question } = await resolveQuestion(req)
      const answer = await store.answers.find(session.id, question.id)
      if (!answer) throw notFound('Nothing saved for that question yet')
      res.json({ answer })
    }),
  )

  /**
   * Marking runs here, against a rubric the client never sees. A question the
   * student wrote themselves has no rubric, so there is nothing to mark.
   */
  router.post(
    '/:sessionId/answers/:questionId/check',
    route(async (req, res) => {
      const { session, question } = await resolveQuestion(req)

      if (!question.rubric?.length) {
        throw badRequest('That question has no rubric, so it cannot be marked')
      }

      const stored = await store.answers.find(session.id, question.id)
      if (!stored) throw badRequest('Save an answer before checking it')

      const state = answerShape(stored)
      const feedback = evaluateAnswer(question, state)

      const answer = await store.answers.upsert(session.id, question.id, {
        feedback,
        feedbackFor: answerKey(state),
        status: feedback.markable ? feedback.verdict : feedback.pending ? 'draft' : (stored.status ?? 'new'),
        checkedAt: now(),
      })

      await store.events.insertMany([
        {
          id: id('evt'),
          sessionId: session.id,
          questionId: question.id,
          type: 'answer_checked',
          at: now(),
          payload: {
            markable: feedback.markable,
            pending: feedback.pending,
            earned: feedback.earned,
            total: feedback.total,
          },
        },
      ])

      res.json({ answer, feedback })
    }),
  )

  return router
}
