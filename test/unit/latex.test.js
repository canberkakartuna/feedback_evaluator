import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hasMath, splitMath } from '../../src/lib/latex.js'

test('hasMath is false for empty text and plain prose', () => {
  assert.equal(hasMath(''), false)
  assert.equal(hasMath(null), false)
  assert.equal(hasMath('no formulas here'), false)
})

test('a lone or padded dollar is currency, not math', () => {
  assert.equal(hasMath('It costs $5 today'), false)
  assert.equal(hasMath('between $ 5 and 6 $'), false)
})

test('hasMath can be called repeatedly (the shared regex resets)', () => {
  assert.equal(hasMath('$x$'), true)
  assert.equal(hasMath('$x$'), true)
})

test('splitMath covers every character, inline and display', () => {
  const text = 'Solve $x+1=2$ then $$y^2$$ and \\(a\\) and \\[b\\].'
  const segments = splitMath(text)
  assert.deepEqual(segments, [
    { kind: 'text', value: 'Solve ' },
    { kind: 'math', value: 'x+1=2', display: false },
    { kind: 'text', value: ' then ' },
    { kind: 'math', value: 'y^2', display: true },
    { kind: 'text', value: ' and ' },
    { kind: 'math', value: 'a', display: false },
    { kind: 'text', value: ' and ' },
    { kind: 'math', value: 'b', display: true },
    { kind: 'text', value: '.' },
  ])
})

test('single-dollar math stays on one line; backslash forms span lines', () => {
  assert.equal(hasMath('$a\nb$'), false)
  assert.deepEqual(splitMath('\\[a\nb\\]'), [{ kind: 'math', value: 'a\nb', display: true }])
})

test('empty math is kept as the characters typed', () => {
  assert.deepEqual(splitMath('\\( \\)'), [{ kind: 'text', value: '\\( \\)' }])
})
