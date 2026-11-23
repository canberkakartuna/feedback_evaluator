import { expect, test } from '@playwright/test'
import { createActivity, seedClass } from './support/seed.mjs'
import { TINY_PNG, openActivity, questionList, signInFirstTime } from './support/student.mjs'

const isAnswerSave = (response) =>
  response.request().method() === 'PUT' && /\/api\/sessions\/[^/]+\/answers\//.test(response.url())

/** Path 3 — opening an activity, reading its questions, and answering them. */
test.describe('working on an activity', () => {
  test('the questions are listed and one can be opened', async ({ page }) => {
    const { studentNumber } = await seedClass()
    await signInFirstTime(page, studentNumber)
    await openActivity(page, 'Ratio practice')

    const list = questionList(page)
    await expect(list.getByRole('button', { name: /^Q1/ })).toBeVisible()
    await expect(list.getByRole('button', { name: /^Q2/ })).toBeVisible()

    // The first question is open to begin with.
    const main = page.getByRole('main')
    await expect(main.getByText('Why does a ratio of 2:4 equal 1:2?')).toBeVisible()
    await expect(main.getByLabel('Question 1 of 2')).toBeVisible()

    // Picking another from the list opens it.
    await list.getByRole('button', { name: /^Q2/ }).click()
    await expect(main.getByText('Share 12 sweets in the ratio 1:3.')).toBeVisible()
    await expect(main.getByLabel('Question 2 of 2')).toBeVisible()

    // Previous / Next walk the set too.
    await main.getByRole('button', { name: /Previous/ }).click()
    await expect(main.getByLabel('Question 1 of 2')).toBeVisible()
  })

  test('a written answer is saved and is still there after a reload', async ({ page }) => {
    const { studentNumber } = await seedClass()
    await signInFirstTime(page, studentNumber)
    await openActivity(page, 'Ratio practice')

    const answer = page.getByLabel('Your written answer')
    const saved = page.waitForResponse(isAnswerSave)
    await answer.fill('Two to four simplifies to one to two.')
    expect((await saved).ok()).toBe(true)

    await page.reload()
    await expect(page.getByLabel('Your written answer')).toHaveValue('Two to four simplifies to one to two.')
  })

  test('checking a written answer marks it against the rubric', async ({ page }) => {
    const { studentNumber } = await seedClass()
    await signInFirstTime(page, studentNumber)
    await openActivity(page, 'Ratio practice')

    const answer = page.getByLabel('Your written answer')
    const q1 = questionList(page).getByRole('button', { name: /^Q1/ })

    // One of two criteria met → needs revision.
    await answer.fill('You divide both numbers by two and the ratio stays the same.')
    await page.getByRole('button', { name: 'Check my answer' }).click()
    await expect(q1).toContainText('Revise · 1/2')

    // Both met → mastered.
    await answer.fill('You divide both parts by their common factor, two, so 2:4 is 1:2.')
    await page.getByRole('button', { name: 'Check my answer' }).click()
    await expect(q1).toContainText('Mastered · 2/2')
    await expect(page.getByText('Every rubric point is covered')).toBeVisible()

    await page.reload()
    await expect(questionList(page).getByRole('button', { name: /^Q1/ })).toContainText('Mastered · 2/2')
  })

  test('a photo of the working can be uploaded and is still there after a reload', async ({ page }) => {
    const { studentNumber } = await seedClass()
    await signInFirstTime(page, studentNumber)
    await openActivity(page, 'Ratio practice')
    await questionList(page).getByRole('button', { name: /^Q2/ }).click()

    await page.getByRole('button', { name: /^Upload/ }).click()
    await expect(page.getByRole('button', { name: /^Upload/ })).toHaveAttribute('aria-pressed', 'true')

    const uploaded = page.waitForResponse(
      (response) => response.request().method() === 'POST' && /\/uploads$/.test(response.url()),
    )
    await page.getByLabel(/Add a photo/).setInputFiles({
      name: 'my-working.png',
      mimeType: 'image/png',
      buffer: TINY_PNG,
    })
    expect((await uploaded).ok()).toBe(true)

    const main = page.getByRole('main')
    await expect(main.getByRole('button', { name: 'Remove my-working.png' })).toBeVisible()
    await expect(main.getByText('Upload a new photo')).toBeVisible()
    // The photo itself is served back.
    await expect(main.getByRole('link', { name: 'Open my-working.png in a new tab' })).toBeVisible()

    await page.reload()
    await questionList(page).getByRole('button', { name: /^Q2/ }).click()
    await expect(page.getByRole('main').getByRole('button', { name: 'Remove my-working.png' })).toBeVisible()
    const image = page.getByRole('main').getByRole('link', { name: 'Open my-working.png in a new tab' }).locator('img')
    await expect(image).toHaveJSProperty('naturalWidth', 1)
  })

  test('a file that is not a photo is refused with a reason', async ({ page }) => {
    const { studentNumber } = await seedClass()
    await signInFirstTime(page, studentNumber)
    await openActivity(page, 'Ratio practice')

    await page.getByRole('button', { name: /^Upload/ }).click()
    await page.getByLabel(/Add a photo/).setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('not a photo'),
    })
    await expect(page.getByRole('alert')).toContainText('notes.txt is not a photo')
  })
})

