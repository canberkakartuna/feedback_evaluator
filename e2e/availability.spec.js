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

/** What src/lib/availability.js formatDay shows in English for that day. */
function shownDay(offset) {
  const date = new Date()
  date.setDate(date.getDate() + offset)
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

async function setDate(page, label, value) {
  const input = page.getByLabel(label)
  await input.fill(value)
  const saved = page.waitForResponse(
    (response) => response.request().method() === 'PATCH' && response.url().includes('/api/activities/'),
  )
  await input.blur()
  await saved
  await expect(input).toBeEnabled()
}

test('dates set in the editor reach every screen, close the code early, and clear', async ({ page, browser }) => {
  const { teacher, studentNumber, activity } = await seedClass()
  const until = `Available until ${shownDay(6)} · 6 days left`

  // ── Teacher: an end date six days out.
  await page.addInitScript((token) => localStorage.setItem('feedback-evaluator.token', token), teacher.token)
  await page.goto(`/teacher/activities/${activity.id}`)
  await expect(page.getByRole('heading', { level: 1, name: 'Ratio practice' })).toBeVisible()
  await expect(page.getByText(/^Available until /)).toHaveCount(0)

  await setDate(page, 'Available until', inputDay(6))
  await expect(page.getByRole('status').filter({ hasText: until })).toBeVisible()
  await expect(page.getByLabel('Available from')).toHaveAttribute('max', inputDay(6))
  await expect(page.getByText('Open to students', { exact: true })).toBeVisible()

  await page.goto('/teacher')
  const tile = page.getByRole('link', { name: /Ratio practice/ })
  await expect(tile).toContainText(until)
  await expect(tile).toContainText('Open')

  // ── Student: the list, the class-code card, the workspace header.
  const student = await browser.newPage()
  await signInFirstTime(student, studentNumber)
  await expect(student.getByRole('button', { name: /Ratio practice/ })).toContainText(until)

  await student.goto(`/join/${activity.code}`)
  await expect(student.getByRole('heading', { name: 'Ratio practice' })).toBeVisible()
  await expect(student.getByRole('status').filter({ hasText: until })).toBeVisible()
  await student.getByRole('button', { name: 'Start this activity' }).click()
  await expect(student).toHaveURL(/\/work\//)
  await expect(student.locator('.ws-head')).toContainText(until)

  // ── Teacher: a start date tomorrow — scheduled, not open.
  await page.goto(`/teacher/activities/${activity.id}`)
  await setDate(page, 'Available from', inputDay(1))
  await expect(page.getByRole('status').filter({ hasText: `Opens on ${shownDay(1)}` }).first()).toBeVisible()
  await expect(page.getByText('Published, opens later')).toBeVisible()
  await expect(page.getByText('Open to students', { exact: true })).toHaveCount(0)

  // The code is refused in words, with the day — not the server's English.
  await student.goto(`/join/${activity.code}`)
  await expect(student.getByRole('alert')).toHaveText(`This activity opens on ${shownDay(1)}.`)

  // ── Teacher: both cleared — nothing about dates anywhere.
  await setDate(page, 'Available from', '')
  await setDate(page, 'Available until', '')
  await expect(page.getByText(/^(Available until|Opens on|Ended on) /)).toHaveCount(0)
  await expect(page.getByText('Open to students', { exact: true })).toBeVisible()

  await page.goto('/teacher')
  await expect(page.getByRole('link', { name: /Ratio practice/ })).not.toContainText('Available until')

  await student.goto('/')
  await expect(student.getByRole('button', { name: /Ratio practice/ })).toBeVisible()
  await expect(student.getByRole('button', { name: /Ratio practice/ })).not.toContainText('Available until')
  await student.close()
})
