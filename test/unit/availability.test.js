import { test } from 'node:test'
import assert from 'node:assert/strict'
import { availabilityState, daysLeft } from '../../shared/activity.js'

/**
 * daysLeft counts calendar days in the runtime's timezone, so the clock is
 * pinned to one with daylight saving: the results below do not depend on the
 * machine the tests run on, and the DST case is a real one (in New York the
 * clocks went forward on 2026-03-08, a 23-hour day). Node reads TZ on change,
 * and node --test runs each file in its own process, so this stays here.
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

test('daysLeft counts calendar days', () => {
  assert.equal(daysLeft(at(2026, 11, 24, 23, 59, 59, 999).toISOString(), NOW), 0)
  assert.equal(daysLeft(at(2026, 11, 25, 0, 30).toISOString(), at(2026, 11, 24, 23, 30)), 1)
  assert.equal(daysLeft(at(2026, 11, 30, 23, 59, 59, 999).toISOString(), NOW), 6)
  assert.equal(daysLeft(at(2026, 11, 20, 23, 59, 59, 999).toISOString(), NOW), -4)
})

test('a late evening now and an end-of-day until on the same date is 0', () => {
  const until = at(2026, 11, 24, 23, 59, 59, 999).toISOString()
  assert.equal(daysLeft(until, at(2026, 11, 24, 23, 45)), 0)
  assert.equal(daysLeft(until, at(2026, 11, 24, 0, 0).getTime()), 0)
})

test('daysLeft is DST safe', () => {
  // Across the spring-forward day (23 hours long) and the fall-back day (25).
  assert.equal(daysLeft(at(2026, 3, 9, 0, 0).toISOString(), at(2026, 3, 7, 23, 59)), 2)
  assert.equal(daysLeft(at(2026, 3, 10, 23, 59).toISOString(), at(2026, 3, 7, 0, 0)), 3)
  assert.equal(daysLeft(at(2026, 11, 2, 0, 0).toISOString(), at(2026, 10, 31, 23, 59)), 2)
  assert.equal(daysLeft(at(2026, 11, 3, 23, 59).toISOString(), at(2026, 10, 31, 0, 0)), 3)
})
