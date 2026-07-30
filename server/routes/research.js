import express from 'express'
import { config } from '../config.js'
import { DEFAULT_CRITERIA, LABEL_VALUES, attachLabels, buildSnippets } from '../services/snippets.js'
import { findQuestion } from '../services/course.js'
import { badRequest, forbidden, notFound, route, unavailable } from '../lib/http.js'

/**
 * Everything a researcher or teacher needs, and nothing a student can reach.
 *
 * These endpoints read every transcript in the system, so they are closed
 * unless RESEARCH_TOKEN is set. Defaulting to open would mean one forgotten
 * env var exposes the whole study.
 */
function requireResearcher(req) {
  // "An admin can reach everything" — including this, without being handed the
  // shared research token. Any other signed-in role falls through to the token
  // check and, having no token, is refused: a teacher sees their own students
  // through /api/users/:id/sessions, not everybody's through here.
  if (req.user?.role === 'admin') return

  if (!config.researchToken) {
    throw unavailable(
      'Researcher endpoints are disabled. Set RESEARCH_TOKEN to enable them.',
    )
  }

  const header = req.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : req.get('x-research-token')

  if (token !== config.researchToken) throw forbidden('Invalid research token')
}

export function researchRoutes(store) {
  const router = express.Router()

  router.use((req, res, next) => {
    try {
      requireResearcher(req)
      next()
    } catch (error) {
      next(error)
    }
  })

  /** Teacher view: who has been in, and how much they produced. */
  router.get(
    '/sessions',
    route(async (req, res) => {
      const sessions = await store.sessions.list({ limit: Number(req.query.limit ?? 100) })

      const rows = await Promise.all(
        sessions.map(async (session) => {
          const [messages, answers, events] = await Promise.all([
            store.messages.listBySession(session.id),
            store.answers.listBySession(session.id),
            store.events.countBySession(session.id),
          ])

          const questionsTouched = new Set(messages.map((m) => m.questionId))

          return {
            ...session,
            counts: {
              messages: messages.length,
              snippets: buildSnippets(messages).length,
              answers: answers.length,
              events,
              questionsWithChat: questionsTouched.size,
            },
          }
        }),
      )

      res.json({ sessions: rows })
    }),
  )

  /** One student's work, question by question. */
  router.get(
    '/sessions/:sessionId/transcript',
    route(async (req, res) => {
      const session = await store.sessions.findById(req.params.sessionId)
      if (!session) throw notFound('No such session')

      const [messages, answers, own, events] = await Promise.all([
        store.messages.listBySession(session.id),
        store.answers.listBySession(session.id),
        store.ownQuestions.listBySession(session.id),
        store.events.listBySession(session.id),
      ])

      const byQuestion = new Map()
      for (const message of messages) {
        if (!byQuestion.has(message.questionId)) byQuestion.set(message.questionId, [])
        byQuestion.get(message.questionId).push(message)
      }

      const questions = [...byQuestion.entries()].map(([questionId, thread]) => {
        const known = findQuestion(questionId)
        const ownQuestion = own.find((entry) => entry.id === questionId)

        return {
          questionId,
          code: known?.code ?? ownQuestion?.code ?? questionId,
          prompt: known?.prompt ?? ownQuestion?.prompt ?? null,
          isOwnQuestion: Boolean(ownQuestion),
          answer: answers.find((entry) => entry.questionId === questionId) ?? null,
          messages: thread,
        }
      })

      res.json({ session, questions, events })
    }),
  )

  /**
   * The snippets themselves: one student turn plus the feedback that answered
   * it. `included` is the keep-or-drop decision; `labels` is the criteria pass.
   */
  router.get(
    '/snippets',
    route(async (req, res) => {
      const { sessionId, included } = req.query

      const messages = sessionId
        ? await store.messages.listBySession(sessionId)
        : await store.messages.listAll()

      const labels = await store.snippetLabels.map()
      let snippets = attachLabels(buildSnippets(messages), labels)

      if (included === 'true') snippets = snippets.filter((s) => s.included === true)
      if (included === 'false') snippets = snippets.filter((s) => s.included === false)
      if (included === 'undecided') snippets = snippets.filter((s) => s.included == null)

      res.json({ criteria: DEFAULT_CRITERIA, count: snippets.length, snippets })
    }),
  )

  /** Keep or drop a snippet, and label it against the criteria. */
  router.patch(
    '/snippets/:snippetId',
    route(async (req, res) => {
      const patch = {}

      if (req.body.included !== undefined) {
        if (typeof req.body.included !== 'boolean' && req.body.included !== null) {
          throw badRequest('"included" must be true, false or null')
        }
        patch.included = req.body.included
      }

      if (req.body.labels !== undefined) {
        const labels = req.body.labels
        if (typeof labels !== 'object' || labels === null || Array.isArray(labels)) {
          throw badRequest('"labels" must be an object of criterionId -> value')
        }

        const known = new Set(DEFAULT_CRITERIA.map((criterion) => criterion.id))
        for (const [criterionId, value] of Object.entries(labels)) {
          if (!known.has(criterionId)) throw badRequest(`Unknown criterion "${criterionId}"`)
          if (!LABEL_VALUES.includes(value)) {
            throw badRequest(`"${criterionId}" must be one of: ${LABEL_VALUES.join(', ')}`)
          }
        }
        patch.labels = labels
      }

      if (req.body.note !== undefined) {
        if (typeof req.body.note !== 'string') throw badRequest('"note" must be a string')
        patch.note = req.body.note.slice(0, 4000)
      }

      if (typeof req.body.labelledBy === 'string') {
        patch.labelledBy = req.body.labelledBy.slice(0, 200)
      }

      if (!Object.keys(patch).length) throw badRequest('Nothing to update')

      const label = await store.snippetLabels.upsert(req.params.snippetId, patch)
      res.json({ label })
    }),
  )

  /**
   * Dataset export. JSON keeps the nesting; CSV is one row per snippet, which
   * is what a coding tool or a stats package wants.
   */
  router.get(
    '/export',
    route(async (req, res) => {
      const labels = await store.snippetLabels.map()
      const snippets = attachLabels(buildSnippets(await store.messages.listAll()), labels).filter(
        (snippet) => snippet.included === true,
      )

      if (req.query.format === 'csv') {
        const columns = [
          'snippet_id',
          'session_id',
          'question_id',
          'student_text',
          'tutor_text',
          'tutor_label',
          'student_rating',
          'note',
          ...DEFAULT_CRITERIA.map((criterion) => `label_${criterion.id}`),
        ]

        const rows = snippets.map((snippet) => [
          snippet.id,
          snippet.sessionId,
          snippet.questionId,
          snippet.student.text,
          snippet.tutor.text,
          snippet.tutor.label ?? '',
          snippet.rating ?? '',
          snippet.note ?? '',
          ...DEFAULT_CRITERIA.map((criterion) => snippet.labels[criterion.id] ?? ''),
        ])

        res.type('text/csv').send(
          [columns, ...rows]
            .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(','))
            .join('\n'),
        )
        return
      }

      res.json({ count: snippets.length, criteria: DEFAULT_CRITERIA, snippets })
    }),
  )

  return router
}
