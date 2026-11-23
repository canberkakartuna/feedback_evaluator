import { expect, test } from '@playwright/test'
import { seedClass } from './support/seed.mjs'
import { openActivity, signInFirstTime, tutorPane } from './support/student.mjs'

/**
 * Path 4 — the tutor chat. The e2e API runs with no OPENAI_API_KEY, so every
 * reply is a scripted line from shared/tutor-scripts.js: no model is called.
 */
async function ask(page, text, remainingAfter) {
  const tutor = tutorPane(page)
  await tutor.getByLabel('Message the tutor').fill(text)
  await tutor.getByRole('button', { name: 'Send' }).click()
  await expect(tutor.getByText(`${remainingAfter} of 20 questions left`)).toBeVisible()
}

test.describe('tutor chat', () => {
  test('a message gets a reply, and the turns left go down', async ({ page }) => {
    const { studentNumber } = await seedClass()
    await signInFirstTime(page, studentNumber)
    await openActivity(page, 'Ratio practice')

    const tutor = tutorPane(page)
    await expect(tutor.getByText('20 of 20 questions left')).toBeVisible()
    // The opening line nobody authored is the interface's own.
    await expect(tutor.getByText('Ask me anything you are stuck on.', { exact: false })).toBeVisible()

    await ask(page, 'I do not know where to start.', 19)
    await expect(tutor.getByText('I do not know where to start.')).toBeVisible()
    // One reply, which can be rated.
    await expect(tutor.getByText('Did this help?')).toHaveCount(1)
    await tutor.getByRole('button', { name: 'Yes' }).click()
    await expect(tutor.getByText('Marked helpful')).toBeVisible()

    await ask(page, 'Can you give me a hint?', 18)
    await expect(tutor.getByText('Did this help?')).toHaveCount(1) // the first is rated now
    await expect(tutor.locator('article[data-from="tutor"][data-kind="reply"]')).toHaveCount(2)

    // The count is per question: Q2 still has all twenty.
    await page.getByRole('complementary', { name: 'Question set' }).getByRole('button', { name: /^Q2/ }).click()
    await expect(tutor.getByText('20 of 20 questions left')).toBeVisible()

    // And it is read from the stored thread, so a reload keeps it.
    await page.reload()
    await expect(tutorPane(page).getByText('18 of 20 questions left')).toBeVisible()
    await expect(tutorPane(page).getByText('Can you give me a hint?')).toBeVisible()
  })

  test('the maths row writes a formula, previews it and sends it rendered', async ({ page }) => {
    const { studentNumber } = await seedClass()
    await signInFirstTime(page, studentNumber)
    await openActivity(page, 'Ratio practice')

    const tutor = tutorPane(page)
    const box = tutor.getByLabel('Message the tutor')
    const toggle = tutor.getByRole('button', { name: 'Maths' })

    // Hidden until asked for.
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(tutor.getByRole('toolbar', { name: 'Maths symbols' })).toHaveCount(0)
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const row = tutor.getByRole('toolbar', { name: 'Maths symbols' })

    // "Is it " then a fraction: the cursor lands in the numerator.
    await box.fill('Is it ')
    await row.getByRole('button', { name: 'Fraction' }).click()
    await expect(box).toBeFocused()
    await expect(box).toHaveValue('Is it $\\frac{}{}$')
    await page.keyboard.type('1')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.type('2')
    await expect(box).toHaveValue('Is it $\\frac{1}{2}$')

    // A rendered preview, before sending.
    const preview = tutor.locator('.mt-preview')
    await expect(preview.getByText('Preview')).toBeVisible()
    await expect(preview.locator('.katex')).toHaveCount(1)

    await tutor.getByRole('button', { name: 'Send' }).click()
    await expect(tutor.getByText('19 of 20 questions left')).toBeVisible()
    await expect(box).toHaveValue('')
    await expect(preview).toHaveCount(0)

    const sent = tutor.locator('article[data-from="student"]').last()
    await expect(sent.locator('.katex')).toHaveCount(1)
    await expect(sent).toContainText('Is it')

    // The row stays open after a reload: the choice is remembered.
    await page.reload()
    await expect(tutorPane(page).getByRole('toolbar', { name: 'Maths symbols' })).toBeVisible()
    await expect(tutorPane(page).locator('article[data-from="student"]').last().locator('.katex')).toHaveCount(1)
  })

  test('after twenty questions the chat closes with the come-back-later message', async ({ page }) => {
    const { studentNumber } = await seedClass()
    await signInFirstTime(page, studentNumber)
    await openActivity(page, 'Ratio practice')

    for (let turn = 1; turn <= 20; turn += 1) {
      await ask(page, `Question number ${turn}`, 20 - turn)
    }

    const tutor = tutorPane(page)
    await expect(tutor.getByRole('status')).toContainText(
      'You have used all 20 questions for this one. Keep working on it yourself, and come back in 2 hours',
    )
    await expect(tutor.getByLabel('Message the tutor')).toHaveCount(0)
    await expect(tutor.getByRole('button', { name: 'Send' })).toHaveCount(0)

    // Still closed after a reload: the server counts the turns, not the page.
    await page.reload()
    await expect(tutorPane(page).getByText('0 of 20 questions left')).toBeVisible()
    await expect(tutorPane(page).getByRole('status')).toContainText('You have used all 20 questions')
    await expect(tutorPane(page).getByLabel('Message the tutor')).toHaveCount(0)
  })
})
