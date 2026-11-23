import { expect, test } from '@playwright/test'
import { seedClass } from './support/seed.mjs'
import { openActivity, signInFirstTime, tutorPane } from './support/student.mjs'

/**
 * The maths row over the answer box and the tutor's message box —
 * src/components/MathTools.jsx: where it starts (the activity's setting), the
 * short guide, and moving between blanks.
 */

/** An activity whose first question has maths in it, so "automatic" opens the row. */
const MATHS_QUESTIONS = [
  { kind: 'Calculate', prompt: 'Simplify $\\frac{2}{4}$.' },
  { kind: 'Calculate', prompt: 'What is $3^{2}$?' },
]

const GUIDE = 'How to write maths'

const answerBox = (page) => page.getByRole('main').getByLabel('Your written answer')
const answerToggle = (page) => page.getByRole('main').getByRole('button', { name: 'Maths', exact: true })
const chatToggle = (page) => tutorPane(page).getByRole('button', { name: 'Maths', exact: true })
const guide = (page) => page.getByRole('region', { name: GUIDE })

/** The guide shows itself the first time; these tests close it out of the way. */
async function closeGuide(page) {
  await guide(page).getByRole('button', { name: 'Close the guide' }).click()
  await expect(guide(page)).toHaveCount(0)
}

