import { test } from 'node:test'
import assert from 'node:assert/strict'
import katex from 'katex'
import { hasMath, splitMath } from '../../src/lib/latex.js'
import {
  MATH_BUTTONS,
  cleanLatex,
  hasBoxes,
  parseDraft,
  serialiseDraft,
} from '../../src/lib/mathDraft.js'

/**
 * Between the stored text and the maths editor — src/lib/mathDraft.js.
 */

const SAMPLES = [
  '',
  'plain words only',
  'It costs $5 and $10 $ today.',
  'Is it $\\frac{1}{2}$?',
  '$x$$y$',
  '$$\\int_0^1 x\\,dx$$ then \\(a+b\\) and \\[c\\]',
  'line one\nline two $x^{2}$\n',
  '$ $ and $$ $$',
  'tab\there $\\sqrt{2}$ end',
  'unicode π ≤ 3 and $π$',
  '$a\nb$ is not maths',
]

test('loading and saving untouched text gives the same text back', () => {
  for (const text of SAMPLES) {
    assert.equal(serialiseDraft(parseDraft(text)), text, JSON.stringify(text))
  }
})

test('a formula keeps its delimiters and source', () => {
  assert.deepEqual(parseDraft('a $$x^2$$ b \\(y\\)'), [
    { kind: 'text', value: 'a ' },
    { kind: 'math', latex: 'x^2', open: '$$', close: '$$' },
    { kind: 'text', value: ' b ' },
    { kind: 'math', latex: 'y', open: '\\(', close: '\\)' },
  ])
})

test('an edited or new formula is cleaned and wrapped in $', () => {
  const segments = [
    { kind: 'text', value: 'so ' },
    { kind: 'math', latex: '\\frac{1}{\\placeholder{}}', open: '', close: '', fresh: true },
    { kind: 'text', value: ' ok' },
  ]
  assert.equal(serialiseDraft(segments), 'so $\\frac{1}{}$ ok')
})

test('an edited display formula keeps its $$', () => {
  const [math] = parseDraft('$$x$$')
  assert.equal(serialiseDraft([{ ...math, latex: 'x^{2}', fresh: true }]), '$$x^{2}$$')
})

test('an empty new formula is dropped', () => {
  const segments = [
    { kind: 'text', value: 'a ' },
    { kind: 'math', latex: '\\placeholder{}', open: '', close: '', fresh: true },
    { kind: 'text', value: 'b' },
  ]
  assert.equal(serialiseDraft(segments), 'a b')
})

test('new formulas never touch another "$"', () => {
  const fresh = (latex) => ({ kind: 'math', latex, open: '', close: '', fresh: true })
  const text = serialiseDraft([fresh('x'), fresh('y')])
  assert.equal(text, '$x$ $y$')
  assert.equal(splitMath(text).filter((segment) => segment.kind === 'math').length, 2)
  assert.equal(serialiseDraft([{ kind: 'text', value: 'costs $' }, fresh('x')]), 'costs $ $x$')
  assert.equal(serialiseDraft([fresh('x'), { kind: 'text', value: '$5' }]), '$x$ $5')
})

test('cleaning: blanks, padding, line breaks and dollar signs', () => {
  assert.equal(cleanLatex('\\int_{\\placeholder{}}^{\\placeholder[b]{}}\\placeholder{}\\,dx'), '\\int_{}^{}\\,dx')
  assert.equal(cleanLatex('  x \n + 1 '), 'x + 1')
  assert.equal(cleanLatex('5\\$'), '5\\text{\\textdollar}')
  assert.equal(cleanLatex('a$b'), 'ab')
  assert.equal(cleanLatex(undefined), '')
})

test("cleaning writes MathLive's \\frac12 shorthand out in full", () => {
  assert.equal(cleanLatex('\\frac12+\\frac{x}{3}+\\dfrac ab'), '\\frac{1}{2}+\\frac{x}{3}+\\dfrac ab')
  assert.equal(cleanLatex('\\frac1x'), '\\frac{1}{x}')
  assert.equal(cleanLatex('\\sqrt9+\\sqrt{10}+\\sqrt[3]{8}'), '\\sqrt{9}+\\sqrt{10}+\\sqrt[3]{8}')
})

test('every button, filled or left empty, stores text that renders the same as MathText shows it', () => {
  for (const button of MATH_BUTTONS) {
    // What MathLive leaves for an untouched insert: every box a placeholder.
    const empty = button.insert.replaceAll(/#[?@0]/g, '\\placeholder{}')
    const filled = button.insert.replaceAll(/#[?@0]/g, '2')
    for (const latex of [empty, filled]) {
      const text = serialiseDraft([
        { kind: 'text', value: 'so ' },
        { kind: 'math', latex, open: '', close: '', fresh: true },
        { kind: 'text', value: ' ok' },
      ])
      assert.equal(hasMath(text), true, `${button.id}: ${text}`)
      const [, math] = splitMath(text)
      assert.doesNotThrow(
        () => katex.renderToString(math.value, { throwOnError: true }),
        `${button.id}: ${math.value}`,
      )
    }
  }
})

test('symbols leave no boxes; structures do', () => {
  const boxes = Object.fromEntries(MATH_BUTTONS.map((button) => [button.id, hasBoxes(button)]))
  assert.equal(boxes.pi, false)
  assert.equal(boxes.le, false)
  assert.equal(boxes.fraction, true)
  assert.equal(boxes.integral, true)
})

test('a literal dollar typed in a formula still renders', () => {
  const text = serialiseDraft([{ kind: 'math', latex: '5\\$', open: '', close: '', fresh: true }])
  const [math] = splitMath(text)
  assert.doesNotThrow(() => katex.renderToString(math.value, { throwOnError: true }))
})
