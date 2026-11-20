import { expect, test } from '@playwright/test'
import { createTeacher, seedClass } from './support/seed.mjs'
import { CONSENT, completeConsent, signIn, signOut } from './support/student.mjs'

/**
 * Path 2 — the one-time consent flow: the participant information sheet, the
 * consent form (six "Yes" boxes), and the personal-information notice.
 */
test.describe('consent flow', () => {
  test('a first-time student goes through the three pages in order', async ({ page }) => {
    const { studentNumber } = await seedClass()
    await signIn(page, studentNumber)

    // Page 1: the sheet. Continue waits for the box.
    await expect(page.getByText('Step 1 of 3 · Before you continue')).toBeVisible()
    await expect(page.getByRole('heading', { name: CONSENT.sheetHeading })).toBeVisible()
    const continueButton = page.getByRole('button', { name: 'Continue' })
    await expect(continueButton).toBeDisabled()
    await page.getByLabel(CONSENT.sheetBox).check()
    await expect(continueButton).toBeEnabled()
    await continueButton.click()

    // Page 2: the form. Continue only once all six are ticked.
    await expect(page.getByText('Step 2 of 3 · Before you continue')).toBeVisible()
    await expect(page.getByRole('heading', { name: CONSENT.formHeading })).toBeVisible()
    const boxes = page.getByRole('group', { name: CONSENT.formHeading }).getByRole('checkbox')
    await expect(boxes).toHaveCount(6)
    for (let index = 0; index < 5; index += 1) {
      await boxes.nth(index).check()
      await expect(continueButton).toBeDisabled()
    }
    await boxes.nth(5).check()
    await expect(continueButton).toBeEnabled()
    // Unticking any one closes it again.
    await boxes.nth(2).uncheck()
    await expect(continueButton).toBeDisabled()
    await boxes.nth(2).check()
    await continueButton.click()

    // Page 3: the notice. Pressing "I understand" is the acceptance.
    await expect(page.getByText('Step 3 of 3 · Before you continue')).toBeVisible()
    await expect(page.getByRole('heading', { name: CONSENT.noticeHeading })).toBeVisible()
    await page.getByRole('button', { name: CONSENT.accept }).click()

    await expect(page.getByRole('heading', { name: 'What are you working on?' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Ratio practice/ })).toBeVisible()
  })

  test('Back keeps the ticks on every page', async ({ page }) => {
    const { studentNumber } = await seedClass()
    await signIn(page, studentNumber)

    await page.getByLabel(CONSENT.sheetBox).check()
    await page.getByRole('button', { name: 'Continue' }).click()
    const boxes = page.getByRole('group', { name: CONSENT.formHeading }).getByRole('checkbox')
    for (let index = 0; index < 6; index += 1) await boxes.nth(index).check()
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByRole('heading', { name: CONSENT.noticeHeading })).toBeVisible()

    // Back from the notice: all six are still ticked.
    await page.getByRole('button', { name: 'Back' }).click()
    await expect(page.getByRole('heading', { name: CONSENT.formHeading })).toBeVisible()
    for (let index = 0; index < 6; index += 1) await expect(boxes.nth(index)).toBeChecked()

    // Back from the form: the sheet box is still ticked.
    await page.getByRole('button', { name: 'Back' }).click()
    await expect(page.getByLabel(CONSENT.sheetBox)).toBeChecked()

    // And forward again without re-ticking anything.
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByRole('button', { name: 'Continue' })).toBeEnabled()
  })

  test('reloading part-way starts again at page 1, with nothing recorded', async ({ page }) => {
    const { studentNumber } = await seedClass()
    await signIn(page, studentNumber)

    await page.getByLabel(CONSENT.sheetBox).check()
    await page.getByRole('button', { name: 'Continue' }).click()
    const boxes = page.getByRole('group', { name: CONSENT.formHeading }).getByRole('checkbox')
    await boxes.nth(0).check()
    await boxes.nth(1).check()

    await page.reload()

    await expect(page.getByText('Step 1 of 3 · Before you continue')).toBeVisible()
    await expect(page.getByRole('heading', { name: CONSENT.sheetHeading })).toBeVisible()
    await expect(page.getByLabel(CONSENT.sheetBox)).not.toBeChecked()
    await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled()
  })

  test('finishing lets the student in, and the next sign-in skips the flow', async ({ page }) => {
    const { studentNumber } = await seedClass()
    await signIn(page, studentNumber)
    await completeConsent(page)

    // Still in after a reload: the consent is on the account, not the page.
    await page.reload()
    await expect(page.getByRole('heading', { name: 'What are you working on?' })).toBeVisible()

    await signOut(page)
    await signIn(page, studentNumber)
    await expect(page.getByRole('heading', { name: 'What are you working on?' })).toBeVisible()
    await expect(page.getByRole('heading', { name: CONSENT.sheetHeading })).toHaveCount(0)
  })

  test('the consent pages follow the language switch (TR: Evet, Anladım)', async ({ page }) => {
    const { studentNumber } = await seedClass()
    await signIn(page, studentNumber)

    await page.getByRole('button', { name: 'TR', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Verileriniz nasıl kullanılıyor' })).toBeVisible()
    await page.getByLabel('Katılımcı Bilgilendirme Formu’nu okudum.').check()
    await page.getByRole('button', { name: 'Devam et' }).click()

    const form = page.getByRole('group', { name: 'Çevrim İçi Katılımcı Onam Formu' })
    await expect(form.getByText('Evet', { exact: true })).toHaveCount(6)
    const boxes = form.getByRole('checkbox')
    for (let index = 0; index < 6; index += 1) await boxes.nth(index).check()
    await page.getByRole('button', { name: 'Devam et' }).click()

    await expect(page.getByRole('heading', { name: 'Sohbette kişisel bilgi paylaşmayın!' })).toBeVisible()
    await page.getByRole('button', { name: 'Anladım' }).click()
    await expect(page.getByRole('heading', { name: 'Ne üzerinde çalışıyorsunuz?' })).toBeVisible()
  })

  test('a teacher signs in and never sees the consent pages', async ({ page }) => {
    const teacher = await createTeacher()
    await page.goto('/signin')
    await page.getByLabel('Email').fill(teacher.email)
    await page.getByLabel('Password').fill(teacher.password)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()

    await expect(page).toHaveURL(/\/teacher$/)
    await expect(page.getByRole('heading', { name: 'Activities', level: 1 })).toBeVisible()
    await expect(page.getByRole('heading', { name: CONSENT.sheetHeading })).toHaveCount(0)

    // Not on a reload either, nor on the student entry screen, which sends staff back to their console.
    await page.reload()
    await expect(page).toHaveURL(/\/teacher$/)
    await page.goto('/')
    await expect(page).toHaveURL(/\/teacher$/)
    await expect(page.getByRole('heading', { name: 'Activities', level: 1 })).toBeVisible()
    await expect(page.getByRole('heading', { name: CONSENT.sheetHeading })).toHaveCount(0)
  })
})
