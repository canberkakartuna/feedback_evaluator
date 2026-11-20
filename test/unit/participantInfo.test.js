import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PARTICIPANT_INFO, linkify, participantInfoFor } from '../../src/lib/participantInfo.js'

test('both languages carry the full sheet, section for section', () => {
  for (const lang of ['en', 'tr']) {
    const sheet = PARTICIPANT_INFO[lang]
    assert.equal(sheet.sections.length, 11)
    assert.equal(sheet.details.length, 4)
    sheet.sections.forEach((section, index) => {
      assert.ok(section.heading.startsWith(`${index + 1}. `), section.heading)
      assert.ok(section.paragraphs.length > 0)
    })
  }
  // Paragraph breaks follow the source document per language: it splits TR
  // section 3 into three paragraphs where the EN sheet has one.
  assert.deepEqual(
    PARTICIPANT_INFO.en.sections.map((s) => s.paragraphs.length),
    [1, 1, 1, 3, 1, 1, 1, 1, 1, 3, 2],
  )
  assert.deepEqual(
    PARTICIPANT_INFO.tr.sections.map((s) => s.paragraphs.length),
    [1, 1, 3, 3, 1, 1, 1, 1, 1, 3, 2],
  )
})

test('the sheet carries the current study title and withdrawal wording', () => {
  const [en, tr] = [PARTICIPANT_INFO.en, PARTICIPANT_INFO.tr]
  assert.deepEqual(en.details[0], ['Title of Study', 'Automating the Pedagogical Evaluation of LLM-generated Feedback'])
  assert.deepEqual(tr.details[0], [
    'Çalışmanın Başlığı',
    'Büyük Dil Modellerinin Ürettiği Geri Bildirimlerin Pedagojik Niteliğinin Otomatik Olarak Değerlendirilmesi',
  ])
  assert.match(en.sections[2].paragraphs[0], /complete an online consent form/)
  assert.match(en.sections[2].paragraphs[0], /withdraw through the “Profile” tab/)
  assert.match(tr.sections[2].paragraphs[0], /çevrim içi onam formunu doldurmanız/)
  assert.match(tr.sections[2].paragraphs[1], /“Profil” sekmesi üzerinden/)
})

test('participantInfoFor falls back to English', () => {
  assert.equal(participantInfoFor('tr').title, 'Katılımcı Bilgilendirme Formu')
  assert.equal(participantInfoFor('xx').title, 'Participant Information Sheet')
})

test('linkify turns emails and URLs into links without eating punctuation', () => {
  assert.deepEqual(linkify('Ebru Toka (ebru.toka.24@ucl.ac.uk), first.'), [
    { text: 'Ebru Toka (' },
    { text: 'ebru.toka.24@ucl.ac.uk', href: 'mailto:ebru.toka.24@ucl.ac.uk' },
    { text: '), first.' },
  ])
  assert.deepEqual(linkify('see https://www.ucl.ac.uk/a-b. Then'), [
    { text: 'see ' },
    { text: 'https://www.ucl.ac.uk/a-b', href: 'https://www.ucl.ac.uk/a-b' },
    { text: '. Then' },
  ])
  assert.deepEqual(linkify('at data-protection@ucl.ac.uk.'), [
    { text: 'at ' },
    { text: 'data-protection@ucl.ac.uk', href: 'mailto:data-protection@ucl.ac.uk' },
    { text: '.' },
  ])
  assert.deepEqual(linkify('no links'), [{ text: 'no links' }])
})
