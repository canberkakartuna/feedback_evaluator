import { expect, test } from '@playwright/test'
import katex from 'katex'
import { splitMath } from '../src/lib/latex.js'
import { seedClass } from './support/seed.mjs'
import { openActivity, signInFirstTime, tutorPane } from './support/student.mjs'

/**
 * The maths row and the formula editor in the answer box and the tutor's
 * message box — MathInput / MathTools / MathEditor in src/components.
 *
 * The editor is not a textarea: what it would send is on its `data-value`
 * (the same `$…$` text a textarea held), and formulas are MathLive fields.
 */

/** An activity whose first question has maths in it, so "automatic" opens the row. */
const MATHS_QUESTIONS = [
  { kind: 'Calculate', prompt: 'Simplify $\\frac{2}{4}$.' },
  { kind: 'Calculate', prompt: 'What is $3^{2}$?' },
]

const isAnswerSave = (response) =>
  response.request().method() === 'PUT' && /\/api\/sessions\/[^/]+\/answers\//.test(response.url())

const answerBox = (page) => page.getByRole('main').getByLabel('Your written answer')
const answerToggle = (page) => page.getByRole('main').getByRole('button', { name: 'Maths', exact: true })
const chatToggle = (page) => tutorPane(page).getByRole('button', { name: 'Maths', exact: true })
const answerRow = (page) => page.getByRole('main').getByRole('toolbar', { name: 'Maths symbols' })
const nextBlank = (page) => page.getByRole('main').getByRole('button', { name: 'Next blank' })

async function start(page, options = { title: 'Fractions', questions: MATHS_QUESTIONS }) {
  const { studentNumber } = await seedClass(options)
  await signInFirstTime(page, studentNumber)
  await openActivity(page, options.title ?? 'Ratio practice')
}

