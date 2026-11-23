import { allStatementsTicked } from './consentForm.js'

/**
 * The three pages of the consent screen (components/ConsentScreen.jsx), in
 * order: the participant information sheet, the consent form, and the notice
 * not to share personal information in the chat. Kept as local state on that
 * one screen, not as routes: nothing is recorded until the last page, so a
 * reload simply starts again from the first.
 */
export const CONSENT_STEPS = ['sheet', 'form', 'notice']

export const CONSENT_STEP_COUNT = CONSENT_STEPS.length

/**
 * Whether the person may move on from `step` (1-based), given what they have
 * ticked so far: `sheetRead` (the "I have read the sheet" box on page 1),
 * `ticks` (one boolean per consent statement on page 2) and `noticeConfirmed`
 * (the "I confirm I do not share personal information" box on page 3).
 */
export function canLeaveStep(step, { sheetRead, ticks, noticeConfirmed } = {}) {
  if (!Number.isInteger(step)) return false
  switch (CONSENT_STEPS[step - 1]) {
    case 'sheet':
      return sheetRead === true
    case 'form':
      return allStatementsTicked(ticks)
    case 'notice':
      return noticeConfirmed === true
    default:
      return false
  }
}

/**
 * Who the consent pages are addressed to: students, and only students. Staff
 * (teacher, manager, annotator, admin) read the study's data rather than being
 * its subjects — see STAFF_ROLES in shared/roles.js — so they are never asked,
 * and the profile does not show them a consent status or a withdraw control.
 * A staff account that consented in the past keeps its record; it is simply
 * not read.
 */
export const consentAppliesTo = (user) => user?.role === 'student'

/**
 * Whether the consent gate in App.jsx shows the consent pages to `user` (the
 * signed-in account, or null): a student who has neither a current consent nor
 * a withdrawal on their account. A student who withdrew carries on without
 * being asked again.
 */
export const needsConsent = (user) =>
  consentAppliesTo(user) && user.consented !== true && user.withdrawn !== true
