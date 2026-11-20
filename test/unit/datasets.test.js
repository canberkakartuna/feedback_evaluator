import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_DATASET_ID,
  assignedDatasets,
  changeMembership,
  datasetIdsOf,
  inAnyDataset,
  membershipForIncluded,
} from '../../shared/datasets.js'
import {
  dialogsByQuestion,
  groupByStudent,
  parseDatasetInput,
  sameName,
  studentKeyOf,
} from '../../server/services/datasets.js'

/** Datasets: membership on label records, the default dataset, browsing by student. */

/* ------------------------------------------------- reading the old shape */

test('a record from before datasets: kept means the default dataset', () => {
  assert.deepEqual(datasetIdsOf({ included: true }), [DEFAULT_DATASET_ID])
})

test('dropped, undecided or no record at all means no dataset', () => {
  assert.deepEqual(datasetIdsOf({ included: false }), [])
  assert.deepEqual(datasetIdsOf({ included: null }), [])
  assert.deepEqual(datasetIdsOf(null), [])
  assert.deepEqual(datasetIdsOf(undefined), [])
})

test('once written, datasetIds is read as it is, even when empty', () => {
  assert.deepEqual(datasetIdsOf({ included: true, datasetIds: ['ds_a'] }), ['ds_a'])
  assert.deepEqual(datasetIdsOf({ included: true, datasetIds: [] }), [])
})

/* ------------------------------------------------------ changing membership */

test('adding to a dataset keeps what an old kept record already had', () => {
  assert.deepEqual(changeMembership({ included: true }, { add: ['ds_a'] }), {
    datasetIds: [DEFAULT_DATASET_ID, 'ds_a'],
    included: true,
  })
})

test('adding marks an undecided or dropped dialog as included', () => {
  assert.equal(changeMembership(null, { add: ['ds_a'] }).included, true)
  assert.equal(changeMembership({ included: false }, { add: ['ds_a'] }).included, true)
})

test('adding twice is harmless', () => {
  assert.deepEqual(changeMembership({ datasetIds: ['ds_a'], included: true }, { add: ['ds_a'] }).datasetIds, ['ds_a'])
})

test('out of the last dataset, a kept dialog goes back to undecided', () => {
  assert.deepEqual(changeMembership({ datasetIds: ['ds_a'], included: true }, { remove: ['ds_a'] }), {
    datasetIds: [],
    included: null,
  })
})

test('removing from a dialog in no dataset leaves a drop a drop', () => {
  assert.deepEqual(changeMembership({ included: false }, { remove: ['ds_a'] }), { datasetIds: [], included: false })
})

test('out of one of two, it stays included', () => {
  assert.deepEqual(changeMembership({ datasetIds: ['ds_a', 'ds_b'], included: true }, { remove: ['ds_a'] }), {
    datasetIds: ['ds_b'],
    included: true,
  })
})

/* ------------------------------------------------ the old keep / drop write */

test('keep with no dataset named puts it in the default one', () => {
  assert.deepEqual(membershipForIncluded(null, true), { datasetIds: [DEFAULT_DATASET_ID], included: true })
})

test('keep leaves a dialog already in a dataset where it is', () => {
  assert.deepEqual(membershipForIncluded({ datasetIds: ['ds_a'], included: true }, true).datasetIds, ['ds_a'])
})

test('drop and undecided take it out of every dataset', () => {
  assert.deepEqual(membershipForIncluded({ datasetIds: ['ds_a'] }, false), { datasetIds: [], included: false })
  assert.deepEqual(membershipForIncluded({ included: true }, null), { datasetIds: [], included: null })
})

/* ------------------------------------------------------------- assignment */

test('inAnyDataset reads the old shape too', () => {
  assert.equal(inAnyDataset({ included: true }, [DEFAULT_DATASET_ID]), true)
  assert.equal(inAnyDataset({ included: true }, ['ds_a']), false)
  assert.equal(inAnyDataset({ datasetIds: ['ds_a'] }, ['ds_b', 'ds_a']), true)
})

test('a labeller is assigned only the active datasets naming them', () => {
  const datasets = [
    { id: 'a', memberIds: ['u1'] },
    { id: 'b', memberIds: ['u1'], archived: true },
    { id: 'c', memberIds: ['u2'] },
    { id: 'd' },
  ]
  assert.deepEqual(
    assignedDatasets(datasets, 'u1').map((d) => d.id),
    ['a'],
  )
  assert.deepEqual(assignedDatasets(datasets, 'u3'), [])
})

/* ------------------------------------------------------------- validation */

