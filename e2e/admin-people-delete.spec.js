import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { E2E } from './ports.mjs'
import { api } from './support/seed.mjs'

/**
 * Admin side: deleting an account on /admin (People). The list is long, so the
 * row's Delete button sits well below the top of the page — the result of the
 * press (done, or refused and why) has to show where the admin is looking, not
 * up at the top of the page they have scrolled away from.
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
  await row.getByRole('button', { name: 'Delete' }).click()

  // One press does not delete: it asks first, in the row.
  await expect(row.getByText(`Delete ${target.name}?`)).toBeVisible()
  await expect(row).toBeVisible()
  const scrolledTo = await page.evaluate(() => window.scrollY)
  // A real network takes a moment over the refetch; locally it is too quick to
  // ever paint the in-between state this guards against.
  await page.route('**/api/users', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 400))
    await route.continue()
  })
  await row.getByRole('button', { name: 'Yes, delete' }).click()

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
  await row.getByRole('button', { name: 'Yes, delete' }).click()

  const refusal = page.getByRole('alert')
  await expect(refusal).toContainText(`${manager.name} was not deleted`)
  await expect(refusal).toContainText(report.name)
  await expect(refusal).toBeInViewport()
  // Still there, and the message can be put away.
  await expect(rowOf(page, manager)).toHaveCount(1)
  await refusal.getByRole('button', { name: 'Dismiss' }).click()
  await expect(refusal).toHaveCount(0)
})
