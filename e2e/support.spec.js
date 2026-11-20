import { expect, test } from '@playwright/test'
import { replyToSupport, seedClass } from './support/seed.mjs'
import { signInFirstTime } from './support/student.mjs'

/** Path 8 — the support channel: write in, read the reply, answer in the same thread. */
test('a student writes to support, reads the reply and answers in the same thread', async ({ page }) => {
  const { teacher, studentNumber } = await seedClass()
  await signInFirstTime(page, studentNumber)

  await page.getByRole('link', { name: 'Support' }).click()
  await expect(page.getByRole('heading', { name: 'Write to us' })).toBeVisible()
  await expect(page.getByText('You have not written in yet.')).toBeVisible()

  const send = page.getByRole('button', { name: 'Send', exact: true })
  await expect(send).toBeDisabled()
  await page.getByLabel('Category').selectOption({ label: 'Suggestion' })
  await page.getByLabel('Title').fill('Bigger answer box')
  await page.getByLabel('Message').fill('The answer box could be taller on my laptop.')
  await send.click()

  await expect(page.getByRole('status')).toHaveText('Sent. The reply will appear below.')
  const thread = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Bigger answer box' }) })
  await expect(thread).toBeVisible()
  await expect(thread).toContainText('Suggestion')
  await expect(thread).toContainText('No reply yet.')

  // The teacher answers from their inbox (seeded through the API).
  await replyToSupport(teacher, 'Bigger answer box', 'Thanks — we will look at it this week.')

  // The navbar says a reply is waiting, until the support page is opened.
  await page.goto('/')
  await expect(page.getByLabel('A reply is waiting')).toBeVisible()
  await page.getByRole('link', { name: /Support/ }).click()
  await expect(thread).toContainText('Thanks — we will look at it this week.')
  await expect(thread).toContainText(/Reply from Tess Teacher/)
  await expect(thread).not.toContainText('No reply yet.')
  await expect(page.getByLabel('A reply is waiting')).toHaveCount(0)

  // The student answers back under the same message, not as a new one.
  await thread.getByLabel('Reply in this conversation').fill('Great, thank you!')
  await thread.getByRole('button', { name: 'Send reply' }).click()
  await expect(thread).toContainText('Great, thank you!')
  await expect(thread).toContainText(/You wrote ·/)
  await expect(thread).toContainText('No reply yet.')
  await expect(page.locator('article')).toHaveCount(1)

  // All of it is still there after a reload.
  await page.reload()
  await expect(thread).toContainText('Thanks — we will look at it this week.')
  await expect(thread).toContainText('Great, thank you!')
})