test.describe('maths tools', () => {
  test('open from the start on an activity with maths, closed on one without', async ({ page }) => {
    const { studentNumber } = await seedClass({ title: 'Fractions', questions: MATHS_QUESTIONS })
    await signInFirstTime(page, studentNumber)
    await openActivity(page, 'Fractions')

    await expect(answerToggle(page)).toHaveAttribute('aria-expanded', 'true')
    await expect(chatToggle(page)).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByRole('main').getByRole('toolbar', { name: 'Maths symbols' })).toBeVisible()
    await expect(tutorPane(page).getByRole('toolbar', { name: 'Maths symbols' })).toBeVisible()

    // The student's own choice wins over the activity, and is remembered.
    await closeGuide(page)
    await answerToggle(page).click()
    await expect(answerToggle(page)).toHaveAttribute('aria-expanded', 'false')
    await page.reload()
    await expect(answerToggle(page)).toHaveAttribute('aria-expanded', 'false')
    await expect(chatToggle(page)).toHaveAttribute('aria-expanded', 'true')
  })

  test('closed from the start on an activity without maths', async ({ page }) => {
    const { studentNumber } = await seedClass()
    await signInFirstTime(page, studentNumber)
    await openActivity(page, 'Ratio practice')

    await expect(answerToggle(page)).toHaveAttribute('aria-expanded', 'false')
    await expect(chatToggle(page)).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByRole('toolbar', { name: 'Maths symbols' })).toHaveCount(0)
    await expect(guide(page)).toHaveCount(0)
  })

  test("the teacher's setting overrides automatic", async ({ page }) => {
    const { studentNumber } = await seedClass({ title: 'Fractions', questions: MATHS_QUESTIONS, mathTools: 'closed' })
    await signInFirstTime(page, studentNumber)
    await openActivity(page, 'Fractions')
    await expect(answerToggle(page)).toHaveAttribute('aria-expanded', 'false')
    await expect(chatToggle(page)).toHaveAttribute('aria-expanded', 'false')
  })

  test('the guide shows once, steps through, closes, and comes back from "?"', async ({ page }) => {
    const { studentNumber } = await seedClass({ title: 'Fractions', questions: MATHS_QUESTIONS })
    await signInFirstTime(page, studentNumber)
    await openActivity(page, 'Fractions')

    // Once, by itself — not twice with both boxes on screen.
    await expect(guide(page)).toHaveCount(1)
    await expect(guide(page)).toContainText('Step 1 of 4')
    await expect(guide(page)).toContainText('Make a fraction')
    // It renders the example, and it does not take the student's focus.
    await expect(guide(page).locator('.katex')).toHaveCount(1)
    await answerBox(page).click()
    await expect(answerBox(page)).toBeFocused()

    await guide(page).getByRole('button', { name: 'Next', exact: true }).click()
    await expect(guide(page)).toContainText('Step 2 of 4')
    await guide(page).getByRole('button', { name: 'Back' }).click()
    await expect(guide(page)).toContainText('Step 1 of 4')

    // Escape closes it, and it stays closed after a reload.
    await guide(page).getByRole('button', { name: 'Next', exact: true }).focus()
    await page.keyboard.press('Escape')
    await expect(guide(page)).toHaveCount(0)
    await page.reload()
    await expect(answerToggle(page)).toHaveAttribute('aria-expanded', 'true')
    await expect(guide(page)).toHaveCount(0)

    // "?" brings it back, with focus on it; closing returns focus to "?".
    const help = page.getByRole('main').getByRole('button', { name: GUIDE })
    await help.click()
    await expect(guide(page)).toBeVisible()
    await expect(guide(page).getByRole('heading', { name: 'Make a fraction' })).toBeFocused()
    for (let step = 1; step < 4; step += 1) {
      await guide(page).getByRole('button', { name: 'Next', exact: true }).click()
    }
    await expect(guide(page)).toContainText('Check the preview')
    await guide(page).getByRole('button', { name: 'Got it' }).click()
    await expect(guide(page)).toHaveCount(0)
    await expect(help).toBeFocused()
  })

  test('Tab moves between blanks and out; a blank shows as a box in the preview', async ({ page }) => {
    const { studentNumber } = await seedClass({ title: 'Fractions', questions: MATHS_QUESTIONS })
    await signInFirstTime(page, studentNumber)
    await openActivity(page, 'Fractions')
    await closeGuide(page)

    const main = page.getByRole('main')
    const box = answerBox(page)
    const row = main.getByRole('toolbar', { name: 'Maths symbols' })

    await box.fill('Half is ')
    await row.getByRole('button', { name: 'Fraction' }).click()
    await page.keyboard.type('1')
    await expect(box).toHaveValue('Half is $\\frac{1}{}$')
    // The empty bottom is drawn as a box, only in the preview.
    await expect(main.locator('.mt-preview')).toContainText('□')

    await page.keyboard.press('Tab')
    await page.keyboard.type('2')
    await page.keyboard.press('Tab') // out of the formula
    await page.keyboard.type(' exactly.')
    await expect(box).toHaveValue('Half is $\\frac{1}{2}$ exactly.')
    await expect(main.locator('.mt-preview')).not.toContainText('□')
    await expect(box).toBeFocused()

    // Outside a formula Tab is an ordinary Tab: focus moves on.
    await page.keyboard.press('Tab')
    await expect(box).not.toBeFocused()

    // "Next blank" does the same for a touch screen.
    await box.fill('')
    await row.getByRole('button', { name: 'Integral' }).click()
    await page.keyboard.type('0')
    await main.getByRole('button', { name: 'Next blank' }).click()
    await page.keyboard.type('1')
    await main.getByRole('button', { name: 'Next blank' }).click()
    await page.keyboard.type('x')
    await expect(box).toHaveValue('$\\int_{0}^{1}{x}\\,dx$')
    await expect(main.locator('.mt-preview .katex')).toHaveCount(1)
  })

  test('in the chat, Tab fills the blanks and Enter still sends', async ({ page }) => {
    const { studentNumber } = await seedClass({ title: 'Fractions', questions: MATHS_QUESTIONS })
    await signInFirstTime(page, studentNumber)
    await openActivity(page, 'Fractions')
    await closeGuide(page)

    const tutor = tutorPane(page)
    const box = tutor.getByLabel('Message the tutor')
    await box.fill('Is it ')
    await tutor.getByRole('toolbar', { name: 'Maths symbols' }).getByRole('button', { name: 'Power' }).click()
    await page.keyboard.type('3')
    await page.keyboard.press('Tab')
    await page.keyboard.type('2')
    await page.keyboard.press('Tab')
    await page.keyboard.type('?')
    await expect(box).toHaveValue('Is it ${3}^{2}$?')
    await page.keyboard.press('Enter')
    await expect(tutor.getByText('19 of 20 questions left')).toBeVisible()
    await expect(tutor.locator('article[data-from="student"]').last().locator('.katex')).toHaveCount(1)
  })
})
