import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  isSkipped,
  labelStatus,
  nextIncompleteIndex,
  resumeIndex,
  summarizeStatuses,
} from '../../shared/labelling.js'

const criteria = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

test('nothing entered is not started', () => {
  assert.equal(labelStatus({}, criteria), 'notStarted')
  assert.equal(labelStatus({ labels: {}, notes: {} }, criteria), 'notStarted')
  assert.equal(labelStatus(null, criteria), 'notStarted')
})

test('every criterion rated is complete, with or without a why note', () => {
  assert.equal(labelStatus({ labels: { a: 'yes', b: 'partly', c: 'no' } }, criteria), 'complete')
  assert.equal(
    labelStatus({ labels: { a: 'yes', b: 'no', c: 'no' }, notes: { a: 'because' } }, criteria),
    'complete',
  )
})

test('some but not all rated is incomplete', () => {
  assert.equal(labelStatus({ labels: { a: 'yes' } }, criteria), 'incomplete')
  assert.equal(labelStatus({ labels: { a: 'yes', b: 'no' } }, criteria), 'incomplete')
})

test('a why note without any rating counts as started, not complete', () => {
  assert.equal(labelStatus({ notes: { b: 'unclear reply' } }, criteria), 'incomplete')
  assert.equal(labelStatus({ notes: { b: '   ' } }, criteria), 'notStarted')
})

test('ratings for criteria no longer asked about do not count', () => {
  assert.equal(labelStatus({ labels: { old: 'yes' } }, criteria), 'notStarted')
  assert.equal(labelStatus({ labels: { a: 'yes', b: 'yes', old: 'yes' } }, criteria), 'incomplete')
})

test('blank or non-string ratings are not ratings', () => {
  assert.equal(labelStatus({ labels: { a: '', b: null, c: undefined } }, criteria), 'notStarted')
})

test('criteria may be given as ids', () => {
  assert.equal(labelStatus({ labels: { a: 'yes', b: 'no' } }, ['a', 'b']), 'complete')
})

test('with no criteria nothing can be complete', () => {
  assert.equal(labelStatus({ labels: { a: 'yes' } }, []), 'notStarted')
})

test('summary counts each status', () => {
  assert.deepEqual(summarizeStatuses(['complete', 'incomplete', 'notStarted', 'notStarted']), {
    complete: 1,
    incomplete: 1,
    notStarted: 2,
  })
  assert.deepEqual(summarizeStatuses([]), { complete: 0, incomplete: 0, notStarted: 0 })
})

test('resume opens the first sample that is not complete', () => {
  assert.equal(resumeIndex(['complete', 'complete', 'incomplete', 'notStarted']), 2)
  assert.equal(resumeIndex(['notStarted', 'complete']), 0)
})

test('resume opens the first sample when all are complete, -1 when empty', () => {
  assert.equal(resumeIndex(['complete', 'complete']), 0)
  assert.equal(resumeIndex([]), -1)
})

test('next incomplete looks forward and wraps round', () => {
  const statuses = ['notStarted', 'complete', 'complete', 'incomplete', 'complete']
  assert.equal(nextIncompleteIndex(statuses, 0), 3)
  assert.equal(nextIncompleteIndex(statuses, 3), 0)
  assert.equal(nextIncompleteIndex(statuses, 4), 0)
})

test('next incomplete is -1 when only the current one (or none) is left', () => {
  assert.equal(nextIncompleteIndex(['complete', 'incomplete', 'complete'], 1), -1)
  assert.equal(nextIncompleteIndex(['complete', 'complete'], 0), -1)
  assert.equal(nextIncompleteIndex([], 0), -1)
})

test('skipped: opened, left, and not complete', () => {
  assert.equal(isSkipped('notStarted', { visited: true, current: false }), true)
  assert.equal(isSkipped('incomplete', { visited: true, current: false }), true)
  assert.equal(isSkipped('complete', { visited: true, current: false }), false)
  assert.equal(isSkipped('notStarted', { visited: false, current: false }), false)
  assert.equal(isSkipped('notStarted', { visited: true, current: true }), false)
})
