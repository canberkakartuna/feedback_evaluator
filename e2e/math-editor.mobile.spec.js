import { expect, test } from '@playwright/test'
import { seedClass } from './support/seed.mjs'
import { openActivity, signInFirstTime, tutorPane } from './support/student.mjs'

/**
 * The maths editor on a phone — run by the `android` (Pixel 7, Chromium) and
 * `iphone` (iPhone 13, WebKit) projects in playwright.config.js: touch, a
 * narrow screen, both engines.
 *
 * Emulation, not a real phone: there is no on-screen keyboard here, so these
 * prove the taps, the focus moves and what is stored — not how a real
 * keyboard covers the page or how Gboard / the iOS keyboard compose text.
 */

const QUESTIONS = [{ kind: 'Calculate', prompt: 'Work out $\\int_{0}^{1} x\\,dx$.' }]

const isAnswerSave = (response) =>
  response.request().method() === 'PUT' && /\/api\/sessions\/[^/]+\/answers\//.test(response.url())

async function start(page) {
  const { studentNumber } = await seedClass({ title: 'Areas', questions: QUESTIONS })
  await signInFirstTime(page, studentNumber)
  await openActivity(page, 'Areas')
}

const inView = (locator) =>
  locator.evaluate((el) => {
    const box = el.getBoundingClientRect()
    return box.top >= 0 && box.bottom <= window.innerHeight
  })

test('answer box: an integral and a fraction mid-sentence, filled with taps, saved and restored', async ({ page }) => {
  await start(page)
  const main = page.getByRole('main')
  const box = main.getByLabel('Your written answer')
  const row = main.getByRole('toolbar', { name: 'Maths symbols' })
  const next = main.getByRole('button', { name: 'Next blank' })

  await box.tap()
  await page.keyboard.type('Area is ')
  await row.getByRole('button', { name: 'Integral' }).tap()
  // The phone keeps its own keyboard in a formula, not MathLive's.
  await expect(box.locator('math-field')).toBeFocused()
  expect(
    await box.locator('math-field').evaluate((field) =>
      field.shadowRoot.querySelector('[part=keyboard-sink]').getAttribute('inputmode'),
    ),
  ).toBe('text')
  await page.keyboard.type('0')
  await next.tap()
  await page.keyboard.type('1')
  await next.tap()
  await page.keyboard.type('x')
  await next.tap()
  await expect(box).toBeFocused()
  await page.keyboard.type(' and half is ')
  await row.getByRole('button', { name: 'Fraction' }).tap()
  await page.keyboard.type('1')
  await next.tap()
  await page.keyboard.type('2')
  await next.tap()
  const saved = page.waitForResponse((response) => isAnswerSave(response) && response.request().postData()?.includes('.'))
  await page.keyboard.type('.')

  const expected = /^Area is \$\\int_\{?0\}?\^\{?1\}?\{?x\}?\\,dx\$ and half is \$\\frac\{1\}\{2\}\$\.$/
  await expect(box).toHaveAttribute('data-value', expected)
  await expect(box.locator('math-field')).toHaveCount(2)
  // Nothing sideways, and the box is still on screen.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize().width)
  expect((await saved).ok()).toBe(true)

  await page.reload()
  await expect(page.getByLabel('Your written answer')).toHaveAttribute('data-value', expected)
  await expect(page.getByLabel('Your written answer').locator('math-field')).toHaveCount(2)
})

test('answer box: tap a formula to edit it; Backspace empties it, then removes it', async ({ page }) => {
  await start(page)
  const main = page.getByRole('main')
  const box = main.getByLabel('Your written answer')
  await box.tap()
  await page.keyboard.type('It is ')
  await main.getByRole('toolbar', { name: 'Maths symbols' }).getByRole('button', { name: 'Square root' }).tap()
  await page.keyboard.type('9')
  await main.getByRole('button', { name: 'Next blank' }).tap()
  await expect(box).toHaveAttribute('data-value', 'It is $\\sqrt{9}$')

  await box.locator('math-field').tap()
  await expect(box.locator('math-field')).toBeFocused()
  await page.keyboard.press('End')
  for (let step = 0; step < 6 && (await box.locator('math-field').count()); step += 1) {
    await page.keyboard.press('Backspace')
  }
  await expect(box.locator('math-field')).toHaveCount(0)
  await expect(box).toHaveAttribute('data-value', 'It is ')
})

test('chat: a power in the message, Send stays on screen, the bubble shows it rendered', async ({ page }) => {
  await start(page)
  await page.getByRole('button', { name: /^Tutor/ }).last().tap()
  const tutor = tutorPane(page)
  const box = tutor.getByLabel('Message the tutor')
  const send = tutor.getByRole('button', { name: 'Send' })

  await box.tap()
  await page.keyboard.type('Is it ')
  await tutor.getByRole('toolbar', { name: 'Maths symbols' }).getByRole('button', { name: 'Power', exact: true }).tap()
  await page.keyboard.type('3')
  await tutor.getByRole('button', { name: 'Next blank' }).tap()
  await page.keyboard.type('2')
  await tutor.getByRole('button', { name: 'Next blank' }).tap()
  await page.keyboard.type('?')
  await expect(box).toHaveAttribute('data-value', 'Is it $3^2$?')
  expect(await inView(send)).toBe(true)
  expect(await inView(box)).toBe(true)

  await send.tap()
  await expect(tutor.getByText('19 of 20 questions left')).toBeVisible()
  await expect(box).toHaveAttribute('data-value', '')
  await expect(tutor.locator('article[data-from="student"]').last().locator('.katex')).toHaveCount(1)
})