/** Path 5 — question status marks, and the topic filter on the activity list. */
test.describe('status marks and topics', () => {
  test('self-marks show in the question list and survive a reload', async ({ page }) => {
    const { studentNumber } = await seedClass()
    await signInFirstTime(page, studentNumber)
    await openActivity(page, 'Ratio practice')

    const list = questionList(page)
    const q1 = list.getByRole('button', { name: /^Q1/ })
    const q2 = list.getByRole('button', { name: /^Q2/ })
    await expect(q1).toContainText('Not started')
    await expect(list.getByText('0 of 2')).toBeVisible()

    const marks = page.getByRole('main')
    const saved = () => page.waitForResponse(isAnswerSave)

    // Two self-marks, no visible heading over them.
    const choices = marks.getByRole('group', { name: 'How did this one go?' }).getByRole('button')
    await expect(choices).toHaveText(['Done', 'In progress'])
    await expect(marks.getByText('How did this one go?')).toHaveCount(0)
    await expect(marks.getByRole('button', { name: 'Got it wrong' })).toHaveCount(0)

    let done = saved()
    await marks.getByRole('button', { name: 'Done' }).click()
    await done
    await expect(marks.getByRole('button', { name: 'Done' })).toHaveAttribute('aria-pressed', 'true')
    await expect(q1).toContainText('Done')
    await expect(list.getByText('1 of 2')).toBeVisible()

    await q2.click()
    done = saved()
    await marks.getByRole('button', { name: 'In progress' }).click()
    await done
    await expect(q2).toContainText('In progress')
    await expect(list.getByText('1 of 2')).toBeVisible()

    await page.reload()
    await expect(questionList(page).getByRole('button', { name: /^Q1/ })).toContainText('Done')
    await expect(questionList(page).getByRole('button', { name: /^Q2/ })).toContainText('In progress')
    await expect(questionList(page).getByText('1 of 2')).toBeVisible()

    // Pressing the same mark again clears it.
    await questionList(page).getByRole('button', { name: /^Q1/ }).click()
    done = saved()
    await page.getByRole('main').getByRole('button', { name: 'Done' }).click()
    await done
    await expect(questionList(page).getByRole('button', { name: /^Q1/ })).toContainText('Not started')
  })

  test('the topic filter narrows the activity list', async ({ page }) => {
    const { teacher, studentNumber } = await seedClass({ title: 'Ratio practice', topic: 'ratio' })
    await createActivity(teacher, { title: 'Functions warm-up', topic: 'functions' })
    await signInFirstTime(page, studentNumber)

    const filter = page.getByRole('group', { name: 'Topic' })
    await expect(filter.getByRole('button', { name: /All topics/ })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('button', { name: /Ratio practice/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Functions warm-up/ })).toBeVisible()

    await filter.getByRole('button', { name: /^Functions/ }).click()
    await expect(page.getByRole('button', { name: /Functions warm-up/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Ratio practice/ })).toHaveCount(0)

    await filter.getByRole('button', { name: /^Ratio/ }).click()
    await expect(page.getByRole('button', { name: /Ratio practice/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Functions warm-up/ })).toHaveCount(0)

    await filter.getByRole('button', { name: /All topics/ }).click()
    await expect(page.getByRole('button', { name: /Ratio practice/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /Functions warm-up/ })).toBeVisible()
  })
})
