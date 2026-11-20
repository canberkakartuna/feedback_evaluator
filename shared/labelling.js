/**
 * How far one labeller has got with one sample (snippet), and with a set of
 * them — the rule behind the one-sample-at-a-time labelling screen
 * (src/routes/teacher/Labelling.jsx).
 *
 * Worked out from the labels the screen already has: for staff, the snippet's
 * `labels` / `notes`; for an annotator, the same fields, which the server fills
 * from that annotator's own entry and nobody else's (`forAnnotator` in
 * server/routes/research.js). So the same rule gives each person their own
 * progress without a new field in any payload.
 *
 * - **complete** — every criterion has a rating. The "why" box is optional
 *   today (nothing asks for it before or after a rating), so it is not
 *   required here either.
 * - **incomplete** — something was entered (a rating or a "why" note on at
 *   least one criterion) but not every criterion is rated.
 * - **notStarted** — nothing at all.
 *
 * Only the criteria passed in count: a rating left over for a criterion that
 * is no longer asked about neither completes a sample nor starts one.
 */

export const LABEL_STATUSES = ['complete', 'incomplete', 'notStarted']

const idsOf = (criteria) =>
  (criteria ?? []).map((criterion) => (typeof criterion === 'string' ? criterion : criterion?.id)).filter(Boolean)

const filled = (value) => typeof value === 'string' && value.trim() !== ''

/** `complete`, `incomplete` or `notStarted` for one snippet against the criteria. */
export function labelStatus(snippet, criteria) {
  const ids = idsOf(criteria)
  if (!ids.length) return 'notStarted'
  const labels = snippet?.labels ?? {}
  const notes = snippet?.notes ?? {}

  const rated = ids.filter((id) => filled(labels[id])).length
  if (rated === ids.length) return 'complete'
  if (rated > 0 || ids.some((id) => filled(notes[id]))) return 'incomplete'
  return 'notStarted'
}

/** Counts per status, for the summary line. */
export function summarizeStatuses(statuses) {
  const counts = { complete: 0, incomplete: 0, notStarted: 0 }
  for (const status of statuses ?? []) {
    if (status in counts) counts[status] += 1
  }
  return counts
}

/**
 * Where to open a set: the first sample that is not complete, or the first
 * sample when every one is (or `-1` for an empty set).
 */
export function resumeIndex(statuses) {
  const list = statuses ?? []
  if (!list.length) return -1
  const open = list.findIndex((status) => status !== 'complete')
  return open === -1 ? 0 : open
}

/**
 * The next sample after `from` that is not complete, wrapping round to the
 * start; `-1` when there is none other than `from` itself.
 */
export function nextIncompleteIndex(statuses, from) {
  const list = statuses ?? []
  for (let step = 1; step < list.length; step += 1) {
    const index = (from + step) % list.length
    if (list[index] !== 'complete') return index
  }
  return -1
}

/**
 * A sample counts as **skipped** when the labeller has had it open and moved
 * on while it was not complete. "Had it open" is the set of sample ids the
 * screen remembers per labeller and dataset; the one on screen now is never
 * skipped — they are on it.
 */
export function isSkipped(status, { visited, current } = {}) {
  return status !== 'complete' && Boolean(visited) && !current
}
