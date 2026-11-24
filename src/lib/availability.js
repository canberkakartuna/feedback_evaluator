import { availabilityState } from '../../shared/activity.js'

/**
 * The date half of an activity's availability range, on the client.
 *
 * The teacher picks days with a native `<input type="date">`, which speaks
 * `YYYY-MM-DD` and nothing else; the API stores instants. These convert between
 * the two in the browser's own timezone — the start of the chosen first day and
 * the end of the chosen last day — so the last day a teacher picks is a day
 * students still have, all of it. What the instants mean (open, upcoming,
 * ended) is availabilityState in shared/activity.js, not here.
 *
 * Pure and free of React, so test/unit/ can import it under plain Node.
 */

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/

/** `'2026-11-30'` → a local Date at that day's start, or null. */
function localDay(value) {
  const match = DAY.exec(value ?? '')
  if (!match) return null
  const [, y, m, d] = match.map(Number)
  const date = new Date(y, m - 1, d)
  // new Date(2026, 1, 31) quietly becomes 3 March; a day that does not exist is no day.
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return null
  return date
}

/** A date input's value → the ISO instant `availableFrom` stores: 00:00:00.000 local. */
export function fromInputToIso(value) {
  const date = localDay(value)
  return date ? date.toISOString() : null
}

/** A date input's value → the ISO instant `availableUntil` stores: 23:59:59.999 local. */
export function untilInputToIso(value) {
  const date = localDay(value)
  if (!date) return null
  date.setHours(23, 59, 59, 999)
  return date.toISOString()
}

/**
 * An ISO instant → the `YYYY-MM-DD` a date input shows, from the local date
 * parts. `toISOString().slice(0, 10)` would be the UTC day, which is the day
 * before for anyone east of Greenwich looking at a start of day.
 */
export function isoToInput(iso) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/**
 * "30 Nov 2026" / "30 Kas 2026" — the day as the reader's language writes it.
 * English is the British form, day first, like the rest of the interface's
 * spelling; plain `en` would give the American "Nov 30, 2026".
 */
export function formatDay(iso, lang) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(lang === 'en' ? 'en-GB' : lang, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/**
 * Where an activity stands for a teacher: `draft` first, whatever its dates
 * say, then the availability state of a published one — `open`, `upcoming`
 * or `ended`. Older activities may lack both date keys; they read as open.
 */
export function liveState(activity, now = Date.now()) {
  if (activity?.status !== 'published') return 'draft'
  return availabilityState(
    { availableFrom: activity.availableFrom ?? null, availableUntil: activity.availableUntil ?? null },
    now,
  )
}

/**
 * The translated sentence for a refusal the server gave because a published
 * activity is outside its dates (`assertWithinAvailability` in
 * server/services/delivery.js), or null for any other failure — the caller
 * then shows that failure the way it always has. `t` and `lang` are passed in
 * so this stays free of React.
 */
export function availabilityRefusal(failure, t, lang) {
  const details = failure?.details
  if (details?.code === 'activity_not_started') {
    return details.availableFrom
      ? t('availability.refusedNotStarted', { date: formatDay(details.availableFrom, lang) })
      : t('availability.refusedNotStartedNoDate')
  }
  if (details?.code === 'activity_ended') {
    return details.availableUntil
      ? t('availability.refusedEnded', { date: formatDay(details.availableUntil, lang) })
      : t('availability.refusedEndedNoDate')
  }
  return null
}
