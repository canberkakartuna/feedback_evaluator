import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  availabilityRefusal,
  formatDay,
  fromInputToIso,
  isSavableDay,
  isoToInput,
  liveState,
  untilInputToIso,
} from '../../src/lib/availability.js'

/**
 * The date input ↔ stored instant conversions in src/lib/availability.js.
 *
 * Availability dates are days in Turkey time (AVAILABILITY_TIME_ZONE in
 * shared/activity.js) for everyone. The runtime is pinned to London here on
 * purpose — the zone of the teacher whose 1 December showed as 2 December in
 * Istanbul — so every result below must be the Istanbul one, not the local
 * one. Node reads TZ on change, and node --test runs each file in its own
 * process, so this stays here.
 */
process.env.TZ = 'Europe/London'

test('the runtime really is London, an hour or none from UTC', () => {
  assert.equal(new Date('2026-12-01T12:00:00Z').getHours(), 12)
  assert.equal(new Date('2026-07-01T12:00:00Z').getHours(), 13)
})

test('a from-date is 00:00 of that day in Istanbul, not in London', () => {
  assert.equal(fromInputToIso('2026-12-01'), '2026-11-30T21:00:00.000Z')
  // Summer: London is on BST, Istanbul is still +03:00.
  assert.equal(fromInputToIso('2026-07-01'), '2026-06-30T21:00:00.000Z')
})

test('an until-date is 23:59:59.999 of that day in Istanbul, so the last day is inclusive', () => {
  assert.equal(untilInputToIso('2026-12-01'), '2026-12-01T20:59:59.999Z')
  // One millisecond later is the next Istanbul day.
  assert.equal(isoToInput(new Date(Date.parse('2026-12-01T20:59:59.999Z') + 1).toISOString()), '2026-12-02')
})

test('the offset is read from the zone, not assumed: Istanbul was +02:00 in winter 2010', () => {
  assert.equal(fromInputToIso('2010-01-15'), '2010-01-14T22:00:00.000Z')
  assert.equal(fromInputToIso('2010-07-15'), '2010-07-14T21:00:00.000Z')
  assert.equal(untilInputToIso('2010-01-15'), '2010-01-15T21:59:59.999Z')
})

test('both conversions round-trip through the input value', () => {
  for (const day of ['2026-12-01', '2026-11-30', '2026-01-01', '2026-03-29', '2026-10-25', '2026-12-31', '2028-02-29', '2000-01-01', '2100-12-31']) {
    assert.equal(isoToInput(fromInputToIso(day)), day)
    assert.equal(isoToInput(untilInputToIso(day)), day)
  }
})

test('isoToInput is the Istanbul day, not the London or UTC one', () => {
  // 00:30 on 1 Dec in Istanbul is 21:30 on 30 Nov in London and UTC.
  assert.equal(isoToInput('2026-11-30T21:30:00.000Z'), '2026-12-01')
  // The instant a London teacher stored before the fix: 23:59 on 1 Dec London
  // is 02:59 on 2 Dec in Istanbul, and that is what it now reads as.
  assert.equal(isoToInput('2026-12-01T23:59:59.999Z'), '2026-12-02')
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

test('isSavableDay: a whole real day from 2000 to 2100, not a year still being typed', () => {
  for (const day of ['2026-11-30', '2000-01-01', '2100-12-31', '2028-02-29']) assert.equal(isSavableDay(day), true, day)
  for (const day of ['', '0002-11-30', '0020-11-30', '0202-11-30', '1999-12-31', '2101-01-01', '2026-02-31', '2026-11', null]) {
    assert.equal(isSavableDay(day), false, String(day))
  }
})

test('formatDay writes the Istanbul day in the reader’s language', () => {
  const iso = untilInputToIso('2026-12-01')
  assert.equal(formatDay(iso, 'en'), '1 Dec 2026')
  assert.equal(formatDay(iso, 'tr'), '1 Ara 2026')
  // The legacy London-saved end shows as the day it is in Istanbul.
  assert.equal(formatDay('2026-12-01T23:59:59.999Z', 'en'), '2 Dec 2026')
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
