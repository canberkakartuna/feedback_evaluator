import { expect, test } from '@playwright/test'
import { addToClassList, api, newStudentNumber, seedClass } from './support/seed.mjs'
import { openActivity, signIn } from './support/student.mjs'

/**
 * Staff side: a teacher deletes two entries on the Student work page, and a
 * student whose entry was deleted starts afresh. The teacher is signed in by
 * putting their token where the console keeps it (src/lib/api.js), since
 * staff sign-in is not what this test is about.
 */

/** A student with consent on their account and one saved answer — one entry. */
async function studentWithWork(activity, studentNumber, draft) {
  const { token } = await api('POST', '/api/auth/student', { body: { studentNumber } })
  await api('POST', '/api/auth/consent', { token })
  const { session } = await api('POST', '/api/sessions', { token, body: { activityId: activity.id } })
  const { questions } = await api('GET', `/api/sessions/${session.id}`, { token }).then((payload) => payload.activity)
  await api('PUT', `/api/sessions/${session.id}/answers/${questions[0].id}`, {
    token,
    body: { mode: 'write', draft },
  })
  return session
}

test('a teacher selects two entries, confirms, and the list updates; the student starts fresh', async ({ page }) => {
  const { teacher, studentNumber, activity } = await seedClass()
  const others = [newStudentNumber(), newStudentNumber()]
  await addToClassList(teacher, others)

  const first = await studentWithWork(activity, studentNumber, 'First answer')
  const second = await studentWithWork(activity, others[0], 'Second answer')
  const kept = await studentWithWork(activity, others[1], 'Kept answer')

  await page.addInitScript((token) => localStorage.setItem('feedback-evaluator.token', token), teacher.token)
  await page.goto('/teacher/students')
  await expect(page.getByRole('heading', { name: 'Student work' })).toBeVisible()
  await expect(page.getByRole('checkbox', { name: /^Select entry / })).toHaveCount(3)

  // Nothing selected: the bulk action waits.
  const deleteSelected = page.getByRole('button', { name: 'Delete selected' })
  await expect(deleteSelected).toBeDisabled()

  await page.getByRole('checkbox', { name: `Select entry ${first.code}` }).check()
  await page.getByRole('checkbox', { name: `Select entry ${second.code}` }).check()
  await expect(page.getByText('2 selected')).toBeVisible()
  // Two of three: the select-all box shows "some".
  const selectAll = page.getByRole('checkbox', { name: 'Select all 3 entries shown' })
  await expect(selectAll).not.toBeChecked()
  expect(await selectAll.evaluate((node) => node.indeterminate)).toBe(true)

  await deleteSelected.click()
  const confirm = page.getByRole('alertdialog', { name: 'Delete 2 entries?' })
  await expect(confirm).toBeVisible()
  await expect(confirm).toContainText('permanently removes')

  // Cancelling changes nothing.
  await confirm.getByRole('button', { name: 'Cancel' }).click()
  await expect(confirm).toBeHidden()
  await expect(page.getByRole('checkbox', { name: /^Select entry / })).toHaveCount(3)

  await deleteSelected.click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete 2 entries' }).click()
  await expect(page.getByRole('status')).toContainText('2 entries deleted.')
  await expect(page.getByRole('checkbox', { name: /^Select entry / })).toHaveCount(1)
  await expect(page.getByRole('checkbox', { name: `Select entry ${kept.code}` })).toBeVisible()
  await expect(page.getByText('0 selected')).toBeVisible()

  // The student whose entry went: signed in as before, no consent pages, and a blank answer.
  await page.evaluate(() => localStorage.removeItem('feedback-evaluator.token'))
  await page.addInitScript(() => localStorage.removeItem('feedback-evaluator.token'))
  await signIn(page, studentNumber)
  await expect(page.getByRole('heading', { name: 'What are you working on?' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Ratio practice/ })).not.toContainText('continue where you left off')
  await openActivity(page, 'Ratio practice')
  await expect(page.getByLabel('Your written answer')).toHaveAttribute('data-value', '')
})
