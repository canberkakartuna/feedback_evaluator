import { test } from 'node:test'
import assert from 'node:assert/strict'
import { datasetName, membershipNames, pickLabellingDataset, pickTarget, studentLabel } from '../../src/lib/datasets.js'

const t = (key) => `t:${key}`

test('the target is the one used last, if it is still offered', () => {
  const datasets = [{ id: 'a' }, { id: 'b' }]
  assert.equal(pickTarget(datasets, 'b'), 'b')
})

test('otherwise the only one, otherwise the default, otherwise the first', () => {
  assert.equal(pickTarget([{ id: 'a' }], 'gone'), 'a')
  assert.equal(pickTarget([{ id: 'a' }, { id: 'd', isDefault: true }], ''), 'd')
  assert.equal(pickTarget([{ id: 'a' }, { id: 'b' }], null), 'a')
})

test('an archived dataset is never the target, and nothing offered means none', () => {
  assert.equal(pickTarget([{ id: 'a', archived: true }, { id: 'b' }], 'a'), 'b')
  assert.equal(pickTarget([], 'a'), '')
  assert.equal(pickTarget(undefined, 'a'), '')
})

test('labelling opens on the dataset asked for if offered, otherwise the first', () => {
  assert.equal(pickLabellingDataset([{ id: 'a' }, { id: 'b' }], 'b'), 'b')
  assert.equal(pickLabellingDataset([{ id: 'a' }, { id: 'b' }], 'x'), 'a')
  assert.equal(pickLabellingDataset([], 'x'), '')
})

test('the default dataset is named in the reader’s language until renamed', () => {
  assert.equal(datasetName({ isDefault: true, name: 'Default dataset' }, t), 't:datasets.defaultName')
  assert.equal(datasetName({ isDefault: true, name: 'Kept before' }, t), 'Kept before')
  assert.equal(datasetName({ name: 'Pilot A' }, t), 'Pilot A')
})

test('membership names skip ids the reader is not shown', () => {
  assert.deepEqual(membershipNames(['a', 'secret'], [{ id: 'a', name: 'Pilot A' }], t), [
    { id: 'a', name: 'Pilot A', archived: false },
  ])
})

test('students are named the way the roster names them', () => {
  assert.equal(studentLabel({ kind: 'account', name: 'Ada' }, t).label, 'Ada')
  assert.equal(studentLabel({ kind: 'account', name: null }, t).label, 't:roster.signedInStudent')
  assert.deepEqual(studentLabel({ kind: 'anonymous', nickname: 'Fox', code: 'ABC' }, t), {
    label: 'Fox',
    code: 'ABC',
    tone: 'quiet',
  })
  assert.equal(studentLabel({ kind: 'anonymous', nickname: null, code: 'ABC' }, t).label, 't:roster.anonymous')
  assert.equal(studentLabel({ kind: 'preview', code: 'XYZ' }, t).label, 't:roster.preview')
})
