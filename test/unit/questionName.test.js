import { test } from 'node:test'
import assert from 'node:assert/strict'
import { numberQuestions, questionName } from '../../src/lib/questionName.js'

/** Stands in for the i18n `t`: echoes the key and its params. */
const t = (key, params) => `${key}:${params.n}`

test('numberQuestions numbers authored and own questions separately', () => {
  const numbered = numberQuestions([
    { id: 'a' },
    { id: 'own1', isOwnQuestion: true },
    { id: 'b' },
    { id: 'own2', isOwnQuestion: true },
  ])
  assert.deepEqual(
    numbered.map((q) => [q.id, q.number]),
    [
      ['a', 1],
      ['own1', 1],
      ['b', 2],
      ['own2', 2],
    ],
  )
})

test('questionName uses the authored or own label by number', () => {
  assert.equal(questionName({ number: 3 }, t), 'qname.authored:3')
  assert.equal(questionName({ number: 1, isOwnQuestion: true }, t), 'qname.own:1')
})

test('questionName falls back to the code, then to a dash', () => {
  assert.equal(questionName({ code: 'F-2' }, t), 'F-2')
  assert.equal(questionName({}, t), '')
  assert.equal(questionName(null, t), '—')
})
