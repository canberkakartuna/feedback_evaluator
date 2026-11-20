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
import {
  dialogsByQuestion,
  ensureDefaultDataset,
  groupByStudent,
  parseDatasetInput,
  sameName,
  studentKeyOf,
} from '../services/datasets.js'
import { teacherCanLabel } from '../../shared/roles.js'
import {
  DATASET_MEMBER_ROLES,
  assignedDatasets,
  datasetIdsOf,
  membershipForIncluded,
} from '../../shared/datasets.js'
import {
  canDeleteSessions,
  canForceDeleteSessions,
  parseSessionIds,
  researchRecordCount,
} from '../../shared/sessionDeletion.js'
import { removeSessionData } from '../services/withdrawal.js'
import { EXTENSIONS } from '../lib/attachments.js'
import { readBytes } from './uploads.js'
import {
  ApiError,
  badRequest,
  forbidden,
  id as newId,
  notFound,
  now,
  route,
  unavailable,
} from '../lib/http.js'

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
 *
 * **Datasets** (shared/datasets.js) sit across all of that. An admin makes
 * them and assigns each to teachers and annotators; staff who may keep a
 * snippet may add it to any active dataset; and labelling is per dataset:
 *
 * - an admin or the research token reads and labels every dataset;
 * - a manager reads and labels every active dataset, within their branch;
 * - a teacher reads only the active datasets assigned to them, within their
 *   own scope, and writes labels only onto snippets in one of those;
 * - an annotator reads only the active datasets assigned to them, whole, as
 *   handles — on top of the snippets assigned to them one by one, as before.
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

/** Creating, editing and assigning datasets: an admin's account, not the research token. */
function requireDatasetAdmin(req) {
  if (req.user?.role !== 'admin') throw forbidden('Only an admin can manage datasets')
}

