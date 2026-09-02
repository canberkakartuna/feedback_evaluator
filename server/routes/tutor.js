import express from 'express'
import { ACTIONS, reply, studentAsk } from '../services/tutor.js'
import { badRequest, id, notFound, now, route } from '../lib/http.js'

export function tutorRoutes(store, { resolveQuestion }) {
  const router = express.Router()

  router.get(
    '/:sessionId/questions/:questionId/messages',
    route(async (req, res) => {
      const { session, question } = await resolveQuestion(req)
      const messages = await store.messages.list(session.id, question.id)
      res.json({ messages })
    }),
  )

  /**
   * One request, two messages: what the student asked and what came back. The
   * pair is the unit the dataset is built from, so it is written atomically
   * rather than left to two round trips that could half-fail.
   *
   * Either send `text` (the student typed something) or `action` (they pressed
   * a quick action, and the server decides what the ask says).
   */
  router.post(
    '/:sessionId/questions/:questionId/messages',
    route(async (req, res) => {
      const { session, question } = await resolveQuestion(req)

      const hasText = typeof req.body.text === 'string' && req.body.text.trim()
      const action = req.body.action ?? null

      if (!hasText && !action) throw badRequest('Send either "text" or "action"')
      if (action && !ACTIONS.includes(action)) {
        throw badRequest(`"action" must be one of: ${ACTIONS.join(', ')}`)
      }
      if (hasText && req.body.text.length > 4000) throw badRequest('"text" is too long')

      const answer = await store.answers.find(session.id, question.id)
      const hintsUsed = answer?.hintsUsed ?? 0

      const askText = action ? studentAsk(action, hintsUsed) : req.body.text.trim()

      /**
       * The thread as it stood before this ask, so the model reads the
       * conversation rather than one isolated line. Fetched here rather than
       * after the insert below, which would hand it its own prompt twice.
       */
      const history = await store.messages.list(session.id, question.id)

      /**
       * The prompt **the session was stamped with**, not whichever is active
       * now.
       *
       * `session.promptVersion` is the record the study rests on — "which
       * prompt produced this feedback?" — so the reply has to actually run on
       * that version. A teacher publishing v3 mid-lesson must not silently
       * change what v2's sessions are answering with and leave the transcript
       * claiming otherwise. Falls back to the active one for a session recorded
       * before any prompt existed.
       */
      const prompt =
        (session.promptVersion ? await store.prompts.byVersion(session.promptVersion) : null) ??
        (await store.prompts.active())

      // Both numbers up front, and from the store: the pair is what a snippet
      // is built from, so nothing may be numbered between them, and a
      // process-local counter would repeat itself across instances.
      const [askSeq, replySeq] = await store.messages.nextSeq(session.id, 2)

      const student = await store.messages.insert({
        id: id('msg'),
        seq: askSeq,
        sessionId: session.id,
        questionId: question.id,
        from: 'student',
        kind: 'ask',
        action,
        text: askText,
        createdAt: now(),
      })

      const generated = await reply({
        question,
        answer,
        action,
        text: askText,
        promptVersion: session.promptVersion,
        systemPrompt: prompt?.text ?? null,
        thread: history,
        // For the question's own uploaded image, which travels to the model —
        // see imageForModel in services/tutor.js.
        store,
        /**
         * Which language to answer in, sent per message rather than stored on
         * the session: the toggle is in the workspace header and a student may
         * switch mid-question, and the reply that follows should follow them.
         * Anything unrecognised is English — the same default the interface has.
         */
        lang: req.body.lang === 'tr' ? 'tr' : 'en',
      })

      const tutor = await store.messages.insert({
        id: id('msg'),
        seq: replySeq,
        sessionId: session.id,
        questionId: question.id,
        from: 'tutor',
        kind: 'reply',
        label: generated.label ?? null,
        text: generated.text,
        action,
        /**
         * Who wrote this: `openai`, `scripted` (a teacher's own words, or the
         * generic script where no model runs at all) or `fallback` (the model was
         * asked and failed). The dataset is not readable without it — see
         * services/tutor.js.
         */
        source: generated.source,
        model: generated.model ?? null,
        promptVersion: generated.promptVersion ?? null,
        rating: null,
        createdAt: now(),
      })

      if (generated.hintsUsed !== hintsUsed) {
        await store.answers.upsert(session.id, question.id, { hintsUsed: generated.hintsUsed })
      }

      await store.events.insertMany([
        {
          id: id('evt'),
          sessionId: session.id,
          questionId: question.id,
          type: action ? 'student_requested_help' : 'student_message_sent',
          at: now(),
          payload: { action, chars: askText.length },
        },
        {
          id: id('evt'),
          sessionId: session.id,
          questionId: question.id,
          type: 'ai_feedback_shown',
          at: now(),
          payload: {
            messageId: tutor.id,
            action,
            label: tutor.label,
            source: tutor.source,
            model: tutor.model,
            // Why the model did not answer, when it did not: a timeout, a 429, a
            // blocked prompt. The operational log is where this belongs rather
            // than on the message, and "how often did the tutor fall back, and
            // why" is a question about a lesson, not about one reply.
            reason: generated.reason ?? null,
          },
        },
      ])

      res.status(201).json({ student, tutor, hintsUsed: generated.hintsUsed })
    }),
  )

  /** Doc item 5: feedback on the feedback. */
  router.post(
    '/:sessionId/messages/:messageId/rating',
    route(async (req, res) => {
      const session = await store.sessions.findById(req.params.sessionId)
      if (!session) throw notFound('No such session')

      const value = req.body?.value
      if (value !== 'up' && value !== 'down') {
        throw badRequest('"value" must be "up" or "down"')
      }

      const message = await store.messages.findById(req.params.messageId)
      if (!message || message.sessionId !== session.id) throw notFound('No such message')
      if (message.from !== 'tutor') throw badRequest('Only tutor messages can be rated')

      const updated = await store.messages.update(message.id, {
        rating: value,
        ratedAt: now(),
        ratingNote: typeof req.body.note === 'string' ? req.body.note.slice(0, 2000) : null,
      })

      await store.events.insertMany([
        {
          id: id('evt'),
          sessionId: session.id,
          questionId: message.questionId,
          type: 'student_rated_feedback',
          at: now(),
          payload: { messageId: message.id, value },
        },
      ])

      res.json({ message: updated })
    }),
  )

  return router
}
