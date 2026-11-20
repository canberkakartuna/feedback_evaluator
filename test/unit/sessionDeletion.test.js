import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DELETE_SESSIONS_MAX,
  canDeleteSessions,
  canForceDeleteSessions,
  isResearchRecord,
  parseSessionIds,
  researchRecordCount,
} from '../../shared/sessionDeletion.js'
import { DEFAULT_DATASET_ID } from '../../shared/datasets.js'

/** Deleting Student work entries: who, how many, and what counts as research data. */

test('teachers, managers and admins may delete; nobody else', () => {
  for (const role of ['teacher', 'manager', 'admin']) assert.equal(canDeleteSessions({ role }), true)
  for (const role of ['student', 'annotator', undefined]) {
    assert.equal(canDeleteSessions(role ? { role } : null), false)
  }
})

test('only an admin may force a protected delete', () => {
  assert.equal(canForceDeleteSessions({ role: 'admin' }), true)
  for (const role of ['manager', 'teacher', 'annotator', 'student']) {
    assert.equal(canForceDeleteSessions({ role }), false)
  }
  assert.equal(canForceDeleteSessions(null), false)
})

test('a record in a dataset is research data, including a pre-dataset kept one', () => {
  assert.equal(isResearchRecord({ datasetIds: ['ds_x'] }), true)
  assert.equal(isResearchRecord({ included: true }), true, 'old shape reads as the default dataset')
  assert.equal(isResearchRecord({ datasetIds: [DEFAULT_DATASET_ID] }), true)
})

test('a labelled record is research data, whoever labelled it', () => {
  assert.equal(isResearchRecord({ datasetIds: [], labels: { specific: 'yes' } }), true)
  assert.equal(isResearchRecord({ notes: { tone: 'kind' } }), true)
  assert.equal(isResearchRecord({ note: 'an overall reason' }), true)
  assert.equal(isResearchRecord({ annotations: { ann_1: { labels: { accurate: 'no' } } } }), true)
  assert.equal(isResearchRecord({ annotations: { ann_1: { notes: { tone: 'x' } } } }), true)
  assert.equal(isResearchRecord({ annotations: { ann_1: { note: 'x' } } }), true)
})

test('a dropped, assigned-only or emptied record is not', () => {
  assert.equal(isResearchRecord(null), false)
  assert.equal(isResearchRecord({ included: false }), false)
  assert.equal(isResearchRecord({ included: null, datasetIds: [] }), false)
  assert.equal(isResearchRecord({ assigneeId: 'ann_1', assignedBy: 'adm_1' }), false)
  assert.equal(isResearchRecord({ labels: {}, notes: { tone: '  ' }, note: '' }), false)
  assert.equal(isResearchRecord({ annotations: { ann_1: { labels: {}, annotatorName: 'A' } } }), false)
})

test('counting research records over a session', () => {
  assert.equal(researchRecordCount([{ included: true }, { included: false }, { labels: { a: 'yes' } }]), 2)
  assert.equal(researchRecordCount([]), 0)
  assert.equal(researchRecordCount(undefined), 0)
})

test('session ids: an array of 1..max strings, duplicates dropped', () => {
  assert.deepEqual(parseSessionIds(['ses_a', ' ses_b ', 'ses_a']), { ids: ['ses_a', 'ses_b'] })
  assert.ok(parseSessionIds(undefined).error)
  assert.ok(parseSessionIds('ses_a').error)
  assert.ok(parseSessionIds([]).error)
  assert.ok(parseSessionIds(['ses_a', 42]).error)
  assert.ok(parseSessionIds(['  ']).error)

  const max = Array.from({ length: DELETE_SESSIONS_MAX }, (_, i) => `ses_${i}`)
  assert.equal(parseSessionIds(max).ids.length, DELETE_SESSIONS_MAX)
  assert.ok(parseSessionIds([...max, 'ses_extra']).error)
  // Duplicates do not count toward the limit.
  assert.equal(parseSessionIds([...max, 'ses_0']).ids.length, DELETE_SESSIONS_MAX)
})
