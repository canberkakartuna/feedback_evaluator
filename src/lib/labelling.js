/**
 * Client helpers for stepping through a labelling set one sample at a time
 * (src/routes/teacher/Labelling.jsx). The rules about what counts as complete
 * live in shared/labelling.js; these are the URL and the browser's memory.
 */

/** The URL parameter that holds the sample on screen, 1-based, or `done`. */
export const SAMPLE_PARAM = 'sample'

/** The value of `?sample=` that means "past the last one": the end summary. */
export const END = 'done'

/**
 * The sample a `?sample=` value points at, for a set of `count`: a 0-based
 * index, `'end'` for the end summary, or `null` when there is no usable value
 * (missing, not a number, out of range) and the screen should pick one itself.
 */
export function sampleFromParam(value, count) {
  if (!count || value == null || value === '') return null
  if (value === END) return 'end'
  if (!/^\d+$/.test(value)) return null
  const index = Number(value) - 1
  return index >= 0 && index < count ? index : null
}

/** The `?sample=` value for a 0-based index, or `'end'`. */
export const paramForSample = (position) => (position === 'end' ? END : String(position + 1))

/** Where the samples a labeller has opened are remembered, per browser. */
export const VISITED_PREFIX = 'feedback-evaluator.labellingVisited'

/**
 * One labeller's set in one dataset (or an annotator's directly assigned
 * list, `individual`). The user id keeps two people sharing a browser apart.
 */
export const visitedKey = (userId, setKey) => `${VISITED_PREFIX}.${userId ?? 'anon'}.${setKey || 'individual'}`

/** The ids remembered as opened, as a Set; empty when storage is unavailable. */
export function recallVisited(key) {
  try {
    const raw = localStorage.getItem(key)
    const ids = raw ? JSON.parse(raw) : []
    return new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === 'string') : [])
  } catch {
    return new Set()
  }
}

export function rememberVisited(key, ids) {
  try {
    localStorage.setItem(key, JSON.stringify([...ids]))
  } catch {
    // Private browsing or full storage: "skipped" lasts for this visit only.
  }
}
