import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  availabilityRefusal,
  formatDay,
  fromInputToIso,
  isoToInput,
  liveState,
  untilInputToIso,
} from '../../src/lib/availability.js'

/**
 * The date input ↔ stored instant conversions in src/lib/availability.js.
 *
 * Pinned to a zone east of Greenwich, where the bug these exist to avoid shows:
 * the start of a local day is the previous day in UTC, so reading the date
 * back with toISOString().slice(0, 10) would be off by one. Node reads TZ on
 * change, and node --test runs each file in its own process, so this stays here.
 */
process.env.TZ = 'Europe/Istanbul' // UTC+3, no daylight saving

test('a from-date is the start of that local day', () => {
  assert.equal(fromInputToIso('2026-11-30'), '2026-11-29T21:00:00.000Z')
})

test('an until-date is the end of that local day, so the last day is inclusive', () => {
  const iso = untilInputToIso('2026-11-30')
  assert.equal(iso, '2026-11-30T20:59:59.999Z')
  const end = new Date(iso)
  assert.equal(end.getDate(), 30)
  assert.equal(end.getHours(), 23)
  assert.equal(end.getMinutes(), 59)
  assert.equal(end.getMilliseconds(), 999)
  // One millisecond later is the next local day.
  assert.equal(new Date(end.getTime() + 1).getDate(), 1)
})

test('both conversions round-trip through the input value', () => {
  for (const day of ['2026-11-30', '2026-01-01', '2026-12-31', '2028-02-29']) {
    assert.equal(isoToInput(fromInputToIso(day)), day)
    assert.equal(isoToInput(untilInputToIso(day)), day)
  }
})

test('isoToInput uses the local date, not the UTC one', () => {
  // 00:30 on 1 Dec in Istanbul is still 30 Nov in UTC.
  assert.equal(isoToInput('2026-11-30T21:30:00.000Z'), '2026-12-01')
})

test('empty and null read as no date', () => {
  assert.equal(fromInputToIso(''), null)
  assert.equal(untilInputToIso(''), null)
  assert.equal(fromInputToIso(undefined), null)
  assert.equal(isoToInput(null), '')
  assert.equal(isoToInput(undefined), '')
  assert.equal(isoToInput('not a date'), '')
  assert.equal(formatDay(null, 'en'), '')
})

test('a value that is not a real day is no date', () => {
  assert.equal(fromInputToIso('2026-02-31'), null)
  assert.equal(untilInputToIso('30/11/2026'), null)
})

test('formatDay writes the day in the reader’s language', () => {
  const iso = untilInputToIso('2026-11-30')
  assert.match(formatDay(iso, 'en'), /^30 Nov 2026$/)
  assert.match(formatDay(iso, 'tr'), /^30 Kas 2026$/)
})

test('liveState: draft wins, then the dates; missing keys read as open', () => {
  const now = new Date(2026, 10, 24, 12)
  const past = fromInputToIso('2026-11-20')
  const future = fromInputToIso('2026-12-01')
  assert.equal(liveState({ status: 'draft', availableFrom: past }, now), 'draft')
  assert.equal(liveState({ status: 'published' }, now), 'open')
  assert.equal(liveState({ status: 'published', availableFrom: future }, now), 'upcoming')
  assert.equal(liveState({ status: 'published', availableUntil: untilInputToIso('2026-11-23') }, now), 'ended')
  assert.equal(liveState({ status: 'published', availableUntil: untilInputToIso('2026-11-24') }, now), 'open')
})

test('availabilityRefusal translates the two date refusals and nothing else', () => {
  const t = (key, vars) => (vars ? `${key}|${vars.date}` : key)
  const from = fromInputToIso('2026-12-01')
  const until = untilInputToIso('2026-11-20')

  assert.equal(
    availabilityRefusal({ details: { code: 'activity_not_started', availableFrom: from } }, t, 'en'),
    'availability.refusedNotStarted|1 Dec 2026',
  )
  assert.equal(
    availabilityRefusal({ details: { code: 'activity_ended', availableUntil: until } }, t, 'en'),
    'availability.refusedEnded|20 Nov 2026',
  )
  assert.equal(
    availabilityRefusal({ details: { code: 'activity_not_started', availableFrom: null } }, t, 'en'),
    'availability.refusedNotStartedNoDate',
  )
  assert.equal(
    availabilityRefusal({ details: { code: 'activity_ended', availableUntil: null } }, t, 'en'),
    'availability.refusedEndedNoDate',
  )
  // The draft refusal carries no details; anything else is left to the caller.
  assert.equal(availabilityRefusal({ message: 'That activity is not open yet' }, t, 'en'), null)
  assert.equal(availabilityRefusal({ details: { hint: 'x' } }, t, 'en'), null)
  assert.equal(availabilityRefusal(null, t, 'en'), null)
})
