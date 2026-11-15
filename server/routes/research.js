import express from 'express'
import { config } from '../config.js'
import { DEFAULT_CRITERIA, LABEL_VALUES, attachLabels, buildSnippets } from '../services/snippets.js'
import { activityScope, displayCode } from '../services/activities.js'
import { scopeOf } from '../services/users.js'
import { teacherCanLabel } from '../../shared/roles.js'
import { ApiError, badRequest, forbidden, notFound, now, route, unavailable } from '../lib/http.js'

/**
 * Reading, keeping and labelling transcripts.
 *
 * Two different people use these routes, and they see different amounts:
 *
 * - a **researcher** holding RESEARCH_TOKEN, or an admin, sees everything;
 * - a **teacher or manager** sees only what came out of their own work — their
 *   students' sessions, plus anonymous sessions on activities they own.
 *
 * The teacher case is the doc's labelling loop: snippets get "shared with
 * teachers", who mark which criteria each one meets. That has to reach real
 * teachers to happen at all, so it is scoped rather than closed. The scope is
 * computed per request from the same hierarchy services/users.js uses, and is
 * applied to reads *and* writes — a teacher cannot label a snippet out of
 * another teacher's class any more than they can read one.
 *
 * Export stays researcher-only. It is the dataset, across everybody.
 *
 * Two narrower cases sit on top of that:
 *
 * - an **annotator** reaches the snippets an admin or manager has assigned to
 *   them (`assigneeId` on the label record) and nothing else here — no
 *   session list, no transcripts, no export — and may label those snippets but
 *   not keep or drop them;
 * - a **teacher whose labelling is switched off** (`canLabel: false`, see
 *   shared/roles.js) is refused the snippet routes, but still reads their
 *   students' sessions and transcripts, which are teaching rather than
 *   labelling.
 */
function researchToken(req) {
  const header = req.get('authorization') ?? ''
  return header.startsWith('Bearer ') ? header.slice(7) : req.get('x-research-token')
}

function isResearcher(req) {
  if (req.user?.role === 'admin') return true
  if (!config.researchToken) return false
  return researchToken(req) === config.researchToken
}

/** Refuses anyone who is neither a researcher nor staff with a roster. */
function requireReader(req) {
  if (isResearcher(req)) return

  if (req.user?.role === 'teacher' || req.user?.role === 'manager') return

  // Let through so the snippet routes can answer them; every other route here
  // turns them away with notForAnnotators.
  if (req.user?.role === 'annotator') return

  // Nothing matched. Say which of the two doors was shut, rather than a blanket
  // 403 that leaves a researcher guessing whether their token or the env var is
  // the problem.
  if (!config.researchToken && !req.user) {
    throw unavailable('Researcher endpoints are disabled. Set RESEARCH_TOKEN to enable them.')
  }
  throw forbidden('Invalid research token')
}

const isAnnotator = (req) => req.user?.role === 'annotator'

/** Sessions, transcripts: whole student work, which is not what an annotator is here for. */
function notForAnnotators(req) {
  if (isAnnotator(req)) throw forbidden('Annotators only see the snippets assigned to them')
}

/** The snippet routes, for a teacher whose labelling an admin or manager has switched off. */
function assertMayLabel(req) {
  if (!teacherCanLabel(req.user)) {
    throw forbidden('Labelling is turned off for this account — ask your manager or an admin')
  }
}

/** Assigning work to annotators: an admin, or a manager within their own branch. */
function requireAssigner(req) {
  if (req.user?.role !== 'admin' && req.user?.role !== 'manager') {
    throw forbidden('Only an admin or a manager can assign labelling work')
  }
}

/** Snippets per assignment call. A class's worth of transcripts, not the dataset. */
export const ASSIGN_MAX = 500

