import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PERSONAL_INFO_NOTICE, personalInfoNoticeFor } from '../../src/lib/personalInfoNotice.js'

test('both languages carry title, confirmation and button label', () => {
  assert.deepEqual(Object.keys(PERSONAL_INFO_NOTICE).sort(), ['en', 'tr'])
  for (const lang of ['en', 'tr']) {
    const notice = PERSONAL_INFO_NOTICE[lang]
    assert.deepEqual(Object.keys(notice).sort(), ['accept', 'confirm', 'title'])
    for (const value of Object.values(notice)) {
      assert.equal(typeof value, 'string')
      assert.ok(value.trim().length > 0)
    }
  }
})

test('the notice carries the approved wording', () => {
  const [en, tr] = [PERSONAL_INFO_NOTICE.en, PERSONAL_INFO_NOTICE.tr]
  assert.equal(en.title, 'Do not share personal information in the chat!')
  assert.equal(
    en.confirm,
    'I confirm that, when chatting with the AI tutor, I do not share any personal information about myself or anyone else, such as names, student ID numbers, email addresses or phone numbers.',
  )
  assert.equal(en.accept, 'I understand')
  assert.equal(tr.title, 'Sohbette kişisel bilgi paylaşmayın!')
  assert.equal(
    tr.confirm,
    'Yapay zekâ eğitmeniyle sohbet ederken ad, soyad, öğrenci numarası, e-posta adresi veya telefon numarası gibi kendime ya da başkalarına ait kişisel bilgileri paylaşmadığımı onaylıyorum.',
  )
  assert.equal(tr.accept, 'Anladım')
})

test('personalInfoNoticeFor falls back to English', () => {
  assert.equal(personalInfoNoticeFor('tr'), PERSONAL_INFO_NOTICE.tr)
  assert.equal(personalInfoNoticeFor('en'), PERSONAL_INFO_NOTICE.en)
  assert.equal(personalInfoNoticeFor('de'), PERSONAL_INFO_NOTICE.en)
  assert.equal(personalInfoNoticeFor(undefined), PERSONAL_INFO_NOTICE.en)
})
