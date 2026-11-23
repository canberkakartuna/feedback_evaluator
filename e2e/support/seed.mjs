import { randomInt, randomUUID } from 'node:crypto'
import { E2E } from '../ports.mjs'

/**
 * Seeding through the e2e API, as a teacher would through the console — but
 * over HTTP, so each test sets up exactly what it needs in a few milliseconds
 * and owns it: its own teacher, its own class list, its own activities. Signed-in
 * students only see their own teacher's activities, so tests never see each
 * other's data even when they run in parallel against the one server.
 */

export async function api(method, path, { body, token } = {}) {
  const response = await fetch(`${E2E.apiOrigin}${path}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  const payload = text ? JSON.parse(text) : null
  if (!response.ok) {
    throw new Error(`${method} ${path} → ${response.status}: ${text}`)
  }
  return payload
}

let adminToken = null
async function admin() {
  if (!adminToken) {
    adminToken = (
      await api('POST', '/api/auth/login', {
        body: { email: E2E.admin.email, password: E2E.admin.password },
      })
    ).token
  }
  return adminToken
}

/** An 8-digit username nobody else in this run has (random; collisions are ~1 in 10^7 per pair). */
export function newStudentNumber() {
  return String(randomInt(60_000_000, 99_999_999))
}

/** A teacher of their own, signed in. */
export async function createTeacher(name = 'Tess Teacher') {
  const suffix = randomUUID().slice(0, 8)
  const email = `teacher-${suffix}@example.com`
  const password = 'e2e teacher password'
  const { user } = await api('POST', '/api/users', {
    token: await admin(),
    body: { role: 'teacher', name: `${name} ${suffix}`, email, password },
  })
  const { token } = await api('POST', '/api/auth/login', { body: { email, password } })
  return { user, token, email, password }
}

/** Puts student numbers on the teacher's class list. */
export async function addToClassList(teacher, numbers) {
  await api('POST', '/api/users/class-list', { token: teacher.token, body: { studentNumbers: numbers } })
}

/**
 * A two-question activity, published. The first question is marked by
 * keyword (so "Check my answer" gives a verdict); the second is open.
 */
export const DEFAULT_QUESTIONS = [
  {
    kind: 'Explain',
    prompt: 'Why does a ratio of 2:4 equal 1:2?',
    promptByLang: { tr: '2:4 oranı neden 1:2 oranına eşittir?' },
    rubric: [
      { label: 'Divides both parts', points: 1, keywords: ['divide'] },
      { label: 'Names the common factor', points: 1, keywords: ['factor'] },
    ],
  },
  {
    kind: 'Calculate',
    prompt: 'Share 12 sweets in the ratio 1:3.',
    promptByLang: { tr: '12 şekeri 1:3 oranında paylaştır.' },
  },
]

export async function createActivity(
  teacher,
  { title = 'Ratio practice', topic = 'ratio', questions = DEFAULT_QUESTIONS, tutorPrompt, mathTools, publish = true } = {},
) {
  const { activity } = await api('POST', '/api/activities', {
    token: teacher.token,
    body: { title, topic, ...(tutorPrompt ? { tutorPrompt } : {}), ...(mathTools ? { mathTools } : {}) },
  })
  for (const question of questions) {
    await api('POST', `/api/activities/${activity.id}/questions`, { token: teacher.token, body: question })
  }
  if (publish) {
    await api('PATCH', `/api/activities/${activity.id}`, {
      token: teacher.token,
      body: { status: 'published' },
    })
  }
  return activity
}

/**
 * The usual starting point: a teacher, one published activity, and a fresh
 * student number on their class list that has never signed in.
 */
export async function seedClass(options = {}) {
  const teacher = await createTeacher()
  const studentNumber = newStudentNumber()
  await addToClassList(teacher, [studentNumber])
  const activity = await createActivity(teacher, options)
  return { teacher, studentNumber, activity }
}

/** A staff reply to a student's support message, as the inbox would send it. */
export async function replyToSupport(teacher, subject, text) {
  const { messages } = await api('GET', '/api/support', { token: teacher.token })
  const message = messages.find((each) => each.subject === subject)
  if (!message) throw new Error(`No support message titled "${subject}" in the teacher's inbox`)
  await api('POST', `/api/support/${message.id}/reply`, { token: teacher.token, body: { text } })
}
