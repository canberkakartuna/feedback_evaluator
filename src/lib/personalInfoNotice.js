/**
 * The notice not to share personal information in the chat / sohbette kişisel
 * bilgi paylaşmama uyarısı, in both languages: the last of the three pages of
 * the consent screen (components/ConsentScreen.jsx). Pressing its button is the
 * acceptance, and is what finally records consent.
 *
 * Like ./consentForm.js and ./participantInfo.js, this is study wording, not
 * interface copy: it lives here rather than in ./strings.js so it is never
 * "tidied" like a UI label. Change it only when the approved text changes.
 *
 * Shape per language: `title`, `body`, `accept` (the button's label).
 */
export const PERSONAL_INFO_NOTICE = {
  en: {
    title: 'Do not share personal information in the chat!',
    body: 'When chatting with the AI tutor, please do not enter any personal information about yourself or anyone else, such as names, student ID numbers, email addresses or phone numbers.',
    accept: 'I understand',
  },
  tr: {
    title: 'Sohbette kişisel bilgi paylaşmayın!',
    body: 'Yapay zekâ eğitmeniyle sohbet ederken ad, soyad, öğrenci numarası, e-posta adresi veya telefon numarası gibi kendinize ya da başkalarına ait kişisel bilgileri paylaşmayın lütfen.',
    accept: 'Anladım',
  },
}

/** The notice in `lang`, falling back to English for an unknown language. */
export const personalInfoNoticeFor = (lang) => PERSONAL_INFO_NOTICE[lang] ?? PERSONAL_INFO_NOTICE.en
