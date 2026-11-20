import {
  DATASET_DESCRIPTION_MAX,
  DATASET_NAME_MAX,
  DEFAULT_DATASET_ID,
  DEFAULT_DATASET_NAME,
} from '../../shared/datasets.js'
import { badRequest } from '../lib/http.js'

/**
 * Datasets on the server: what one is made of, the default one every existing
 * kept snippet belongs to, and how staff browse dialogs by student to fill
 * them. The membership rules themselves are in shared/datasets.js.
 */

/** The default dataset as first written. `createdAt` sorts it ahead of any an admin makes. */
export const defaultDatasetDoc = () => ({
  id: DEFAULT_DATASET_ID,
  name: DEFAULT_DATASET_NAME,
  description: '',
  isDefault: true,
  archived: false,
  archivedAt: null,
  memberIds: [],
  createdAt: '1970-01-01T00:00:00.000Z',
  createdBy: null,
  updatedAt: null,
})

/**
 * Makes sure the default dataset exists, once per store per process. It is
 * inserted only when missing (store `datasets.ensure`), so running this again —
 * another instance, a restart — changes nothing, and never undoes a rename.
 * A failure is not remembered, so the next request tries again.
 */
const ensured = new WeakMap()
export function ensureDefaultDataset(store) {
  if (!ensured.has(store)) {
    ensured.set(
      store,
      store.datasets.ensure(defaultDatasetDoc()).catch((error) => {
        ensured.delete(store)
        throw error
      }),
    )
  }
  return ensured.get(store)
}

/**
 * A dataset's name and description from a request body. `partial` for an
 * edit, where either may be left out; a name, when given, is never blank.
 */
export function parseDatasetInput(body, { partial = false } = {}) {
  const out = {}

  if (body?.name !== undefined || !partial) {
    const name = body?.name
    if (typeof name !== 'string' || !name.trim()) throw badRequest('"name" is required')
    if (name.trim().length > DATASET_NAME_MAX) {
      throw badRequest(`"name" must be at most ${DATASET_NAME_MAX} characters`)
    }
    out.name = name.trim()
  }

  if (body?.description !== undefined) {
    const description = body.description ?? ''
    if (typeof description !== 'string') throw badRequest('"description" must be text')
    if (description.length > DATASET_DESCRIPTION_MAX) {
      throw badRequest(`"description" must be at most ${DATASET_DESCRIPTION_MAX} characters`)
    }
    out.description = description.trim()
  } else if (!partial) {
    out.description = ''
  }

  return out
}

/** Two datasets may not share a name, ignoring case and surrounding space. */
export const sameName = (a, b) => a.trim().toLowerCase() === b.trim().toLowerCase()

/* ------------------------------------------------------- browsing by student */

/**
 * Who a session belongs to, for the selection screen's student list.
 *
 * A signed-in student is one person across every session they have started,
 * so their sessions are grouped under `u:<userId>`. An anonymous session has
 * nothing to tie it to another — it is its own "student", `s:<sessionId>`, as
 * it is its own row on the roster. So is a staff walkthrough recorded before
 * staff stopped being able to start sessions: it is nobody's work, and is
 * shown as what it is rather than merged into a person.
 */
export function studentKeyOf(session) {
  if (session.userId && !session.staffPreview) return `u:${session.userId}`
  return `s:${session.id}`
}

/**
 * One row per student from their sessions and what each produced.
 *
 * `sessions` are the sessions in the caller's scope; `perSession` maps a
 * session id to `{ dialogs, inDataset, questions, lastAt }` (counts, the
 * question ids that had a dialog, and when its last message was written); `nameOf(userId)` is the student's name when the
 * caller may see it, otherwise `null` — the same rule the roster follows.
 * Most recently active first.
 */
export function groupByStudent(sessions, perSession, nameOf = () => null) {
  const rows = new Map()

  for (const session of sessions) {
    const key = studentKeyOf(session)
    const counts = perSession.get(session.id) ?? { dialogs: 0, inDataset: 0, questions: [] }

    if (!rows.has(key)) {
      const account = key.startsWith('u:')
      rows.set(key, {
        key,
        kind: session.staffPreview ? 'preview' : account ? 'account' : 'anonymous',
        userId: account ? session.userId : null,
        name: account ? nameOf(session.userId) : null,
        nickname: account ? null : (session.nickname ?? null),
        code: account ? null : (session.code ?? null),
        consentWithdrawn: false,
        sessionCount: 0,
        dialogCount: 0,
        inDatasetCount: 0,
        questionCount: 0,
        activityIds: [],
        lastAt: null,
        _questions: new Set(),
      })
    }

    const row = rows.get(key)
    row.sessionCount += 1
    row.dialogCount += counts.dialogs
    row.inDatasetCount += counts.inDataset
    for (const questionId of counts.questions) row._questions.add(`${session.id}:${questionId}`)
    if (session.activityId && !row.activityIds.includes(session.activityId)) {
      row.activityIds.push(session.activityId)
    }
    if (session.consent?.withdrawnAt) row.consentWithdrawn = true
    const at = counts.lastAt ?? session.createdAt ?? null
    if (at && (!row.lastAt || at > row.lastAt)) row.lastAt = at
  }

  return [...rows.values()]
    .map(({ _questions, ...row }) => ({ ...row, questionCount: _questions.size }))
    .sort((a, b) => String(b.lastAt ?? '').localeCompare(String(a.lastAt ?? '')) || a.key.localeCompare(b.key))
}

/**
 * A student's dialogs, grouped by question: one group per session and
 * question, in the order the questions were first talked about, each holding
 * its dialogs in the order they happened. `snippets` carry their context
 * (`question`, `answer`) as the research routes attach it.
 */
export function dialogsByQuestion(snippets) {
  const groups = new Map()

  for (const snippet of snippets) {
    const key = `${snippet.sessionId}:${snippet.questionId}`
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        sessionId: snippet.sessionId,
        questionId: snippet.questionId,
        question: snippet.question ?? null,
        answer: snippet.answer ?? null,
        firstAt: snippet.student?.at ?? null,
        dialogs: [],
      })
    }
    const { question: _question, answer: _answer, ...dialog } = snippet
    groups.get(key).dialogs.push(dialog)
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      dialogs: group.dialogs.sort((a, b) => String(a.student?.at ?? '').localeCompare(String(b.student?.at ?? ''))),
    }))
    .sort((a, b) => String(a.firstAt ?? '').localeCompare(String(b.firstAt ?? '')))
}
