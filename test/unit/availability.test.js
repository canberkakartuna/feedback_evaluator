import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AVAILABILITY_TIME_ZONE,
  availabilityDay,
  availabilityInstant,
  availabilityState,
  daysLeft,
} from '../../shared/activity.js'

/**
 * availabilityState compares instants, so any zone does for it. daysLeft
 * counts calendar days in Turkey time (AVAILABILITY_TIME_ZONE), whatever the
 * runtime's zone: the clock is pinned to New York, which has daylight saving
 * and is seven or eight hours behind Istanbul, so a result that leaked the
 * local zone would show. Node reads TZ on change, and node --test runs each
 * file in its own process, so this stays here.
 */
process.env.TZ = 'America/New_York'

/** A local wall-clock time in that zone. */
const at = (y, m, d, h = 0, min = 0, s = 0, ms = 0) => new Date(y, m - 1, d, h, min, s, ms)

const NOW = at(2026, 11, 24, 12)
const BEFORE = at(2026, 11, 20).toISOString()
const AFTER = at(2026, 11, 28).toISOString()

/* --------------------------------------------------------- availabilityState */

test('no dates is open', () => {
  assert.equal(availabilityState({}, NOW), 'open')
  assert.equal(availabilityState({ availableFrom: null, availableUntil: null }, NOW), 'open')
  assert.equal(availabilityState({ availableFrom: undefined, availableUntil: undefined }, NOW), 'open')
})

test('from only: upcoming before it, open after it', () => {
  assert.equal(availabilityState({ availableFrom: AFTER }, NOW), 'upcoming')
  assert.equal(availabilityState({ availableFrom: BEFORE }, NOW), 'open')
})

test('until only: open before it, ended after it', () => {
  assert.equal(availabilityState({ availableUntil: AFTER }, NOW), 'open')
  assert.equal(availabilityState({ availableUntil: BEFORE }, NOW), 'ended')
})

test('both: upcoming, open and ended', () => {
  const range = { availableFrom: at(2026, 11, 22).toISOString(), availableUntil: at(2026, 11, 26).toISOString() }
  assert.equal(availabilityState(range, at(2026, 11, 21)), 'upcoming')
  assert.equal(availabilityState(range, NOW), 'open')
  assert.equal(availabilityState(range, at(2026, 11, 27)), 'ended')
})

test('the boundary instants themselves are open', () => {
  const from = at(2026, 11, 22)
  const until = at(2026, 11, 26, 23, 59, 59, 999)
  const range = { availableFrom: from.toISOString(), availableUntil: until.toISOString() }
  assert.equal(availabilityState(range, from), 'open')
  assert.equal(availabilityState(range, until), 'open')
  assert.equal(availabilityState(range, from.getTime() - 1), 'upcoming')
  assert.equal(availabilityState(range, until.getTime() + 1), 'ended')
})

test('now may be a number or a Date, and status is ignored', () => {
  const activity = { status: 'draft', availableUntil: BEFORE }
  assert.equal(availabilityState(activity, NOW), 'ended')
  assert.equal(availabilityState(activity, NOW.getTime()), 'ended')
  assert.equal(availabilityState({ status: 'draft' }, NOW), 'open')
})

test('defaults now to the current time', () => {
  assert.equal(availabilityState({ availableFrom: new Date(Date.now() + 60_000).toISOString() }), 'upcoming')
  assert.equal(availabilityState({ availableUntil: new Date(Date.now() - 60_000).toISOString() }), 'ended')
})

/* ------------------------------------------------------------------ daysLeft */

test('daysLeft is null without an end date', () => {
  assert.equal(daysLeft(null, NOW), null)
  assert.equal(daysLeft(undefined, NOW), null)
  assert.equal(daysLeft('', NOW), null)
})

test('the zone is Turkey time', () => {
  assert.equal(AVAILABILITY_TIME_ZONE, 'Europe/Istanbul')
})

/** The end of 1 December 2026 in Istanbul, as the editor stores it. */
const END_1_DEC = '2026-12-01T20:59:59.999Z'

test('daysLeft counts Istanbul calendar days, not New York ones', () => {
  // 23:59 on 30 Nov in Istanbul: one day left. 00:01 on 1 Dec: the last day.
  assert.equal(daysLeft(END_1_DEC, Date.parse('2026-11-30T20:59:00Z')), 1)
  assert.equal(daysLeft(END_1_DEC, Date.parse('2026-11-30T21:01:00Z')), 0)
  // Both of those are still 30 Nov in New York, where a local count would say 1 twice.
  assert.equal(new Date('2026-11-30T21:01:00Z').getDate(), 30)
  assert.equal(daysLeft(END_1_DEC, new Date('2026-12-01T20:59:59.999Z')), 0)
  assert.equal(daysLeft(END_1_DEC, Date.parse('2026-12-01T21:00:00Z')), -1)
  assert.equal(daysLeft(END_1_DEC, Date.parse('2026-11-25T09:00:00Z')), 6)
})

test('the end instant a London teacher stored before the fix counts to 2 December', () => {
  // 23:59:59.999 on 1 Dec in London is 02:59 on 2 Dec in Istanbul.
  assert.deepEqual(availabilityDay('2026-12-01T23:59:59.999Z'), { year: 2026, month: 12, day: 2 })
  assert.equal(daysLeft('2026-12-01T23:59:59.999Z', Date.parse('2026-12-01T12:00:00Z')), 1)
})

test('availabilityInstant and availabilityDay agree with Intl across 2000–2100', () => {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', dateStyle: 'short', timeStyle: 'medium', hourCycle: 'h23' })
  for (let year = 2000; year <= 2100; year += 1) {
    for (const [month, day] of [[1, 15], [3, 31], [7, 1], [10, 31]]) {
      const start = availabilityInstant(year, month, day)
      const end = availabilityInstant(year, month, day, 23, 59, 59, 999)
      const pad = (n) => String(n).padStart(2, '0')
      assert.equal(fmt.format(start), `${year}-${pad(month)}-${pad(day)}, 00:00:00`, `${year}-${month}-${day} start`)
      assert.equal(fmt.format(end), `${year}-${pad(month)}-${pad(day)}, 23:59:59`, `${year}-${month}-${day} end`)
      assert.equal(end.getTime() - start.getTime() + 1 >= 23 * 3_600_000, true)
      assert.deepEqual(availabilityDay(end), { year, month, day })
    }
  }
})

test('daysLeft is the same whatever the runtime clock change does', () => {
  // New York's spring-forward (8 Mar 2026) and fall-back (1 Nov 2026) days.
  assert.equal(daysLeft(availabilityInstant(2026, 3, 9, 23, 59, 59, 999).toISOString(), availabilityInstant(2026, 3, 7, 12)), 2)
  assert.equal(daysLeft(availabilityInstant(2026, 11, 2, 23, 59, 59, 999).toISOString(), availabilityInstant(2026, 10, 31, 12)), 2)
})
