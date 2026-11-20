import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CONSENT_FORM,
  CONSENT_STATEMENT_COUNT,
  allStatementsTicked,
  consentFormFor,
} from '../../src/lib/consentForm.js'

test('both languages carry the full form: title, instruction, yes label, six statements', () => {
  assert.deepEqual(Object.keys(CONSENT_FORM).sort(), ['en', 'tr'])
  assert.equal(CONSENT_STATEMENT_COUNT, 6)
  for (const lang of ['en', 'tr']) {
    const form = CONSENT_FORM[lang]
    assert.ok(form.title)
    assert.ok(form.instruction)
    assert.ok(form.yes)
    assert.equal(form.statements.length, 6)
    for (const statement of form.statements) {
      assert.equal(typeof statement, 'string')
      assert.ok(statement.trim().length > 0)
      // Numbered by the screen, not in the text.
      assert.doesNotMatch(statement, /^\s*(\d+[.)]|-)\s/)
    }
  }
})

test('the form carries the source wording', () => {
  const [en, tr] = [CONSENT_FORM.en, CONSENT_FORM.tr]
  assert.equal(en.title, 'Consent Form for Online Participants')
  assert.equal(tr.title, 'Çevrim İçi Katılımcı Onam Formu')
  assert.equal(en.instruction, 'Please read each statement and tick “Yes” to confirm your agreement.')
  assert.equal(tr.instruction, 'Lütfen her ifadeyi okuyun ve onaylamak için “Evet” kutusunu işaretleyin.')
  assert.equal(en.yes, 'Yes')
  assert.equal(tr.yes, 'Evet')
  assert.equal(en.statements[0], 'I confirm that I am aged 18 or over.')
  assert.equal(tr.statements[0], '18 yaşından büyük olduğumu beyan ediyorum.')
})

test('consentFormFor falls back to English', () => {
  assert.equal(consentFormFor('tr'), CONSENT_FORM.tr)
  assert.equal(consentFormFor('en'), CONSENT_FORM.en)
  assert.equal(consentFormFor('de'), CONSENT_FORM.en)
  assert.equal(consentFormFor(undefined), CONSENT_FORM.en)
})

test('allStatementsTicked is true only when all six are ticked', () => {
  assert.equal(allStatementsTicked(Array(6).fill(true)), true)
  assert.equal(allStatementsTicked(Array(6).fill(false)), false)
  for (let missing = 0; missing < 6; missing += 1) {
    const ticks = Array(6).fill(true)
    ticks[missing] = false
    assert.equal(allStatementsTicked(ticks), false, `statement ${missing + 1} unticked`)
  }
  assert.equal(allStatementsTicked(Array(5).fill(true)), false)
  assert.equal(allStatementsTicked(Array(7).fill(true)), false)
  assert.equal(allStatementsTicked([true, true, true, true, true, 'yes']), false)
  assert.equal(allStatementsTicked(undefined), false)
  assert.equal(allStatementsTicked([]), false)
})
