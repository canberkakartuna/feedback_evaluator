import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { E2E } from './ports.mjs'
import { api, seedClass } from './support/seed.mjs'

/**
 * Labelling one snippet at a time, as an annotator: Next, a skipped snippet
 * shown as skipped, the end summary listing what is left, and a reload that
 * resumes at the first snippet not complete.
 *
 * The dialogs come from the scripted tutor (no OPENAI_API_KEY in the e2e API).
 */

const CRITERIA_COUNT = 5

async function adminToken() {
  return (await api('POST', '/api/auth/login', { body: { email: E2E.admin.email, password: E2E.admin.password } }))
    .token
}

/** A student's three tutor exchanges, picked into a new dataset assigned to a new annotator. */
async function seedDatasetForAnnotator() {
  const { studentNumber, activity, teacher } = await seedClass()
  const student = (await api('POST', '/api/auth/student', { body: { studentNumber } })).token
  const { session, activity: opened } = await api('POST', '/api/sessions', {
    token: student,
    body: { consent: true, activityId: activity.id },
  })
  const questionId = opened.questions[0].id
  for (const text of ['Where do I start?', 'Can you give me a hint?', 'Is this right?']) {
    await api('POST', `/api/sessions/${session.id}/questions/${questionId}/messages`, { token: student, body: { text } })
  }

  const admin = await adminToken()
  const { snippets } = await api('GET', `/api/research/snippets?sessionId=${session.id}`, { token: admin })
  if (snippets.length !== 3) throw new Error(`expected 3 snippets, got ${snippets.length}`)

  const suffix = randomUUID().slice(0, 8)
  const { dataset } = await api('POST', '/api/research/datasets', { token: admin, body: { name: `Steps ${suffix}` } })
  await api('POST', `/api/research/datasets/${dataset.id}/snippets`, {
    token: admin,
    body: { snippetIds: snippets.map((snippet) => snippet.id) },
  })

  const email = `annotator-${suffix}@example.com`
  const password = 'e2e annotator password'
  const { user } = await api('POST', '/api/users', {
    token: admin,
    body: { role: 'annotator', name: `Ann ${suffix}`, email, password },
  })
  await api('POST', `/api/research/datasets/${dataset.id}/members`, { token: admin, body: { userId: user.id } })
  return { email, password, dataset, teacher }
}

