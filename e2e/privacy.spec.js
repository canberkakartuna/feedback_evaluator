import { expect, test } from '@playwright/test'
import { api, seedClass } from './support/seed.mjs'
import { openActivity, questionList, signIn, signInFirstTime, signOut, tutorPane } from './support/student.mjs'

/**
 * Path 10 — an activity's `tutorPrompt` is the teacher's guidance to the AI
 * tutor, and never travels to a student. Every response the student's browser
 * receives on the way through their usual path is read and searched for it.
 */
const MARKER = 'E2E-TUTOR-PROMPT-MARKER'

test("an activity's tutor prompt never reaches the student's browser", async ({ page }) => {
  const { teacher, studentNumber, activity } = await seedClass({
    tutorPrompt: `${MARKER}: never give the answer, only ask questions back.`,
  })

  // The marker is really there, for the teacher.
  const authored = await api('GET', `/api/activities/${activity.id}`, { token: teacher.token })
  expect(authored.activity.tutorPrompt).toContain(MARKER)

  const bodies = []
  page.on('response', (response) => {
    const type = response.headers()['content-type'] ?? ''
    if (!/json|text|javascript/.test(type)) return
    bodies.push(
      response
        .text()
        .then((text) => ({ url: response.url(), text }))
        .catch(() => ({ url: response.url(), text: '' })),
    )
  })

  await signInFirstTime(page, studentNumber)
  await openActivity(page, 'Ratio practice')

  // Work that makes the server read the activity and run the tutor.
  const tutor = tutorPane(page)
  await tutor.getByLabel('Message the tutor').fill('What should I do first?')
  await tutor.getByRole('button', { name: 'Send' }).click()
  await expect(tutor.getByText('19 of 20 questions left')).toBeVisible()
  await page.getByLabel('Your written answer').fill('You divide both parts by the common factor, which is two here.')
  await page.getByRole('button', { name: 'Check my answer' }).click()
  await expect(questionList(page).getByRole('button', { name: /^Q1/ })).toContainText('2/2')

  await page.reload()
  await expect(tutorPane(page).getByText('What should I do first?')).toBeVisible()
  await page.getByRole('link', { name: 'Profile' }).click()
  await expect(page.getByRole('heading', { name: 'Profile', level: 1 })).toBeVisible()
  await signOut(page)
  await signIn(page, studentNumber)
  await expect(page.getByRole('button', { name: /Ratio practice/ })).toBeVisible()

  const seen = await Promise.all(bodies)
  const apiResponses = seen.filter(({ url }) => new URL(url).pathname.startsWith('/api/'))
  // The path above really went through the API (sign-in, activities, session, tutor, marking).
  expect(apiResponses.length).toBeGreaterThan(10)
  // The text itself, anywhere; and the field, in any API payload (the bundle
  // names it in the teacher's editor code, which is not a leak).
  expect(seen.filter(({ text }) => text.includes(MARKER)).map(({ url }) => url)).toEqual([])
  expect(apiResponses.filter(({ text }) => text.includes('tutorPrompt')).map(({ url }) => url)).toEqual([])
})
