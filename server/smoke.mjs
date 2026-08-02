/**
 * End-to-end check over real HTTP: accounts, authoring, consent, answering,
 * marking, the tutor, uploads, own questions, events, and the labelling loop.
 *
 *   npm run test:api                 # in-memory store
 *   npm run test:api:mongo           # the same assertions against MongoDB
 *
 * Starts its own server on a spare port with a known research token, so it
 * never touches a running one.
 *
 * **Accounts come first now, and that is a change worth knowing about.** They
 * used to run last, so that everything above them proved the anonymous path
 * still worked with no users in the system at all. Questions are no longer
 * hard-coded — a teacher authors them — so a teacher has to exist before there
 * is anything for a student to open. The anonymous path is still covered, and
 * still the default: every student assertion below runs against a session
 * created with **no token at all**, exactly as a student who has never signed in
 * would. The signed-in student is the extra case, not the base one.
 */
import { createApp } from './app.js'
import { once } from 'node:events'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/**
 * A dot-prefixed leaf, deliberately.
 *
 * The real default is `server/.uploads`, and `res.sendFile` refuses any path
 * with a dot-prefixed segment unless told not to — so a temp directory without
 * one tested a layout no deployment has, and every "the bytes are served"
 * assertion below passed against a configuration nobody runs. It cost a live
 * 500 to find. Keep the dot.
 */
const uploadDir = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'fe-smoke-')), '.uploads')
await fs.mkdir(uploadDir, { recursive: true })
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

/**
 * The question the marking assertions run against.
 *
 * A real rubric with real keywords, because the point of several checks below
 * is that none of this reaches the browser. "water potential" appears in a
 * keyword and in a hint and in no public field, so finding it in a student
 * payload means something leaked.
 */
const OSMOSIS = {
  prompt:
    'A red blood cell is placed in distilled water. Within a minute it swells and bursts. Explain why, and say why a plant cell in the same beaker would not burst.',
  kind: 'Explain',
  rubric: [
    {
      label: 'Names the water potential gradient',
      points: 1,
      keywords: ['water potential', 'hypotonic'],
      coach: 'Say which way water moves and what drives it.',
    },
    {
      label: 'Identifies osmosis across the membrane',
      points: 1,
      keywords: ['osmosis', 'partially permeable'],
      coach: 'Name the process, and the property of the membrane that allows it.',
    },
    {
      label: 'Credits the cell wall for the plant cell',
      points: 1,
      keywords: ['cell wall', 'turgid'],
      coach: 'The plant cell has a structure the red blood cell lacks.',
    },
  ],
  tutor: {
    opening: 'This one is two questions wearing one coat. Which half feels shakier?',
    hints: [
      'Start outside the cell. Distilled water has no solute in it at all.',
      'Water moves down that gradient, into the cell, by osmosis.',
      'The plant cell has a rigid layer outside the membrane that pushes back.',
    ],
    concept: 'Osmosis is the net movement of water across a partially permeable membrane.',
    example: 'Worked parallel: a potato cylinder in 1.0 M sucrose loses mass.',
    misconception: 'Careful with "the water is sucked in" — water is not pulled.',
  },
}

/** A teacher who typed a prompt and nothing else. Allowed, and has to work. */
const BARE_QUESTION = {
  prompt: 'Sketch the apparatus you would use to measure the rate of this reaction.',
  kind: 'Diagram',
  workingExpected: true,
}

