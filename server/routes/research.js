import express from 'express'
import { config } from '../config.js'
import {
  DEFAULT_CRITERIA,
  LABEL_VALUES,
  attachLabels,
  buildSnippets,
  snippetHandle,
} from '../services/snippets.js'
import { activityScope, displayCode } from '../services/activities.js'
import { scopeOf } from '../services/users.js'
import { teacherCanLabel } from '../../shared/roles.js'
import { EXTENSIONS } from '../lib/attachments.js'
import { readBytes } from './uploads.js'
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
 *   not keep or drop them. They never see a snippet id or a session id: their
 *   snippets are named by opaque handles (`snippetHandle`), because a session
 *   id is enough to open the student's session on routes that anonymous
 *   students need open;
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
  async function assignedSnippets(req, labels) {
    const assigned = new Set(
      [...labels.values()]
        .filter((label) => label.assigneeId === req.user.id)
        .map((label) => label.snippetId),
    )
    const sessionIds = new Set([...assigned].map(sessionOfSnippet))

    const messages = (
      await Promise.all([...sessionIds].map((id) => store.messages.listBySession(id)))
    ).flat()

    return buildSnippets(messages).filter((snippet) => assigned.has(snippet.id))
  }

  /**
   * Who each snippet is assigned to, by name, for the people who assign — an
   * admin or a manager. One read of the annotators, not one per snippet.
   *
   * Deactivated annotators are read too, and `assigneeActive` says which is
   * which: deactivating someone keeps their assignments (they may come back),
   * so the staff have to be able to see that work is sitting with an account
   * that cannot sign in, find it, and hand it on. `null` when unassigned, and
   * `false` for an id that is no longer an annotator at all.
   */
  async function withAssigneeNames(snippets) {
    const annotators = await store.users.list({ role: 'annotator' })
    const byId = new Map(annotators.map((user) => [user.id, user]))
    return snippets.map((snippet) => ({
      ...snippet,
      assigneeName: snippet.assigneeId ? (byId.get(snippet.assigneeId)?.name ?? null) : null,
      assigneeActive: snippet.assigneeId ? Boolean(byId.get(snippet.assigneeId)?.active) : null,
    }))
  }

  /**
   * The files a student handed in for one snippet, in the order an annotator's
   * file route numbers them: the answer's attachments (photos, the board
   * export) as the answer holds them now, then the photo of an own question.
   * Worked out from the snippet with its context (`withContext`) on every
   * request, by the list route and the file route alike, so an index means the
   * same file to both and nothing has to be stored to say so.
   *
   * A question image a teacher authored is not in it: it lives under the
   * activity, not the session, and an annotator gets it as anyone else does.
   */
  function studentFiles(snippet) {
    const files = (snippet.answer?.attachments ?? []).map((file) => ({
      uploadId: file.id,
      type: file.type,
      source: file.source === 'whiteboard' ? 'whiteboard' : 'file',
    }))
    const { question } = snippet
    if (question.isOwnQuestion && question.image) {
      // `withContext` keeps the URL, not the id; the server wrote that URL as
      // `/api/uploads/<id>` (routes/uploads.js), so the id is read back off it.
      const uploadId = /^\/api\/uploads\/([\w-]+)$/.exec(question.image.url ?? '')?.[1]
      if (uploadId) files.push({ uploadId, type: question.image.type, source: 'question' })
    }
    return files
  }

  /** Where an annotator fetches a snippet's file: by handle and index, nothing else. */
  const annotatorFileUrl = (handle, index) => `/api/research/snippets/${handle}/files/${index}`

  /**
   * What an annotator is shown of a snippet: an allow-list, so a field added to
   * snippets later reaches them only if it is added here too.
   *
   * - `id` is the snippet's handle, not its id, and `sessionId` and
   *   `questionId` are gone — see `snippetHandle`.
   * - Who wrote the feedback (`source`, `model`) is left out of the payload
   *   altogether rather than only hidden on the screen, as it is for teachers:
   *   an annotator is there to label blind, and has no other use for it.
   * - `assignedBy` is another account's id, and nothing on their screen uses it.
   * - Files the student handed in — answer photos, a board export, the photo
   *   of an own question — are named by the annotator file route
   *   (`GET /snippets/:handle/files/:index`) and carry only `url`, `type` and,
   *   for an answer file, whether it is the board. Not their `/api/uploads/`
   *   URL: an upload id is public by itself, and on Spaces that URL redirects
   *   to a signed URL whose key is `dropshot/<sessionId>/<uploadId>`. Nor their
   *   names, which a student may have typed their own into. The file route
   *   streams the bytes instead, see below.
   *   A question image a teacher authored lives under the activity instead,
   *   and stays as it is.
   * - A question's code falls back to the raw question id when neither of the
   *   session's question lists knows it; an annotator gets no code instead.
   * - `labels`, `notes` and `note` are this annotator's own entry under the
   *   record's `annotations`, blank until they write one — never the shared
   *   record's, which a teacher or another annotator may have written. That is
   *   also why a snippet reassigned to them starts blank. `included` is the
   *   staff's decision, shown read-only.
   */
  const forAnnotator = (annotatorId, labels) => (snippet) => {
    const { question, answer } = snippet
    const handle = snippetHandle(annotatorId, snippet.id)
    const own = labels.get(snippet.id)?.annotations?.[annotatorId] ?? {}
    const files = studentFiles(snippet).map((file, index) => ({
      ...file,
      url: annotatorFileUrl(handle, index),
    }))
    const questionFile = files.find((file) => file.source === 'question')

    return {
      id: handle,
      student: { text: snippet.student.text, at: snippet.student.at },
      tutor: { text: snippet.tutor.text, label: snippet.tutor.label, at: snippet.tutor.at },
      rating: snippet.rating,
      turnIndex: snippet.turnIndex,
      included: snippet.included,
      // Their own labelling, never the shared record's (see `annotationsOf`).
      labels: own.labels ?? {},
      note: own.note ?? '',
      notes: own.notes ?? {},
      assigneeId: snippet.assigneeId,
      assignedAt: snippet.assignedAt,
      question: {
        code: question.code === snippet.questionId ? null : question.code,
        prompt: question.prompt,
        promptByLang: question.promptByLang,
        image: questionFile
          ? { url: questionFile.url, type: questionFile.type }
          : question.isOwnQuestion
            ? null
            : question.image,
        isOwnQuestion: question.isOwnQuestion,
      },
      answer: answer && {
        mode: answer.mode,
        draft: answer.draft,
        strokeCount: answer.strokeCount,
        attachments: files
          .filter((file) => file.source !== 'question')
          .map(({ url, type, source }) => ({ url, type, source })),
        updatedAt: answer.updatedAt,
      },
    }
  }

  /**
   * The label record a PATCH answers with, as an annotator may see it: the
   * shared record's `included` and assignment, and their own entry for
   * everything they wrote. `labelledBy` is themselves — the shared record's
   * would name whoever labelled it for the staff.
   */
  const labelForAnnotator = (handle, label, own, user) => ({
    id: handle,
    included: label.included ?? null,
    labels: own?.labels ?? {},
    note: own?.note ?? '',
    notes: own?.notes ?? {},
    assigneeId: label.assigneeId ?? null,
    assignedAt: label.assignedAt ?? null,
    labelledBy: user.id,
    labelledByName: user.name ?? null,
    labelledAt: own?.labelledAt ?? null,
  })

  /**
   * Every annotator's own labelling of one snippet, from `annotations` on its
   * label record, oldest first, for the staff who hand the work out.
   *
   * Kept per annotator rather than written over the shared `labels`, so an
   * annotator never sees or overwrites what a teacher or another annotator
   * decided, and the shared record keeps its `labelledBy`. It is also the
   * second coder the export's inter-rater columns need. Reassigning a snippet
   * does not remove the earlier annotator's entry — it is research data — so
   * there may be more than one; `annotatorId === assigneeId` marks the one
   * the snippet sits with now.
   *
   * The name is the account's current one, or the name stamped when it was
   * written if the account is no longer an annotator (deleted, or moved to
   * another role), or `null` if neither is known.
   */
  function annotationsOf(label, nameOf) {
    return Object.entries(label?.annotations ?? {})
      .map(([annotatorId, entry]) => ({
        annotatorId,
        annotatorName: nameOf.get(annotatorId) ?? entry.annotatorName ?? null,
        labels: entry.labels ?? {},
        notes: entry.notes ?? {},
        note: entry.note ?? '',
        labelledAt: entry.labelledAt ?? null,
      }))
      .sort((a, b) => String(a.labelledAt ?? '').localeCompare(String(b.labelledAt ?? '')))
  }

  /** Annotator id -> name, for `annotationsOf`. One read, not one per snippet. */
  async function annotatorNames() {
    const annotators = await store.users.list({ role: 'annotator' })
    return new Map(annotators.map((user) => [user.id, user.name]))
  }

  /**
   * Adds the annotators' work to staff snippets — admin, manager and the
   * research token, never a teacher, whose payload stays as it was. Additive:
   * `annotation` is the current assignee's entry (`null` when unassigned or
   * when they have not written anything yet) and `annotations` is every entry,
   * the current assignee's included.
   */
  function withAnnotations(snippets, labels, nameOf) {
    return snippets.map((snippet) => {
      const annotations = annotationsOf(labels.get(snippet.id), nameOf)
      return {
        ...snippet,
        annotation: snippet.assigneeId
          ? (annotations.find((entry) => entry.annotatorId === snippet.assigneeId) ?? null)
          : null,
        annotations,
      }
    })
  }

  /** Admin, manager, or the research token with no account: who sees `annotation`. */
  const seesAnnotations = (req) =>
    req.user?.role === 'admin' || req.user?.role === 'manager' || (!req.user && isResearcher(req))

  /**
   * The label record behind an annotator's handle, or `null`.
   *
   * Recomputed over their own assignments and nothing else — read by assignee,
   * not by loading every record — so a handle resolves only to a snippet
   * assigned to this annotator, and a real snippet id, which is never a
   * handle, resolves to nothing at all. Every miss is the same miss, so
   * probing with ids learns nothing. The record itself comes back so the
   * caller need not read it a second time.
   */
  async function resolveHandle(req, handle) {
    const mine = await store.snippetLabels.listByAssignee(req.user.id)
    return mine.find((label) => snippetHandle(req.user.id, label.snippetId) === handle) ?? null
  }

  /**
   * The snippet with this id, built from the messages that are really there,
   * or `null`. A label record outlives nothing on its own: once the session's
   * messages are gone (withdrawn), so is the snippet, whatever the labels say.
   */
  async function findSnippet(snippetId) {
    const messages = await store.messages.listBySession(sessionOfSnippet(snippetId))
    return buildSnippets(messages).find((snippet) => snippet.id === snippetId) ?? null
  }

  router.get(
    '/snippets',
    route(async (req, res) => {
      assertMayLabel(req)

      const { sessionId, included } = req.query
      const labels = await store.snippetLabels.map()
      let snippets

      if (isAnnotator(req)) {
        // `sessionId` is ignored for them, not refused or checked: an answer
        // that changed with it would confirm whether a guessed session id has
        // anything of theirs in it. They have no session ids to filter by.
        snippets = attachLabels(await assignedSnippets(req, labels), labels)
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

      if (isAnnotator(req)) snippets = snippets.map(forAnnotator(req.user.id, labels))
      else if (req.user?.role === 'admin' || req.user?.role === 'manager') {
        snippets = await withAssigneeNames(snippets)
      }
      if (seesAnnotations(req)) snippets = withAnnotations(snippets, labels, await annotatorNames())

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

      /** The real snippet id. For an annotator the path carries a handle instead. */
      let snippetId = req.params.snippetId
      /** An annotator's label record, read once while resolving their handle. */
      let assigned = null

      if (isAnnotator(req)) {
        // Only what has been assigned to them, and only by handle. Anything
        // else — another annotator's handle, an unassigned snippet, a real
        // snippet id, something made up — reads as missing, so an annotator
        // learns nothing about the rest of the dataset.
        assigned = await resolveHandle(req, req.params.snippetId)
        // And only while the snippet is still there. The label record survives
        // nothing on its own account, but a session withdrawn before this
        // check existed, or between an assignment and this save, must not
        // keep taking labels and reasons about words that are gone.
        if (!assigned || !(await findSnippet(assigned.snippetId))) {
          throw notFound('No such snippet')
        }
        snippetId = assigned.snippetId

        // Keeping or dropping a snippet decides what the dataset is made of,
        // and stays with the staff who own it. An annotator labels.
        if (req.body?.included !== undefined) {
          throw forbidden('Annotators label snippets; keeping or dropping one is for staff')
        }
      } else {
        const scope = await sessionScope(req)
        if (!canRead(scope, sessionOfSnippet(snippetId))) {
          throw notFound('No such snippet')
        }
      }

      const patch = {}

      if (req.body?.included !== undefined) {
        if (typeof req.body.included !== 'boolean' && req.body.included !== null) {
          throw badRequest('"included" must be true, false or null')
        }
        patch.included = req.body.included
      }

      if (req.body?.labels !== undefined) {
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

      if (req.body?.note !== undefined) {
        if (typeof req.body.note !== 'string') throw badRequest('"note" must be a string')
        patch.note = req.body.note.slice(0, 4000)
      }

      if (req.body?.notes !== undefined) {
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

        const given = Object.fromEntries(
          Object.entries(notes).map(([criterionId, text]) => [criterionId, text.slice(0, 4000)]),
        )

        if (isAnnotator(req)) {
          // Per criterion by the store itself (`annotate`), into their own entry.
          patch.notes = given
        } else {
          /**
           * Merged here rather than replaced, unlike `labels`. The store's upsert
           * is a shallow merge, so a body carrying only the criterion whose box
           * was just left would otherwise wipe the reasons written for the other
           * four. The client sends one criterion at a time for exactly that
           * reason: it cannot hold a stale copy of the others.
           */
          const current = await store.snippetLabels.get(snippetId)
          patch.notes = { ...(current?.notes ?? {}), ...given }
        }
      }

      // Checked before attribution is stamped on, or every request would carry
      // a change and "nothing to update" could never be true.
      if (!Object.keys(patch).length) throw badRequest('Nothing to update')

      /**
       * An annotator writes into their own entry only (`annotations` on the
       * record, see `annotationsOf`), never the shared `labels`, `notes`,
       * `note` or `labelledBy`: those are the staff's labelling, and
       * overwriting them would both show the annotator someone else's
       * decisions and lose whose they were. Attribution is the entry's key —
       * their account id — so it is still taken from the token, not the body.
       */
      if (isAnnotator(req)) {
        const own = await store.snippetLabels.annotate(snippetId, req.user.id, {
          ...patch,
          annotatorName: req.user.name ?? null,
          labelledAt: new Date().toISOString(),
        })
        res.json({ label: labelForAnnotator(req.params.snippetId, assigned, own, req.user) })
        return
      }

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
      } else if (typeof req.body?.labelledBy === 'string') {
        patch.labelledBy = req.body.labelledBy.slice(0, 200)
      }

      patch.labelledAt = new Date().toISOString()

      // The annotators' entries are left out of the answer, which stays the
      // shared record it always was: a teacher is not shown them at all.
      const { annotations: _annotations, ...label } = await store.snippetLabels.upsert(
        snippetId,
        patch,
      )
      res.json({ label })
    }),
  )

  /**
   * One of the files a student handed in for a snippet, for the annotator it
   * is assigned to — the bytes themselves, streamed through the API.
   *
   * Not a redirect, unlike `/api/uploads/:id`: on Spaces that redirect is to a
   * signed URL whose key is `dropshot/<sessionId>/<uploadId>`, which is exactly
   * what an annotator must not learn (see `snippetHandle`). So nothing the
   * response carries names the session, the upload or the student — no key, no
   * id, and a neutral file name rather than whatever the student called it.
   * `private, no-store`, because it is a student's work behind a login.
   *
   * `:index` counts into `studentFiles` for that snippet, recomputed here. An
   * annotator only: staff and the research token have `/api/uploads/:id`, and
   * this route answers as if it were not there for anyone else's handle, an
   * unassigned or withdrawn snippet, or an index past the end.
   */
  router.get(
    '/snippets/:handle/files/:index',
    route(async (req, res) => {
      if (!isAnnotator(req)) {
        throw forbidden('This is an annotator\'s view of a file; staff open it by its upload')
      }

      const assigned = await resolveHandle(req, req.params.handle)
      const snippet = assigned ? await findSnippet(assigned.snippetId) : null
      if (!snippet) throw notFound('No such file')

      const index = /^\d{1,3}$/.test(req.params.index) ? Number(req.params.index) : -1
      const [inContext] = await withContext([snippet])
      const file = studentFiles(inContext)[index]
      if (!file) throw notFound('No such file')

      // Checked against the session too, so a file list that somehow named
      // another session's upload still could not hand it over.
      const upload = await store.uploads.findById(file.uploadId)
      if (!upload || upload.sessionId !== snippet.sessionId) throw notFound('No such file')

      let body
      try {
        body = await readBytes(upload)
      } catch {
        body = null // Spaces said no (gone, or unreachable): the same answer as below.
      }
      if (!body) throw notFound('That file is no longer available')

      const extension = EXTENSIONS[upload.type] ?? 'bin'
      res.status(200)
      res.type(upload.type)
      res.setHeader('Content-Disposition', `inline; filename="snippet-file-${index + 1}.${extension}"`)
      res.setHeader('Cache-Control', 'private, no-store')
      res.setHeader('X-Content-Type-Options', 'nosniff')

      body.once('error', () => {
        // A file deleted underneath an open stream. Before anything was sent
        // that is an honest 404; after, the connection is all there is to end.
        if (res.headersSent) {
          res.destroy()
          return
        }
        res.removeHeader('Content-Disposition')
        res.status(404).json({ error: { message: 'That file is no longer available' } })
      })
      // A reader who goes away mid-file: `pipe` alone would leave the source
      // open — on Spaces, a socket held out of the S3 client's pool until it
      // times out; on disk, a file descriptor. A finished read is already
      // destroyed, so this only ever cuts one short.
      res.once('close', () => {
        if (!body.destroyed) body.destroy()
      })
      body.pipe(res)
    }),
  )

  /**
   * Dataset export. JSON keeps the nesting; CSV is one row per snippet, which
   * is what a coding tool or a stats package wants. Both carry the annotators'
   * labelling beside the shared record's: JSON as `annotation` and
   * `annotations` (see `withAnnotations`), CSV as columns appended at the end.
   */
  router.get(
    '/export',
    route(async (req, res) => {
      // Researcher-only, unlike the routes above: this is the dataset across
      // every class, which is precisely what a teacher's scope excludes.
      requireResearcher(req)

      const labels = await store.snippetLabels.map()
      const snippets = withAnnotations(
        attachLabels(buildSnippets(await store.messages.listAll()), labels).filter(
          (snippet) => snippet.included === true,
        ),
        labels,
        await annotatorNames(),
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
          /*
           * The annotator's labelling, appended after everything above for the
           * same reason. The columns above are the shared record — the staff
           * coder — and these are the second coder the inter-rater score is
           * computed against. One row per snippet still, so one annotator per
           * row: the current assignee's entry if they have written one,
           * otherwise the latest entry anyone wrote (a snippet unassigned or
           * reassigned after the work was done keeps its work in the export).
           * `annotator_count` says when there are more; the JSON export
           * carries every entry under `annotations`.
           */
          'annotator_id',
          ...DEFAULT_CRITERIA.map((criterion) => `annotator_label_${criterion.id}`),
          ...DEFAULT_CRITERIA.map((criterion) => `annotator_note_${criterion.id}`),
          'annotator_count',
        ]

        /** The annotator entry a CSV row carries, by the rule above. */
        const rowAnnotation = (snippet) => snippet.annotation ?? snippet.annotations.at(-1) ?? null

        const rows = snippets.map((snippet) => {
          const annotation = rowAnnotation(snippet)
          return [
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
            annotation?.annotatorId ?? '',
            ...DEFAULT_CRITERIA.map((criterion) => annotation?.labels[criterion.id] ?? ''),
            ...DEFAULT_CRITERIA.map((criterion) => annotation?.notes[criterion.id] ?? ''),
            snippet.annotations.length,
          ]
        })

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
