import { expect, test } from '@playwright/test'
import { seedClass } from './support/seed.mjs'
import { signInFirstTime } from './support/student.mjs'

/**
 * An activity's availability range, end to end: the teacher sets the dates in
 * the editor, and the "available until … · N days left" line follows the
 * activity onto the teacher's tile, the student's list, the class-code card
 * and the workspace header. A start date in the future closes it — the code
 * is refused in the student's own words — and clearing both dates puts
 * everything back the way an undated activity has always looked.
 *
 * The teacher is signed in by putting their token where the console keeps it
 * (src/lib/api.js), as in student-work-delete.spec.js. The browser and this
 * file share the machine's timezone, so the days below are the same local
 * days the date inputs speak.
 */

/** `YYYY-MM-DD` for today plus `offset` days, from local date parts. */
function inputDay(offset) {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** The local Date a `YYYY-MM-DD` value names. */
const dayOf = (value) => {
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** What src/lib/availability.js formatDay shows in English for that day. */
const shownDay = (value) =>
  dayOf(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })

/**
 * The line the note should read for an end date typed as `value`, worked out
 * now — at assertion time — rather than when the test started, so a run that
 * crosses midnight expects the count the page will actually show.
 */
function untilLine(value) {
  const today = new Date()
  const start = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  const end = dayOf(value)
  const days = Math.round((Date.UTC(end.getFullYear(), end.getMonth(), end.getDate()) - start) / 86_400_000)
  const tail = days <= 0 ? 'last day' : `${days} ${days === 1 ? 'day' : 'days'} left`
  return `Due date ${shownDay(value)} · ${tail}`
}

/** Polls until `locator`'s text contains the line for `value`, recomputed on every try. */
async function expectUntil(locator, value) {
  await expect
    .poll(async () => {
      const text = (await locator.allTextContents()).join('\n')
      return text.includes(untilLine(value))
    })
    .toBe(true)
}

const patched = (page) =>
  page.waitForResponse(
    (response) => response.request().method() === 'PATCH' && response.url().includes('/api/activities/'),
  )

/** Picks a whole day: it saves on change, with no blur needed. */
async function setDate(page, label, value) {
  const input = page.getByLabel(label, { exact: true })
  const saved = patched(page)
  await input.fill(value)
  await saved
  await expect(input).toBeEnabled()
  await expect(input).toHaveValue(value)
}

async function clearDate(page, buttonLabel) {
  const saved = patched(page)
  await page.getByRole('button', { name: buttonLabel }).click()
  await saved
  await expect(page.getByRole('button', { name: buttonLabel })).toHaveCount(0)
}

test('dates set in the editor reach every screen, close the code early, and clear', async ({ page, browser }) => {
  const { teacher, studentNumber, activity } = await seedClass()
  const end = inputDay(6)
  const start = inputDay(1)

  // ── Teacher: an end date six days out.
  await page.addInitScript((token) => localStorage.setItem('feedback-evaluator.token', token), teacher.token)
  await page.goto(`/teacher/activities/${activity.id}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Ratio practice' })).toBeVisible()
  await expect(page.getByText(/^Due date /)).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Clear the end date' })).toHaveCount(0)

  await setDate(page, 'Available until', end)
  await expectUntil(page.getByRole('status'), end)
  await expect(page.getByRole('button', { name: 'Clear the end date' })).toBeVisible()
  await expect(page.getByLabel('Available from', { exact: true })).toHaveAttribute('max', end)
  await expect(page.getByText('Open to students', { exact: true })).toBeVisible()

  await page.goto('/teacher')
  const tile = page.getByRole('link', { name: /Ratio practice/ })
  await expectUntil(tile, end)
  await expect(tile).toContainText('Open')

  // ── Student: the list, the class-code card, the workspace header.
  const student = await browser.newPage()
  await signInFirstTime(student, studentNumber)
  await expectUntil(student.getByRole('button', { name: /Ratio practice/ }), end)

  await student.goto(`/join/${activity.code}`)
  await expect(student.getByRole('heading', { name: 'Ratio practice' })).toBeVisible()
  await expectUntil(student.getByRole('status'), end)
  await student.getByRole('button', { name: 'Start this activity' }).click()
  await expect(student).toHaveURL(/\/work\//)
  await expectUntil(student.locator('.ws-head'), end)

  // ── Teacher: a start date tomorrow — scheduled, not open.
  await page.goto(`/teacher/activities/${activity.id}`)
  await setDate(page, 'Available from', start)
  await expect(page.getByRole('status').filter({ hasText: `Opens on ${shownDay(start)}` }).first()).toBeVisible()
  await expect(page.getByText('Published, opens later')).toBeVisible()
  await expect(page.getByText('Open to students', { exact: true })).toHaveCount(0)

  // An end before the start is refused: said in words, and the box goes back.
  const until = page.getByLabel('Available until', { exact: true })
  const refused = patched(page)
  await until.fill(inputDay(0))
  expect((await refused).status()).toBe(400)
  await expect(page.getByRole('alert')).toHaveText(
    'The end date must be after the start date. To move both dates later, change the end date first.',
  )
  await expect(until).toHaveValue(end)

  // The code is refused in words, with the day — not the server's English.
  await student.goto(`/join/${activity.code}`)
  await expect(student.getByRole('alert')).toHaveText(`This activity opens on ${shownDay(start)}.`)

  // ── Teacher: both cleared with their buttons — nothing about dates anywhere.
  await clearDate(page, 'Clear the start date')
  await clearDate(page, 'Clear the end date')
  await expect(page.getByLabel('Available from', { exact: true })).toHaveValue('')
  await expect(until).toHaveValue('')
  await expect(page.getByText(/^(Due date|Opens on|Ended on) /)).toHaveCount(0)
  await expect(page.getByText('Open to students', { exact: true })).toBeVisible()

  await page.goto('/teacher')
  await expect(page.getByRole('link', { name: /Ratio practice/ })).not.toContainText('Due date')

  await student.goto('/')
  await expect(student.getByRole('button', { name: /Ratio practice/ })).toBeVisible()
  await expect(student.getByRole('button', { name: /Ratio practice/ })).not.toContainText('Due date')
  await student.close()
})

test('an emptied date box is put back, never saved as no date', async ({ page }) => {
  const { teacher, activity } = await seedClass()
  const end = inputDay(6)

  await page.addInitScript((token) => localStorage.setItem('feedback-evaluator.token', token), teacher.token)
  await page.goto(`/teacher/activities/${activity.id}`)
  await setDate(page, 'Available until', end)

  let patches = 0
  page.on('request', (request) => {
    if (request.method() === 'PATCH') patches += 1
  })
  const until = page.getByLabel('Available until', { exact: true })
  await until.fill('')
  await until.blur()
  await expect(until).toHaveValue(end)
  await page.reload()
  await expect(page.getByLabel('Available until', { exact: true })).toHaveValue(end)
  expect(patches).toBe(0)
})
