import { test } from 'node:test'
import assert from 'node:assert/strict'
import { paramForSample, recallVisited, rememberVisited, sampleFromParam, visitedKey } from '../../src/lib/labelling.js'

test('a 1-based sample number becomes a 0-based index', () => {
  assert.equal(sampleFromParam('1', 3), 0)
  assert.equal(sampleFromParam('3', 3), 2)
})

test('done is the end summary', () => {
  assert.equal(sampleFromParam('done', 3), 'end')
})

test('missing, malformed or out-of-range values give null', () => {
  assert.equal(sampleFromParam(null, 3), null)
  assert.equal(sampleFromParam('', 3), null)
  assert.equal(sampleFromParam('0', 3), null)
  assert.equal(sampleFromParam('4', 3), null)
  assert.equal(sampleFromParam('-1', 3), null)
  assert.equal(sampleFromParam('2.5', 3), null)
  assert.equal(sampleFromParam('abc', 3), null)
  assert.equal(sampleFromParam('1', 0), null)
})

test('and back to the URL', () => {
  assert.equal(paramForSample(0), '1')
  assert.equal(paramForSample(9), '10')
  assert.equal(paramForSample('end'), 'done')
})

test('the visited key is per user and per set', () => {
  assert.notEqual(visitedKey('u1', 'ds1'), visitedKey('u2', 'ds1'))
  assert.notEqual(visitedKey('u1', 'ds1'), visitedKey('u1', 'ds2'))
  assert.equal(visitedKey('u1', ''), visitedKey('u1', 'individual'))
})

test('without localStorage, recall is empty and remember does not throw', () => {
  assert.deepEqual([...recallVisited('k')], [])
  assert.doesNotThrow(() => rememberVisited('k', new Set(['a'])))
})

test('with localStorage, the set round-trips and junk is ignored', () => {
  const store = new Map()
  globalThis.localStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
  }
  try {
    rememberVisited('k', new Set(['a', 'b']))
    assert.deepEqual([...recallVisited('k')].sort(), ['a', 'b'])
    store.set('bad', '{not json')
    assert.deepEqual([...recallVisited('bad')], [])
    store.set('mixed', JSON.stringify(['a', 3, null]))
    assert.deepEqual([...recallVisited('mixed')], ['a'])
  } finally {
    delete globalThis.localStorage
  }
})
