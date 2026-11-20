import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  deletionOutcome,
  selectionSummary,
  toggleAllShown,
  toggleOne,
} from '../../src/lib/studentWorkSelection.js'

/** Selecting rows on the Student work page. */

test('only shown rows count as selected', () => {
  const selected = new Set(['a', 'hidden'])
  const summary = selectionSummary(['a', 'b'], selected)
  assert.deepEqual(summary.selectedShown, ['a'])
  assert.equal(summary.all, false)
  assert.equal(summary.some, true)
})

test('select-all states: none, some (indeterminate), all', () => {
  assert.deepEqual(
    { ...selectionSummary(['a', 'b'], new Set()), selectedShown: undefined },
    { selectedShown: undefined, all: false, some: false },
  )
  assert.equal(selectionSummary(['a', 'b'], new Set(['a', 'b'])).all, true)
  assert.equal(selectionSummary(['a', 'b'], new Set(['a', 'b'])).some, false)
  assert.equal(selectionSummary([], new Set(['a'])).all, false, 'an empty list is never "all"')
})

test('select-all ticks every shown row, then clears them, leaving hidden ones alone', () => {
  const ticked = toggleAllShown(['a', 'b'], new Set(['hidden']))
  assert.deepEqual([...ticked].sort(), ['a', 'b', 'hidden'])
  const cleared = toggleAllShown(['a', 'b'], ticked)
  assert.deepEqual([...cleared], ['hidden'])
  // From "some", select-all completes the set rather than clearing it.
  assert.deepEqual([...toggleAllShown(['a', 'b'], new Set(['a']))].sort(), ['a', 'b'])
})

test('one row toggles without mutating the old set', () => {
  const before = new Set(['a'])
  const after = toggleOne(before, 'b')
  assert.deepEqual([...after].sort(), ['a', 'b'])
  assert.deepEqual([...before], ['a'])
  assert.deepEqual([...toggleOne(after, 'a')], ['b'])
})

test('reading back a delete result', () => {
  assert.deepEqual(
    deletionOutcome({
      deleted: ['a', 'b'],
      protected: [
        { sessionId: 'c', dialogs: 2 },
        { sessionId: 'd', dialogs: 1 },
      ],
      failed: [{ sessionId: 'e', reason: 'error' }],
    }),
    { deleted: 2, protectedIds: ['c', 'd'], protectedCount: 2, protectedDialogs: 3, failed: 1 },
  )
  assert.deepEqual(deletionOutcome({}), {
    deleted: 0,
    protectedIds: [],
    protectedCount: 0,
    protectedDialogs: 0,
    failed: 0,
  })
})
