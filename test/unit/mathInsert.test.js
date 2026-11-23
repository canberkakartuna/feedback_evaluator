import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hasMath, splitMath } from '../../src/lib/latex.js'
import {
  MATH_SNIPPETS,
  MAX_ANSWER_LENGTH,
  MAX_MESSAGE_LENGTH,
  insertMath,
  insideMath,
  nextBlank,
  previousBlank,
  showBlanks,
} from '../../src/lib/mathInsert.js'

/**
 * The maths row — src/lib/mathInsert.js. `|` in a comment or an expected
 * string marks the cursor.
 */

const at = (result) => result.text.slice(0, result.selectionStart) + '|' + result.text.slice(result.selectionStart)

test('an empty box gets a wrapped formula with the cursor in its first slot', () => {
  const result = insertMath('', 0, 0, 'fraction')
  assert.equal(result.text, '$\\frac{}{}$')
  assert.equal(at(result), '$\\frac{|}{}$')
  assert.equal(result.selectionStart, result.selectionEnd)
})

test('a power with nothing before it puts the cursor in a blank base', () => {
  assert.equal(at(insertMath('', 0, 0, 'power')), '${|}^{}$')
})

test('an integral and a sum start at the lower limit, every part a blank', () => {
  assert.equal(at(insertMath('', 0, 0, 'integral')), '$\\int_{|}^{}{}\\,dx$')
  assert.equal(at(insertMath('', 0, 0, 'sum')), '$\\sum_{|}^{}{}$')
})

test('mid-text, the formula goes in at the cursor and the rest is kept', () => {
  const text = 'so it is  over two'
  const result = insertMath(text, 9, 9, 'sqrt')
  assert.equal(at(result), 'so it is $\\sqrt{|}$ over two')
})

test('a symbol outside a formula is wrapped and the cursor goes after it', () => {
  assert.equal(at(insertMath('x  3', 2, 2, 'le')), 'x $≤$| 3')
  assert.equal(at(insertMath('area = r', 7, 7, 'pi')), 'area = $π$|r')
})

test('a selection becomes the numerator, the cursor goes to the denominator', () => {
  assert.equal(at(insertMath('half is x+1 now', 8, 11, 'fraction')), 'half is $\\frac{x+1}{|}$ now')
})

test('a selection becomes the base of a power, the integrand, the root', () => {
  assert.equal(at(insertMath('e', 0, 1, 'power')), '$e^{|}$')
  assert.equal(at(insertMath('x^2', 0, 3, 'integral')), '$\\int_{|}^{}{x^2}\\,dx$')
  assert.equal(at(insertMath('2', 0, 1, 'sqrt')), '$\\sqrt{2}$|')
})

test('a symbol replaces the selection', () => {
  assert.equal(at(insertMath('a * b', 2, 3, 'times')), 'a $×$| b')
})

test('spaces at the edges of a selection stay outside the formula', () => {
  const result = insertMath('take  x  now', 4, 9, 'power')
  assert.equal(at(result), 'take  $x^{|}$  now')
})

test('with no selection, the letters or digits just typed become the base', () => {
  assert.equal(at(insertMath('it is 2', 7, 7, 'power')), 'it is $2^{|}$')
  assert.equal(at(insertMath('a', 1, 1, 'subscript')), '$a_{|}$')
  // A space before the cursor: nothing to take, so the base is a blank.
  assert.equal(at(insertMath('it is ', 6, 6, 'power')), 'it is ${|}^{}$')
  // Only powers and subscripts take one.
  assert.equal(at(insertMath('x', 1, 1, 'fraction')), 'x$\\frac{|}{}$')
})

test('inside a formula already, nothing is wrapped again', () => {
  // "$x|$"
  assert.equal(at(insertMath('$x$', 2, 2, 'power')), '$x^{|}$')
  assert.equal(at(insertMath('$2$', 2, 2, 'pi')), '$2π|$')
  // Right after the opening delimiter counts as inside.
  assert.equal(at(insertMath('$x$', 1, 1, 'fraction')), '$\\frac{|}{}x$')
  // A selection inside a formula is wrapped in place.
  assert.equal(at(insertMath('$a+b$ is it', 1, 4, 'fraction')), '$\\frac{a+b}{|}$ is it')
  // Display maths too.
  assert.equal(at(insertMath('$$y$$', 3, 3, 'sqrt')), '$$y\\sqrt{|}$$')
})

test('just after a closing delimiter is outside the formula', () => {
  assert.equal(insideMath('$x$ and', 3), false)
  assert.equal(insideMath('$x$ and', 2), true)
  assert.equal(insideMath('costs $5 today', 7), false)
  // Kept apart by a space, or "$x$$≥$" would read the "$$" as display maths.
  const after = insertMath('$x$', 3, 3, 'ge')
  assert.equal(at(after), '$x$ $≥$|')
  assert.equal(splitMath(after.text).filter((segment) => segment.kind === 'math').length, 2)
  const before = insertMath('$x$', 0, 0, 'pi')
  assert.equal(before.text, '$π$ $x$')
  assert.equal(splitMath(before.text).filter((segment) => segment.kind === 'math').length, 2)
})

