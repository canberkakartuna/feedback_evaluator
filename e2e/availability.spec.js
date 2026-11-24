import { expect, test } from '@playwright/test'
import { api, seedClass } from './support/seed.mjs'
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

/**
 * Availability dates are days in Turkey time (AVAILABILITY_TIME_ZONE in
 * shared/activity.js), whatever zone this machine or the browser is in, so
 * every expected day and count below is worked out in Istanbul.
 */
const ZONE = 'Europe/Istanbul'
const DAY_MS = 86_400_000

/** Today's date in Istanbul as a UTC-midnight timestamp, read now. */
function istanbulToday() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: ZONE, year: 'numeric', month: 'numeric', day: 'numeric' })
      .formatToParts(new Date())
      .map((part) => [part.type, Number(part.value)]),
  )
  return Date.UTC(parts.year, parts.month - 1, parts.day)
}

/** `YYYY-MM-DD` for today in Istanbul plus `offset` days. */
const inputDay = (offset) => new Date(istanbulToday() + offset * DAY_MS).toISOString().slice(0, 10)

/** A `YYYY-MM-DD` value as a UTC-midnight timestamp. */
const dayOf = (value) => Date.parse(`${value}T00:00:00Z`)

/** What src/lib/availability.js formatDay shows in English for that day. */
const shownDay = (value) =>
  new Date(dayOf(value)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

/**
 * The line the note should read for an end date typed as `value`, worked out
 * now — at assertion time — rather than when the test started, so a run that
 * crosses midnight in Istanbul expects the count the page will actually show.
 */
function untilLine(value) {
  const days = Math.round((dayOf(value) - istanbulToday()) / DAY_MS)
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

test('a teacher in London and a reader in Istanbul see the same day', async ({ browser }) => {
  // The report: an end date of 1 Dec picked in London showed as 2 Dec in Turkey.
  const { teacher, activity } = await seedClass()
  const end = inputDay(6)

  const london = await browser.newContext({ timezoneId: 'Europe/London' })
  await london.addInitScript((token) => localStorage.setItem('feedback-evaluator.token', token), teacher.token)
  const editor = await london.newPage()
  await editor.goto(`/teacher/activities/${activity.id}`)
  await expect(editor.getByText('Dates follow Turkey time (GMT+3).')).toBeVisible()
  await setDate(editor, 'Available until', end)

  // Stored as the end of that day in Istanbul, not in London.
  const { activity: stored } = await api('GET', `/api/activities/${activity.id}`, { token: teacher.token })
  expect(stored.availableUntil).toBe(new Date(`${end}T23:59:59.999+03:00`).toISOString())

  // The London teacher's own editor: the same day in the box and the note.
  await editor.reload()
  await expect(editor.getByLabel('Available until', { exact: true })).toHaveValue(end)
  await expectUntil(editor.getByRole('status'), end)

  // Istanbul: the same day on the teacher's tiles.
  const istanbul = await browser.newContext({ timezoneId: 'Europe/Istanbul' })
  await istanbul.addInitScript((token) => localStorage.setItem('feedback-evaluator.token', token), teacher.token)
  const tiles = await istanbul.newPage()
  await tiles.goto('/teacher')
  await expectUntil(tiles.getByRole('link', { name: /Ratio practice/ }), end)

  await london.close()
  await istanbul.close()
})
