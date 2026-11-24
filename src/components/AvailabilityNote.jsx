import { availabilityState, daysLeft } from '../../shared/activity'
import { formatDay } from '../lib/availability'
import { useI18n } from '../lib/i18n'
import './AvailabilityNote.css'

/** Days left at or under which the end date is worth a warning. */
const SOON = 3

/**
 * What an activity's availability range means right now, in one line.
 *
 *   open, with an end date   "Available until 30 Nov 2026 · 6 days left" / "· last day"
 *   upcoming                 "Opens on 1 Dec 2026"   (teachers only)
 *   ended                    "Ended on 20 Nov 2026"  (teachers only)
 *
 * and nothing otherwise — no dates, or open with only a start date, reads
 * exactly as an activity always has. A student is never shown an upcoming or
 * ended activity (the server leaves them out of the list and refuses their
 * code), so with `audience="student"` only the first form can appear.
 *
 * Status is not read: a draft is closed whatever its dates say, and the
 * screens that show drafts say so themselves.
 *
 * `variant="note"` is a console notice (`.cs-note`) for a screen with room;
 * `variant="inline"` is one small line for a tile, a list entry or the
 * workspace header, and is phrasing content so it can sit inside a button.
 */
export default function AvailabilityNote({
  activity,
  audience = 'teacher',
  variant = 'note',
  className = '',
  style,
  now = Date.now(),
}) {
  const { lang, t } = useI18n()

  const range = {
    availableFrom: activity?.availableFrom ?? null,
    availableUntil: activity?.availableUntil ?? null,
  }
  const state = availabilityState(range, now)

  let text = null
  let tone = null

  if (state === 'open' && range.availableUntil) {
    const days = daysLeft(range.availableUntil, now)
    const date = formatDay(range.availableUntil, lang)
    text =
      days <= 0
        ? t('availability.untilLastDay', { date })
        : t('availability.untilDays', { date, count: days })
    if (days <= SOON) tone = 'warn'
  } else if (audience === 'teacher' && state === 'upcoming') {
    text = t('availability.opensOn', { date: formatDay(range.availableFrom, lang) })
  } else if (audience === 'teacher' && state === 'ended') {
    text = t('availability.endedOn', { date: formatDay(range.availableUntil, lang) })
    tone = 'bad'
  }

  if (!text) return null

  if (variant === 'inline') {
    return (
      <span className={`av-inline ${className}`.trim()} data-tone={tone ?? undefined} style={style}>
        {text}
      </span>
    )
  }

  return (
    <p
      className={`cs-note ${className}`.trim()}
      data-tone={tone ?? undefined}
      role="status"
      style={style}
    >
      {text}
    </p>
  )
}
