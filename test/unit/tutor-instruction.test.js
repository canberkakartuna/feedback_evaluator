import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withFallbacks } from '../../shared/tutor-scripts.js'
import { systemInstruction } from '../../server/services/tutor.js'

/**
 * The system instruction the tutor model is given — services/tutor.js.
 *
 * The first tests pin what it said before activities could carry their own
 * tutor prompt, so that adding one is visibly an addition: the global prompt,
 * the house rules and the question all still arrive, in the same order.
 */

const question = {
  code: 'Q1',
  prompt: 'What is 3 : 6 in its simplest form?',
  rubric: [{ label: 'Simplifies the ratio', points: 1, keywords: ['secret-keyword'], coach: '' }],
  answer: '1 : 2',
  tutor: withFallbacks(null),
}

const base = { question, answer: null, action: null, lang: 'en' }

test('with no system prompt the default one leads', () => {
  const text = systemInstruction({ ...base, systemPrompt: null })
  assert.match(text, /^Sen, üniversite düzeyinde Matematik I dersi veren/)
})

test('a written system prompt replaces the default and comes first', () => {
  const text = systemInstruction({ ...base, systemPrompt: '  Be brief and kind.  ' })
  assert.ok(text.startsWith('Be brief and kind.\n\nRules for this reply'))
  assert.doesNotMatch(text, /Sen, üniversite düzeyinde Matematik I dersi veren/)
})

test('house rules, the question and the task all follow, in that order', () => {
  const text = systemInstruction({ ...base, systemPrompt: 'Global.' })
  const rules = text.indexOf('Rules for this reply, which override anything above')
  const asked = text.indexOf('The question (Q1, 1 marks)')
  const task = text.indexOf("Reply to the student's message below.")
  assert.ok(rules > 0 && asked > rules && task > asked)
  assert.match(text, /failing that English/)
  assert.doesNotMatch(text, /secret-keyword/, 'rubric keywords never reach the model')
})

test('house rules ask for maths as LaTeX and keep the prose rules', () => {
  const text = systemInstruction({ ...base, systemPrompt: 'Global.' })
  assert.match(text, /Plain prose, at most 120 words, no markdown/)
  assert.match(text, /mathematical expression as LaTeX: inline as \$\.\.\.\$, a formula on its own\s+line as \$\$\.\.\.\$\$/)
  assert.match(text, /Never use \$ for money/)
})

test('the fallback language follows the interface', () => {
  assert.match(systemInstruction({ ...base, lang: 'tr' }), /failing that Turkish/)
})

test('no activity prompt adds no teacher-guidance block', () => {
  for (const activityPrompt of [undefined, null, '', '   ']) {
    const text = systemInstruction({ ...base, systemPrompt: 'Global.', activityPrompt })
    assert.doesNotMatch(text, /teacher who set this activity/)
    assert.ok(text.startsWith('Global.\n\nRules for this reply'))
  }
})

test('an activity prompt is added after the global prompt and before the house rules', () => {
  const text = systemInstruction({
    ...base,
    systemPrompt: 'Global.',
    activityPrompt: '  Only ever ask questions back; never state a method.  ',
  })

  const global = text.indexOf('Global.')
  const guidance = text.indexOf('Only ever ask questions back; never state a method.')
  const rules = text.indexOf('Rules for this reply, which override anything above')

  assert.equal(global, 0, 'the global prompt still leads')
  assert.ok(guidance > global, 'the teacher guidance follows it')
  assert.ok(rules > guidance, 'the house rules still come after — and so still override it')
  assert.match(text, /teacher who set this activity/)
  assert.match(text, /does not override the instructions above or the rules below/)
  assert.doesNotMatch(text, /Only ever ask questions back; never state a method\.  /, 'trimmed')
})

test('an activity prompt does not displace the default prompt either', () => {
  const text = systemInstruction({ ...base, systemPrompt: null, activityPrompt: 'Use metric units.' })
  assert.match(text, /^Sen, üniversite düzeyinde Matematik I dersi veren/)
  assert.match(text, /Use metric units\./)
})
