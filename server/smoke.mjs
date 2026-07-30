/**
 * End-to-end check over real HTTP: consent, answering, marking, the tutor,
 * uploads, own questions, events, and the researcher side.
 *
 *   npm run test:api                 # in-memory store
 *   npm run test:api:mongo           # the same assertions against MongoDB
 *
 * Starts its own server on a spare port with a known research token, so it
 * never touches a running one.
 */
import { createApp } from './app.js'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
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
// Set explicitly rather than left to fall back to the research token, so a
// BOOTSTRAP_TOKEN in a local .env cannot change what these assertions mean.
config.bootstrapToken = 'smoke-token'

/**
 * Which store to run against, decided here rather than inherited.
 *
 * In-memory is the default: hermetic, no network, and what a bare checkout has.
 * `SMOKE_MONGO=1` runs the identical assertions against MongoDB — the whole
 * point being that they should all still pass — in a throwaway database dropped
 * at the end.
 *
 * The default has to override `config.mongoUri` explicitly, because `.env.local`
 * very likely sets it, and these assertions count rows: pointed at a real
 * database they would both fail and litter it.
 */
const useMongo = process.env.SMOKE_MONGO === '1'
const smokeDb = `smoke_${randomUUID().replaceAll('-', '').slice(0, 12)}`

