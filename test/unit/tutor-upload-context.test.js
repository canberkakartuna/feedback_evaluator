import { test } from 'node:test'
import assert from 'node:assert/strict'
import { withFallbacks } from '../../shared/tutor-scripts.js'
import { systemInstruction } from '../../server/services/tutor.js'

/**
 * An uploaded answer no longer starts the tutor by itself (Session.jsx): the
 * student starts the chat when they choose to. These pin that a turn they
 * start — a typed message, not the old automatic "review" — still gives the
 * model their uploaded working to read.
 */

const question = {
  code: 'Q1',
  prompt: 'Share 12 sweets in the ratio 1:3.',
  rubric: [],
  tutor: withFallbacks(null),
}

const uploaded = {
  mode: 'upload',
  attachments: [{ id: 'upl_1', name: 'working.png', type: 'image/png', source: 'file', url: '/api/uploads/upl_1' }],
}

test('a typed message after an upload tells the model the upload is attached', () => {
  const text = systemInstruction({
    question,
    answer: uploaded,
    action: null,
    lang: 'en',
    work: [{ url: 'data:image/png;base64,AAAA' }],
  })
  assert.match(text, /The student's answer is a file they uploaded/)
  assert.match(text, /attached to their latest message/)
  assert.match(text, /Reply to the student's message below\./)
})

test('an upload the model could not load is still named, not ignored', () => {
  const text = systemInstruction({ question, answer: uploaded, action: null, lang: 'en', work: [] })
  assert.match(text, /working on paper and photographing it \(1 files\)/)
})
