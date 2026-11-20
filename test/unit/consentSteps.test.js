import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CONSENT_STEPS,
  CONSENT_STEP_COUNT,
  canLeaveStep,
  consentAppliesTo,
  needsConsent,
} from '../../src/lib/consentSteps.js'

test('three pages, in order: sheet, form, notice', () => {
  assert.deepEqual(CONSENT_STEPS, ['sheet', 'form', 'notice'])
  assert.equal(CONSENT_STEP_COUNT, 3)
})

test('page 1 is left only once the sheet is marked read', () => {
  assert.equal(canLeaveStep(1, { sheetRead: true }), true)
  assert.equal(canLeaveStep(1, { sheetRead: false }), false)
  assert.equal(canLeaveStep(1, {}), false)
  assert.equal(canLeaveStep(1), false)
  // The form's ticks do not open page 1.
  assert.equal(canLeaveStep(1, { sheetRead: false, ticks: Array(6).fill(true) }), false)
  assert.equal(canLeaveStep(1, { sheetRead: 'yes' }), false)
})

test('page 2 is left only once all six statements are ticked', () => {
  assert.equal(canLeaveStep(2, { ticks: Array(6).fill(true) }), true)
  assert.equal(canLeaveStep(2, { sheetRead: true, ticks: Array(6).fill(false) }), false)
  for (let missing = 0; missing < 6; missing += 1) {
    const ticks = Array(6).fill(true)
    ticks[missing] = false
    assert.equal(canLeaveStep(2, { sheetRead: true, ticks }), false, `statement ${missing + 1} unticked`)
  }
  assert.equal(canLeaveStep(2, { sheetRead: true }), false)
})

test('page 3 has no box: its button is the acceptance', () => {
  assert.equal(canLeaveStep(3, {}), true)
  assert.equal(canLeaveStep(3), true)
})

test('pages outside 1–3 are never passable', () => {
  for (const step of [0, 4, -1, undefined, '1']) {
    assert.equal(canLeaveStep(step, { sheetRead: true, ticks: Array(6).fill(true) }), false, String(step))
  }
})

test('only students are asked: staff of every kind go straight in', () => {
  assert.equal(consentAppliesTo({ role: 'student' }), true)
  for (const role of ['admin', 'manager', 'annotator', 'teacher']) {
    assert.equal(consentAppliesTo({ role }), false, role)
    assert.equal(needsConsent({ role, consented: false, withdrawn: false }), false, role)
  }
  assert.equal(consentAppliesTo(null), false)
  assert.equal(consentAppliesTo(undefined), false)
  assert.equal(needsConsent(null), false)
})

test('a student is asked until they consent, and not after withdrawing', () => {
  assert.equal(needsConsent({ role: 'student', consented: false, withdrawn: false }), true)
  assert.equal(needsConsent({ role: 'student' }), true)
  assert.equal(needsConsent({ role: 'student', consented: true, withdrawn: false }), false)
  assert.equal(needsConsent({ role: 'student', consented: false, withdrawn: true }), false)
})
