import { test } from 'node:test'
import assert from 'node:assert/strict'
import { translate, translationInstruction } from '../../server/services/translate.js'

test('translate sends the text with an instruction naming both languages', async () => {
  let sent = null
  const generate = async (options) => {
    sent = options
    return { text: 'Hücreyi etiketleyin.', model: 'stub' }
  }

  const result = await translate({ text: '  Label the cell.  ', from: 'en', to: 'tr' }, { generate })

  assert.deepEqual(result, { text: 'Hücreyi etiketleyin.', model: 'stub' })
  assert.equal(sent.turns[0].text, 'Label the cell.')
  assert.match(sent.system, /from English to Turkish/)
  assert.match(sent.system, /LaTeX/)
})

test('translate refuses bad input before calling the model', async () => {
  const generate = async () => assert.fail('the model should not be called')
  await assert.rejects(translate({ text: '', from: 'en', to: 'tr' }, { generate }), { status: 400 })
  await assert.rejects(translate({ text: 'x', from: 'en', to: 'en' }, { generate }), { status: 400 })
  await assert.rejects(translate({ text: 'x', from: 'en', to: 'de' }, { generate }), { status: 400 })
})

test('a model failure becomes a 503, not a 500', async () => {
  const generate = async () => {
    throw new Error('stopped early (length)')
  }
  await assert.rejects(translate({ text: 'x', from: 'tr', to: 'en' }, { generate }), { status: 503 })
})

test('the instruction runs the other way too', () => {
  assert.match(translationInstruction('tr', 'en'), /from Turkish to English/)
})