test.describe('maths tools', () => {
  test('open from the start on an activity with maths; a student choice wins and is remembered', async ({ page }) => {
    await start(page)
    await expect(answerToggle(page)).toHaveAttribute('aria-expanded', 'true')
    await expect(chatToggle(page)).toHaveAttribute('aria-expanded', 'true')
    await expect(answerRow(page)).toBeVisible()

    await answerToggle(page).click()
    await expect(answerToggle(page)).toHaveAttribute('aria-expanded', 'false')
    await page.reload()
    await expect(answerToggle(page)).toHaveAttribute('aria-expanded', 'false')
    await expect(chatToggle(page)).toHaveAttribute('aria-expanded', 'true')
  })

  test('closed from the start on an activity without maths, or when the teacher says so', async ({ page }) => {
    await start(page, {})
    await expect(answerToggle(page)).toHaveAttribute('aria-expanded', 'false')
    await expect(chatToggle(page)).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByRole('toolbar', { name: 'Maths symbols' })).toHaveCount(0)
  })

  test("the teacher's setting overrides automatic", async ({ page }) => {
    await start(page, { title: 'Fractions', questions: MATHS_QUESTIONS, mathTools: 'closed' })
    await expect(answerToggle(page)).toHaveAttribute('aria-expanded', 'false')
  })

  test('every button puts a rendered structure in the sentence; no code ever shows', async ({ page }) => {
    await start(page)
    const box = answerBox(page)
    await box.click()
    await page.keyboard.type('So ')

    const buttons = ['Power', 'Subscript', 'Fraction', 'Square root', 'Integral', 'Sum', 'Pi', 'Infinity']
    for (const name of buttons) {
      await answerRow(page).getByRole('button', { name, exact: true }).click()
      await page.keyboard.type('2')
      // Out of the formula, whatever boxes are left.
      for (let step = 0; step < 4 && (await box.evaluate((el) => document.activeElement !== el)); step += 1) {
        await page.keyboard.press('Tab')
      }
      await page.keyboard.type(' ')
    }
    for (const name of ['Less than or equal to', 'Greater than or equal to', 'Not equal to', 'Multiply', 'Divide']) {
      await answerRow(page).getByRole('button', { name }).click()
      await page.keyboard.type(' ')
    }

    await expect(box.locator('math-field')).toHaveCount(13)
    // What the student sees is prose and formulas: no dollar signs, braces or backslashes.
    expect(await box.innerText()).not.toMatch(/[$\\{}]/)
    // What it stores is the usual text, every formula in $…$.
    const value = await box.getAttribute('data-value')
    expect(value.startsWith('So $')).toBe(true)
    expect(value.match(/\$[^$]+\$/g)).toHaveLength(13)
    for (const piece of ['\\frac', '\\sqrt', '\\int', '\\sum', '\\pi', '\\infty', '\\le', '\\ge', '\\ne', '\\times', '\\div']) {
      expect(value).toContain(piece)
    }
    // And every one renders where the tutor's and teachers' views show it (MathText / KaTeX).
    for (const segment of splitMath(value).filter((each) => each.kind === 'math')) {
      expect(() => katex.renderToString(segment.value, { throwOnError: true }), segment.value).not.toThrow()
    }
    console.log('every button stores:', value)
  })

  test('a fraction mid-sentence: Tab between boxes, out, Backspace removes it, reload restores', async ({ page }) => {
    await start(page)
    const box = answerBox(page)
    await box.click()
    await page.keyboard.type('Half is ')
    await answerRow(page).getByRole('button', { name: 'Fraction' }).click()
    await expect(box.locator('math-field')).toBeFocused()
    await page.keyboard.type('1')
    await page.keyboard.press('Tab')
    await page.keyboard.type('2')
    await page.keyboard.press('Tab')
    await expect(box).toBeFocused()
    await page.keyboard.type(' exactly.')
    await expect(box).toHaveAttribute('data-value', 'Half is $\\frac{1}{2}$ exactly.')

    // Saved like typing, and back as a formula after a reload.
    await page.waitForResponse((response) => isAnswerSave(response) && response.request().postData()?.includes('exactly'))
    await page.reload()
    await expect(answerBox(page)).toHaveAttribute('data-value', 'Half is $\\frac{1}{2}$ exactly.')
    await expect(answerBox(page).locator('math-field')).toHaveCount(1)

    // Tap the formula to edit it; Backspace empties it, then removes it.
    await answerBox(page).locator('math-field').click()
    await expect(answerBox(page).locator('math-field')).toBeFocused()
    await page.keyboard.press('End')
    for (let step = 0; step < 8 && (await answerBox(page).locator('math-field').count()); step += 1) {
      await page.keyboard.press('Backspace')
    }
    await expect(answerBox(page).locator('math-field')).toHaveCount(0)
    await expect(answerBox(page)).toHaveAttribute('data-value', 'Half is  exactly.')
  })

  test('an integral with "Next blank": lower limit, upper limit, body, then out', async ({ page }) => {
    await start(page)
    const box = answerBox(page)
    await box.click()
    await page.keyboard.type('Area ')
    await answerRow(page).getByRole('button', { name: 'Integral' }).click()
    await page.keyboard.type('0')
    await nextBlank(page).click()
    await page.keyboard.type('1')
    await nextBlank(page).click()
    await page.keyboard.type('x')
    await nextBlank(page).click()
    await expect(box).toBeFocused()
    await page.keyboard.type(' units')
    await expect(box).toHaveAttribute('data-value', /^Area \$\\int_\{?0\}?\^\{?1\}?\{?x\}?\\,dx\$ units$/)
  })

  test('structures nest: a fraction inside a power', async ({ page }) => {
    await start(page)
    const box = answerBox(page)
    await box.click()
    await page.keyboard.type('x')
    await answerRow(page).getByRole('button', { name: 'Power', exact: true }).click()
    await answerRow(page).getByRole('button', { name: 'Fraction' }).click()
    await page.keyboard.type('1')
    await page.keyboard.press('Tab')
    await page.keyboard.type('2')
    await expect(box.locator('math-field')).toHaveCount(1)
    await expect(box).toHaveAttribute('data-value', '$x^{\\frac{1}{2}}$')
  })

  test('opening a saved draft changes nothing and saves nothing', async ({ page }) => {
    await start(page)
    const box = answerBox(page)
    await box.click()
    await page.keyboard.type('Seed ')
    const saved = page.waitForResponse(isAnswerSave)
    // A draft typed the old way: dollars and all.
    await page.evaluate(() => {
      const data = new DataTransfer()
      data.setData('text/plain', 'is $$\\int_0^1 x\\,dx$$ or \\(a+b\\)')
      document.getElementById('answer').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
    })
    await saved
    const stored = await box.getAttribute('data-value')
    expect(stored).toContain('$$\\int_0^1 x\\,dx$$')
    await expect(box.locator('math-field')).toHaveCount(2)

    let saves = 0
    page.on('request', (request) => {
      if (request.method() === 'PUT' && request.url().includes('/answers/')) saves += 1
    })
    await page.reload()
    await expect(answerBox(page).locator('math-field')).toHaveCount(2)
    await expect(answerBox(page)).toHaveAttribute('data-value', stored)
    await page.waitForTimeout(1500)
    expect(saves).toBe(0)
  })

  test('in the chat: Enter inside a formula leaves it, Enter in the sentence sends, the bubble is rendered', async ({ page }) => {
    await start(page)
    const tutor = tutorPane(page)
    const box = tutor.getByLabel('Message the tutor')
    await box.click()
    await page.keyboard.type('Is it ')
    await tutor.getByRole('toolbar', { name: 'Maths symbols' }).getByRole('button', { name: 'Power', exact: true }).click()
    await page.keyboard.type('3')
    await page.keyboard.press('Tab')
    await page.keyboard.type('2')
    await page.keyboard.press('Enter') // leaves the formula, does not send
    await expect(tutor.getByText('20 of 20 questions left')).toBeVisible()
    await page.keyboard.type('?')
    await expect(box).toHaveAttribute('data-value', 'Is it $3^2$?')
    await page.keyboard.press('Enter')
    await expect(tutor.getByText('19 of 20 questions left')).toBeVisible()
    await expect(box).toHaveAttribute('data-value', '')
    await expect(box).toBeFocused()
    await expect(tutor.locator('article[data-from="student"]').last().locator('.katex')).toHaveCount(1)
  })

  test('if the formula editor cannot load, the box is a plain textarea with the same text', async ({ page }) => {
    await page.route(/mathlive[^/]*\.js$/, (route) => route.abort())
    await start(page)
    const box = answerBox(page)
    await expect(box).toHaveJSProperty('tagName', 'TEXTAREA')
    await expect(page.getByRole('toolbar', { name: 'Maths symbols' })).toHaveCount(0)
    await box.fill('Half is $\\frac{1}{2}$')
    await expect(box).toHaveValue('Half is $\\frac{1}{2}$')
  })
})