export function researchRoutes(store) {
  const router = express.Router()

  router.use((req, res, next) => {
    try {
      requireReader(req)
      next()
    } catch (error) {
      next(error)
    }
  })

  /**
   * Which sessions this caller may read.
   *
   * `{ all: true }` for a researcher. For staff it is an explicit id set, built
   * from both routes a session can belong to them by: a signed-in student on
   * their roster, or an anonymous student who joined an activity they own.
   * Anonymous work would otherwise be invisible to the teacher who set it,
   * which is most of it.
   */
  async function sessionScope(req) {
    if (isResearcher(req)) return { all: true }
    // Never by roster: an annotator's reach is their assignments, read separately.
    if (isAnnotator(req)) return { all: false, ids: new Set() }

    const [users, activities] = await Promise.all([
      scopeOf(store, req.user),
      activityScope(store, req.user),
    ])

    const studentIds = [...users.ids]
    const owned = await store.activities.list(
      activities.all ? {} : { ownerId: activities.ownerIds },
    )

    const [byStudent, byActivity] = await Promise.all([
      studentIds.length ? store.sessions.list({ userId: studentIds, limit: 1000 }) : [],
      owned.length
        ? store.sessions.list({ activityId: owned.map((entry) => entry.id), limit: 1000 })
        : [],
    ])

    return {
      all: false,
      ids: new Set([...byStudent, ...byActivity].map((session) => session.id)),
    }
  }

  const canRead = (scope, sessionId) => scope.all || scope.ids.has(sessionId)

  /** Snippet ids are `sessionId:questionId:seq`, and a session id has no colon. */
  const sessionOfSnippet = (snippetId) => String(snippetId).split(':')[0]

  function requireResearcher(req) {
    if (!isResearcher(req)) throw forbidden('This endpoint is for researchers')
  }

  /**
   * What a student hands in, trimmed to what a labeller reads: the words, the
   * pictures, and how many strokes a drawing has. The raw strokes can run to
   * thousands of points per answer, and the marker's feedback is not part of
   * judging the tutor's reply. `null` when nothing was handed in at all.
   */
  function answerContext(answer) {
    if (!answer) return null
    const draft = answer.draft ?? ''
    const strokeCount = answer.strokes?.length ?? 0
    const attachments = (answer.attachments ?? []).map(({ id, name, type, source, url }) => ({
      id,
      name,
      type,
      source,
      url,
    }))
    if (!draft.trim() && !strokeCount && !attachments.length) return null

    return {
      mode: answer.mode ?? null,
      draft,
      strokeCount,
      attachments,
      updatedAt: answer.updatedAt ?? null,
    }
  }

  /**
   * The question and the student's answer behind each snippet, resolved the
   * same way the transcript route does it.
   *
   * Read once per distinct session (answers, own questions) and once per
   * distinct activity (authored questions) rather than per snippet: without a
   * session filter one page can span every session in a teacher's scope.
   */
  async function withContext(snippets) {
    const sessionIds = [...new Set(snippets.map((snippet) => snippet.sessionId))]

    const perSession = new Map(
      await Promise.all(
        sessionIds.map(async (sessionId) => {
          const [session, answers, own] = await Promise.all([
            store.sessions.findById(sessionId),
            store.answers.listBySession(sessionId),
            store.ownQuestions.listBySession(sessionId),
          ])
          return [sessionId, { activityId: session?.activityId ?? null, answers, own }]
        }),
      ),
    )

    const activityIds = [
      ...new Set([...perSession.values()].map((entry) => entry.activityId).filter(Boolean)),
    ]
    const authoredBy = new Map(
      await Promise.all(
        activityIds.map(async (activityId) => {
          const authored = await store.questions.list({ activityId })
          // Codes are ordinals within the activity, so they come from the
          // full list and not from whichever questions have snippets.
          return [
            activityId,
            new Map(
              authored.map((question, index) => [
                question.id,
                { question, code: displayCode(question, index) },
              ]),
            ),
          ]
        }),
      ),
    )

    return snippets.map((snippet) => {
      const { activityId, answers, own } = perSession.get(snippet.sessionId)
      const authored = authoredBy.get(activityId)?.get(snippet.questionId)
      const ownQuestion = own.find((entry) => entry.id === snippet.questionId)
      const source = authored?.question ?? ownQuestion
      const image = source?.image

      return {
        ...snippet,
        question: {
          code: authored?.code ?? ownQuestion?.code ?? snippet.questionId,
          prompt: source?.prompt ?? null,
          promptByLang: authored?.question.promptByLang ?? {},
          image: image ? { url: image.url, name: image.name, type: image.type } : null,
          isOwnQuestion: Boolean(ownQuestion),
        },
        answer: answerContext(answers.find((entry) => entry.questionId === snippet.questionId)),
      }
    })
  }

  /** Teacher view: who has been in, and how much they produced. */
  router.get(
    '/sessions',
    route(async (req, res) => {
      notForAnnotators(req)
      const scope = await sessionScope(req)
      const all = await store.sessions.list({ limit: Number(req.query.limit ?? 100) })
      const sessions = scope.all ? all : all.filter((session) => canRead(scope, session.id))

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
      notForAnnotators(req)
      const scope = await sessionScope(req)
      const session = await store.sessions.findById(req.params.sessionId)

      // Out of scope reads as 404, matching the rest of the API: whether a
      // session id exists is not something one teacher learns from another's
      // class.
      if (!session || !canRead(scope, session.id)) throw notFound('No such session')

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

      // One read of the activity's questions rather than one per thread, so the
      // ordinal codes (Q1, Q2, …) line up with what the student was shown.
      const authored = session.activityId
        ? await store.questions.list({ activityId: session.activityId })
        : []
      const codeOf = new Map(
        authored.map((question, index) => [question.id, displayCode(question, index)]),
      )
      const promptOf = new Map(authored.map((question) => [question.id, question.prompt]))
      const byLangOf = new Map(authored.map((question) => [question.id, question.promptByLang]))

      const questions = [...byQuestion.entries()].map(([questionId, thread]) => {
        const ownQuestion = own.find((entry) => entry.id === questionId)

        return {
          questionId,
          code: codeOf.get(questionId) ?? ownQuestion?.code ?? questionId,
          prompt: promptOf.get(questionId) ?? ownQuestion?.prompt ?? null,
          promptByLang: byLangOf.get(questionId) ?? {},
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
  /**
   * An annotator's snippets: exactly the ones assigned to them.
   *
   * Read from the assignments outward rather than by filtering every message in
   * the system — the label records say which snippets, the snippet ids say which
   * sessions, and only those sessions' messages are read. A snippet whose
   * session has since been withdrawn simply stops appearing.
   */
  async function assignedSnippets(req, labels, sessionId) {
    const assigned = new Set(
      [...labels.values()]
        .filter((label) => label.assigneeId === req.user.id)
        .map((label) => label.snippetId),
    )
    const sessionIds = new Set([...assigned].map(sessionOfSnippet))

    if (sessionId && !sessionIds.has(sessionId)) throw notFound('No such session')

    const wanted = sessionId ? [sessionId] : [...sessionIds]
    const messages = (await Promise.all(wanted.map((id) => store.messages.listBySession(id)))).flat()

    return buildSnippets(messages).filter((snippet) => assigned.has(snippet.id))
  }

  /**
   * Who each snippet is assigned to, by name, for the people who assign — an
   * admin or a manager. One read of the annotators, not one per snippet.
   */
  async function withAssigneeNames(snippets) {
    const annotators = await store.users.list({ role: 'annotator' })
    const nameOf = new Map(annotators.map((user) => [user.id, user.name]))
    return snippets.map((snippet) => ({
      ...snippet,
      assigneeName: snippet.assigneeId ? (nameOf.get(snippet.assigneeId) ?? null) : null,
    }))
  }

  /**
   * What an annotator is shown of a snippet. Who wrote the feedback (`source`,
   * `model`) is left out of the payload altogether rather than only hidden on
   * the screen, as it is for teachers: an annotator is there to label blind,
   * and has no other use for it. Everything else is what a teacher sees.
   */
  const forAnnotator = ({ tutor: { source: _source, model: _model, ...tutor }, ...snippet }) => ({
    ...snippet,
    tutor,
  })

  router.get(
    '/snippets',
    route(async (req, res) => {
      assertMayLabel(req)

      const { sessionId, included } = req.query
      const labels = await store.snippetLabels.map()
      let snippets

      if (isAnnotator(req)) {
        snippets = attachLabels(await assignedSnippets(req, labels, sessionId), labels)
      } else {
        const scope = await sessionScope(req)

        if (sessionId && !canRead(scope, sessionId)) throw notFound('No such session')

        const messages = sessionId
          ? await store.messages.listBySession(sessionId)
          : await store.messages.listAll()

        const readable = scope.all
          ? messages
          : messages.filter((message) => canRead(scope, message.sessionId))

        snippets = attachLabels(buildSnippets(readable), labels)
      }

      if (included === 'true') snippets = snippets.filter((s) => s.included === true)
      if (included === 'false') snippets = snippets.filter((s) => s.included === false)
      if (included === 'undecided') snippets = snippets.filter((s) => s.included == null)

      // After the filter, so only the sessions still on the page are read.
      snippets = await withContext(snippets)

      if (isAnnotator(req)) snippets = snippets.map(forAnnotator)
      else if (req.user?.role === 'admin' || req.user?.role === 'manager') {
        snippets = await withAssigneeNames(snippets)
      }

      res.json({ criteria: DEFAULT_CRITERIA, count: snippets.length, snippets })
    }),
  )

  /**
   * The annotators work can be assigned to: id and name, active only.
   *
   * Its own route because a manager cannot see annotators through
   * `GET /api/users` — they belong to no manager's branch — and widening the
   * manager's user scope to fix that would hand them every annotator's whole
   * record. This hands them exactly what a picker needs.
   */
  router.get(
    '/annotators',
    route(async (req, res) => {
      requireAssigner(req)
      const annotators = await store.users.list({ role: 'annotator', active: true })
      res.json({ annotators: annotators.map(({ id, name }) => ({ id, name })) })
    }),
  )

  /**
   * Handing snippets to an annotator, or taking them back (`assigneeId: null`).
   *
   * Stored on the snippet's label record beside the labels themselves —
   * `assigneeId`, `assignedBy`, `assignedAt` — so one read of the labels answers
   * both "what has been labelled" and "who is meant to label it". One annotator
   * per snippet: assigning again moves it.
   *
   * All or nothing: every id is checked before anything is written, so a batch
   * with one bad id in it changes nothing. A snippet must exist (be built from
   * messages that are really there), and for a manager it must come from a
   * session in their own branch, by the same sessionScope every other read uses.
   * One out of reach is reported as missing, as everywhere else here.
   */
  router.post(
    '/snippets/assign',
    route(async (req, res) => {
      requireAssigner(req)

      const raw = req.body?.snippetIds
      if (!Array.isArray(raw) || raw.length === 0) {
        throw badRequest('"snippetIds" must be a non-empty array')
      }
      if (raw.length > ASSIGN_MAX) throw badRequest(`At most ${ASSIGN_MAX} snippets at a time`)
      if (raw.some((entry) => typeof entry !== 'string' || !entry)) {
        throw badRequest('"snippetIds" must be snippet ids')
      }
      const snippetIds = [...new Set(raw)]

      const assigneeId = req.body?.assigneeId
      if (assigneeId === undefined) {
        throw badRequest('"assigneeId" is required — an annotator\'s id, or null to unassign')
      }
      if (assigneeId !== null) {
        if (typeof assigneeId !== 'string') throw badRequest('"assigneeId" must be a user id or null')
        const assignee = await store.users.findById(assigneeId)
        if (!assignee || assignee.role !== 'annotator') {
          throw badRequest('"assigneeId" must be the id of an annotator')
        }
        if (!assignee.active) throw badRequest('That annotator is deactivated')
      }

      const scope = await sessionScope(req)
      const sessionIds = [...new Set(snippetIds.map(sessionOfSnippet))]
      if (sessionIds.some((sessionId) => !canRead(scope, sessionId))) {
        throw notFound('No such snippet')
      }

      const existing = new Set(
        (
          await Promise.all(
            sessionIds.map(async (sessionId) =>
              buildSnippets(await store.messages.listBySession(sessionId)),
            ),
          )
        )
          .flat()
          .map((snippet) => snippet.id),
      )
      const missing = snippetIds.filter((snippetId) => !existing.has(snippetId))
      if (missing.length) throw new ApiError(404, 'No such snippet', { snippetIds: missing })

      const at = now()
      const patch =
        assigneeId === null
          ? { assigneeId: null, assignedBy: null, assignedAt: null }
          : { assigneeId, assignedBy: req.user.id, assignedAt: at }

      await Promise.all(snippetIds.map((snippetId) => store.snippetLabels.upsert(snippetId, patch)))

      res.json({ assigneeId, count: snippetIds.length, snippetIds })
    }),
  )

  /** Keep or drop a snippet, and label it against the criteria. */
  router.patch(
    '/snippets/:snippetId',
    route(async (req, res) => {
      // Scoped on the way in as well as the way out. Reading is filtered by
      // sessionScope, but a teacher who learned a snippet id elsewhere must not
      // be able to write a label onto another class's data.
      assertMayLabel(req)

      if (isAnnotator(req)) {
        // Only what has been assigned to them. Anything else — another
        // annotator's, an unassigned one, an id that does not exist — reads as
        // missing, so an annotator learns nothing about the rest of the dataset.
        const current = await store.snippetLabels.get(req.params.snippetId)
        if (current?.assigneeId !== req.user.id) throw notFound('No such snippet')

        // Keeping or dropping a snippet decides what the dataset is made of,
        // and stays with the staff who own it. An annotator labels.
        if (req.body.included !== undefined) {
          throw forbidden('Annotators label snippets; keeping or dropping one is for staff')
        }
      } else {
        const scope = await sessionScope(req)
        if (!canRead(scope, sessionOfSnippet(req.params.snippetId))) {
          throw notFound('No such snippet')
        }
      }

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

      if (req.body.notes !== undefined) {
        const notes = req.body.notes
        if (typeof notes !== 'object' || notes === null || Array.isArray(notes)) {
          throw badRequest('"notes" must be an object of criterionId -> text')
        }

        const known = new Set(DEFAULT_CRITERIA.map((criterion) => criterion.id))
        for (const [criterionId, value] of Object.entries(notes)) {
          if (!known.has(criterionId)) throw badRequest(`Unknown criterion "${criterionId}"`)
          if (typeof value !== 'string') {
            throw badRequest(`The note for "${criterionId}" must be a string`)
          }
        }

        /**
         * Merged here rather than replaced, unlike `labels`. The store's upsert
         * is a shallow merge, so a body carrying only the criterion whose box
         * was just left would otherwise wipe the reasons written for the other
         * four. The client sends one criterion at a time for exactly that
         * reason: it cannot hold a stale copy of the others.
         */
        const current = await store.snippetLabels.get(req.params.snippetId)
        patch.notes = {
          ...(current?.notes ?? {}),
          ...Object.fromEntries(
            Object.entries(notes).map(([criterionId, text]) => [criterionId, text.slice(0, 4000)]),
          ),
        }
      }

      // Checked before attribution is stamped on, or every request would carry
      // a change and "nothing to update" could never be true.
      if (!Object.keys(patch).length) throw badRequest('Nothing to update')

      /**
       * Who labelled it is taken from the token, not the body.
       *
       * The doc wants two coders per snippet so an inter-rater score can be
       * computed, and that number means nothing if the coder's name is
       * self-reported. A researcher on the shared token has no account, so they
       * may still name themselves — that path is unchanged.
       */
      if (req.user) {
        patch.labelledBy = req.user.id
        patch.labelledByName = req.user.name
      } else if (typeof req.body.labelledBy === 'string') {
        patch.labelledBy = req.body.labelledBy.slice(0, 200)
      }

      patch.labelledAt = new Date().toISOString()

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
      // Researcher-only, unlike the routes above: this is the dataset across
      // every class, which is precisely what a teacher's scope excludes.
      requireResearcher(req)

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
          // Appended rather than placed beside `note`, so no existing column
          // moves for a script that reads them by position.
          ...DEFAULT_CRITERIA.map((criterion) => `note_${criterion.id}`),
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
          ...DEFAULT_CRITERIA.map((criterion) => snippet.notes[criterion.id] ?? ''),
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
