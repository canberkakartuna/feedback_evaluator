import { test } from 'node:test'
import assert from 'node:assert/strict'
import { opensPicker } from '../../src/lib/uploadPicker.js'

/**
 * When a click on a mode tab also opens the file picker — src/lib/uploadPicker.js,
 * called from QuestionPanel's requestMode.
 */

const answer = (mode, { draft = '', strokes = [], attachments = [] } = {}) => ({
  mode,
  draft,
  strokes,
  attachments,
})
const photo = { id: 'f1', name: 'working.png', source: 'file' }
const board = { id: 'b1', name: 'board.png', source: 'whiteboard' }

test('already in Upload with no photo: the tab opens the picker', () => {
  assert.equal(opensPicker(answer('upload'), 'upload'), true)
})

test('already in Upload with a photo: re-clicking the tab does not prompt a replace', () => {
  assert.equal(opensPicker(answer('upload', { attachments: [photo] }), 'upload'), false)
})

test('switching into Upload from an empty answer: switch and open', () => {
  assert.equal(opensPicker(answer('write'), 'upload'), true)
  assert.equal(opensPicker(answer('write', { draft: '   ' }), 'upload'), true)
  assert.equal(opensPicker(answer('draw'), 'upload'), true)
})

test('switching into Upload when the discard warning shows: no picker', () => {
  assert.equal(opensPicker(answer('write', { draft: 'ratio is 1:2' }), 'upload'), false)
  assert.equal(opensPicker(answer('draw', { strokes: [[0, 0]], attachments: [board] }), 'upload'), false)
})

test('any other tab never opens it', () => {
  assert.equal(opensPicker(answer('upload'), 'write'), false)
  assert.equal(opensPicker(answer('write'), 'write'), false)
  assert.equal(opensPicker(answer('write'), 'draw'), false)
})
