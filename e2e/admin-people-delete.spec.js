import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { E2E } from './ports.mjs'
import { api } from './support/seed.mjs'

/**
 * Admin side: deleting an account on /admin (People). The list is long, so the
 * row's Delete button sits well below the top of the page — the result of the
 * press (done, or refused and why) has to show where the admin is looking, not
 * up at the top of the page they have scrolled away from.
 *
 * Delete asks first, in a dialog over the page. It used to ask inside the row,
 * which doubled the row's height and pushed everything under it down the moment
 * Delete was pressed; the table must not move at all while the question is open.
 */

async function adminToken() {
  const { token } = await api('POST', '/api/auth/login', {
    body: { email: E2E.admin.email, password: E2E.admin.password },
  })
  return token
}

async function createUser(token, body) {
  const suffix = randomUUID().slice(0, 8)
  const { user } = await api('POST', '/api/users', {
    token,
    body: { email: `${body.role}-${suffix}@example.com`, password: 'e2e user password', ...body, name: `${body.name} ${suffix}` },
  })
  return user
}

/** The row for one account in the People table — by its email, since a name also shows under "Reports to". */
const rowOf = (page, user) => page.getByRole('row').filter({ hasText: user.email })

/** Every row's height, every column's width and the table's scroll width — what a reflow would change. */
const tableGeometry = (page) =>
  page.locator('.cs-table').evaluate((table) => ({
    columns: [...table.tHead.rows[0].cells].map((cell) => cell.getBoundingClientRect().width),
    rows: [...table.tBodies[0].rows].map((row) => row.getBoundingClientRect().height),
    scrollWidth: table.parentElement.scrollWidth,
  }))

test.use({ viewport: { width: 1280, height: 600 } })

test('deleting an account from far down the list: confirm, then the result is in view', async ({ page }) => {
  const token = await adminToken()
  // Enough accounts that the table runs well past the first screen.
  for (let index = 0; index < 12; index += 1) await createUser(token, { role: 'teacher', name: 'Filler Teacher' })
  const target = await createUser(token, { role: 'teacher', name: 'Zz Delete Me' })

  await page.addInitScript((value) => localStorage.setItem('feedback-evaluator.token', value), token)
  await page.goto('/admin')
  await expect(page.getByRole('heading', { name: 'People', level: 1 })).toBeVisible()

  const row = rowOf(page, target)
  await row.scrollIntoViewIfNeeded()
  await page.evaluate(() => document.fonts.ready)
  const before = await tableGeometry(page)
  const scrolledTo = await page.evaluate(() => window.scrollY)
  const deleteButton = row.getByRole('button', { name: 'Delete' })
  await deleteButton.click()

  // One press does not delete: it asks first, naming the account...
  await expect(page.getByText(`Delete ${target.name}?`)).toBeVisible()
  // ...without moving anything in the table under it.
  expect(await tableGeometry(page)).toEqual(before)
  expect(await page.evaluate(() => window.scrollY)).toBe(scrolledTo)

  const dialog = page.getByRole('alertdialog', { name: `Delete ${target.name}?` })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText(target.email)
  // Focus starts on the harmless answer; Escape puts the question away and
  // gives focus back to the row's Delete button, with nothing deleted.
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(deleteButton).toBeFocused()
  await expect(rowOf(page, target)).toHaveCount(1)

  await deleteButton.click()
  // A real network takes a moment over the refetch; locally it is too quick to
  // ever paint the in-between state this guards against.
  await page.route('**/api/users', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 400))
    await route.continue()
  })
  await dialog.getByRole('button', { name: 'Yes, delete' }).click()
  await expect(dialog).toHaveCount(0)

  const done = page.getByRole('status')
  await expect(done).toContainText(`${target.name} deleted.`)
  await expect(done).toBeInViewport()
  await expect(rowOf(page, target)).toHaveCount(0)
  // The refetch after the delete keeps the table up, so the window stays where
  // the admin was instead of jumping back to the top. (Not an exact match:
  // other tests running alongside add accounts to the same list.)
  expect(scrolledTo).toBeGreaterThan(200)
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(scrolledTo - 150)
})

test('a refused delete says why, in the admin language, where the admin can see it', async ({ page }) => {
  const token = await adminToken()
  for (let index = 0; index < 12; index += 1) await createUser(token, { role: 'teacher', name: 'Filler Teacher' })
  const manager = await createUser(token, { role: 'manager', name: 'Zz Busy Manager' })
  const report = await createUser(token, { role: 'teacher', name: 'Report Teacher', managerId: manager.id })

  await page.addInitScript((value) => localStorage.setItem('feedback-evaluator.token', value), token)
  await page.goto('/admin')

  const row = rowOf(page, manager)
  await row.scrollIntoViewIfNeeded()
  await row.getByRole('button', { name: 'Delete' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Yes, delete' }).click()

  const refusal = page.getByRole('alert')
  await expect(refusal).toContainText(`${manager.name} was not deleted`)
  await expect(refusal).toContainText(report.name)
  await expect(refusal).toBeInViewport()
  // Still there, and the message can be put away.
  await expect(rowOf(page, manager)).toHaveCount(1)
  await refusal.getByRole('button', { name: 'Dismiss' }).click()
  await expect(refusal).toHaveCount(0)
})