test('a dataset needs a name, trimmed, of sensible length', () => {
  assert.deepEqual(parseDatasetInput({ name: '  Pilot  ' }), { name: 'Pilot', description: '' })
  assert.throws(() => parseDatasetInput({}), /name/)
  assert.throws(() => parseDatasetInput({ name: '   ' }), /name/)
  assert.throws(() => parseDatasetInput({ name: 'x'.repeat(121) }), /120/)
  assert.throws(() => parseDatasetInput({ name: 'ok', description: 3 }), /description/)
})

test('an edit may leave either field out, never blank the name', () => {
  assert.deepEqual(parseDatasetInput({ description: ' Second round ' }, { partial: true }), { description: 'Second round' })
  assert.deepEqual(parseDatasetInput({}, { partial: true }), {})
  assert.throws(() => parseDatasetInput({ name: '' }, { partial: true }), /name/)
})

test('names compare without case or surrounding space', () => {
  assert.equal(sameName(' Pilot A ', 'PILOT A'), true)
  assert.equal(sameName('Pilot A', 'Pilot B'), false)
})

/* ---------------------------------------------------- browsing by student */

test('a signed-in student is one key across sessions; anyone else is their session', () => {
  assert.equal(studentKeyOf({ id: 's1', userId: 'u1' }), 'u:u1')
  assert.equal(studentKeyOf({ id: 's2', userId: null }), 's:s2')
  assert.equal(studentKeyOf({ id: 's3', userId: 'u9', staffPreview: true }), 's:s3')
})

test('students are grouped with their counts, most recently active first', () => {
  const sessions = [
    { id: 's1', userId: 'u1', activityId: 'a1', createdAt: '2026-01-01T00:00:00Z' },
    { id: 's2', userId: 'u1', activityId: 'a2', createdAt: '2026-01-02T00:00:00Z' },
    { id: 's3', userId: null, nickname: 'Fox', code: 'ABC234', activityId: 'a1', createdAt: '2026-01-03T00:00:00Z' },
    { id: 's4', userId: 'u2', createdAt: '2026-01-01T00:00:00Z', consent: { withdrawnAt: '2026-01-05T00:00:00Z' } },
  ]
  const perSession = new Map([
    ['s1', { dialogs: 2, inDataset: 1, questions: ['q1'], lastAt: '2026-01-04T00:00:00Z' }],
    ['s2', { dialogs: 1, inDataset: 0, questions: ['q1'], lastAt: null }],
    ['s3', { dialogs: 3, inDataset: 3, questions: ['q1', 'q2'], lastAt: '2026-01-03T10:00:00Z' }],
  ])
  const rows = groupByStudent(sessions, perSession, (userId) => (userId === 'u1' ? 'Ada' : null))

  assert.deepEqual(
    rows.map((row) => row.key),
    ['u:u1', 's:s3', 'u:u2'],
  )
  const ada = rows[0]
  assert.equal(ada.kind, 'account')
  assert.equal(ada.name, 'Ada')
  assert.equal(ada.sessionCount, 2)
  assert.equal(ada.dialogCount, 3)
  assert.equal(ada.inDatasetCount, 1)
  // q1 in two different sessions is two questions worked on.
  assert.equal(ada.questionCount, 2)
  assert.deepEqual(ada.activityIds, ['a1', 'a2'])

  const fox = rows[1]
  assert.equal(fox.kind, 'anonymous')
  assert.equal(fox.name, null)
  assert.equal(fox.nickname, 'Fox')
  assert.equal(fox.code, 'ABC234')

  // A student out of the caller's user scope has no name; withdrawal is flagged.
  assert.equal(rows[2].name, null)
  assert.equal(rows[2].consentWithdrawn, true)
  assert.equal(rows[2].dialogCount, 0)
})

test('dialogs are grouped by question, in the order they happened', () => {
  const snippet = (sessionId, questionId, seq, at) => ({
    id: `${sessionId}:${questionId}:${seq}`,
    sessionId,
    questionId,
    question: { code: questionId.toUpperCase() },
    answer: { draft: `answer to ${questionId}` },
    student: { text: 'hi', at },
    tutor: { text: 'hello', at },
  })
  const groups = dialogsByQuestion([
    snippet('s1', 'q2', 5, '2026-01-01T00:05:00Z'),
    snippet('s1', 'q1', 3, '2026-01-01T00:03:00Z'),
    snippet('s1', 'q1', 1, '2026-01-01T00:01:00Z'),
  ])

  assert.deepEqual(
    groups.map((group) => group.questionId),
    ['q1', 'q2'],
  )
  assert.deepEqual(
    groups[0].dialogs.map((dialog) => dialog.id),
    ['s1:q1:1', 's1:q1:3'],
  )
  assert.equal(groups[0].question.code, 'Q1')
  assert.equal(groups[0].answer.draft, 'answer to q1')
  // The question and answer belong to the group, not to every dialog.
  assert.equal('question' in groups[0].dialogs[0], false)
})