async function signInStaff(page, { email, password }) {
  await page.goto('/signin')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

const progress = (page) => page.getByRole('region', { name: 'Your progress' })
const stepNav = (page) => page.getByRole('navigation', { name: 'Move between snippets' })
const heading = (page) => page.getByRole('heading', { level: 2, name: /^Snippet \d+ \/ \d+$/ })

/** Rates every criterion on the snippet on screen ("Yes" each time). */
async function rateAll(page) {
  const yes = page.locator('article.cs-snip').getByRole('button', { name: 'Yes', exact: true })
  await expect(yes).toHaveCount(CRITERIA_COUNT)
  for (let i = 0; i < CRITERIA_COUNT; i += 1) {
    await yes.nth(i).click()
    await expect(yes.nth(i)).toHaveAttribute('aria-pressed', 'true')
  }
}

test.describe('labelling one snippet at a time', () => {
  test('an annotator steps through, skips one, sees it listed, completes it, and resumes', async ({ page }) => {
    const seeded = await seedDatasetForAnnotator()
    await signInStaff(page, seeded)

    // Opens on the first snippet, with the position in the URL.
    await expect(heading(page)).toHaveText('Snippet 1 / 3')
    await expect(page).toHaveURL(/[?&]sample=1\b/)
    await expect(page).toHaveURL(new RegExp(`dataset=${seeded.dataset.id}`))
    await expect(progress(page)).toContainText('0 complete · 0 incomplete · 3 not started')

    // Complete the first, then Next.
    await rateAll(page)
    await expect(page.locator('.cs-step-status')).toHaveText(/Complete/)
    await stepNav(page).getByRole('button', { name: 'Next', exact: true }).click()
    await expect(heading(page)).toHaveText('Snippet 2 / 3')
    await expect(heading(page)).toBeFocused()

    // Rate one criterion only and move on: snippet 2 is incomplete and skipped.
    await page.locator('article.cs-snip').getByRole('button', { name: 'Partly', exact: true }).first().click()
    await expect(progress(page)).toContainText('1 complete · 1 incomplete · 1 not started')
    // A "why" note typed and left straight for Next is saved, not lost.
    await page.getByLabel('Why', { exact: true }).first().fill('Too vague to act on.')
    await stepNav(page).getByRole('button', { name: 'Next', exact: true }).click()
    await expect(heading(page)).toHaveText('Snippet 3 / 3')
    await expect(progress(page).getByRole('button', { name: 'Snippet 2: Incomplete, skipped' })).toBeVisible()
    await expect(progress(page)).toContainText('1 skipped')

    // The last one's Next is Finish; the end lists what is left, with links.
    await stepNav(page).getByRole('button', { name: 'Finish' }).click()
    await expect(page.getByRole('heading', { name: 'End of this set' })).toBeFocused()
    await expect(page.getByText('2 snippets are not complete yet:')).toBeVisible()
    await expect(page).toHaveURL(/[?&]sample=done\b/)

    // Back goes to the previous snippet.
    await page.goBack()
    await expect(heading(page)).toHaveText('Snippet 3 / 3')
    await page.goForward()
    await page.getByRole('button', { name: 'Open snippet 2' }).click()
    await expect(heading(page)).toHaveText('Snippet 2 / 3')
    await page.reload()
    await expect(page.getByLabel('Why', { exact: true }).first()).toHaveValue('Too vague to act on.')
    await rateAll(page)
    await expect(progress(page)).toContainText('2 complete · 0 incomplete · 1 not started')

    // Reload with no position resumes at the first not complete: snippet 3.
    await page.goto(`/annotate?dataset=${seeded.dataset.id}`)
    await expect(heading(page)).toHaveText('Snippet 3 / 3')
    await expect(page).toHaveURL(/[?&]sample=3\b/)
    // Labels were saved on the server, not only on screen.
    await expect(progress(page)).toContainText('2 complete · 0 incomplete · 1 not started')

    // A plain reload keeps the snippet in the URL.
    await page.goto(`/annotate?dataset=${seeded.dataset.id}&sample=1`)
    await expect(heading(page)).toHaveText('Snippet 1 / 3')
    await page.reload()
    await expect(heading(page)).toHaveText('Snippet 1 / 3')

    // Next incomplete jumps to the one left.
    await stepNav(page).getByRole('button', { name: 'Next incomplete' }).click()
    await expect(heading(page)).toHaveText('Snippet 3 / 3')
    await rateAll(page)
    await expect(stepNav(page).getByRole('button', { name: 'Next incomplete' })).toBeDisabled()
    await stepNav(page).getByRole('button', { name: 'Finish' }).click()
    await expect(page.getByText('All 3 snippets are complete. Thank you.')).toBeVisible()
  })

  test('a teacher labels a dataset one snippet at a time, in Turkish, at phone width', async ({ page }) => {
    const seeded = await seedDatasetForAnnotator()
    const admin = await adminToken()
    await api('POST', `/api/research/datasets/${seeded.dataset.id}/members`, {
      token: admin,
      body: { userId: seeded.teacher.user.id },
    })

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/signin')
    await page.getByRole('button', { name: 'TR', exact: true }).click()
    await page.getByLabel('E-posta').fill(seeded.teacher.email)
    await page.getByLabel('Şifre').fill(seeded.teacher.password)
    await page.getByRole('button', { name: 'Giriş yap' }).click()
    await expect(page).not.toHaveURL(/\/signin/)

    await page.goto(`/teacher/labelling?dataset=${seeded.dataset.id}`)
    const head = page.getByRole('heading', { level: 2, name: /^Kesit \d+ \/ \d+$/ })
    await expect(head).toHaveText('Kesit 1 / 3')
    await expect(page.locator('article.cs-snip')).toHaveCount(1)
    await expect(page.getByRole('region', { name: 'İlerlemeniz' })).toContainText('0 tamamlandı · 0 eksik · 3 başlanmadı')

    await page.getByRole('navigation', { name: 'Kesitler arasında gezinme' }).getByRole('button', { name: 'Sonraki' }).click()
    await expect(head).toHaveText('Kesit 2 / 3')
    await expect(page.getByRole('button', { name: 'Kesit 1: Başlanmadı, atlandı' })).toBeVisible()

    // Nothing wider than the phone.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(0)
  })
})
