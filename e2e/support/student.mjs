import { expect } from '@playwright/test'

/**
 * What a student does in the browser, written the way they see it: by labels,
 * roles and the words on screen (English unless a test switches language).
 */

export const CONSENT = {
  sheetHeading: 'How this system uses your data',
  sheetBox: 'I have read the Participant Information Sheet.',
  formHeading: 'Consent Form for Online Participants',
  noticeHeading: 'Do not share personal information in the chat!',
  noticeBox:
    'I confirm that, when chatting with the AI tutor, I do not share any personal information about myself or anyone else, such as names, student ID numbers, email addresses or phone numbers.',
  accept: 'I understand',
}

/** Signs in on the student entry screen with an 8-digit username. */
export async function signIn(page, studentNumber) {
  await page.goto('/')
  await page.getByLabel('Username').fill(studentNumber)
  await page.getByRole('button', { name: 'Continue' }).click()
}

/** The three consent pages, straight through. */
export async function completeConsent(page) {
  await expect(page.getByRole('heading', { name: CONSENT.sheetHeading })).toBeVisible()
  await page.getByLabel(CONSENT.sheetBox).check()
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page.getByRole('heading', { name: CONSENT.formHeading })).toBeVisible()
  const boxes = page.getByRole('group', { name: CONSENT.formHeading }).getByRole('checkbox')
  await expect(boxes).toHaveCount(6)
  for (let index = 0; index < 6; index += 1) await boxes.nth(index).check()
  await page.getByRole('button', { name: 'Continue' }).click()

  await expect(page.getByRole('heading', { name: CONSENT.noticeHeading })).toBeVisible()
  await page.getByLabel(CONSENT.noticeBox).check()
  await page.getByRole('button', { name: CONSENT.accept }).click()
  await expect(page.getByRole('heading', { name: 'What are you working on?' })).toBeVisible()
}

/** A first-time student, signed in and past consent, on the activity list. */
export async function signInFirstTime(page, studentNumber) {
  await signIn(page, studentNumber)
  await completeConsent(page)
}

export async function signOut(page) {
  await page.getByRole('button', { name: 'Sign out' }).first().click()
  await expect(page.getByLabel('Username')).toBeVisible()
}

/** Opens an activity from the list and waits for the workspace. */
export async function openActivity(page, title) {
  await page.getByRole('button', { name: new RegExp(title) }).click()
  await expect(page).toHaveURL(/\/work\//)
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()
}

/** The question list pane (the left one in the workspace). */
export const questionList = (page) => page.getByRole('complementary', { name: 'Question set' })

/** The tutor pane (docked on the right at this viewport). */
export const tutorPane = (page) => page.getByRole('complementary', { name: 'AI tutor' })

/** A 1×1 PNG, as a student's "photo of their working". */
export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)
