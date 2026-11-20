import { datasetIdsOf } from './datasets.js'

/**
 * Deleting entries from the Student work page (one entry = one session).
 *
 * The rules both sides need: who may delete, how many ids one request takes,
 * and which of a session's label records are **research data** — the ones that
 * stop a session being deleted unless an admin forces it.
 *
 * Shared because the client shows the same limits the server enforces. The
 * server is where they hold (routes/research.js).
 */

/** Ids per request. The Student work list shows at most 100 rows, so "select all" fits. */
export const DELETE_SESSIONS_MAX = 100

/** Who may delete sessions at all — each within the sessions they can already see. */
export const SESSION_DELETER_ROLES = ['teacher', 'manager', 'admin']

export const canDeleteSessions = (user) => SESSION_DELETER_ROLES.includes(user?.role)

/** Deleting a session whose dialogs are research data. Admin only, and only when asked for. */
export const canForceDeleteSessions = (user) => user?.role === 'admin'

/** Any value in a `{ key: value }` map that says something. */
const saysSomething = (map) =>
  Boolean(map) &&
  typeof map === 'object' &&
  Object.values(map).some((value) => value != null && String(value).trim() !== '')

/**
 * Whether one label record is research data: its dialog is in a dataset
 * (including a pre-dataset "kept" record, read as the default dataset), or
 * somebody has labelled it — staff labels, a per-criterion reason, the old
 * single note, or any annotator's own entry.
 *
 * Not research data: a record that only says the dialog was dropped
 * (`included: false`), or only who it is assigned to. Those describe a
 * decision about the dialog, not a measurement of it, and go with the session.
 */
export function isResearchRecord(label) {
  if (!label) return false
  if (datasetIdsOf(label).length > 0) return true
  if (saysSomething(label.labels) || saysSomething(label.notes)) return true
  if (typeof label.note === 'string' && label.note.trim()) return true

  return Object.values(label.annotations ?? {}).some(
    (entry) =>
      saysSomething(entry?.labels) ||
      saysSomething(entry?.notes) ||
      (typeof entry?.note === 'string' && entry.note.trim() !== ''),
  )
}

/** How many of a session's label records are research data. */
export const researchRecordCount = (labels) => (labels ?? []).filter(isResearchRecord).length

/**
 * The session ids from a request body: `{ sessionIds: [...] }`, 1 to
 * DELETE_SESSIONS_MAX non-empty strings, duplicates dropped in order.
 * Answers `{ ids }` or `{ error }` — the route turns an error into a 400.
 */
export function parseSessionIds(value) {
  if (!Array.isArray(value)) return { error: '"sessionIds" must be an array of session ids' }
  if (value.length === 0) return { error: '"sessionIds" must name at least one session' }
  if (value.some((entry) => typeof entry !== 'string' || !entry.trim())) {
    return { error: '"sessionIds" must be session id strings' }
  }

  const ids = [...new Set(value.map((entry) => entry.trim()))]
  if (ids.length > DELETE_SESSIONS_MAX) {
    return { error: `At most ${DELETE_SESSIONS_MAX} sessions per request` }
  }
  return { ids }
}
