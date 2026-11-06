import { test } from 'node:test'
import assert from 'node:assert/strict'
import { promptFor, textFor, titleFor } from '../../shared/activity.js'
import { initialWording } from '../../src/lib/wording.js'

/* Pinned before the change: these held with the old promptFor and must still. */

test('promptFor: the language asked for wins', () => {
  const question = { prompt: 'Neutral', promptByLang: { en: 'English', tr: 'Türkçe' } }
  assert.equal(promptFor(question, 'en'), 'English')
  assert.equal(promptFor(question, 'tr'), 'Türkçe')
})

test('promptFor: a blank language falls back to the neutral prompt', () => {
  const question = { prompt: 'Neutral', promptByLang: { en: 'English', tr: '   ' } }
  assert.equal(promptFor(question, 'tr'), 'Neutral')
})

test('promptFor: a question with no translations reads the same in both', () => {
  assert.equal(promptFor({ prompt: 'Only this' }, 'en'), 'Only this')
  assert.equal(promptFor({ prompt: 'Only this' }, 'tr'), 'Only this')
  assert.equal(promptFor(null, 'en'), '')
})

/* The change: with no neutral prompt, the other language is the backup. */

test('promptFor: with no neutral prompt, the other language is shown', () => {
  const question = { prompt: '', promptByLang: { tr: 'Sadece Türkçe' } }
  assert.equal(promptFor(question, 'en'), 'Sadece Türkçe')
})

test('titleFor: per-language name, then the stored title, then the other language', () => {
  assert.equal(titleFor({ title: 'Ratio', titleByLang: { tr: 'Oran' } }, 'tr'), 'Oran')
  assert.equal(titleFor({ title: 'Ratio', titleByLang: { tr: 'Oran' } }, 'en'), 'Ratio')
  assert.equal(titleFor({ title: '', titleByLang: { tr: 'Oran' } }, 'en'), 'Oran')
  // Activities made before names were per language have only `title`.
  assert.equal(titleFor({ title: 'Ratio' }, 'tr'), 'Ratio')
})

test('textFor: nothing anywhere is an empty string', () => {
  assert.equal(textFor({}, '', 'en'), '')
  assert.equal(textFor(undefined, undefined, 'tr'), '')
})

/* Opening a question in the two-box form — see src/lib/wording.js. */

test('initialWording: per-language wording goes to its own box', () => {
  const question = { prompt: 'Find x.', promptByLang: { en: 'Find x.', tr: 'x i bulun.' } }
  assert.deepEqual(initialWording(question, 'tr'), { en: 'Find x.', tr: 'x i bulun.' })
})

test('initialWording: an old single prompt opens in the language being read', () => {
  assert.deepEqual(initialWording({ prompt: 'Oranı bulun.' }, 'tr'), { en: '', tr: 'Oranı bulun.' })
  assert.deepEqual(initialWording({ prompt: 'Find the ratio.' }, 'en'), { en: 'Find the ratio.', tr: '' })
})

test('initialWording: an old prompt beside one translation fills the blank box', () => {
  const question = { prompt: 'Find the ratio.', promptByLang: { tr: 'Oranı bulun.' } }
  assert.deepEqual(initialWording(question, 'tr'), { en: 'Find the ratio.', tr: 'Oranı bulun.' })
})

test('initialWording: a new question opens blank', () => {
  assert.deepEqual(initialWording(undefined, 'en'), { en: '', tr: '' })
})
