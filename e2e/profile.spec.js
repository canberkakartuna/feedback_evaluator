import { expect, test } from '@playwright/test'
import { seedClass } from './support/seed.mjs'
import { openActivity, signIn, signInFirstTime, signOut } from './support/student.mjs'

const CLOSED =
  'Withdrawing here is only possible during the sign-in your consent was given in. To withdraw now, contact your course instructor.'

/** Path 9 — the profile: username, the information sheet, and withdrawing. */
test.describe('profile', () => {
  test('shows the username and the information sheet can be read again', async ({ page }) => {
    const { studentNumber } = await seedClass()
    await signInFirstTime(page, studentNumber)
    await page.getByRole('link', { name: 'Profile' }).click()

    await expect(page.getByRole('heading', { name: 'Profile', level: 1 })).toBeVisible()
    const account = page.getByRole('definition').filter({ hasText: studentNumber })
    await expect(account).toBeVisible()
    await expect(page.getByRole('term').filter({ hasText: 'Username' })).toBeVisible()
    await expect(page.getByText(/^Submitted /)).toBeVisible()

    const sheetTitle = page.getByRole('heading', { name: 'Participant Information Sheet' })
    await expect(sheetTitle).toBeHidden()
    await page.getByText('Read the participant information sheet').click()
    await expect(sheetTitle).toBeVisible()
    await expect(page.getByRole('heading', { name: '1. What’s the purpose of the study?' })).toBeVisible()
  })

  test('withdrawing works in the sign-in consent was given in', async ({ page }) => {
    const { studentNumber } = await seedClass()
    await signInFirstTime(page, studentNumber)
    await page.getByRole('link', { name: 'Profile' }).click()

    await expect(
      page.getByText('You can withdraw here until you sign out. After that, you can withdraw by contacting your course instructor.'),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Withdraw from the study' }).click()

    // Asked to confirm, and Cancel backs out.
    await expect(page.getByRole('alert')).toContainText('You are withdrawing from the study.')
    await page.getByRole('button', { name: 'Cancel' }).click()
    await expect(page.getByRole('alert')).toHaveCount(0)

    await page.getByRole('button', { name: 'Withdraw from the study' }).click()
    await page.getByRole('button', { name: 'Withdraw from the study' }).click()
    await expect(page.getByText(/^You withdrew from the study on /)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Withdraw from the study' })).toHaveCount(0)

    // They can still use the system, and are not asked to consent again.
    await page.getByRole('link', { name: 'Home' }).click()
    await expect(page.getByRole('heading', { name: 'What are you working on?' })).toBeVisible()
    await openActivity(page, 'Ratio practice')

    await signOut(page)
    await signIn(page, studentNumber)
    await expect(page.getByRole('heading', { name: 'What are you working on?' })).toBeVisible()
    await page.getByRole('link', { name: 'Profile' }).click()
    await expect(page.getByText(/^You withdrew from the study on /)).toBeVisible()
  })

  test('after signing out and in again, withdrawing is closed with the contact-the-instructor message', async ({
    page,
  }) => {
    const { studentNumber } = await seedClass()
    await signInFirstTime(page, studentNumber)
    await signOut(page)
    await signIn(page, studentNumber)

    await page.getByRole('link', { name: 'Profile' }).click()
    await expect(page.getByText(/^Submitted /)).toBeVisible()
    await expect(page.getByText(CLOSED)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Withdraw from the study' })).toHaveCount(0)
  })
})
