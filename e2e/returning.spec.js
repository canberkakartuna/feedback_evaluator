import { expect, test } from '@playwright/test'
import { seedClass } from './support/seed.mjs'
import { openActivity, questionList, signIn, signInFirstTime, signOut, tutorPane } from './support/student.mjs'

/** Path 7 — a returning student signs in with the same username and finds their work. */
test('a returning student finds their answers, marks and tutor chat waiting', async ({ page }) => {
  const { studentNumber } = await seedClass()
  await signInFirstTime(page, studentNumber)
  await openActivity(page, 'Ratio practice')

  // Some work: a written answer, a self-mark on Q2, and one tutor turn.
  const saved = page.waitForResponse(
    (response) => response.request().method() === 'PUT' && /\/answers\//.test(response.url()),
  )
  await page.getByLabel('Your written answer').fill('Both sides halve, so it stays the same ratio.')
  await saved

  await questionList(page).getByRole('button', { name: /^Q2/ }).click()
  const marked = page.waitForResponse(
    (response) => response.request().method() === 'PUT' && /\/answers\//.test(response.url()),
  )
  await page.getByRole('main').getByRole('button', { name: 'Done' }).click()
  await marked

  const tutor = tutorPane(page)
  await tutor.getByLabel('Message the tutor').fill('How do I share in a ratio?')
  await tutor.getByRole('button', { name: 'Send' }).click()
  await expect(tutor.getByText('19 of 20 questions left')).toBeVisible()

  await signOut(page)

  // Back again, as a returning student: no consent pages, and the activity says so.
  await signIn(page, studentNumber)
  await expect(page.getByRole('heading', { name: 'What are you working on?' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Ratio practice/ })).toContainText('continue where you left off')
  await openActivity(page, 'Ratio practice')

  await expect(page.getByLabel('Your written answer')).toHaveValue('Both sides halve, so it stays the same ratio.')
  await expect(questionList(page).getByRole('button', { name: /^Q2/ })).toContainText('Done')
  await expect(questionList(page).getByText('1 of 2')).toBeVisible()

  await questionList(page).getByRole('button', { name: /^Q2/ }).click()
  await expect(tutorPane(page).getByText('How do I share in a ratio?')).toBeVisible()
  await expect(tutorPane(page).getByText('19 of 20 questions left')).toBeVisible()
})