/** A teacher or an annotator: labelling reaches them through dataset assignment. */
const isAssignedLabeller = (req) => req.user?.role === 'teacher' || req.user?.role === 'annotator'

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

  /* ------------------------------------------------- deleting student work */

  /**
   * Deleting entries from the Student work page. One entry is one session, and
   * deleting it removes what `removeSessionData` removes for a withdrawal: the
   * session, its answers, tutor messages, events, own questions, uploaded files
   * (records and bytes) and the label records on its dialogs. The student's
   * account, sign-in and consent are not touched; opening the activity again
   * starts a new session.
   *
   * - **Who:** a signed-in teacher, manager or admin, each within the sessions
   *   `sessionScope` already lets them read. The research token alone is not
   *   enough — a deletion is attributed to an account.
   * - **Scope is all-or-nothing:** one id that is unknown or out of reach and
   *   nothing is deleted — 404 with the offending ids, the same answer for both
   *   so it says nothing about whether a session exists elsewhere.
   * - **Research data is per id:** a session whose dialogs are in a dataset or
   *   carry labels (shared/sessionDeletion.js `isResearchRecord`) is skipped and
   *   reported under `protected`, unless an admin sends `force: true`, which
   *   deletes it with its label records — and so its dataset memberships,
   *   which live on those records. Nothing is left pointing at it.
   *
   * Sessions are deleted one by one; one that fails is reported under
   * `failed` and the rest carry on, so the answer always says exactly which
   * ids are gone.
   */
  async function deleteSessions(req, sessionIds, force) {
    if (!canDeleteSessions(req.user)) {
      throw forbidden('Only a teacher, a manager or an admin can delete student work')
    }
    if (force && !canForceDeleteSessions(req.user)) {
      throw forbidden('Only an admin can delete entries whose dialogs are research data')
    }

    const scope = await sessionScope(req)
    const sessions = await Promise.all(sessionIds.map((sessionId) => store.sessions.findById(sessionId)))
    const missing = sessionIds.filter(
      (sessionId, index) => !sessions[index] || !canRead(scope, sessionId),
    )
    if (missing.length) throw new ApiError(404, 'No such session', { sessionIds: missing })

    const result = { deleted: [], protected: [], failed: [], files: 0, labelRecords: 0 }

    for (const session of sessions) {
      try {
        const labels = await store.snippetLabels.listBySession(session.id)
        const dialogs = researchRecordCount(labels)
        if (dialogs > 0 && !force) {
          result.protected.push({ sessionId: session.id, dialogs })
          continue
        }
        const { files } = await removeSessionData(store, session)
        result.deleted.push(session.id)
        result.files += files
        result.labelRecords += labels.length
      } catch (error) {
        console.error(`[api] could not delete session ${session.id}: ${error.message}`)
        result.failed.push({ sessionId: session.id, reason: 'error' })
      }
    }

    // Who deleted what, kept after the work itself is gone. An account event:
    // `sessionId` is null, as for sign-ins.
    if (result.deleted.length) {
      await store.events.insertMany([
        {
          id: newId('evt'),
          sessionId: null,
          userId: req.user.id,
          type: 'student_work_deleted',
          at: now(),
          payload: {
            sessionIds: result.deleted,
            forced: Boolean(force),
            files: result.files,
            labelRecords: result.labelRecords,
          },
        },
      ])
    }

    return result
  }

  /**
   * `{ sessionIds: [...], force? }` → `{ deleted, protected, failed, files,
   * labelRecords }`. At most DELETE_SESSIONS_MAX ids. See deleteSessions.
   */
  router.post(
    '/sessions/delete',
    route(async (req, res) => {
      notForAnnotators(req)
      if (!canDeleteSessions(req.user)) {
        throw forbidden('Only a teacher, a manager or an admin can delete student work')
      }
      const { ids, error } = parseSessionIds(req.body?.sessionIds)
      if (error) throw badRequest(error)
      const force = req.body?.force === true

      res.json(await deleteSessions(req, ids, force))
    }),
  )

  /**
   * One entry. The same rules; `?force=true` for an admin. A protected session
   * is a 409 here rather than a 200 that deleted nothing.
   */
  router.delete(
    '/sessions/:sessionId',
    route(async (req, res) => {
      notForAnnotators(req)
      const force = req.query.force === 'true' || req.query.force === '1'
      const result = await deleteSessions(req, [req.params.sessionId], force)

      if (result.protected.length) {
        throw new ApiError(
          409,
          'This entry has dialogs in a dataset or with labels — only an admin can delete it',
          { protected: result.protected },
        )
      }
      if (result.failed.length) throw new ApiError(500, 'The entry could not be deleted')
      res.json(result)
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
    const mine = await annotatorReach(req)
    return mine.find((label) => snippetHandle(req.user.id, label.snippetId) === handle) ?? null
  }

  /* ------------------------------------------------------------- datasets */

  /** Every dataset, the default one created first if it is not there yet. */
  async function allDatasets() {
    await ensureDefaultDataset(store)
    return store.datasets.list()
  }

  /**
   * The label records an annotator may label: the ones assigned to them one
   * by one, and every record in an active dataset assigned to them. What their
   * handles resolve over, so a snippet in a dataset that is not theirs — or
   * that was unassigned from them, or archived — reads as missing.
   */
  async function annotatorReach(req) {
    const datasetIds = assignedDatasets(await allDatasets(), req.user.id).map((dataset) => dataset.id)
    const [assigned, inDatasets] = await Promise.all([
      store.snippetLabels.listByAssignee(req.user.id),
      datasetIds.length ? store.snippetLabels.listByDatasets(datasetIds) : [],
    ])
    return [...new Map([...assigned, ...inDatasets].map((label) => [label.snippetId, label])).values()]
  }

  /**
   * One dataset, for someone about to read or label it, or a refusal.
   *
   * Missing is 404. Archived is 404 too for anyone but an admin or the
   * research token: it has been put away. For a teacher or an annotator a
   * dataset not assigned to them is 403 — they are told it is not theirs, not
   * shown it. A manager reads every active dataset, within their branch.
   */
  async function datasetForReader(req, datasetId) {
    await ensureDefaultDataset(store)
    const dataset = await store.datasets.findById(String(datasetId))
    if (!dataset) throw notFound('No such dataset')
    if (dataset.archived && !isResearcher(req)) throw notFound('No such dataset')
    if (isAssignedLabeller(req) && !(dataset.memberIds ?? []).includes(req.user.id)) {
      throw forbidden('This dataset is not assigned to you')
    }
    return dataset
  }

  /**
   * The snippets of one dataset the caller may see: built from the messages
   * that are really there (a withdrawn session's are gone, so are its
   * snippets), and for staff other than an admin, only from sessions in their
   * scope. An annotator's reach is the dataset itself — they never see a
   * session id, so they are not filtered by one.
   */
  async function datasetSnippets(req, dataset, { sessionId } = {}) {
    const members = await store.snippetLabels.listByDatasets([dataset.id])
    const memberIds = new Set(members.map((label) => label.snippetId))
    let sessionIds = [...new Set(members.map((label) => sessionOfSnippet(label.snippetId)))]

    if (!isAnnotator(req)) {
      const scope = await sessionScope(req)
      if (sessionId && !canRead(scope, sessionId)) throw notFound('No such session')
      sessionIds = sessionIds.filter((id) => canRead(scope, id) && (!sessionId || id === sessionId))
    }

    const messages = (
      await Promise.all(sessionIds.map((id) => store.messages.listBySession(id)))
    ).flat()
    return buildSnippets(messages).filter((snippet) => memberIds.has(snippet.id))
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

      const { sessionId, included, datasetId } = req.query
      const labels = await store.snippetLabels.map()
      let snippets

      if (datasetId) {
        // One dataset, for whoever may read it (see datasetForReader). For an
        // annotator `sessionId` is ignored here too, for the reason below.
        const dataset = await datasetForReader(req, datasetId)
        snippets = attachLabels(
          await datasetSnippets(req, dataset, { sessionId: isAnnotator(req) ? undefined : sessionId }),
          labels,
        )
      } else if (isAnnotator(req)) {
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

      /** The record as it stands, for the dataset rules below. Not read for an annotator. */
      const current = isAnnotator(req) ? null : await store.snippetLabels.get(snippetId)

      /**
       * Keeping or dropping moves the snippet in or out of datasets
       * (shared/datasets.js `membershipForIncluded`): keep puts a snippet
       * that is in no dataset into the default one, drop or undecided takes it
       * out of all of them. Choosing *which* dataset is
       * `POST /datasets/:datasetId/snippets`.
       */
      if (patch.included !== undefined) {
        patch.datasetIds = membershipForIncluded(current, patch.included).datasetIds
      }

      /**
       * A teacher labels only what is in a dataset assigned to them — keeping
       * or dropping their own students' snippets is selection, and stays open
       * to them as before. Checked against the membership this same request
       * leaves behind, so "keep and label" in one go works when keeping puts
       * it in a dataset of theirs.
       */
      const writesLabels =
        req.body?.labels !== undefined || req.body?.notes !== undefined || req.body?.note !== undefined
      if (req.user?.role === 'teacher' && writesLabels) {
        const theirs = new Set(
          assignedDatasets(await allDatasets(), req.user.id).map((dataset) => dataset.id),
        )
        const after = patch.datasetIds ?? datasetIdsOf(current)
        if (!after.some((datasetId) => theirs.has(datasetId))) {
          throw forbidden('This dialog is not in a dataset assigned to you')
        }
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
      // Read the way every list reads it, for a record from before datasets.
      res.json({ label: { ...label, datasetIds: datasetIdsOf(label) } })
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

  /* ------------------------------------------------------ dataset routes */

  /**
   * A dataset as its reader sees it. Everyone gets the name, the description,
   * whether it is the default or archived, whether it is assigned to them, and
   * how many of its dialogs they can reach. An admin also gets who it is
   * assigned to and when it was made and changed.
   */
  function describeDataset(dataset, { req, count, usersById }) {
    const row = {
      id: dataset.id,
      name: dataset.name,
      description: dataset.description ?? '',
      isDefault: Boolean(dataset.isDefault),
      archived: Boolean(dataset.archived),
      assigned: Boolean(req.user && (dataset.memberIds ?? []).includes(req.user.id)),
      count,
    }
    if (!usersById) return row

    return {
      ...row,
      memberIds: dataset.memberIds ?? [],
      // An id that names nobody any more (a deleted account) is listed as
      // such, so it can be taken off; deleting an account normally does that.
      members: (dataset.memberIds ?? []).map((memberId) => {
        const user = usersById.get(memberId)
        return user
          ? { id: user.id, name: user.name, role: user.role, active: Boolean(user.active) }
          : { id: memberId, name: null, role: null, active: false }
      }),
      createdAt: dataset.createdAt ?? null,
      createdBy: dataset.createdBy ?? null,
      updatedAt: dataset.updatedAt ?? null,
      archivedAt: dataset.archivedAt ?? null,
    }
  }

  /**
   * How many of each dataset's dialogs the caller can reach, from the label
   * records alone (no messages read): every member for an admin, the research
   * token and an annotator; the ones from sessions in scope for a teacher or a
   * manager. A withdrawn session's records go with it, so they are not counted.
   */
  async function datasetCounts(req, datasets) {
    const ids = datasets.map((dataset) => dataset.id)
    const counts = new Map(ids.map((id) => [id, 0]))
    if (!ids.length) return counts

    const members = await store.snippetLabels.listByDatasets(ids)
    const scope = isAnnotator(req) ? { all: true } : await sessionScope(req)
    const wanted = new Set(ids)
    for (const label of members) {
      if (!canRead(scope, sessionOfSnippet(label.snippetId))) continue
      for (const datasetId of datasetIdsOf(label)) {
        if (wanted.has(datasetId)) counts.set(datasetId, counts.get(datasetId) + 1)
      }
    }
    return counts
  }

  /** Every account an admin's dataset rows name, in one read. */
  async function usersFor(datasets) {
    const ids = [...new Set(datasets.flatMap((dataset) => dataset.memberIds ?? []))]
    const users = ids.length ? await store.users.list({ ids, limit: ids.length }) : []
    return new Map(users.map((user) => [user.id, user]))
  }

  /** One dataset as an admin reads it, after a change. */
  async function adminRow(req, dataset) {
    const counts = await datasetCounts(req, [dataset])
    return describeDataset(dataset, { req, count: counts.get(dataset.id), usersById: await usersFor([dataset]) })
  }

  /**
   * The datasets this caller can see.
   *
   * - admin, research token: all of them, archived included, with who each
   *   is assigned to;
   * - manager, teacher: the active ones — any of them can be a target when
   *   picking dialogs — with `assigned` saying which a teacher labels;
   * - annotator: only the active ones assigned to them, plus `individualCount`,
   *   how many snippets are assigned to them one by one outside any dataset.
   */
  router.get(
    '/datasets',
    route(async (req, res) => {
      assertMayLabel(req)
      const all = await allDatasets()
      const admin = isResearcher(req)

      const visible = admin
        ? all
        : isAnnotator(req)
          ? assignedDatasets(all, req.user.id)
          : all.filter((dataset) => !dataset.archived)

      const [counts, usersById] = await Promise.all([
        datasetCounts(req, visible),
        admin ? usersFor(visible) : null,
      ])

      const body = {
        datasets: visible.map((dataset) =>
          describeDataset(dataset, { req, count: counts.get(dataset.id), usersById }),
        ),
      }
      if (isAnnotator(req)) {
        body.individualCount = (await store.snippetLabels.listByAssignee(req.user.id)).length
      }
      res.json(body)
    }),
  )

  /** A new dataset. Admin only; the name must not be one another dataset has. */
  router.post(
    '/datasets',
    route(async (req, res) => {
      requireDatasetAdmin(req)
      const input = parseDatasetInput(req.body)
      const all = await allDatasets()
      if (all.some((dataset) => sameName(dataset.name, input.name))) {
        throw new ApiError(409, 'A dataset with that name already exists')
      }

      const at = now()
      const dataset = await store.datasets.create({
        id: newId('ds'),
        name: input.name,
        description: input.description,
        isDefault: false,
        archived: false,
        archivedAt: null,
        memberIds: [],
        createdAt: at,
        createdBy: req.user.id,
        updatedAt: at,
      })
      res.status(201).json({ dataset: await adminRow(req, dataset) })
    }),
  )

  /**
   * Renaming, describing, archiving or bringing one back. Archiving hides a
   * dataset from everyone but the admin — no picking into it, no labelling in
   * it — and keeps everything in it. The default dataset is never archived:
   * an old client's "keep" still puts snippets there.
   */
  router.patch(
    '/datasets/:datasetId',
    route(async (req, res) => {
      requireDatasetAdmin(req)
      const all = await allDatasets()
      const dataset = all.find((entry) => entry.id === req.params.datasetId)
      if (!dataset) throw notFound('No such dataset')

      const patch = parseDatasetInput(req.body, { partial: true })
      if (req.body?.archived !== undefined) {
        if (typeof req.body.archived !== 'boolean') throw badRequest('"archived" must be true or false')
        if (req.body.archived && dataset.isDefault) {
          throw badRequest('The default dataset cannot be archived')
        }
        patch.archived = req.body.archived
        patch.archivedAt = req.body.archived ? (dataset.archivedAt ?? now()) : null
      }
      if (!Object.keys(patch).length) throw badRequest('Nothing to update')
      if (
        patch.name &&
        all.some((entry) => entry.id !== dataset.id && sameName(entry.name, patch.name))
      ) {
        throw new ApiError(409, 'A dataset with that name already exists')
      }

      patch.updatedAt = now()
      res.json({ dataset: await adminRow(req, await store.datasets.update(dataset.id, patch)) })
    }),
  )

  /**
   * Deleting a dataset — only an empty one. A dataset that has dialogs in it
   * is research data (and the labels on them were made in it), so it is
   * refused with 409 and archived instead. The default dataset is never
   * deleted.
   */
  router.delete(
    '/datasets/:datasetId',
    route(async (req, res) => {
      requireDatasetAdmin(req)
      await ensureDefaultDataset(store)
      const dataset = await store.datasets.findById(req.params.datasetId)
      if (!dataset) throw notFound('No such dataset')
      if (dataset.isDefault) throw new ApiError(409, 'The default dataset cannot be deleted')

      const members = await store.snippetLabels.listByDatasets([dataset.id])
      if (members.length) {
        throw new ApiError(
          409,
          'This dataset has dialogs in it — archive it instead, or remove them first',
          { count: members.length },
        )
      }

      await store.datasets.remove(dataset.id)
      res.json({ deleted: true, datasetId: dataset.id })
    }),
  )

  /**
   * Assigning a dataset to a teacher or an annotator, who may then read and
   * label it. Active accounts only, and not onto an archived dataset.
   */
  router.post(
    '/datasets/:datasetId/members',
    route(async (req, res) => {
      requireDatasetAdmin(req)
      await ensureDefaultDataset(store)
      const dataset = await store.datasets.findById(req.params.datasetId)
      if (!dataset) throw notFound('No such dataset')
      if (dataset.archived) throw new ApiError(409, 'This dataset is archived — bring it back first')

      const userId = req.body?.userId
      if (typeof userId !== 'string' || !userId) throw badRequest('"userId" is required')
      const user = await store.users.findById(userId)
      if (!user || !DATASET_MEMBER_ROLES.includes(user.role)) {
        throw badRequest('"userId" must be a teacher or an annotator')
      }
      if (!user.active) throw badRequest('That account is deactivated')

      res.json({ dataset: await adminRow(req, await store.datasets.addMember(dataset.id, userId)) })
    }),
  )

  /**
   * Taking a dataset back from someone. They stop seeing it at once; every
   * label they made stays where it is, on the snippets.
   */
  router.delete(
    '/datasets/:datasetId/members/:userId',
    route(async (req, res) => {
      requireDatasetAdmin(req)
      await ensureDefaultDataset(store)
      const dataset = await store.datasets.findById(req.params.datasetId)
      if (!dataset) throw notFound('No such dataset')

      res.json({
        dataset: await adminRow(req, await store.datasets.removeMember(dataset.id, req.params.userId)),
      })
    }),
  )

  /**
   * Adding dialogs to a dataset, or taking them out (`…/snippets/remove`) —
   * the "which dataset" half of keeping a snippet.
   *
   * The same people as keep-or-drop: a teacher whose labelling is on, a
   * manager, an admin, the research token; never an annotator. Any active
   * dataset may be the target — picking is not limited to the datasets a
   * teacher labels. Every snippet must exist and be in the caller's scope, or
   * nothing changes (404 with the ids, as for assignment). Taking dialogs out
   * leaves their labels on the record.
   */
  async function changeMembership(req, res, direction) {
    notForAnnotators(req)
    assertMayLabel(req)

    const raw = req.body?.snippetIds
    if (!Array.isArray(raw) || raw.length === 0) throw badRequest('"snippetIds" must be a non-empty array')
    if (raw.length > ASSIGN_MAX) throw badRequest(`At most ${ASSIGN_MAX} snippets at a time`)
    if (raw.some((entry) => typeof entry !== 'string' || !entry)) {
      throw badRequest('"snippetIds" must be snippet ids')
    }
    const snippetIds = [...new Set(raw)]

    await ensureDefaultDataset(store)
    const dataset = await store.datasets.findById(req.params.datasetId)
    if (!dataset || (dataset.archived && !isResearcher(req))) throw notFound('No such dataset')
    if (dataset.archived && direction === 'add') {
      throw new ApiError(409, 'This dataset is archived — nothing can be added to it')
    }

    const scope = await sessionScope(req)
    const sessionIds = [...new Set(snippetIds.map(sessionOfSnippet))]
    if (sessionIds.some((sessionId) => !canRead(scope, sessionId))) throw notFound('No such snippet')

    const existing = new Set(
      (await Promise.all(sessionIds.map(async (sessionId) => buildSnippets(await store.messages.listBySession(sessionId)))))
        .flat()
        .map((snippet) => snippet.id),
    )
    const missing = snippetIds.filter((snippetId) => !existing.has(snippetId))
    if (missing.length) throw new ApiError(404, 'No such snippet', { snippetIds: missing })

    const change = direction === 'add' ? { add: [dataset.id] } : { remove: [dataset.id] }
    const records = await Promise.all(
      snippetIds.map((snippetId) => store.snippetLabels.changeDatasets(snippetId, change)),
    )

    res.json({
      datasetId: dataset.id,
      count: snippetIds.length,
      snippetIds,
      memberships: Object.fromEntries(
        records.map((record) => [
          record.snippetId,
          { datasetIds: datasetIdsOf(record), included: record.included ?? null },
        ]),
      ),
    })
  }

  router.post(
    '/datasets/:datasetId/snippets',
    route((req, res) => changeMembership(req, res, 'add')),
  )
  router.post(
    '/datasets/:datasetId/snippets/remove',
    route((req, res) => changeMembership(req, res, 'remove')),
  )

  /* ------------------------------------------- dialog selection, by student */

  /**
   * The sessions in the caller's scope — the ones `/sessions` would list —
   * with a row's worth of counts each. The student list and one student's
   * page both start here, so the two can never disagree about who is in reach.
   */
  async function sessionsInScope(req) {
    const scope = await sessionScope(req)
    const all = await store.sessions.list({ limit: 1000 })
    return scope.all ? all : all.filter((session) => canRead(scope, session.id))
  }

  /**
   * A student's name, where the caller may already see it on the roster: an
   * admin or the research token always; anyone else only for a student in
   * their own user scope. Otherwise `null`, and the screen says "signed-in
   * student", as the roster does.
   */
  async function studentNames(req, userIds) {
    if (!userIds.length) return new Map()
    let ids = userIds
    if (!isResearcher(req)) {
      const scope = await scopeOf(store, req.user)
      ids = scope.all ? userIds : userIds.filter((userId) => scope.ids.has(userId))
    }
    if (!ids.length) return new Map()
    const users = await store.users.list({ ids, limit: ids.length })
    return new Map(users.map((user) => [user.id, user.name]))
  }

  /** The student rows for these sessions: counts from their messages and label records. */
  async function studentRows(req, sessions, labels) {
    const perSession = new Map(
      await Promise.all(
        sessions.map(async (session) => {
          const messages = await store.messages.listBySession(session.id)
          const snippets = buildSnippets(messages)
          return [
            session.id,
            {
              dialogs: snippets.length,
              inDataset: snippets.filter((snippet) => datasetIdsOf(labels.get(snippet.id)).length).length,
              questions: [...new Set(snippets.map((snippet) => snippet.questionId))],
              lastAt: messages.at(-1)?.createdAt ?? null,
            },
          ]
        }),
      ),
    )
    const names = await studentNames(req, [
      ...new Set(sessions.filter((session) => session.userId && !session.staffPreview).map((session) => session.userId)),
    ])
    return groupByStudent(sessions, perSession, (userId) => names.get(userId) ?? null)
  }

  /**
   * Dialog selection, step one: the students whose work this caller can see,
   * with how many dialogs each has and how many of those are in a dataset.
   * The people who keep or drop snippets; never an annotator.
   */
  router.get(
    '/students',
    route(async (req, res) => {
      notForAnnotators(req)
      assertMayLabel(req)
      const [sessions, labels] = await Promise.all([sessionsInScope(req), store.snippetLabels.map()])
      res.json({ students: await studentRows(req, sessions, labels) })
    }),
  )

  /**
   * Step two: one student's dialogs, question by question — the question, what
   * they handed in, and each exchange with its datasets. `key` is a row's key
   * from the list (`u:<userId>` or `s:<sessionId>`); one out of scope is 404.
   */
  router.get(
    '/students/:key/dialogs',
    route(async (req, res) => {
      notForAnnotators(req)
      assertMayLabel(req)

      const key = String(req.params.key)
      const [all, labels] = await Promise.all([sessionsInScope(req), store.snippetLabels.map()])
      const sessions = all.filter((session) => studentKeyOf(session) === key)
      if (!sessions.length) throw notFound('No such student')

      const messages = (
        await Promise.all(sessions.map((session) => store.messages.listBySession(session.id)))
      ).flat()
      const snippets = await withContext(attachLabels(buildSnippets(messages), labels))

      const [student] = await studentRows(req, sessions, labels)
      const questions = dialogsByQuestion(
        snippets.map((snippet) => ({
          id: snippet.id,
          sessionId: snippet.sessionId,
          questionId: snippet.questionId,
          question: snippet.question,
          answer: snippet.answer,
          // Who wrote the reply is left out, as on the labelling screen.
          student: snippet.student,
          tutor: { text: snippet.tutor.text, label: snippet.tutor.label, at: snippet.tutor.at },
          rating: snippet.rating,
          turnIndex: snippet.turnIndex,
          included: snippet.included,
          datasetIds: snippet.datasetIds,
        })),
      )

      res.json({ student, questions })
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

      // One dataset's snippets, or — as before — every kept one.
      const datasetId = req.query.datasetId ? String(req.query.datasetId) : null
      if (datasetId) {
        await ensureDefaultDataset(store)
        if (!(await store.datasets.findById(datasetId))) throw notFound('No such dataset')
      }

      const labels = await store.snippetLabels.map()
      const snippets = withAnnotations(
        attachLabels(buildSnippets(await store.messages.listAll()), labels).filter(
          (snippet) =>
            snippet.included === true && (!datasetId || snippet.datasetIds.includes(datasetId)),
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
