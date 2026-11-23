import { expect, test } from '@playwright/test'
import { seedClass } from './support/seed.mjs'
import { openActivity, questionList, signInFirstTime } from './support/student.mjs'

/** Path 6 — the EN/TR switch changes the interface and question labels, and is remembered. */
test('switching to Turkish changes the workspace and survives a reload', async ({ page }) => {
  const { studentNumber } = await seedClass()
  await signInFirstTime(page, studentNumber)
  await openActivity(page, 'Ratio practice')

  await expect(questionList(page).getByRole('button', { name: /^Q1/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'EN', exact: true })).toHaveAttribute('aria-pressed', 'true')

  await page.getByRole('button', { name: 'TR', exact: true }).click()
  await expect(page.getByRole('button', { name: 'TR', exact: true })).toHaveAttribute('aria-pressed', 'true')

  // Interface text, question labels and the Turkish prompt the teacher wrote.
  const list = page.getByRole('complementary', { name: 'Soru listesi' })
  await expect(list.getByRole('button', { name: /^Soru 1/ })).toBeVisible()
  await expect(list.getByRole('button', { name: /^Soru 2/ })).toBeVisible()
  await expect(page.getByRole('main').getByText('2:4 oranı neden 1:2 oranına eşittir?')).toBeVisible()
  await expect(page.getByRole('complementary', { name: 'Yapay zekâ öğretmeni' }).getByText('20 sorudan 20 hakkın kaldı')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Çıkış yap' })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('button', { name: 'TR', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('complementary', { name: 'Soru listesi' }).getByRole('button', { name: /^Soru 1/ })).toBeVisible()

  // Also on the other screens, after navigating away.
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Ne üzerinde çalışıyorsunuz?' })).toBeVisible()

  // And back to English.
  await page.getByRole('button', { name: 'EN', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'What are you working on?' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'What are you working on?' })).toBeVisible()
})

test('the language chosen before signing in carries through sign-in', async ({ page }) => {
  const { studentNumber } = await seedClass()
  await page.goto('/')
  await page.getByRole('button', { name: 'TR', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Öğrenci girişi' })).toBeVisible()
  await expect(page.getByText('Sadece 8 haneli sayısal değer girilebilir')).toBeVisible()

  await page.getByLabel('Kullanıcı Adı').fill(studentNumber)
  await page.getByRole('button', { name: 'Devam et' }).click()
  await expect(page.getByRole('heading', { name: 'Verileriniz nasıl kullanılıyor' })).toBeVisible()
})
