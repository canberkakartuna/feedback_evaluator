/**
 * The consent form for online participants / çevrim içi katılımcı onam formu,
 * in both languages, shown under the participant information sheet on the
 * consent screen (components/ConsentScreen.jsx).
 *
 * Like ./participantInfo.js, this is an ethics document, not interface copy: it
 * is reproduced word for word from the researcher's source document and lives
 * here rather than in ./strings.js so it is never "tidied" like a UI label.
 * Change it only when the approved text changes.
 *
 * Shape per language: `title`, `instruction`, `yes` (the label of each tick
 * box), `statements` (six, in order; numbered by the screen, not in the text).
 */
export const CONSENT_FORM = {
  en: {
    title: 'Consent Form for Online Participants',
    instruction: 'Please read each statement and tick “Yes” to confirm your agreement.',
    yes: 'Yes',
    statements: [
      'I confirm that I am aged 18 or over.',
      'I have read the Participant Information Sheet and voluntarily agree to take part in this study. I understand that my decision about taking part in the study will not affect my course grade.',
      'I understand that my conversations with the AI tutor will be recorded, and I agree to their use for research as described in the Participant Information Sheet.',
      'I understand how to withdraw from the study and request the removal of my recorded conversations, as explained in the Participant Information Sheet.',
      'I agree that anonymised excerpts from my conversations with the AI tutor may be included in academic publications.',
      'I agree that anonymised excerpts from my conversations with the AI tutor may be shared as part of a research dataset, as described in the Participant Information Sheet.',
    ],
  },
  tr: {
    title: 'Çevrim İçi Katılımcı Onam Formu',
    instruction: 'Lütfen her ifadeyi okuyun ve onaylamak için “Evet” kutusunu işaretleyin.',
    yes: 'Evet',
    statements: [
      '18 yaşından büyük olduğumu beyan ediyorum.',
      'Katılımcı Bilgilendirme Formu’nu okudum ve bu araştırmaya gönüllü olarak katılmayı kabul ediyorum. Araştırmaya katılıp katılmama kararımın ders notumu etkilemeyeceğini anlıyorum.',
      'Yapay zekâ eğitmeniyle yaptığım görüşmelerin kaydedileceğini anlıyorum ve bu kayıtların Katılımcı Bilgilendirme Formu’nda açıklandığı şekilde araştırma amacıyla kullanılmasına onay veriyorum.',
      'Katılımcı Bilgilendirme Formu’nda açıklandığı şekilde, araştırmadan nasıl çekilebileceğimi ve görüşme kayıtlarımın araştırmadan çıkarılmasını nasıl talep edebileceğimi anlıyorum.',
      'Yapay zekâ eğitmeniyle yaptığım görüşmelerden alınan anonimleştirilmiş alıntıların akademik yayınlarda kullanılmasına onay veriyorum.',
      'Yapay zekâ eğitmeniyle yaptığım görüşmelerden alınan anonimleştirilmiş alıntıların, Katılımcı Bilgilendirme Formu’nda açıklandığı şekilde bir araştırma veri setinin parçası olarak paylaşılmasına onay veriyorum.',
    ],
  },
}

/** How many statements the form has; the same in every language. */
export const CONSENT_STATEMENT_COUNT = CONSENT_FORM.en.statements.length

/** The form in `lang`, falling back to English for an unknown language. */
export const consentFormFor = (lang) => CONSENT_FORM[lang] ?? CONSENT_FORM.en

/**
 * Whether every statement has been ticked — the only condition under which
 * consent may be submitted. `ticks` is one boolean per statement, in order.
 */
export const allStatementsTicked = (ticks) =>
  Array.isArray(ticks) && ticks.length === CONSENT_STATEMENT_COUNT && ticks.every((tick) => tick === true)