if (useMongo) {
  if (!config.mongoUri) {
    console.error('SMOKE_MONGO=1 but MONGODB_URI is unset — nothing to connect to.')
    process.exit(1)
  }
  config.mongoDb = smokeDb
  console.log(`\nstore: mongodb, throwaway database "${smokeDb}"`)
} else {
  config.mongoUri = null
  console.log('\nstore: in-memory')
}

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
  check(
    `reports the ${useMongo ? 'mongodb' : 'in-memory'} store`,
    health.body.store === (useMongo ? 'mongo' : 'memory'),
    `got ${health.body.store}`,
  )
  check('persistence reported correctly', health.body.persistent === useMongo)
  if (useMongo) {
    check('database reachable', health.body.databaseReachable === true)
    check('using the throwaway database', health.body.database === smokeDb)
  }

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

  /**
   * Accounts and the hierarchy.
   *
   * Deliberately last: everything above runs with no accounts at all, which is
   * the anonymous path this must not break. The counts asserted in the
   * researcher block would also shift if a signed-in session were created
   * before them.
   */
  console.log('\nbootstrap')
  const noUsersYet = await call('GET', '/api/health')
  check('health reports no users', noUsersYet.body.users === 0)

  const openBootstrap = await call('POST', '/api/auth/bootstrap', {
    body: { name: 'Root', email: 'root@example.com', password: 'correct horse battery' },
  })
  check('bootstrap needs the bootstrap token', openBootstrap.status === 403)

  const weak = await call('POST', '/api/auth/bootstrap', {
    token: 'smoke-token',
    body: { name: 'Root', email: 'root@example.com', password: 'short' },
  })
  check('short password rejected', weak.status === 400)

  const notEmail = await call('POST', '/api/auth/bootstrap', {
    token: 'smoke-token',
    body: { name: 'Root', email: 'not-an-email', password: 'correct horse battery' },
  })
  check('malformed email rejected', notEmail.status === 400)

  const boot = await call('POST', '/api/auth/bootstrap', {
    token: 'smoke-token',
    body: { name: 'Root', email: 'Root@Example.com ', password: 'correct horse battery' },
  })
  check('first admin created', boot.status === 201 && boot.body.user.role === 'admin')
  check('email normalised', boot.body.user.email === 'root@example.com')
  check('bootstrap signs the admin in', typeof boot.body.token === 'string')
  check('password hash never returned', !JSON.stringify(boot.body).includes('scrypt'))
  const adminToken = boot.body.token
  const admin = boot.body.user

  const again = await call('POST', '/api/auth/bootstrap', {
    token: 'smoke-token',
    body: { name: 'Second', email: 'second@example.com', password: 'correct horse battery' },
  })
  check('bootstrap closes once a user exists', again.status === 403)

  console.log('\nsign in')
  const wrongPassword = await call('POST', '/api/auth/login', {
    body: { email: 'root@example.com', password: 'wrong password here' },
  })
  check('wrong password is 401', wrongPassword.status === 401)

  const unknownEmail = await call('POST', '/api/auth/login', {
    body: { email: 'nobody@example.com', password: 'wrong password here' },
  })
  check('unknown email answers the same way', unknownEmail.status === 401)
  check(
    'login does not say which was wrong',
    wrongPassword.body.error.message === unknownEmail.body.error.message,
  )

  const login = await call('POST', '/api/auth/login', {
    body: { email: 'root@example.com', password: 'correct horse battery' },
  })
  check('login returns a token', login.status === 200 && typeof login.body.token === 'string')
  check('login records lastLoginAt', typeof login.body.user.lastLoginAt === 'string')

  const anonymousMe = await call('GET', '/api/auth/me')
  check('me needs a token', anonymousMe.status === 401)
  const badTokenMe = await call('GET', '/api/auth/me', { token: 'not-a-real-token' })
  check('an invalid token is 401, not a 500', badTokenMe.status === 401)
  const me = await call('GET', '/api/auth/me', { token: adminToken })
  check('me returns the signed-in user', me.body.user.id === admin.id)
  check('me hides the password hash', me.body.user.passwordHash === undefined)

  console.log('\nbuilding the hierarchy')
  const manager = (
    await call('POST', '/api/users', {
      token: adminToken,
      body: { role: 'manager', name: 'Mo Manager', email: 'mo@example.com', password: 'correct horse battery' },
    })
  ).body.user
  check('admin creates a manager', manager?.role === 'manager')

  const managerLogin = await call('POST', '/api/auth/login', {
    body: { email: 'mo@example.com', password: 'correct horse battery' },
  })
  const managerToken = managerLogin.body.token

  const teacher = (
    await call('POST', '/api/users', {
      token: managerToken,
      body: { role: 'teacher', name: 'Tia Teacher', email: 'tia@example.com', password: 'correct horse battery' },
    })
  ).body.user
  check('manager creates a teacher under themselves', teacher.managerId === manager.id)

  const teacherLogin = await call('POST', '/api/auth/login', {
    body: { email: 'tia@example.com', password: 'correct horse battery' },
  })
  const teacherToken = teacherLogin.body.token

  const student = (
    await call('POST', '/api/users', {
      token: teacherToken,
      body: { role: 'student', name: 'Sam Student', email: 'sam@example.com', password: 'correct horse battery' },
    })
  ).body.user
  check('teacher creates a student under themselves', student.teacherId === teacher.id)
  check('a student has no manager pointer', student.managerId === null)

  // A second branch of the tree, to prove the scoping actually excludes things.
  const otherTeacher = (
    await call('POST', '/api/users', {
      token: adminToken,
      body: {
        role: 'teacher',
        name: 'Ada Other',
        email: 'ada@example.com',
        password: 'correct horse battery',
        managerId: manager.id,
      },
    })
  ).body.user
  const otherStudent = (
    await call('POST', '/api/users', {
      token: adminToken,
      body: {
        role: 'student',
        name: 'Zed Other',
        email: 'zed@example.com',
        password: 'correct horse battery',
        teacherId: otherTeacher.id,
      },
    })
  ).body.user
  check('admin can create anywhere in the tree', otherStudent.teacherId === otherTeacher.id)

  const unassigned = await call('POST', '/api/users', {
    token: adminToken,
    body: { role: 'student', name: 'Una Unassigned', email: 'una@example.com', password: 'correct horse battery' },
  })
  check('admin may leave a student unassigned', unassigned.body.user.teacherId === null)

  console.log('\nwho can create whom')
  const studentLogin = await call('POST', '/api/auth/login', {
    body: { email: 'sam@example.com', password: 'correct horse battery' },
  })
  let studentToken = studentLogin.body.token

  const studentCreates = await call('POST', '/api/users', {
    token: studentToken,
    body: { role: 'student', name: 'Nope', email: 'nope@example.com', password: 'correct horse battery' },
  })
  check('a student creates nobody', studentCreates.status === 403)

  const teacherMakesTeacher = await call('POST', '/api/users', {
    token: teacherToken,
    body: { role: 'teacher', name: 'Nope', email: 'nope@example.com', password: 'correct horse battery' },
  })
  check('a teacher cannot create a teacher', teacherMakesTeacher.status === 403)

  const managerMakesManager = await call('POST', '/api/users', {
    token: managerToken,
    body: { role: 'manager', name: 'Nope', email: 'nope@example.com', password: 'correct horse battery' },
  })
  check('a manager cannot staff their own layer', managerMakesManager.status === 403)

  const badRole = await call('POST', '/api/users', {
    token: adminToken,
    body: { role: 'headmaster', name: 'Nope', email: 'nope@example.com', password: 'correct horse battery' },
  })
  check('unknown role rejected', badRole.status === 400)

  const wrongParentRole = await call('POST', '/api/users', {
    token: adminToken,
    body: {
      role: 'student',
      name: 'Nope',
      email: 'nope@example.com',
      password: 'correct horse battery',
      teacherId: manager.id,
    },
  })
  check('a student cannot be parented to a manager', wrongParentRole.status === 400)

  const parentedAdmin = await call('POST', '/api/users', {
    token: adminToken,
    body: {
      role: 'admin',
      name: 'Nope',
      email: 'nope@example.com',
      password: 'correct horse battery',
      teacherId: teacher.id,
    },
  })
  check('a role with no parent slot cannot be given one', parentedAdmin.status === 400)

  const duplicate = await call('POST', '/api/users', {
    token: adminToken,
    body: { role: 'student', name: 'Clone', email: 'sam@example.com', password: 'correct horse battery' },
  })
  check('duplicate email is 409', duplicate.status === 409)

  const poached = await call('POST', '/api/users', {
    token: teacherToken,
    body: {
      role: 'student',
      name: 'Nope',
      email: 'nope@example.com',
      password: 'correct horse battery',
      teacherId: otherTeacher.id,
    },
  })
  check("a teacher cannot fill another teacher's roster", poached.status === 403)

  console.log('\nscope')
  const adminList = await call('GET', '/api/users', { token: adminToken })
  check('admin sees everyone', adminList.body.users.length === 7)
  check('admin scope reported as all', adminList.body.scope === 'all')

  const managerList = await call('GET', '/api/users', { token: managerToken })
  const managerIds = managerList.body.users.map((u) => u.id)
  check('manager sees self, teachers and their students', managerList.body.users.length === 5)
  check('manager sees both their teachers', managerIds.includes(teacher.id) && managerIds.includes(otherTeacher.id))
  check('manager does not see the admin', !managerIds.includes(admin.id))
  check('manager does not see an unassigned student', !managerIds.includes(unassigned.body.user.id))

  const teacherList = await call('GET', '/api/users', { token: teacherToken })
  const teacherIds = teacherList.body.users.map((u) => u.id)
  check('teacher sees self and own students only', teacherList.body.users.length === 2)
  check("teacher does not see another teacher's student", !teacherIds.includes(otherStudent.id))

  const studentList = await call('GET', '/api/users', { token: studentToken })
  check('student sees only themselves', studentList.body.users.length === 1)
  check('and it is themselves', studentList.body.users[0].id === student.id)

  const filtered = await call(`GET`, `/api/users?role=student&teacherId=${teacher.id}`, {
    token: managerToken,
  })
  check('roster can be filtered', filtered.body.users.length === 1)

  const poachByQuery = await call(`GET`, `/api/users?teacherId=${otherTeacher.id}`, {
    token: teacherToken,
  })
  check('a query cannot widen scope', poachByQuery.body.users.length === 0)

  const readOther = await call('GET', `/api/users/${otherStudent.id}`, { token: teacherToken })
  check('out of scope reads as 404, not 403', readOther.status === 404)
  const readOwn = await call('GET', `/api/users/${student.id}`, { token: teacherToken })
  check('own student is readable', readOwn.body.user.id === student.id)
  const readUp = await call('GET', `/api/users/${admin.id}`, { token: studentToken })
  check('a student cannot read the admin', readUp.status === 404)

  console.log('\nsessions belong to the student who was signed in')
  const anonSession = await call('POST', '/api/sessions', { body: { consent: true } })
  check('anonymous sessions still work', anonSession.body.session.userId === null)

  const ownedSession = await call('POST', '/api/sessions', {
    token: studentToken,
    body: { consent: true, topicId: 'transport' },
  })
  check('a signed-in session is linked', ownedSession.body.session.userId === student.id)

  const teacherSees = await call('GET', `/api/users/${student.id}/sessions`, { token: teacherToken })
  check("teacher sees their student's sessions", teacherSees.body.sessions.length === 1)
  check('with counts attached', teacherSees.body.sessions[0].counts.messages === 0)
  const teacherPries = await call('GET', `/api/users/${otherStudent.id}/sessions`, {
    token: teacherToken,
  })
  check("teacher cannot see another teacher's student's sessions", teacherPries.status === 404)
  const managerSees = await call('GET', `/api/users/${student.id}/sessions`, { token: managerToken })
  check('manager reaches through the teacher', managerSees.body.sessions.length === 1)

  console.log('\nediting, reassigning, deactivating')
  const renamed = await call('PATCH', `/api/users/${student.id}`, {
    token: studentToken,
    body: { name: 'Samantha Student' },
  })
  check('a student may rename themselves', renamed.body.user.name === 'Samantha Student')

  const selfPromote = await call('PATCH', `/api/users/${student.id}`, {
    token: studentToken,
    body: { role: 'admin' },
  })
  check('a student cannot promote themselves', selfPromote.status === 403)

  const selfDeactivate = await call('PATCH', `/api/users/${student.id}`, {
    token: studentToken,
    body: { active: false },
  })
  check('nobody deactivates their own account', selfDeactivate.status === 400)

  const selfDemote = await call('PATCH', `/api/users/${admin.id}`, {
    token: adminToken,
    body: { role: 'manager' },
  })
  check('the last admin cannot demote themselves', selfDemote.status === 400)

  const moved = await call('PATCH', `/api/users/${student.id}`, {
    token: managerToken,
    body: { teacherId: otherTeacher.id },
  })
  check('manager moves a student between their teachers', moved.body.user.teacherId === otherTeacher.id)
  const afterMove = await call('GET', `/api/users/${student.id}`, { token: teacherToken })
  check('the old teacher loses sight of them', afterMove.status === 404)

  const movedBack = await call('PATCH', `/api/users/${student.id}`, {
    token: adminToken,
    body: { teacherId: teacher.id },
  })
  check('and can be moved back', movedBack.body.user.teacherId === teacher.id)

  const promoted = await call('PATCH', `/api/users/${unassigned.body.user.id}`, {
    token: adminToken,
    body: { role: 'teacher', managerId: manager.id },
  })
  check('admin changes a role', promoted.body.user.role === 'teacher')
  check('the stale pointer is cleared', promoted.body.user.teacherId === null)
  check('and the new one is set', promoted.body.user.managerId === manager.id)

  const nothing = await call('PATCH', `/api/users/${student.id}`, { token: adminToken, body: {} })
  check('an empty patch is rejected', nothing.status === 400)

  console.log('\npasswords')
  const wrongCurrent = await call('POST', '/api/auth/password', {
    token: studentToken,
    body: { currentPassword: 'not it at all', newPassword: 'a whole new password' },
  })
  check('changing a password needs the current one', wrongCurrent.status === 403)

  const changed = await call('POST', '/api/auth/password', {
    token: studentToken,
    body: { currentPassword: 'correct horse battery', newPassword: 'a whole new password' },
  })
  check('password changed', changed.body.changed === true)
  const staleToken = await call('GET', '/api/auth/me', { token: studentToken })
  check('a password change signs out the old token', staleToken.status === 401)
  studentToken = changed.body.token
  check('and hands back a working one', (await call('GET', '/api/auth/me', { token: studentToken })).status === 200)

  const selfReset = await call('POST', `/api/users/${student.id}/password`, {
    token: studentToken,
    body: { newPassword: 'trying to skip the check' },
  })
  check('the reset route is not a way around the current password', selfReset.status === 400)

  const reset = await call('POST', `/api/users/${student.id}/password`, {
    token: teacherToken,
    body: { newPassword: 'teacher set this one' },
  })
  check('teacher resets their student', reset.body.reset === true)
  check('the reset revoked their sessions', reset.body.sessionsRevoked === 1)
  check(
    'the old password stops working',
    (
      await call('POST', '/api/auth/login', {
        body: { email: 'sam@example.com', password: 'a whole new password' },
      })
    ).status === 401,
  )
  const reLogin = await call('POST', '/api/auth/login', {
    body: { email: 'sam@example.com', password: 'teacher set this one' },
  })
  check('the new one works', reLogin.status === 200)
  studentToken = reLogin.body.token

  const strangerReset = await call('POST', `/api/users/${otherStudent.id}/password`, {
    token: teacherToken,
    body: { newPassword: 'not your student' },
  })
  check("a teacher cannot reset another teacher's student", strangerReset.status === 404)

  console.log('\nsigning out and deactivating')
  const signedOut = await call('POST', '/api/auth/logout', { token: studentToken })
  check('logout succeeds', signedOut.body.signedOut === true)
  check(
    'the token stops working',
    (await call('GET', '/api/auth/me', { token: studentToken })).status === 401,
  )

  const backIn = await call('POST', '/api/auth/login', {
    body: { email: 'sam@example.com', password: 'teacher set this one' },
  })
  studentToken = backIn.body.token

  const deactivated = await call('PATCH', `/api/users/${student.id}`, {
    token: teacherToken,
    body: { active: false },
  })
  check('teacher deactivates their student', deactivated.body.user.active === false)
  check(
    'deactivation revokes live tokens immediately',
    (await call('GET', '/api/auth/me', { token: studentToken })).status === 401,
  )
  const deactivatedLogin = await call('POST', '/api/auth/login', {
    body: { email: 'sam@example.com', password: 'teacher set this one' },
  })
  check('a deactivated account cannot sign in', deactivatedLogin.status === 403)

  console.log('\ndeleting is deliberately hard')
  const deleteSelf = await call('DELETE', `/api/users/${admin.id}`, { token: adminToken })
  check('you cannot delete yourself', deleteSelf.status === 400)

  const deleteWithStudents = await call('DELETE', `/api/users/${teacher.id}`, { token: managerToken })
  check('a teacher with students cannot be deleted', deleteWithStudents.status === 409)
  check('and the blockers are named', deleteWithStudents.body.error.details.children.length >= 1)

  const deleteWithSessions = await call('DELETE', `/api/users/${student.id}`, { token: teacherToken })
  check('a user with recorded work cannot be deleted', deleteWithSessions.status === 409)

  const deletable = (
    await call('POST', '/api/users', {
      token: teacherToken,
      body: { role: 'student', name: 'Temp Student', email: 'temp@example.com', password: 'correct horse battery' },
    })
  ).body.user
  const deletedTemp = await call('DELETE', `/api/users/${deletable.id}`, { token: teacherToken })
  check('a student with no work can be deleted', deletedTemp.body.deleted === true)
  check(
    'and is gone',
    (await call('GET', `/api/users/${deletable.id}`, { token: adminToken })).status === 404,
  )
  const emailFreed = await call('POST', '/api/users', {
    token: teacherToken,
    body: { role: 'student', name: 'Reuse', email: 'temp@example.com', password: 'correct horse battery' },
  })
  check('the email is free again', emailFreed.status === 201)

  console.log('\nan admin reaches everything')
  const adminResearch = await call('GET', '/api/research/sessions', { token: adminToken })
  check('admin reads research without the research token', adminResearch.status === 200)
  const teacherResearch = await call('GET', '/api/research/sessions', { token: teacherToken })
  check('a teacher does not', teacherResearch.status === 403)
  const managerResearch = await call('GET', '/api/research/snippets', { token: managerToken })
  check('nor does a manager', managerResearch.status === 403)
  const stillWorks = await call('GET', '/api/research/sessions', { token: 'smoke-token' })
  check('the research token still works', stillWorks.status === 200)

  const finalHealth = await call('GET', '/api/health')
  check('health counts users', finalHealth.body.users === 8)
} finally {
  server.close()
  await fs.rm(uploadDir, { recursive: true, force: true })

  if (useMongo) {
    await app.locals.store.close()

    // Cleanup lives here rather than behind a store method: nothing in the
    // running application should be able to delete collections.
    //
    // Collection by collection, not dropDatabase: an Atlas application user is
    // granted readWrite on its databases, which covers dropping a collection but
    // not a database. A database with nothing left in it stops existing anyway.
    const { MongoClient } = await import('mongodb')
    const client = new MongoClient(config.mongoUri)
    try {
      const db = client.db(smokeDb)
      const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map((c) => c.name)
      await Promise.all(names.map((name) => db.collection(name).drop()))
      console.log(`\ndropped ${smokeDb} (${names.length} collections)`)
    } finally {
      await client.close()
    }
  }
}

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length) {
  for (const failure of failures) console.log(`  ✗ ${failure.name}`)
  process.exitCode = 1
}
