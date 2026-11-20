import { expect, test } from '@playwright/test'
import { newStudentNumber, seedClass } from './support/seed.mjs'
import { signIn } from './support/student.mjs'

/** Path 1 — a student signs in with the 8-digit username on their teacher's class list. */
test.describe('student sign-in', () => {
  test('a number on the class list signs in', async ({ page }) => {
    const { studentNumber } = await seedClass()
    await signIn(page, studentNumber)
    // First time in, so the consent pages come next — proof the account is signed in.
    await expect(page.getByRole('heading', { name: 'How this system uses your data' })).toBeVisible()
  })

  test('a number not on any class list is refused', async ({ page }) => {
    await seedClass()
    await signIn(page, newStudentNumber())
    await expect(page.getByRole('alert')).toHaveText(
      'That username is not on a class list. Check it, or ask your teacher to add it.',
    )
    await expect(page.getByLabel('Username')).toBeVisible()
  })

  test('only an 8-digit number can be entered', async ({ page }) => {
    await page.goto('/')
    const username = page.getByLabel('Username')
    const go = page.getByRole('button', { name: 'Continue' })

    // The rule is stated up front, under the field.
    await expect(page.getByText('Only an 8-digit number can be entered.')).toBeVisible()

    // Letters cannot be typed at all: the field keeps the digits only.
    await username.pressSequentially('ab12cd34')
    await expect(username).toHaveValue('1234')
    await expect(go).toBeDisabled()

    // Seven digits: still not a username.
    await username.fill('')
    await username.pressSequentially('1234567')
    await expect(go).toBeDisabled()

    // A ninth digit is cut off.
    await username.pressSequentially('89')
    await expect(username).toHaveValue('12345678')
    await expect(go).toBeEnabled()
  })
})
