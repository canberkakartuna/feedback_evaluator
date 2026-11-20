import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DICTIONARIES } from '../../src/lib/strings.js'
import { TUTOR_PRESETS, withPreset } from '../../src/lib/tutorGuide.js'

test('an empty field takes the template as it is', () => {
  assert.deepEqual(withPreset('', 'Ask questions.', 100), { text: 'Ask questions.', appended: false })
  assert.deepEqual(withPreset('   ', 'Ask questions.', 100), { text: 'Ask questions.', appended: false })
})

test("a field with the teacher's text keeps it, and the template goes on the end", () => {
  const result = withPreset('Use metric units.\n', 'Ask questions.', 100)
  assert.deepEqual(result, { text: 'Use metric units.\n\nAsk questions.', appended: true })
})

test('picking the same template twice adds nothing', () => {
  const once = withPreset('', 'Ask questions.', 100).text
  assert.deepEqual(withPreset(once, 'Ask questions.', 100), { text: once, appended: false })
})

test('a template that would not fit is refused, not cut', () => {
  assert.equal(withPreset('x'.repeat(95), 'Ask questions.', 100), null)
  assert.equal(withPreset('', 'x'.repeat(101), 100), null)
})

test('every template has a label and a text in both languages', () => {
  assert.equal(TUTOR_PRESETS.length, 4)
  for (const lang of ['en', 'tr']) {
    for (const preset of TUTOR_PRESETS) {
      for (const key of [preset.label, preset.text]) {
        const [section, leaf] = key.split('.')
        assert.ok(DICTIONARIES[lang][section][leaf]?.trim(), `${lang} ${key}`)
      }
    }
  }
})