test('a selection spanning lines is wrapped in \\( \\) instead of $ $', () => {
  const result = insertMath('a\nb', 0, 3, 'sqrt')
  assert.equal(result.text, '\\(\\sqrt{a\nb}\\)')
  assert.equal(hasMath(result.text), true)
})

test('a "$" in the selection is kept literally', () => {
  assert.equal(insertMath('$&', 0, 2, 'sqrt').text, '$\\sqrt{$&}$')
})

test('every button, in every position, gives text that renders as maths', () => {
  const cases = [
    ['', 0, 0],
    ['so x then', 4, 4],
    ['so x then', 3, 4],
    ['$y$', 2, 2],
  ]
  for (const { id } of MATH_SNIPPETS) {
    for (const [text, start, end] of cases) {
      const result = insertMath(text, start, end, id)
      assert.ok(result, `${id} on ${JSON.stringify(text)}`)
      assert.equal(hasMath(result.text), true, `${id} on ${JSON.stringify(text)}: ${result.text}`)
      const segments = splitMath(result.text)
      assert.equal(segments.map((segment) => segment.kind).filter((kind) => kind === 'math').length, 1)
      assert.ok(result.selectionStart >= 0 && result.selectionStart <= result.text.length)
    }
  }
})

test('an unknown button does nothing', () => {
  assert.equal(insertMath('x', 0, 0, 'nope'), null)
})

test('nothing is inserted past the server limit', () => {
  const full = 'x'.repeat(MAX_MESSAGE_LENGTH - 2)
  assert.equal(insertMath(full, full.length, full.length, 'pi'), null) // "$π$" is 3 more
  assert.ok(insertMath('x'.repeat(MAX_MESSAGE_LENGTH - 4), 0, 0, 'pi'))
})

test('the answer box passes its own, longer limit', () => {
  const long = 'x'.repeat(MAX_MESSAGE_LENGTH)
  assert.equal(insertMath(long, 0, 0, 'pi'), null)
  assert.ok(insertMath(long, 0, 0, 'pi', MAX_ANSWER_LENGTH))
  const full = 'x'.repeat(MAX_ANSWER_LENGTH - 2)
  assert.equal(insertMath(full, 0, 0, 'pi', MAX_ANSWER_LENGTH), null)
})

/** Applies a caret move to the text, for reading with `at`. */
const moved = (text, move) => move && at({ text, ...move })

test('Tab goes to the next blank, then out of the formula', () => {
  const text = 'so $\\frac{1}{}$ ok'
  // "so $\frac{1|}{}$ ok" → the denominator
  assert.equal(moved(text, nextBlank(text, 11)), 'so $\\frac{1}{|}$ ok')
  // From the last blank → just past the closing "$"
  assert.equal(moved(text, nextBlank(text, 14)), 'so $\\frac{1}{}$| ok')
})

test('an integral walks lower limit, upper limit, body, then out', () => {
  const text = '$\\int_{}^{}{}\\,dx$ and'
  const first = nextBlank(text, 7) // in the lower limit
  assert.equal(moved(text, first), '$\\int_{}^{|}{}\\,dx$ and')
  assert.equal(moved(text, nextBlank(text, first.selectionStart)), '$\\int_{}^{}{|}\\,dx$ and')
  assert.equal(moved(text, nextBlank(text, 13)), '$\\int_{}^{}{}\\,dx$| and')
})

test('Tab leaves display maths past both dollar signs', () => {
  assert.equal(moved('$$x^{2}$$!', nextBlank('$$x^{2}$$!', 6)), '$$x^{2}$$|!')
})

test('outside a formula Tab is left alone', () => {
  assert.equal(nextBlank('plain text', 3), null)
  assert.equal(nextBlank('$x$ then', 5), null)
  assert.equal(previousBlank('plain', 2), null)
})

test('Shift+Tab goes back a blank, and is left alone with none behind', () => {
  const text = '$\\frac{}{}$'
  assert.equal(moved(text, previousBlank(text, 9)), '$\\frac{|}{}$')
  assert.equal(previousBlank(text, 7), null)
})

test('an escaped brace is not a blank', () => {
  assert.equal(moved('$\\{}x$', nextBlank('$\\{}x$', 1)), '$\\{}x$|')
  assert.equal(showBlanks('$\\{}$'), '$\\{}$')
})

test('the preview shows each blank as a box, only inside formulas', () => {
  assert.equal(showBlanks('a {} $\\frac{2}{}$'), 'a {} $\\frac{2}{\\square}$')
  assert.equal(showBlanks('${}^{}$ and $x$'), '${\\square}^{\\square}$ and $x$')
  assert.equal(showBlanks('no maths'), 'no maths')
  assert.equal(showBlanks(''), '')
})

test('every inserted formula can be filled by Tab and left', () => {
  for (const { id } of MATH_SNIPPETS) {
    let state = insertMath('', 0, 0, id)
    for (let step = 0; step < 5; step += 1) {
      const move = nextBlank(state.text, state.selectionStart)
      if (!move) break
      state = { ...state, ...move }
    }
    assert.equal(state.selectionStart, state.text.length, `${id}: Tab ends after the formula`)
  }
})
