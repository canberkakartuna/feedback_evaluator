import { test } from 'node:test'
import assert from 'node:assert/strict'
import { homeFor, landingFor } from '../../src/lib/auth.js'
import { DEFAULT_LANGUAGE, LANGUAGES, roleStringKey, translate } from '../../src/lib/i18n.js'
import { NO_TOPIC, matchesTopic, topicKey } from '../../src/lib/topics.js'

// Pins the helpers moved out of auth.jsx, i18n.jsx and TopicFilter.jsx so
// those files export only components (react/only-export-components).

test('homeFor sends each role to its console', () => {
  assert.equal(homeFor(null), '/')
  assert.equal(homeFor({ role: 'admin' }), '/admin')
  assert.equal(homeFor({ role: 'manager' }), '/teacher')
  assert.equal(homeFor({ role: 'teacher' }), '/teacher')
  assert.equal(homeFor({ role: 'student' }), '/')
})

test('landingFor honours `from` only inside the user’s own console', () => {
  const teacher = { role: 'teacher' }
  assert.equal(landingFor(teacher), '/teacher')
  assert.equal(landingFor(teacher, '/teacher/students'), '/teacher/students')
  assert.equal(landingFor(teacher, '/teacher'), '/teacher')
  assert.equal(landingFor(teacher, '/'), '/teacher')
  assert.equal(landingFor(teacher, '/teachers'), '/teacher')
  assert.equal(landingFor(teacher, '/admin'), '/teacher')
  assert.equal(landingFor({ role: 'student' }, '/teacher'), '/')
  assert.equal(landingFor(null, '/teacher'), '/')
})

test('translate fills placeholders, picks plurals and falls back to English', () => {
  assert.equal(DEFAULT_LANGUAGE, 'en')
  assert.deepEqual(LANGUAGES.map((language) => language.id), ['en', 'tr'])
  assert.equal(translate('en', 'common.all'), 'All')
  assert.equal(translate('en', 'common.questions', { count: 1 }), '1 question')
  assert.equal(translate('en', 'common.questions', { count: 3 }), '3 questions')
  assert.equal(translate('xx', 'common.all'), 'All')
  assert.notEqual(translate('tr', 'common.all'), 'common.all')
})

test('roleStringKey builds the people.role* key', () => {
  assert.equal(roleStringKey('admin'), 'people.roleAdmin')
  assert.equal(roleStringKey('teacher'), 'people.roleTeacher')
  assert.equal(roleStringKey(undefined), 'people.role')
})

test('matchesTopic treats null as its own bucket', () => {
  assert.equal(NO_TOPIC, 'none')
  assert.equal(topicKey(null), 'none')
  assert.equal(topicKey(undefined), 'none')
  assert.equal(topicKey('algebra'), 'algebra')
  assert.equal(matchesTopic({ topic: 'algebra' }, 'all'), true)
  assert.equal(matchesTopic({ topic: 'algebra' }, 'algebra'), true)
  assert.equal(matchesTopic({ topic: 'algebra' }, 'geometry'), false)
  assert.equal(matchesTopic({ topic: null }, 'none'), true)
  assert.equal(matchesTopic({}, 'none'), true)
})
