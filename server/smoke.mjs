/**
 * End-to-end check over real HTTP: consent, answering, marking, the tutor,
 * uploads, own questions, events, and the researcher side.
 *
 *   npm run test:api
 *
 * Starts its own server on a spare port with a known research token, so it
 * never touches a running one.
 */
import { createApp } from './app.js'
import { once } from 'node:events'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fe-smoke-'))
process.env.UPLOAD_DIR = uploadDir
process.env.RESEARCH_TOKEN = 'smoke-token'

// config is read at import time, so it must be imported after the env is set.
const { config } = await import('./config.js')
config.uploadDir = uploadDir
config.researchToken = 'smoke-token'

const app = createApp()
const server = app.listen(0)
await once(server, 'listening')
const base = `http://localhost:${server.address().port}`

let passed = 0
const failures = []

function check(name, condition, detail) {
  if (condition) {
    passed += 1
    console.log(`  ✓ ${name}`)
  } else {
    failures.push({ name, detail })
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

async function call(method, url, { body, token } = {}) {
  const res = await fetch(`${base}${url}`, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  })

  const text = await res.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = { raw: text.slice(0, 200) }
  }
  return { status: res.status, body: json, contentType: res.headers.get('content-type') }
}

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='

try {
  console.log('\nhealth + course')
  const health = await call('GET', '/api/health')
  check('health ok', health.status === 200 && health.body.ok === true)
  check('reports in-memory store', health.body.store === 'memory')

  const course = await call('GET', '/api/course')
  check('course returns groups', course.body.course.groups.length === 4)
  const firstQuestion = course.body.course.groups[0].questions[0]
  check('question carries a prompt', typeof firstQuestion.prompt === 'string')
  check('no rubric on the question', !('rubric' in firstQuestion))
  check('tutor scripts are NOT exposed', !('tutor' in firstQuestion))
  // "water potential" is a BIO-101 rubric keyword and appears in its hints,
  // but in none of the public fields — so finding it means something leaked.
  const payload = JSON.stringify(course.body)
  check('no rubric keywords anywhere in the payload', !payload.includes('water potential'))
  check('no hint text anywhere in the payload', !payload.includes('Start outside the cell'))
  check('criteria are counted, not listed', firstQuestion.criteriaCount === 3)

  const badTopic = await call('GET', '/api/course?topicId=nope')
  check('unknown topic is 404', badTopic.status === 404)

  console.log('\nconsent gate')
  const refused = await call('POST', '/api/sessions', { body: { topicId: 'all' } })
  check('no session without consent', refused.status === 400)
  check('says which field is missing', refused.body.error.details?.field === 'consent')

  const declined = await call('POST', '/api/sessions', { body: { consent: false } })
  check('explicit refusal also rejected', declined.status === 400)

  const started = await call('POST', '/api/sessions', {
    body: { consent: true, topicId: 'transport', device: 'smoke' },
  })
  check('session created', started.status === 201)
  const session = started.body.session
  check('consent recorded with a version', Boolean(session.consent.version))
  check('topic scoped course returned', started.body.course.groups.length === 1)
  check('session has a short code', /^[A-Z2-9]{6}$/.test(session.code))

  const byCode = await call('GET', `/api/sessions/by-code/${session.code}`)
  check('phone can attach by code', byCode.body.session.id === session.id)

  console.log('\nanswers + marking')
  const qId = started.body.course.groups[0].questions[1].id // BIO-102, the data question
  const saved = await call('PUT', `/api/sessions/${session.id}/answers/${qId}`, {
    body: { mode: 'write', draft: 'It is active transport because the plateau shows saturation.' },
  })
  check('answer saved', saved.status === 200 && saved.body.answer.mode === 'write')

  const checked = await call('POST', `/api/sessions/${session.id}/answers/${qId}/check`)
  check('marked server-side', checked.status === 200)
  check('partial credit awarded', checked.body.feedback.earned > 0)
  check(
    'unmet criterion returns coaching, not keywords',
    typeof checked.body.feedback.nextStep === 'string' &&
      !JSON.stringify(checked.body.feedback).includes('keywords'),
  )
  check('criterion labels present', checked.body.feedback.criteria.length === 4)

  const badMode = await call('PUT', `/api/sessions/${session.id}/answers/${qId}`, {
    body: { mode: 'telepathy' },
  })
  check('unknown mode rejected', badMode.status === 400)

  const switched = await call('PUT', `/api/sessions/${session.id}/answers/${qId}`, {
    body: { mode: 'draw' },
  })
  check('switching mode clears the old answer', switched.body.answer.draft === '')
  check('switching mode clears the old mark', switched.body.answer.feedback === null)

  const drawCheck = await call('POST', `/api/sessions/${session.id}/answers/${qId}/check`)
  check('a drawing is not scored', drawCheck.body.feedback.markable === false)

  const marked = await call('PUT', `/api/sessions/${session.id}/answers/${qId}`, {
    body: { selfMark: 'unfinished' },
  })
  check('self-mark stored', marked.body.answer.selfMark === 'unfinished')
  const badMark = await call('PUT', `/api/sessions/${session.id}/answers/${qId}`, {
    body: { selfMark: 'brilliant' },
  })
  check('unknown self-mark rejected', badMark.status === 400)

  console.log('\ntutor')
  const hint1 = await call('POST', `/api/sessions/${session.id}/questions/${qId}/messages`, {
    body: { action: 'hint' },
  })
  check('hint returns both turns', hint1.status === 201 && Boolean(hint1.body.student && hint1.body.tutor))
  check('hint 1 labelled', hint1.body.tutor.label === 'Hint 1 of 3')
  const hint2 = await call('POST', `/api/sessions/${session.id}/questions/${qId}/messages`, {
    body: { action: 'hint' },
  })
  check('hints escalate server-side', hint2.body.tutor.label === 'Hint 2 of 3')
  check('hint text differs', hint1.body.tutor.text !== hint2.body.tutor.text)

  const typed = await call('POST', `/api/sessions/${session.id}/questions/${qId}/messages`, {
    body: { text: 'Is it because the carriers are saturated?' },
  })
  check('free text gets a reply', typed.status === 201 && typed.body.tutor.text.length > 0)

  const empty = await call('POST', `/api/sessions/${session.id}/questions/${qId}/messages`, {
    body: {},
  })
  check('empty message rejected', empty.status === 400)

  const rated = await call('POST', `/api/sessions/${session.id}/messages/${typed.body.tutor.id}/rating`, {
    body: { value: 'up' },
  })
  check('feedback can be rated', rated.body.message.rating === 'up')

  const rateStudent = await call(
    'POST',
    `/api/sessions/${session.id}/messages/${typed.body.student.id}/rating`,
    { body: { value: 'up' } },
  )
  check('student turns cannot be rated', rateStudent.status === 400)

  console.log('\nuploads')
  const upload = await call('POST', `/api/sessions/${session.id}/questions/${qId}/uploads`, {
    body: { name: 'working.png', dataUrl: PNG, source: 'whiteboard' },
  })
  check('upload accepted', upload.status === 201)
  check('attached to the answer', upload.body.answer.attachments.length === 1)
  check('bytes are served back', (await fetch(`${base}${upload.body.upload.url}`)).status === 200)
  check('file path is not leaked', upload.body.upload.path === undefined)

  const second = await call('POST', `/api/sessions/${session.id}/questions/${qId}/uploads`, {
    body: { name: 'again.png', dataUrl: PNG, source: 'whiteboard' },
  })
  check('a board replaces its own export', second.body.answer.attachments.length === 1)

  const badFile = await call('POST', `/api/sessions/${session.id}/questions/${qId}/uploads`, {
    body: { name: 'x.txt', dataUrl: 'data:text/plain;base64,aGVsbG8=' },
  })
  check('unsupported type rejected', badFile.status === 400)

  console.log('\nown questions + events')
  const own = await call('POST', `/api/sessions/${session.id}/own-questions`, {
    body: { prompt: 'How do I solve 3(x - 2) = 4x + 1?' },
  })
  check('own question created', own.status === 201 && own.body.question.code === 'OWN-01')

  const ownHint = await call(
    'POST',
    `/api/sessions/${session.id}/questions/${own.body.question.id}/messages`,
    { body: { action: 'hint' } },
  )
  check('own question gets generic hints', ownHint.body.tutor.label === 'Hint 1 of 3')

  const ownCheck = await call(
    'POST',
    `/api/sessions/${session.id}/answers/${own.body.question.id}/check`,
  )
  check('own question cannot be marked', ownCheck.status === 400)

  const events = await call('POST', `/api/sessions/${session.id}/events`, {
    body: { events: [{ type: 'question_shown', questionId: qId }, { type: 'idle' }] },
  })
  check('events accepted in a batch', events.body.written === 2)
  const badEvent = await call('POST', `/api/sessions/${session.id}/events`, {
    body: { events: [{ payload: {} }] },
  })
  check('typeless event rejected', badEvent.status === 400)

  console.log('\nprompt versioning')
  const prompt = await call('POST', '/api/prompts', {
    body: { text: 'Never give the final answer. Ask one question back.', note: 'v1 socratic' },
  })
  check('prompt version created', prompt.body.prompt.versionId === 'v1')
  const later = await call('POST', '/api/sessions', { body: { consent: true } })
  check('new sessions record the active prompt', later.body.session.promptVersion === 'v1')

  console.log('\nresearcher access')
  const noToken = await call('GET', '/api/research/sessions')
  check('research needs a token', noToken.status === 403)
  const wrongToken = await call('GET', '/api/research/sessions', { token: 'nope' })
  check('wrong token refused', wrongToken.status === 403)

  const list = await call('GET', '/api/research/sessions', { token: 'smoke-token' })
  check('sessions listed', list.status === 200 && list.body.sessions.length === 2)
  const row = list.body.sessions.find((entry) => entry.id === session.id)
  check('message counts reported', row.counts.messages === 8)
  check('snippet count reported', row.counts.snippets === 4)

  const transcript = await call(`GET`, `/api/research/sessions/${session.id}/transcript`, {
    token: 'smoke-token',
  })
  check('transcript grouped by question', transcript.body.questions.length === 2)
  check('own question flagged in transcript', transcript.body.questions.some((q) => q.isOwnQuestion))

  const snippets = await call('GET', `/api/research/snippets?sessionId=${session.id}`, {
    token: 'smoke-token',
  })
  check('snippets are student+feedback pairs', snippets.body.snippets.length === 4)
  check(
    'each snippet holds both turns',
    snippets.body.snippets.every((s) => s.student.text && s.tutor.text),
  )
  check('labelling criteria offered', snippets.body.criteria.length === 5)
  check('undecided by default', snippets.body.snippets.every((s) => s.included === null))

  const target = snippets.body.snippets[0]
  const labelled = await call('PATCH', `/api/research/snippets/${target.id}`, {
    token: 'smoke-token',
    body: {
      included: true,
      labels: { specific: 'yes', actionable: 'partly', 'no-answer': 'yes' },
      note: 'Good nudge, stops short of the answer.',
      labelledBy: 'teacher-1',
    },
  })
  check('snippet labelled', labelled.body.label.included === true)

  const badLabel = await call('PATCH', `/api/research/snippets/${target.id}`, {
    token: 'smoke-token',
    body: { labels: { specific: 'maybe' } },
  })
  check('label value validated', badLabel.status === 400)
  const badCriterion = await call('PATCH', `/api/research/snippets/${target.id}`, {
    token: 'smoke-token',
    body: { labels: { invented: 'yes' } },
  })
  check('unknown criterion rejected', badCriterion.status === 400)

  const included = await call('GET', '/api/research/snippets?included=true', {
    token: 'smoke-token',
  })
  check('can filter to kept snippets', included.body.count === 1)

  const exportJson = await call('GET', '/api/research/export', { token: 'smoke-token' })
  check('export holds only kept snippets', exportJson.body.count === 1)
  const exportCsv = await fetch(`${base}/api/research/export?format=csv`, {
    headers: { authorization: 'Bearer smoke-token' },
  })
  const csv = await exportCsv.text()
  check('csv export', exportCsv.headers.get('content-type').includes('text/csv'))
  check('csv has a header and one row', csv.trim().split('\n').length === 2)
  check('csv includes the label column', csv.includes('label_specific'))

  console.log('\nwithdrawal')
  const deleted = await call('DELETE', `/api/sessions/${session.id}`)
  check('session deleted', deleted.body.deleted === true)
  check('its files were removed', deleted.body.files === 2)
  const gone = await call('GET', `/api/sessions/${session.id}`)
  check('session no longer readable', gone.status === 404)
  const afterDelete = await call('GET', `/api/research/snippets?sessionId=${session.id}`, {
    token: 'smoke-token',
  })
  check('its snippets are gone too', afterDelete.body.snippets.length === 0)

  console.log('\nnot found')
  const nowhere = await call('GET', '/api/nope')
  check('unknown route is 404 json', nowhere.status === 404 && Boolean(nowhere.body.error))
  const badSession = await call('GET', '/api/sessions/ses_missing')
  check('unknown session is 404', badSession.status === 404)
} finally {
  server.close()
  await fs.rm(uploadDir, { recursive: true, force: true })
}

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) {
  for (const failure of failures) console.log(`  ✗ ${failure.name}`)
  process.exitCode = 1
}
