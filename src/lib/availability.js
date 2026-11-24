import {
  AVAILABILITY_TIME_ZONE,
  availabilityDay,
  availabilityInstant,
  availabilityState,
} from '../../shared/activity.js'

/**
 * The date half of an activity's availability range, on the client.
 *
 * The teacher picks days with a native `<input type="date">`, which speaks
 * `YYYY-MM-DD` and nothing else; the API stores instants. These convert between
 * the two as days in AVAILABILITY_TIME_ZONE (Turkey time, shared/activity.js) —
 * the start of the chosen first day and the end of the chosen last day there —
 * never in the browser's own zone. A teacher abroad picking 1 December stores
 * the same instant as one in Istanbul, and every reader sees 1 December. What
 * the instants mean (open, upcoming, ended) is availabilityState, not here.
 *
 * Pure and free of React, so test/unit/ can import it under plain Node.
 */

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/

/** `'2026-11-30'` → `{ year, month, day }` (month 1–12), or null for anything that is not a real day. */
function parseDay(value) {
  const match = DAY.exec(value ?? '')
  if (!match) return null
  const [year, month, day] = match.slice(1).map(Number)
  // 31 February would quietly become 3 March; a day that does not exist is no day.
  const check = new Date(Date.UTC(year, month - 1, day))
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
    return null
  }
  return { year, month, day }
}

/**
 * Whether a date input's value is a whole day worth saving: a real day in a
 * year from 2000 to 2100, the range the server accepts. Typing a year digit by
 * digit makes some browsers report 0002, 0020 and 0202 on the way to 2026, and
 * each of those is a real day; this is what keeps them from being sent.
 */
export function isSavableDay(value) {
  const day = parseDay(value)
  return Boolean(day) && day.year >= 2000 && day.year <= 2100
}

/** A date input's value → the ISO instant `availableFrom` stores: 00:00:00.000 of that day in Turkey. */
export function fromInputToIso(value) {
  const day = parseDay(value)
  return day ? availabilityInstant(day.year, day.month, day.day).toISOString() : null
}

/** A date input's value → the ISO instant `availableUntil` stores: 23:59:59.999 of that day in Turkey. */
export function untilInputToIso(value) {
  const day = parseDay(value)
  return day ? availabilityInstant(day.year, day.month, day.day, 23, 59, 59, 999).toISOString() : null
}

/**
 * An ISO instant → the `YYYY-MM-DD` a date input shows: its calendar day in
 * Turkey, whatever the browser's zone. Also what the inputs' min/max are.
 */
export function isoToInput(iso) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const { year, month, day } = availabilityDay(date)
  const pad = (n) => String(n).padStart(2, '0')
  return `${year}-${pad(month)}-${pad(day)}`
}

/**
 * "30 Nov 2026" / "30 Kas 2026" — the instant's day in Turkey, as the reader's
 * language writes it. English is the British form, day first, like the rest of
 * the interface's spelling; plain `en` would give the American "Nov 30, 2026".
 */
export function formatDay(iso, lang) {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(lang === 'en' ? 'en-GB' : lang, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: AVAILABILITY_TIME_ZONE,
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