try {
  console.log('\nhealth on an empty system')
  const health = await call('GET', '/api/health')
  check('health ok', health.status === 200 && health.body.ok === true)
  check(
    `reports the ${useMongo ? 'mongodb' : 'in-memory'} store`,
    health.body.store === (useMongo ? 'mongo' : 'memory'),
    `got ${health.body.store}`,
  )
  check('persistence reported correctly', health.body.persistent === useMongo)
  check('health reports no users', health.body.users === 0)
  if (useMongo) {
    check('database reachable', health.body.databaseReachable === true)
    check('using the throwaway database', health.body.database === smokeDb)
  }

  console.log('\nbootstrap')
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

  const managerToken = (
    await call('POST', '/api/auth/login', {
      body: { email: 'mo@example.com', password: 'correct horse battery' },
    })
  ).body.token

  const teacher = (
    await call('POST', '/api/users', {
      token: managerToken,
      body: { role: 'teacher', name: 'Tia Teacher', email: 'tia@example.com', password: 'correct horse battery' },
    })
  ).body.user
  check('manager creates a teacher under themselves', teacher.managerId === manager.id)

  const teacherToken = (
    await call('POST', '/api/auth/login', {
      body: { email: 'tia@example.com', password: 'correct horse battery' },
    })
  ).body.token

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

  const otherTeacherToken = (
    await call('POST', '/api/auth/login', {
      body: { email: 'ada@example.com', password: 'correct horse battery' },
    })
  ).body.token

  const unassigned = await call('POST', '/api/users', {
    token: adminToken,
    body: { role: 'student', name: 'Una Unassigned', email: 'una@example.com', password: 'correct horse battery' },
  })
  check('admin may leave a student unassigned', unassigned.body.user.teacherId === null)

  console.log('\nwho can create whom')
  const studentLoginFirst = await call('POST', '/api/auth/login', {
    body: { email: 'sam@example.com', password: 'correct horse battery' },
  })
  let studentToken = studentLoginFirst.body.token

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

  /* ================================================================ authoring */

  console.log('\nauthoring an activity')
  const noAuth = await call('POST', '/api/activities', { body: { title: 'Sneaky' } })
  check('creating an activity needs a token', noAuth.status === 401)

  const studentAuthors = await call('POST', '/api/activities', {
    token: studentToken,
    body: { title: 'Sneaky' },
  })
  check('a student cannot author', studentAuthors.status === 403)

  const untitled = await call('POST', '/api/activities', { token: teacherToken, body: {} })
  check('an activity needs a title', untitled.status === 400)

  const created = await call('POST', '/api/activities', {
    token: teacherToken,
    body: { title: 'Membranes & transport', blurb: 'How things cross the membrane.' },
  })
  check('teacher creates an activity', created.status === 201)
  const activity = created.body.activity
  check('it starts as a draft', activity.status === 'draft')
  check('it carries no join code', activity.code === undefined)
  check('it is owned by its author', activity.ownerId === teacher.id)
  check('it starts empty', activity.questionCount === 0)

  console.log('\nadding questions')
  const emptyPublish = await call('PATCH', `/api/activities/${activity.id}`, {
    token: teacherToken,
    body: { status: 'published' },
  })
  check('an empty activity cannot be published', emptyPublish.status === 400)

  const noPrompt = await call('POST', `/api/activities/${activity.id}/questions`, {
    token: teacherToken,
    body: { kind: 'Explain' },
  })
  check('a question needs a prompt', noPrompt.status === 400)

  const badKind = await call('POST', `/api/activities/${activity.id}/questions`, {
    token: teacherToken,
    body: { prompt: 'Fine prompt', kind: 'Interpretive dance' },
  })
  check('an unknown question kind is rejected', badKind.status === 400)

  const badCriterion = await call('POST', `/api/activities/${activity.id}/questions`, {
    token: teacherToken,
    body: { prompt: 'Fine prompt', rubric: [{ points: 1 }] },
  })
  check('a criterion needs a label', badCriterion.status === 400)

  const badPoints = await call('POST', `/api/activities/${activity.id}/questions`, {
    token: teacherToken,
    body: { prompt: 'Fine prompt', rubric: [{ label: 'Something', points: -3 }] },
  })
  check('negative points rejected', badPoints.status === 400)

  const marked = await call('POST', `/api/activities/${activity.id}/questions`, {
    token: teacherToken,
    body: OSMOSIS,
  })
  check('question with a rubric created', marked.status === 201)
  const markedQ = marked.body.question
  check('it is numbered Q1', markedQ.code === 'Q1')
  check('the rubric came back to its author', markedQ.rubric.length === 3)
  check('criteria were given ids', markedQ.rubric.every((c) => typeof c.id === 'string' && c.id))
  check('keywords were lower-cased', markedQ.rubric[0].keywords.includes('water potential'))

  const bare = await call('POST', `/api/activities/${activity.id}/questions`, {
    token: teacherToken,
    body: BARE_QUESTION,
  })
  check('a question with no rubric is allowed', bare.status === 201)
  const bareQ = bare.body.question
  check('it is numbered Q2', bareQ.code === 'Q2')
  check('its rubric is empty, not absent', Array.isArray(bareQ.rubric) && bareQ.rubric.length === 0)
  check('its tutor script is empty, not absent', bareQ.tutor.hints.length === 0)

  const dataQ = (
    await call('POST', `/api/activities/${activity.id}/questions`, {
      token: teacherToken,
      body: {
        prompt: 'Use the table to decide whether uptake is diffusion or active transport.',
        kind: 'Read the data',
        stimulus: {
          kind: 'table',
          caption: 'Glucose uptake',
          columns: ['External glucose', 'Uptake', 'Uptake with cyanide'],
          rows: [
            ['1.0', '18', '2'],
            ['16.0', '80', '8'],
          ],
        },
        rubric: [
          { label: 'Concludes active transport', points: 1, keywords: ['active transport'] },
          { label: 'Uses the plateau', points: 1, keywords: ['plateau', 'levels off'] },
        ],
      },
    })
  ).body.question
  check('a question can carry a table', dataQ.stimulus.rows.length === 2)

  const raggedTable = await call('POST', `/api/activities/${activity.id}/questions`, {
    token: teacherToken,
    body: {
      prompt: 'Fine prompt',
      stimulus: { kind: 'table', columns: ['a', 'b'], rows: [['only one']] },
    },
  })
  check('a ragged table row is rejected', raggedTable.status === 400)

  /**
   * The other way to set a question: photograph it.
   *
   * Retyping a question out of a textbook is the slowest part of setting work,
   * so an uploaded image counts as the question on its own. What is enforced is
   * that a question asks *something* — a prompt, an image, or both — never
   * neither.
   */
  console.log('\nwriting a question, or uploading one')
  const askless = await call('POST', `/api/activities/${activity.id}/questions`, {
    token: teacherToken,
    body: { kind: 'Explain' },
  })
  check('a question with neither prompt nor image is refused', askless.status === 400)

  const uploadedQ = await call('POST', `/api/activities/${activity.id}/questions`, {
    token: teacherToken,
    body: { kind: 'Diagram', image: { name: 'q4.png', dataUrl: PNG } },
  })
  check('an image alone is a question', uploadedQ.status === 201)
  check('it has no prompt', uploadedQ.body.question.prompt === '')
  check('the image came back with a url', uploadedQ.body.question.image.url.startsWith('/api/uploads/'))
  check(
    'and the bytes are served',
    (await fetch(`${base}${uploadedQ.body.question.image.url}`)).status === 200,
  )

  const badImage = await call('POST', `/api/activities/${activity.id}/questions`, {
    token: teacherToken,
    body: { image: { name: 'notes.txt', dataUrl: 'data:text/plain;base64,aGVsbG8=' } },
  })
  check('an unsupported image type is refused', badImage.status === 400)

  const strippedPrompt = await call(
    'PATCH',
    `/api/activities/${activity.id}/questions/${uploadedQ.body.question.id}`,
    { token: teacherToken, body: { image: null } },
  )
  check('removing the only image is refused', strippedPrompt.status === 400)
  check(
    'and the question still has its image',
    (
      await call('GET', `/api/activities/${activity.id}`, { token: teacherToken })
    ).body.questions.find((q) => q.id === uploadedQ.body.question.id).image !== null,
  )

  const typedInstead = await call(
    'PATCH',
    `/api/activities/${activity.id}/questions/${uploadedQ.body.question.id}`,
    { token: teacherToken, body: { prompt: 'Describe the apparatus shown.', image: null } },
  )
  check('but swapping the image for a prompt is fine', typedInstead.status === 200)
  check('the image is gone', typedInstead.body.question.image === null)
  check('the prompt is there', typedInstead.body.question.prompt === 'Describe the apparatus shown.')

  const bothWays = await call(
    'PATCH',
    `/api/activities/${activity.id}/questions/${uploadedQ.body.question.id}`,
    { token: teacherToken, body: { image: { name: 'q4b.png', dataUrl: PNG } } },
  )
  check('a question can have both', bothWays.body.question.prompt && bothWays.body.question.image)

  await call('DELETE', `/api/activities/${activity.id}/questions/${uploadedQ.body.question.id}`, {
    token: teacherToken,
  })

  console.log('\nauthoring scope')
  const peek = await call('GET', `/api/activities/${activity.id}`, { token: otherTeacherToken })
  check("another teacher cannot read it, and gets 404 not 403", peek.status === 404)

  const meddle = await call('POST', `/api/activities/${activity.id}/questions`, {
    token: otherTeacherToken,
    body: { prompt: 'Not yours' },
  })
  check('nor add a question to it', meddle.status === 404)

  const managerReads = await call('GET', `/api/activities/${activity.id}`, { token: managerToken })
  check("the manager above them can read it", managerReads.status === 200)
  const adminReads = await call('GET', `/api/activities/${activity.id}`, { token: adminToken })
  check('so can an admin', adminReads.status === 200)

  const ownList = await call('GET', '/api/activities', { token: teacherToken })
  check('teacher lists their own', ownList.body.activities.length === 1)
  check('with a question count', ownList.body.activities[0].questionCount === 3)
  const otherList = await call('GET', '/api/activities', { token: otherTeacherToken })
  check("and not another teacher's", otherList.body.activities.length === 0)
  const managerList = await call('GET', '/api/activities', { token: managerToken })
  check("a manager sees their teachers'", managerList.body.activities.length === 1)

  console.log('\nreordering')
  const shortOrder = await call('POST', `/api/activities/${activity.id}/questions/reorder`, {
    token: teacherToken,
    body: { questionIds: [dataQ.id] },
  })
  check('a partial order is rejected', shortOrder.status === 400)

  const dupeOrder = await call('POST', `/api/activities/${activity.id}/questions/reorder`, {
    token: teacherToken,
    body: { questionIds: [dataQ.id, dataQ.id, markedQ.id] },
  })
  check('a duplicate in the order is rejected', dupeOrder.status === 400)

  const reordered = await call('POST', `/api/activities/${activity.id}/questions/reorder`, {
    token: teacherToken,
    body: { questionIds: [dataQ.id, markedQ.id, bareQ.id] },
  })
  check('reordering works', reordered.status === 200)
  check('the moved question is now Q1', reordered.body.questions[0].id === dataQ.id)
  check('and renumbered', reordered.body.questions[0].code === 'Q1')
  check('the old Q1 is now Q2', reordered.body.questions[1].code === 'Q2')

  // Put it back, so the assertions below read in the order they were written.
  await call('POST', `/api/activities/${activity.id}/questions/reorder`, {
    token: teacherToken,
    body: { questionIds: [markedQ.id, bareQ.id, dataQ.id] },
  })

  console.log('\nnothing leaks to the student')
  const preview = await call('GET', `/api/activities/${activity.id}/preview`, {
    token: teacherToken,
  })
  const previewText = JSON.stringify(preview.body)
  check('preview returns every question', preview.body.activity.questions.length === 3)
  check('no rubric on a previewed question', !('rubric' in preview.body.activity.questions[0]))
  check('no tutor script either', !('tutor' in preview.body.activity.questions[0]))
  check('no keyword survives the trip', !previewText.includes('water potential'))
  check('no hint text survives it', !previewText.includes('Start outside the cell'))
  check('criteria are counted, not listed', preview.body.activity.questions[0].criteriaCount === 3)
  check('and the count is honest', preview.body.activity.questions[0].points === 3)
  check('an unmarked question says so', preview.body.activity.questions[1].markable === false)
  check('a marked one says so too', preview.body.activity.questions[0].markable === true)

  console.log('\npublishing is the whole access decision')
  const draftList = await call('GET', '/api/activities/available')
  check('a draft is invisible to an anonymous visitor', draftList.body.activities.length === 0)

  const draftSession = await call('POST', '/api/sessions', {
    body: { consent: true, activityId: activity.id },
  })
  check('and cannot be started', draftSession.status === 400)

  const published = await call('PATCH', `/api/activities/${activity.id}`, {
    token: teacherToken,
    body: { status: 'published' },
  })
  check('publishing works once it has questions', published.body.activity.status === 'published')

  /**
   * The open list. There is no join code and no account on this path, so
   * "published" is the entire gate — which is exactly why the two assertions
   * above matter.
   */
  const openList = await call('GET', '/api/activities/available')
  check('now an anonymous visitor can see it', openList.body.activities.length === 1)
  check('it is named', openList.body.activities[0].title === 'Membranes & transport')
  check('and counted', openList.body.activities[0].questionCount === 3)
  check('but carries no questions', !('questions' in openList.body.activities[0]))
  check(
    'and no mark scheme',
    !JSON.stringify(openList.body).includes('water potential'),
  )

  /* ================================================================== student */

  console.log('\nconsent gate')
  const refused = await call('POST', '/api/sessions', { body: { activityId: activity.id } })
  check('no session without consent', refused.status === 400)
  check('says which field is missing', refused.body.error.details?.field === 'consent')

  const declined = await call('POST', '/api/sessions', {
    body: { consent: false, activityId: activity.id },
  })
  check('explicit refusal also rejected', declined.status === 400)

  const noActivity = await call('POST', '/api/sessions', { body: { consent: true } })
  check('a session must name an activity', noActivity.status === 400)

  /**
   * The anonymous door: no token, no code, no password. Everything that follows
   * runs on this session, so if any of it needed an identity it would fail here.
   */
  console.log('\nstarting anonymously')
  const started = await call('POST', '/api/sessions', {
    body: { consent: true, activityId: activity.id, device: 'smoke' },
  })
  check('session created with no credentials at all', started.status === 201)
  const session = started.body.session
  check('it is anonymous', session.userId === null)
  check('consent recorded with a version', Boolean(session.consent.version))
  check('it is bound to the activity', session.activityId === activity.id)
  check('the activity came back with it', started.body.activity.questions.length === 3)
  check('session has its own short code', /^[A-Z2-9]{6}$/.test(session.code))
  check(
    'no mark scheme in the session payload',
    !JSON.stringify(started.body).includes('water potential'),
  )

  check('it still has a short code, as a label for the teacher', /^[A-Z2-9]{6}$/.test(session.code))

  console.log('\nanswers + marking')
  const saved = await call('PUT', `/api/sessions/${session.id}/answers/${markedQ.id}`, {
    body: {
      mode: 'write',
      draft:
        'Distilled water has a higher water potential, so water enters by osmosis through the partially permeable membrane.',
    },
  })
  check('answer saved', saved.status === 200 && saved.body.answer.mode === 'write')

  const checked = await call('POST', `/api/sessions/${session.id}/answers/${markedQ.id}/check`)
  check('marked server-side', checked.status === 200)
  check('partial credit awarded', checked.body.feedback.earned === 2)
  check('out of the authored total', checked.body.feedback.total === 3)
  check('criterion labels present', checked.body.feedback.criteria.length === 3)
  check(
    'unmet criterion returns coaching, not keywords',
    typeof checked.body.feedback.nextStep === 'string' &&
      !JSON.stringify(checked.body.feedback).includes('keywords'),
  )

  const unmarkable = await call('POST', `/api/sessions/${session.id}/answers/${bareQ.id}/check`)
  check('a question with no rubric cannot be checked', unmarkable.status === 400)

  const badMode = await call('PUT', `/api/sessions/${session.id}/answers/${markedQ.id}`, {
    body: { mode: 'telepathy' },
  })
  check('unknown mode rejected', badMode.status === 400)

  const switched = await call('PUT', `/api/sessions/${session.id}/answers/${markedQ.id}`, {
    body: { mode: 'draw' },
  })
  check('switching mode clears the old answer', switched.body.answer.draft === '')
  check('switching mode clears the old mark', switched.body.answer.feedback === null)

  const drawCheck = await call('POST', `/api/sessions/${session.id}/answers/${markedQ.id}/check`)
  check('a drawing is not scored', drawCheck.body.feedback.markable === false)

  const selfMarked = await call('PUT', `/api/sessions/${session.id}/answers/${markedQ.id}`, {
    body: { selfMark: 'unfinished' },
  })
  check('self-mark stored', selfMarked.body.answer.selfMark === 'unfinished')
  const badMark = await call('PUT', `/api/sessions/${session.id}/answers/${markedQ.id}`, {
    body: { selfMark: 'brilliant' },
  })
  check('unknown self-mark rejected', badMark.status === 400)

  console.log('\ntutor')
  const hint1 = await call('POST', `/api/sessions/${session.id}/questions/${markedQ.id}/messages`, {
    body: { action: 'hint' },
  })
  check('hint returns both turns', hint1.status === 201 && Boolean(hint1.body.student && hint1.body.tutor))
  check('hint 1 labelled', hint1.body.tutor.label === 'Hint 1 of 3')
  check('it is the hint the teacher wrote', hint1.body.tutor.text.startsWith('Start outside'))

  const hint2 = await call('POST', `/api/sessions/${session.id}/questions/${markedQ.id}/messages`, {
    body: { action: 'hint' },
  })
  check('hints escalate server-side', hint2.body.tutor.label === 'Hint 2 of 3')
  check('hint text differs', hint1.body.tutor.text !== hint2.body.tutor.text)

  const bareHint = await call('POST', `/api/sessions/${session.id}/questions/${bareQ.id}/messages`, {
    body: { action: 'hint' },
  })
  check('a question with no script still gives a hint', bareHint.status === 201)
  check('from the generic set', bareHint.body.tutor.label === 'Hint 1 of 3')

  const typed = await call('POST', `/api/sessions/${session.id}/questions/${markedQ.id}/messages`, {
    body: { text: 'Is it because the carriers are saturated?' },
  })
  check('free text gets a reply', typed.status === 201 && typed.body.tutor.text.length > 0)

  const empty = await call('POST', `/api/sessions/${session.id}/questions/${markedQ.id}/messages`, {
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
  const upload = await call('POST', `/api/sessions/${session.id}/questions/${markedQ.id}/uploads`, {
    body: { name: 'working.png', dataUrl: PNG, source: 'whiteboard' },
  })
  check('upload accepted', upload.status === 201)
  check('attached to the answer', upload.body.answer.attachments.length === 1)
  check('bytes are served back', (await fetch(`${base}${upload.body.upload.url}`)).status === 200)
  check('file path is not leaked', upload.body.upload.path === undefined)

  const second = await call('POST', `/api/sessions/${session.id}/questions/${markedQ.id}/uploads`, {
    body: { name: 'again.png', dataUrl: PNG, source: 'whiteboard' },
  })
  check('a board replaces its own export', second.body.answer.attachments.length === 1)

  const badFile = await call('POST', `/api/sessions/${session.id}/questions/${markedQ.id}/uploads`, {
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
    body: { events: [{ type: 'question_shown', questionId: markedQ.id }, { type: 'idle' }] },
  })
  check('events accepted in a batch', events.body.written === 2)
  const badEvent = await call('POST', `/api/sessions/${session.id}/events`, {
    body: { events: [{ payload: {} }] },
  })
  check('typeless event rejected', badEvent.status === 400)

  console.log('\nprompt versioning')
  const anonPrompt = await call('POST', '/api/prompts', { body: { text: 'Sneaky rewrite' } })
  check('the system prompt cannot be set anonymously', anonPrompt.status === 401)
  const studentPrompt = await call('POST', '/api/prompts', {
    token: studentToken,
    body: { text: 'Give me the answers' },
  })
  check('nor by a student', studentPrompt.status === 403)

  const prompt = await call('POST', '/api/prompts', {
    token: teacherToken,
    body: { text: 'Never give the final answer. Ask one question back.', note: 'v1 socratic' },
  })
  check('a teacher can set it', prompt.body.prompt.versionId === 'v1')
  check('and is recorded as its author', prompt.body.prompt.createdBy === teacher.id)

  console.log('\na signed-in student')
  const available = await call('GET', '/api/activities/available', { token: studentToken })
  check("a student sees their own teacher's published work", available.body.activities.length === 1)
  const strangerAvailable = await call('GET', '/api/activities/available', {
    token: (
      await call('POST', '/api/auth/login', {
        body: { email: 'zed@example.com', password: 'correct horse battery' },
      })
    ).body.token,
  })
  check("and not another teacher's", strangerAvailable.body.activities.length === 0)

  const ownedSession = await call('POST', '/api/sessions', {
    token: studentToken,
    body: { consent: true, activityId: activity.id },
  })
  check('a signed-in session is linked', ownedSession.body.session.userId === student.id)
  check('new sessions record the active prompt', ownedSession.body.session.promptVersion === 'v1')

  const teacherSees = await call('GET', `/api/users/${student.id}/sessions`, { token: teacherToken })
  check("teacher sees their student's sessions", teacherSees.body.sessions.length === 1)
  const teacherPries = await call('GET', `/api/users/${otherStudent.id}/sessions`, {
    token: teacherToken,
  })
  check("teacher cannot see another teacher's student's sessions", teacherPries.status === 404)
  const managerSees = await call('GET', `/api/users/${student.id}/sessions`, { token: managerToken })
  check('manager reaches through the teacher', managerSees.body.sessions.length === 1)

  /* ================================================================ labelling */

  /**
   * Anonymous does not mean invisible.
   *
   * A student who came in with no code and no password still produced work a
   * teacher has to be able to read — that is the whole point of collecting it.
   * The session has no `userId` to scope by, so it reaches the teacher through
   * the **activity** instead: they own it, so they see every session started
   * from it. These four assertions are the ones that would break if that link
   * were ever dropped.
   */
  console.log('\nthe teacher labelling loop')
  const teacherSessions = await call('GET', '/api/research/sessions', { token: teacherToken })
  check('a teacher may now read transcripts', teacherSessions.status === 200)

  const anonRow = teacherSessions.body.sessions.find((entry) => entry.id === session.id)
  check('the anonymous session is visible to them', Boolean(anonRow))
  check('it is still anonymous', anonRow.userId === null)
  check('with its work counted', anonRow.counts.messages > 0 && anonRow.counts.snippets > 0)
  check('and reached through the activity they own', anonRow.activityId === activity.id)
  check(
    "and their own student's",
    teacherSessions.body.sessions.some((row) => row.id === ownedSession.body.session.id),
  )
  check('two in total', teacherSessions.body.sessions.length === 2)

  const strangerSessions = await call('GET', '/api/research/sessions', {
    token: otherTeacherToken,
  })
  check('another teacher sees none of it', strangerSessions.body.sessions.length === 0)

  const row = teacherSessions.body.sessions.find((entry) => entry.id === session.id)
  check('message counts reported', row.counts.messages === 10)
  check('snippet count reported', row.counts.snippets === 5)

  const transcript = await call('GET', `/api/research/sessions/${session.id}/transcript`, {
    token: teacherToken,
  })
  check('transcript grouped by question', transcript.body.questions.length === 3)
  check('own question flagged in transcript', transcript.body.questions.some((q) => q.isOwnQuestion))
  check(
    'authored questions carry their ordinal code',
    transcript.body.questions.some((q) => q.code === 'Q1'),
  )

  const strangerTranscript = await call('GET', `/api/research/sessions/${session.id}/transcript`, {
    token: otherTeacherToken,
  })
  check('another teacher cannot read that transcript', strangerTranscript.status === 404)

  const snippets = await call('GET', `/api/research/snippets?sessionId=${session.id}`, {
    token: teacherToken,
  })
  check('snippets are student+feedback pairs', snippets.body.snippets.length === 5)
  check(
    'each snippet holds both turns',
    snippets.body.snippets.every((s) => s.student.text && s.tutor.text),
  )
  check('labelling criteria offered', snippets.body.criteria.length === 5)
  check('undecided by default', snippets.body.snippets.every((s) => s.included === null))

  const target = snippets.body.snippets[0]
  const labelled = await call('PATCH', `/api/research/snippets/${target.id}`, {
    token: teacherToken,
    body: {
      included: true,
      labels: { specific: 'yes', actionable: 'partly', 'no-answer': 'yes' },
      note: 'Good nudge, stops short of the answer.',
    },
  })
  check('teacher labels a snippet', labelled.body.label.included === true)
  check('the labeller is taken from the token', labelled.body.label.labelledBy === teacher.id)
  check('and named', labelled.body.label.labelledByName === 'Tia Teacher')

  const forged = await call('PATCH', `/api/research/snippets/${target.id}`, {
    token: teacherToken,
    body: { included: true, labelledBy: 'someone-else' },
  })
  check('a self-reported labeller is ignored', forged.body.label.labelledBy === teacher.id)

  const strangerLabels = await call('PATCH', `/api/research/snippets/${target.id}`, {
    token: otherTeacherToken,
    body: { included: false },
  })
  check("another teacher cannot label someone else's snippet", strangerLabels.status === 404)

  const badLabel = await call('PATCH', `/api/research/snippets/${target.id}`, {
    token: teacherToken,
    body: { labels: { specific: 'maybe' } },
  })
  check('label value validated', badLabel.status === 400)
  const badCriterion2 = await call('PATCH', `/api/research/snippets/${target.id}`, {
    token: teacherToken,
    body: { labels: { invented: 'yes' } },
  })
  check('unknown criterion rejected', badCriterion2.status === 400)
  const nothingToLabel = await call('PATCH', `/api/research/snippets/${target.id}`, {
    token: teacherToken,
    body: {},
  })
  check('an empty label patch is rejected', nothingToLabel.status === 400)

  const included = await call('GET', '/api/research/snippets?included=true', {
    token: teacherToken,
  })
  check('can filter to kept snippets', included.body.count === 1)

  console.log('\nresearcher access')
  const noToken = await call('GET', '/api/research/sessions')
  check('research needs a token', noToken.status === 403)
  const wrongToken = await call('GET', '/api/research/sessions', { token: 'nope' })
  check('wrong token refused', wrongToken.status === 403)
  const studentResearch = await call('GET', '/api/research/sessions', { token: studentToken })
  check('a student cannot read research', studentResearch.status === 403)

  const list = await call('GET', '/api/research/sessions', { token: 'smoke-token' })
  check('the research token sees every session', list.body.sessions.length === 2)

  const exportJson = await call('GET', '/api/research/export', { token: 'smoke-token' })
  check('export holds only kept snippets', exportJson.body.count === 1)
  const teacherExport = await call('GET', '/api/research/export', { token: teacherToken })
  check('a teacher cannot export the dataset', teacherExport.status === 403)
  const adminExport = await call('GET', '/api/research/export', { token: adminToken })
  check('an admin can', adminExport.status === 200)

  const exportCsv = await fetch(`${base}/api/research/export?format=csv`, {
    headers: { authorization: 'Bearer smoke-token' },
  })
  const csv = await exportCsv.text()
  check('csv export', exportCsv.headers.get('content-type').includes('text/csv'))
  check('csv has a header and one row', csv.trim().split('\n').length === 2)
  check('csv includes the label column', csv.includes('label_specific'))

  /* ================================================================= deletion */

  console.log('\nan activity in use cannot be deleted')
  const deleteUsed = await call('DELETE', `/api/activities/${activity.id}`, { token: teacherToken })
  check('deleting a worked-on activity is 409', deleteUsed.status === 409)
  check('and it says how to close it instead', Boolean(deleteUsed.body.error.details.hint))

  const deleteUsedQuestion = await call(
    'DELETE',
    `/api/activities/${activity.id}/questions/${bareQ.id}`,
    { token: teacherToken },
  )
  check('nor a question students have seen', deleteUsedQuestion.status === 409)

  const spare = (
    await call('POST', '/api/activities', { token: teacherToken, body: { title: 'Spare' } })
  ).body.activity
  const spareQuestion = (
    await call('POST', `/api/activities/${spare.id}/questions`, {
      token: teacherToken,
      body: { prompt: 'Nobody has seen this.' },
    })
  ).body.question
  const droppedQuestion = await call(
    'DELETE',
    `/api/activities/${spare.id}/questions/${spareQuestion.id}`,
    { token: teacherToken },
  )
  check('an unused question can be deleted', droppedQuestion.body.deleted === true)
  const dropped = await call('DELETE', `/api/activities/${spare.id}`, { token: teacherToken })
  check('and so can an unused activity', dropped.body.deleted === true)
  check(
    'it is gone',
    (await call('GET', `/api/activities/${spare.id}`, { token: teacherToken })).status === 404,
  )

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

  /* ============================================================ user admin */

  console.log('\nscope')
  const adminUserList = await call('GET', '/api/users', { token: adminToken })
  check('admin sees everyone', adminUserList.body.users.length === 7)
  check('admin scope reported as all', adminUserList.body.scope === 'all')

  const managerUserList = await call('GET', '/api/users', { token: managerToken })
  const managerIds = managerUserList.body.users.map((u) => u.id)
  check('manager sees self, teachers and their students', managerUserList.body.users.length === 5)
  check('manager sees both their teachers', managerIds.includes(teacher.id) && managerIds.includes(otherTeacher.id))
  check('manager does not see the admin', !managerIds.includes(admin.id))
  check('manager does not see an unassigned student', !managerIds.includes(unassigned.body.user.id))

  const teacherUserList = await call('GET', '/api/users', { token: teacherToken })
  const teacherIds = teacherUserList.body.users.map((u) => u.id)
  check('teacher sees self and own students only', teacherUserList.body.users.length === 2)
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

  console.log('\ndeleting a user is deliberately hard')
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

  console.log('\nnot found')
  const nowhere = await call('GET', '/api/nope')
  check('unknown route is 404 json', nowhere.status === 404 && Boolean(nowhere.body.error))
  const badSession = await call('GET', '/api/sessions/ses_missing')
  check('unknown session is 404', badSession.status === 404)
  const badActivity = await call('GET', '/api/activities/act_missing', { token: teacherToken })
  check('unknown activity is 404', badActivity.status === 404)

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
