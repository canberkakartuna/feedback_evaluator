import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isNavActive } from '../../src/lib/navActive.js'

const activities = { to: '/teacher', end: true, also: ['/teacher/activities'] }
const students = { to: '/teacher/students' }
const support = { to: '/teacher/support' }

test('the /teacher index tab is current on itself and on activity pages only', () => {
  assert.equal(isNavActive('/teacher', activities), true)
  assert.equal(isNavActive('/teacher/', activities), true)
  assert.equal(isNavActive('/teacher/activities/abc', activities), true)
  assert.equal(isNavActive('/teacher/activities/abc/preview', activities), true)
  assert.equal(isNavActive('/teacher/students', activities), false)
  assert.equal(isNavActive('/teacher/support', activities), false)
})

test('a plain tab is current on itself and on pages below it', () => {
  assert.equal(isNavActive('/teacher/students', students), true)
  assert.equal(isNavActive('/teacher/students/s1', students), true)
  assert.equal(isNavActive('/teacher/class-list', students), false)
  assert.equal(isNavActive('/teacher', students), false)
})

test('matching is by path segment, not by string prefix', () => {
  assert.equal(isNavActive('/teacher/supporters', support), false)
  assert.equal(isNavActive('/teacher/activitiesX', activities), false)
})

test('exactly one teacher tab is current on every console page', () => {
  const tabs = [
    activities,
    students,
    { to: '/teacher/class-list' },
    { to: '/teacher/labelling' },
    support,
    { to: '/teacher/teachers' },
  ]
  for (const path of [
    '/teacher',
    '/teacher/activities/a1',
    '/teacher/activities/a1/preview',
    '/teacher/students',
    '/teacher/students/s1',
    '/teacher/class-list',
    '/teacher/labelling',
    '/teacher/support',
    '/teacher/teachers',
  ]) {
    assert.equal(tabs.filter((tab) => isNavActive(path, tab)).length, 1, path)
  }
})
