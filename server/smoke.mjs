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
import { fallbackReplies } from '../shared/tutor-scripts.js'
import { TURN_LIMIT, TURN_LOCK_MS, turnState } from '../shared/turns.js'
import { promptFor } from '../shared/activity.js'
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
/**
 * Uploads go to the temp disk above, whatever `.env.local` holds. With Spaces
 * keys there, every photo these assertions upload used to land in the real,
 * shared bucket — and the ones no withdrawal removes stayed there. Blank (not
 * unset) because the .env loader only fills keys that are still undefined.
 * test/unit/spaces-read.test.js covers the Spaces read path against a fake.
 */
process.env.SPACES_KEY = ''
process.env.SPACES_SECRET = ''

// config is read at import time, so it must be imported after the env is set.
const { config } = await import('./config.js')
config.uploadDir = uploadDir
/**
 * The blank SPACES_* above come too late on their own: the static
 * `import { createApp } from './app.js'` at the top is evaluated before this
 * module's body, and it has already read config.js — so with keys in
 * `.env.local` the uploads below went to the real bucket. Forced off here, and
 * the storage backend rebuilt from it; the "deleting student work" section
 * checks the files land on, and leave, this temp disk.
 */
config.spaces.key = null
config.spaces.secret = null
;(await import('./lib/storage.js')).resetStorage()
config.researchToken = 'smoke-token'
// Set explicitly rather than left to fall back to the research token, so a
// BOOTSTRAP_TOKEN in a local .env cannot change what these assertions mean.
config.bootstrapToken = 'smoke-token'
// After config, which it reads its key from. Used to say which handle an
// annotator should have been given for a snippet the test knows by id.
const { snippetHandle } = await import('./services/snippets.js')

/**
 * The tutor runs scripted here, whatever `.env.local` has in it.
 *
 * Not a shortcut: these assertions are about the parts of the tutor the server
 * owns — that hints escalate one at a time, that a question with no script
 * still gets one, that both turns are written atomically. A live model would
 * make every one of them depend on the network, on a quota, and on a reply
 * nobody can predict, and would bill someone for running the test suite.
 * `npm run check:openai` is the check that the key and the model work.
 */
config.openai.apiKey = null

/**
 * Anonymous sessions on, for everything but the class-list section near the
 * end. Most of the assertions below were written against sessions started
 * with no token, and the API still supports them behind
 * STUDENT_SIGN_IN_REQUIRED=false; the class-list section turns the default
 * (sign-in required) back on and checks that it holds.
 */
config.studentSignInRequired = false

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
 * payload means something leaked. The teacher's answer carries its own marker
 * phrase — "exerts an opposing pressure" — for the same reason.
 */
const OSMOSIS = {
  prompt:
    'A red blood cell is placed in distilled water. Within a minute it swells and bursts. Explain why, and say why a plant cell in the same beaker would not burst.',
  kind: 'Explain',
  answer:
    'Water enters both cells by osmosis, down the water potential gradient across the partially permeable membrane. The red blood cell has no wall, so it swells until it lyses; the plant cell wall exerts an opposing pressure and the cell only becomes turgid.',
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
  check('tutor reported as scripted, as configured above', health.body.tutor === 'scripted')
  check(
    'and warns that no model is running',
    health.body.warnings.some((warning) => warning.includes('OPENAI_API_KEY')),
  )
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

  // `let`: the passwords section below changes this teacher's password, which
  // signs them out and hands back a new token.
  let teacherToken = (
    await call('POST', '/api/auth/login', {
      body: { email: 'tia@example.com', password: 'correct horse battery' },
    })
  ).body.token

  const student = (
    await call('POST', '/api/users', {
      token: teacherToken,
      body: { role: 'student', name: 'Sam Student', studentNumber: '10000001' },
    })
  ).body.user
  check('teacher creates a student under themselves', student.teacherId === teacher.id)
  check('by student number, keeping the name given', student.studentNumber === '10000001' && student.name === 'Sam Student')
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
        studentNumber: '10000002',
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
    // The older shape — an email, and now no password — still makes a student.
    body: { role: 'student', name: 'Una Unassigned', email: 'una@example.com' },
  })
  check('admin may leave a student unassigned', unassigned.body.user.teacherId === null)
  check(
    'a student is refused a password',
    (
      await call('POST', '/api/users', {
        token: adminToken,
        body: { role: 'student', name: 'Pat', email: 'pat@example.com', password: 'correct horse battery' },
      })
    ).status === 400,
  )
  check(
    'a student number must be a username',
    (
      await call('POST', '/api/users', {
        token: teacherToken,
        body: { role: 'student', studentNumber: '123' },
      })
    ).status === 400,
  )

  console.log('\nwho can create whom')
  const studentLoginFirst = await call('POST', '/api/auth/student', {
    body: { studentNumber: '10000001' },
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
    body: { role: 'teacher', name: 'Clone', email: 'tia@example.com', password: 'correct horse battery' },
  })
  check('duplicate email is 409', duplicate.status === 409)
  const duplicateNumber = await call('POST', '/api/users', {
    token: adminToken,
    body: { role: 'student', name: 'Clone', studentNumber: '10000001' },
  })
  check('and so is a duplicate student number', duplicateNumber.status === 409)

  const poached = await call('POST', '/api/users', {
    token: teacherToken,
    body: {
      role: 'student',
      name: 'Nope',
      email: 'nope@example.com',
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

  const badTopic = await call('POST', '/api/activities', {
    token: teacherToken,
    body: { title: 'Fine title', topic: 'astrology' },
  })
  check('an unknown topic is rejected', badTopic.status === 400)

  const created = await call('POST', '/api/activities', {
    token: teacherToken,
    body: {
      title: 'Membranes & transport',
      blurb: 'How things cross the membrane.',
      topic: 'ratio',
    },
  })
  check('teacher creates an activity', created.status === 201)
  const activity = created.body.activity
  check('it starts as a draft', activity.status === 'draft')
  check('it is owned by its author', activity.ownerId === teacher.id)
  check('it starts empty', activity.questionCount === 0)
  check('the topic is stored', activity.topic === 'ratio')
  check('a name given once has no per-language names', Object.keys(activity.titleByLang).length === 0)

  console.log('\nactivity names per language')
  const namedTr = await call('POST', '/api/activities', {
    token: teacherToken,
    body: { titleByLang: { tr: '  Oran ve orantı  ', en: '' } },
  })
  check('an activity can be named in one language alone', namedTr.status === 201)
  check('the name is trimmed and the blank language dropped', JSON.stringify(namedTr.body.activity.titleByLang) === '{"tr":"Oran ve orantı"}')
  check('and the title is filled from it', namedTr.body.activity.title === 'Oran ve orantı')

  const renamedActivity = await call('PATCH', `/api/activities/${namedTr.body.activity.id}`, {
    token: teacherToken,
    body: { titleByLang: { en: 'Ratio', tr: 'Oran' } },
  })
  check('both names can be set', renamedActivity.body.activity.titleByLang.en === 'Ratio')
  check('and the title follows English first', renamedActivity.body.activity.title === 'Ratio')

  const badLangName = await call('PATCH', `/api/activities/${namedTr.body.activity.id}`, {
    token: teacherToken,
    body: { titleByLang: { de: 'Verhältnis' } },
  })
  check('a name in a language the interface lacks is refused', badLangName.status === 400)

  const blankNames = await call('POST', '/api/activities', {
    token: teacherToken,
    body: { titleByLang: { en: ' ', tr: '' } },
  })
  check('blank names in every language are no title', blankNames.status === 400)
  await call('DELETE', `/api/activities/${namedTr.body.activity.id}`, { token: teacherToken })

  console.log('\nAI translation')
  const translateAnon = await call('POST', '/api/translate', { body: { text: 'Hi', from: 'en', to: 'tr' } })
  check('translating needs a token', translateAnon.status === 401)
  const translateStudent = await call('POST', '/api/translate', {
    token: studentToken,
    body: { text: 'Hi', from: 'en', to: 'tr' },
  })
  check('and is for authors, not students', translateStudent.status === 403)
  const translateSame = await call('POST', '/api/translate', {
    token: teacherToken,
    body: { text: 'Hi', from: 'en', to: 'en' },
  })
  check('the two languages must differ', translateSame.status === 400)
  const translateOff = await call('POST', '/api/translate', {
    token: teacherToken,
    body: { text: 'Hi', from: 'en', to: 'tr' },
  })
  check('with no model key it says so with a 503', translateOff.status === 503)

  /**
   * The class code. Six characters from the unambiguous alphabet, allocated at
   * creation — not a credential, which is what the draft assertions below are
   * really checking.
   */
  check('it carries a class code', /^[A-Z2-9]{6}$/.test(activity.code))

  const untopiced = await call('PATCH', `/api/activities/${activity.id}`, {
    token: teacherToken,
    body: { topic: null },
  })
  check('the topic can be cleared', untopiced.body.activity.topic === null)
  await call('PATCH', `/api/activities/${activity.id}`, {
    token: teacherToken,
    body: { topic: 'whole-numbers' },
  })

  /**
   * The activity's own tutor prompt: staff write it, the model reads it, and
   * no student payload ever carries it. TUTOR-GUIDANCE-MARKER is a phrase in
   * no public field, so finding it in anything a student receives — checked
   * in every leak section below — means it leaked.
   */
  console.log("\nan activity's own tutor prompt")
  check('a new activity starts with none', activity.tutorPrompt === '')
  const withGuidance = await call('PATCH', `/api/activities/${activity.id}`, {
    token: teacherToken,
    body: { tutorPrompt: '  TUTOR-GUIDANCE-MARKER: only ask questions back.  ' },
  })
  check('a teacher can set it', withGuidance.status === 200)
  check('it is trimmed', withGuidance.body.activity.tutorPrompt === 'TUTOR-GUIDANCE-MARKER: only ask questions back.')
  const authorView = await call('GET', `/api/activities/${activity.id}`, { token: teacherToken })
  check('the author reads it back', authorView.body.activity.tutorPrompt === 'TUTOR-GUIDANCE-MARKER: only ask questions back.')
  check(
    'a non-string tutor prompt is refused',
    (await call('PATCH', `/api/activities/${activity.id}`, { token: teacherToken, body: { tutorPrompt: 42 } })).status === 400,
  )
  check(
    'so is one over 4000 characters',
    (await call('PATCH', `/api/activities/${activity.id}`, { token: teacherToken, body: { tutorPrompt: 'x'.repeat(4001) } }))
      .status === 400,
  )
  const createdWithGuidance = await call('POST', '/api/activities', {
    token: teacherToken,
    body: { title: 'Guided', tutorPrompt: 'Be Socratic.' },
  })
  check('it can be given at creation', createdWithGuidance.body.activity.tutorPrompt === 'Be Socratic.')
  const clearedGuidance = await call('PATCH', `/api/activities/${createdWithGuidance.body.activity.id}`, {
    token: teacherToken,
    body: { tutorPrompt: null },
  })
  check('and null clears it', clearedGuidance.body.activity.tutorPrompt === '')
  await call('DELETE', `/api/activities/${createdWithGuidance.body.activity.id}`, { token: teacherToken })
  check(
    "another teacher cannot set it on someone else's activity",
    (await call('PATCH', `/api/activities/${activity.id}`, { token: otherTeacherToken, body: { tutorPrompt: 'mine now' } }))
      .status === 404,
  )
  check(
    'nor can a student',
    (await call('PATCH', `/api/activities/${activity.id}`, { token: studentToken, body: { tutorPrompt: 'hi' } })).status ===
      404,
  )

  console.log('\nenhancing a tutor prompt')
  const enhanceAnon = await call('POST', '/api/tutor-prompt/enhance', { body: { text: 'ask questions' } })
  check('enhancing needs a token', enhanceAnon.status === 401)
  const enhanceStudent = await call('POST', '/api/tutor-prompt/enhance', {
    token: studentToken,
    body: { text: 'ask questions' },
  })
  check('and is for authors, not students', enhanceStudent.status === 403)
  const enhanceEmpty = await call('POST', '/api/tutor-prompt/enhance', { token: teacherToken, body: { text: '  ' } })
  check('an empty draft is a 400', enhanceEmpty.status === 400)
  const enhanceLong = await call('POST', '/api/tutor-prompt/enhance', {
    token: teacherToken,
    body: { text: 'x'.repeat(4001) },
  })
  check('a draft over the limit is a 400', enhanceLong.status === 400)
  const enhanceOff = await call('POST', '/api/tutor-prompt/enhance', {
    token: teacherToken,
    body: { text: 'ask questions', lang: 'en' },
  })
  check('with no model key it says so with a 503', enhanceOff.status === 503)

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

  const badAnswer = await call('POST', `/api/activities/${activity.id}/questions`, {
    token: teacherToken,
    body: { prompt: 'Fine prompt', answer: 42 },
  })
  check('a non-string answer is rejected', badAnswer.status === 400)

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
  check('the answer came back to its author', markedQ.answer === OSMOSIS.answer)

  const bare = await call('POST', `/api/activities/${activity.id}/questions`, {
    token: teacherToken,
    body: BARE_QUESTION,
  })
  check('a question with no rubric is allowed', bare.status === 201)
  const bareQ = bare.body.question
  check('it is numbered Q2', bareQ.code === 'Q2')
  check('its rubric is empty, not absent', Array.isArray(bareQ.rubric) && bareQ.rubric.length === 0)
  check('its tutor script is empty, not absent', bareQ.tutor.hints.length === 0)
  check('its answer is empty, not absent', bareQ.answer === '')

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

  const answered = await call(
    'PATCH',
    `/api/activities/${activity.id}/questions/${uploadedQ.body.question.id}`,
    { token: teacherToken, body: { answer: '  A conical flask feeding a gas syringe.  ' } },
  )
  check(
    'an answer can be added after the fact, trimmed',
    answered.body.question.answer === 'A conical flask feeding a gas syringe.',
  )

  const unanswered = await call(
    'PATCH',
    `/api/activities/${activity.id}/questions/${uploadedQ.body.question.id}`,
    { token: teacherToken, body: { answer: null } },
  )
  check('and cleared again with null', unanswered.body.question.answer === '')

  /**
   * The answer photographed off a mark scheme instead of typed. Same upload
   * shape as the question's own image, same three-state protocol — and the
   * question is deleted afterwards still carrying one, which is what exercises
   * the cleanup path for its bytes.
   */
  const answerShot = await call(
    'PATCH',
    `/api/activities/${activity.id}/questions/${uploadedQ.body.question.id}`,
    { token: teacherToken, body: { answerImage: { name: 'key.png', dataUrl: PNG } } },
  )
  check('the answer can be a picture', answerShot.status === 200)
  check(
    'it comes back to the teacher with a url',
    answerShot.body.question.answerImage.url.startsWith('/api/uploads/'),
  )

  const answerShotGone = await call(
    'PATCH',
    `/api/activities/${activity.id}/questions/${uploadedQ.body.question.id}`,
    { token: teacherToken, body: { answerImage: null } },
  )
  check('and removed again with null', answerShotGone.body.question.answerImage === null)

  await call(
    'PATCH',
    `/api/activities/${activity.id}/questions/${uploadedQ.body.question.id}`,
    { token: teacherToken, body: { answerImage: { name: 'key.png', dataUrl: PNG } } },
  )
  await call('DELETE', `/api/activities/${activity.id}/questions/${uploadedQ.body.question.id}`, {
    token: teacherToken,
  })

  const translated = await call(
    'PATCH',
    `/api/activities/${activity.id}/questions/${bareQ.id}`,
    { token: teacherToken, body: { promptByLang: { en: '  Label the cell.  ', tr: 'Hücreyi etiketleyin.' } } },
  )
  check('a prompt can be written per language', translated.body.question.promptByLang.tr === 'Hücreyi etiketleyin.')
  check('and is trimmed like the prompt', translated.body.question.promptByLang.en === 'Label the cell.')
  const unknownLang = await call(
    'PATCH',
    `/api/activities/${activity.id}/questions/${bareQ.id}`,
    { token: teacherToken, body: { promptByLang: { de: 'Beschrifte die Zelle.' } } },
  )
  check('a language the interface does not have is refused', unknownLang.status === 400)
  const translationOnly = await call('POST', `/api/activities/${activity.id}/questions`, {
    token: teacherToken,
    body: { promptByLang: { tr: 'Sadece Türkçe yazılmış bir soru.' } },
  })
  check('a prompt in one language alone is a question', translationOnly.status === 201)
  await call('DELETE', `/api/activities/${activity.id}/questions/${translationOnly.body.question.id}`, {
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

  // An answer picture on the first question, so the leak checks below have one
  // to fail on. Its upload id must never appear in a student payload.
  const answerKey = (
    await call('PATCH', `/api/activities/${activity.id}/questions/${markedQ.id}`, {
      token: teacherToken,
      body: { answerImage: { name: 'mark-scheme.png', dataUrl: PNG } },
    })
  ).body.question.answerImage

  const preview = await call('GET', `/api/activities/${activity.id}/preview`, {
    token: teacherToken,
  })
  const previewText = JSON.stringify(preview.body)
  check('preview returns every question', preview.body.activity.questions.length === 3)
  check('no rubric on a previewed question', !('rubric' in preview.body.activity.questions[0]))
  check('no tutor script either', !('tutor' in preview.body.activity.questions[0]))
  check('no teacher answer either', !('answer' in preview.body.activity.questions[0]))
  check('no answer picture either', !('answerImage' in preview.body.activity.questions[0]))
  check('no answer picture url survives it', !previewText.includes(answerKey.id))
  check('no keyword survives the trip', !previewText.includes('water potential'))
  check('no hint text survives it', !previewText.includes('Start outside the cell'))
  check('no answer text survives it', !previewText.includes('exerts an opposing pressure'))
  check('no tutor prompt survives it', !previewText.includes('TUTOR-GUIDANCE-MARKER'))
  check('criteria are counted, not listed', preview.body.activity.questions[0].criteriaCount === 3)
  check('and the count is honest', preview.body.activity.questions[0].points === 3)
  check('an unmarked question says so', preview.body.activity.questions[1].markable === false)
  check('a marked one says so too', preview.body.activity.questions[0].markable === true)
  check(
    'the per-language prompts do travel',
    preview.body.activity.questions.some((question) => question.promptByLang?.tr === 'Hücreyi etiketleyin.'),
  )

  console.log('\npublishing is the whole access decision')
  const draftList = await call('GET', '/api/activities/available')
  check('a draft is invisible to an anonymous visitor', draftList.body.activities.length === 0)

  const draftSession = await call('POST', '/api/sessions', {
    body: { consent: true, activityId: activity.id },
  })
  check('and cannot be started', draftSession.status === 400)

  /**
   * The class code is a shortcut, not a key. Everything here runs with no token
   * at all, and a draft is refused down this path exactly as it is down the list
   * path — which is the assertion that keeps the code from becoming a way in.
   */
  const draftByCode = await call('GET', `/api/activities/code/${activity.code}`)
  check('a draft cannot be reached by its class code', draftByCode.status === 400)

  const draftCodeSession = await call('POST', '/api/sessions', {
    body: { consent: true, code: activity.code },
  })
  check('nor started by it', draftCodeSession.status === 400)

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
  check('and carries its topic, for the filter', openList.body.activities[0].topic === 'whole-numbers')
  check('but carries no questions', !('questions' in openList.body.activities[0]))
  check(
    'and no mark scheme',
    !JSON.stringify(openList.body).includes('water potential'),
  )
  check('and no tutor prompt', !JSON.stringify(openList.body).includes('TUTOR-GUIDANCE-MARKER'))

  console.log('\nthe class code, once it is published')
  const byCode = await call('GET', `/api/activities/code/${activity.code.toLowerCase()}`)
  check('a published activity resolves from its code', byCode.status === 200)
  check('case does not matter', byCode.body.activity.id === activity.id)
  check('it is named', byCode.body.activity.title === 'Membranes & transport')
  check('and counted', byCode.body.activity.questionCount === 3)
  check('but carries no questions', !('questions' in byCode.body.activity))
  check('and no tutor prompt', !JSON.stringify(byCode.body).includes('TUTOR-GUIDANCE-MARKER'))

  const nonsenseCode = await call('GET', '/api/activities/code/ZZZZZZ')
  check('an unknown code is a 404', nonsenseCode.status === 404)

  const codeSession = await call('POST', '/api/sessions', {
    body: { consent: true, code: activity.code.toLowerCase() },
  })
  check('a student can start from a code alone', codeSession.status === 201)
  check('and lands in the right activity', codeSession.body.session.activityId === activity.id)
  check('with consent still recorded', codeSession.body.session.consent.given === true)
  // Removed again: the assertions further down count sessions.
  await call('DELETE', `/api/sessions/${codeSession.body.session.id}`)

  const codeNoConsent = await call('POST', '/api/sessions', { body: { code: activity.code } })
  check('the code does not bypass consent', codeNoConsent.status === 400)

  const secondActivity = await call('POST', '/api/activities', {
    token: teacherToken,
    body: { title: 'A second activity' },
  })
  check(
    'every activity gets its own code',
    secondActivity.body.activity.code !== activity.code,
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

  const studentNoConsent = await call('POST', '/api/sessions', {
    token: studentToken,
    body: { activityId: activity.id },
  })
  check('a signed-in student is still asked', studentNoConsent.status === 400)

  /**
   * Staff are refused rather than exempted. There is no preview any more, so
   * there is no session a teacher can start — with consent or without it, which
   * is why both are tried here. The workspace is students' only.
   */
  const staffSession = await call('POST', '/api/sessions', {
    token: teacherToken,
    body: { activityId: activity.id },
  })
  check('a teacher cannot start a session', staffSession.status === 403)

  const staffConsenting = await call('POST', '/api/sessions', {
    token: teacherToken,
    body: { consent: true, activityId: activity.id },
  })
  check('nor by agreeing to a notice not addressed to them', staffConsenting.status === 403)

  check(
    'an admin cannot either',
    (await call('POST', '/api/sessions', {
      token: adminToken,
      body: { consent: true, activityId: activity.id },
    })).status === 403,
  )

  /**
   * A student with an account is asked once. The agreement goes on the account,
   * and a later session carries it forward — with the date it was *first* given,
   * not the date the session started.
   */
  const beforeConsent = await call('GET', '/api/auth/me', { token: studentToken })
  check('a new account has not consented', beforeConsent.body.user.consented === false)

  const recorded = await call('POST', '/api/auth/consent', { token: studentToken })
  check('a student can record consent on their account', recorded.status === 201 || recorded.status === 200)
  check('and it says so', recorded.body.user.consented === true)
  check('with the version it agreed to', Boolean(recorded.body.user.consent.version))
  const firstAt = recorded.body.user.consent.at

  const reconsent = await call('POST', '/api/auth/consent', { token: studentToken })
  check('recording it twice is a no-op', reconsent.body.recorded === false)
  check('so the first date survives', reconsent.body.user.consent.at === firstAt)

  check(
    'consent needs an account to be recorded against',
    (await call('POST', '/api/auth/consent')).status === 401,
  )

  const returning = await call('POST', '/api/sessions', {
    token: studentToken,
    body: { activityId: activity.id },
  })
  check('a returning student is not asked again', returning.status === 201)
  check('the session records consent', returning.body.session.consent.given === true)
  check('and when it was first given', returning.body.session.consent.firstGivenAt === firstAt)
  check('and no session is a staff preview any more', returning.body.session.staffPreview === false)
  // Taken back out again: everything below counts rows, and a session left
  // lying in the store would make the roster assertions about a student's work
  // be about this one instead.
  await call('DELETE', `/api/sessions/${returning.body.session.id}`, { token: studentToken })

  /**
   * The anonymous door: no token, no code, no password. Everything that follows
   * runs on this session, so if any of it needed an identity it would fail here.
   */
  console.log('\nstarting anonymously')

  /**
   * The nickname: what an anonymous session is called on a teacher's roster.
   * Optional, capped, and ignored for a session that already has an account
   * naming it.
   */
  const nicknamed = await call('POST', '/api/sessions', {
    body: { consent: true, activityId: activity.id, nickname: '  Blue Fox  ' },
  })
  check('an anonymous session can carry a nickname', nicknamed.body.session.nickname === 'Blue Fox')

  const longNickname = await call('POST', '/api/sessions', {
    body: { consent: true, activityId: activity.id, nickname: 'x'.repeat(200) },
  })
  check('a long one is cut, not refused', longNickname.body.session.nickname.length === 40)

  const blankNickname = await call('POST', '/api/sessions', {
    body: { consent: true, activityId: activity.id, nickname: '   ' },
  })
  check('a blank one is null, not an empty string', blankNickname.body.session.nickname === null)

  const namedAccount = await call('POST', '/api/sessions', {
    token: studentToken,
    body: { consent: true, activityId: activity.id, nickname: 'Sneaky' },
  })
  check(
    'a signed-in session ignores it — the account names it',
    namedAccount.body.session.nickname === null,
  )

  // Removed again: everything below this point counts sessions.
  for (const spare of [nicknamed, longNickname, blankNickname, namedAccount]) {
    await call('DELETE', `/api/sessions/${spare.body.session.id}`, { token: studentToken })
  }

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
  check(
    'no teacher answer in the session payload',
    !JSON.stringify(started.body).includes('exerts an opposing pressure'),
  )
  check('no tutor prompt in the session payload', !JSON.stringify(started.body).includes('TUTOR-GUIDANCE-MARKER'))
  const sessionReread = await call('GET', `/api/sessions/${session.id}`)
  check(
    'nor when the session is read back',
    sessionReread.status === 200 && !JSON.stringify(sessionReread.body).includes('TUTOR-GUIDANCE-MARKER'),
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
  check('and it is recorded as scripted, not generated', hint1.body.tutor.source === 'scripted')
  check('with no model against it', hint1.body.tutor.model === null)

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
  check(
    "the activity's tutor prompt is not in the chat response",
    ![hint1, hint2, typed].some((reply) => JSON.stringify(reply.body).includes('TUTOR-GUIDANCE-MARKER')),
  )

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

  /**
   * The failure path, which is the one that matters and the one nobody sees.
   *
   * A key that cannot work, pointed at a model that does not exist, so the call
   * fails without reaching a real quota: a student must still get a whole
   * sentence, and the record must say the model was asked and failed rather
   * than quietly reading like a teacher wrote it.
   */
  config.openai.apiKey = 'not-a-real-key'
  config.openai.model = 'no-such-model'
  config.openai.timeoutMs = 8000

  const brokenModel = await call(
    'POST',
    `/api/sessions/${session.id}/questions/${bareQ.id}/messages`,
    { body: { text: 'Does it still answer when the model is down?' } },
  )
  check('a failed model call still answers the student', brokenModel.status === 201)
  check('with one of the whole scripted sentences', fallbackReplies.includes(brokenModel.body.tutor.text))
  check('recorded as a fallback, not as a script', brokenModel.body.tutor.source === 'fallback')

  const broken = await call('GET', `/api/research/sessions/${session.id}/transcript`, {
    token: 'smoke-token',
  })
  check(
    'and why it failed is in the event log',
    broken.body.events.some(
      (event) => event.type === 'ai_feedback_shown' && typeof event.payload?.reason === 'string',
    ),
  )

  config.openai.apiKey = null
  config.openai.model = 'gpt-4o-mini'

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

  // A question can be photographed again and again; only the latest shows,
  // every one is kept (design doc).
  const photoOne = await call('POST', `/api/sessions/${session.id}/questions/${markedQ.id}/uploads`, {
    body: { name: 'try-1.png', dataUrl: PNG },
  })
  const photoTwo = await call('POST', `/api/sessions/${session.id}/questions/${markedQ.id}/uploads`, {
    body: { name: 'try-2.png', dataUrl: PNG },
  })
  const shownPhotos = photoTwo.body.answer.attachments.filter((item) => item.source !== 'whiteboard')
  check(
    'a new photo replaces the one before it on the answer',
    shownPhotos.length === 1 && shownPhotos[0].id === photoTwo.body.upload.id,
  )
  check(
    'next to the board, which stays',
    photoTwo.body.answer.attachments.some((item) => item.source === 'whiteboard'),
  )
  check('the earlier photo is still kept', (await fetch(`${base}${photoOne.body.upload.url}`)).status === 200)
  const photoThree = await call('POST', `/api/sessions/${session.id}/questions/${markedQ.id}/uploads`, {
    body: { name: 'try-3.png', dataUrl: PNG },
  })
  const removedPhoto = await call(
    'DELETE',
    `/api/sessions/${session.id}/questions/${markedQ.id}/uploads/${photoThree.body.upload.id}`,
  )
  check(
    'removing a photo takes it off the answer',
    removedPhoto.body.answer.attachments.every((item) => item.id !== photoThree.body.upload.id),
  )
  check('but keeps it', (await fetch(`${base}${photoThree.body.upload.url}`)).status === 200)

  const badFile = await call('POST', `/api/sessions/${session.id}/questions/${markedQ.id}/uploads`, {
    body: { name: 'x.txt', dataUrl: 'data:text/plain;base64,aGVsbG8=' },
  })
  check('unsupported type rejected', badFile.status === 400)

  // Students hand in photos only; a PDF is a teacher's question format.
  const studentPdf = await call('POST', `/api/sessions/${session.id}/questions/${markedQ.id}/uploads`, {
    body: { name: 'working.pdf', dataUrl: 'data:application/pdf;base64,JVBERi0xLjQK' },
  })
  check('a student PDF is refused', studentPdf.status === 400)

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

  // Photographed rather than typed (3 Nov 2026 doc).
  const ownEmpty = await call('POST', `/api/sessions/${session.id}/own-questions`, {
    body: { prompt: '   ' },
  })
  check('an own question with neither text nor photo is refused', ownEmpty.status === 400)
  const ownPdf = await call('POST', `/api/sessions/${session.id}/own-questions`, {
    body: { image: { name: 'q.pdf', dataUrl: 'data:application/pdf;base64,JVBERi0xLjQK' } },
  })
  check('an own question photo must be a photo', ownPdf.status === 400)
  const ownPhoto = await call('POST', `/api/sessions/${session.id}/own-questions`, {
    body: { image: { name: 'worksheet.png', dataUrl: PNG } },
  })
  check(
    'an own question can be a photo alone',
    ownPhoto.status === 201 && ownPhoto.body.question.prompt === '' && ownPhoto.body.question.image?.type === 'image/png',
  )
  check('its storage path is not leaked', ownPhoto.body.question.image?.path === undefined)
  const [twinA, twinB] = await Promise.all(
    ['twin a', 'twin b'].map((prompt) =>
      call('POST', `/api/sessions/${session.id}/own-questions`, { body: { prompt } }),
    ),
  )
  check(
    'two own questions sent at once both land, under different ids',
    twinA.status === 201 && twinB.status === 201 && twinA.body.question.id !== twinB.body.question.id,
  )
  check('and its bytes are served', (await fetch(`${base}${ownPhoto.body.question.image.url}`)).status === 200)

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
    token: (await call('POST', '/api/auth/student', { body: { studentNumber: '10000002' } })).body.token,
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
  // A teacher labels only in a dataset assigned to them (see "datasets" below).
  // Kept snippets are in the default dataset, so assigning that one keeps this
  // loop exactly as it was.
  check(
    'an admin assigns the default dataset to the teacher',
    (await call('POST', '/api/research/datasets/ds_default/members', { token: adminToken, body: { userId: teacher.id } }))
      .status === 200,
  )
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
  // Twelve messages, six pairs: the tutor exchanges above plus the one that
  // proves a failed model call still answers. Counted rather than sampled, so a
  // turn that stopped being recorded shows up here.
  check('message counts reported', row.counts.messages === 12)
  check('snippet count reported', row.counts.snippets === 6)

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

  // A written answer on the marked question, so a snippet has one to carry
  // (the last thing done to it above was switching to an empty drawing).
  await call('PUT', `/api/sessions/${session.id}/answers/${markedQ.id}`, {
    body: { mode: 'write', draft: 'Water moves in by osmosis.' },
  })

  const snippets = await call('GET', `/api/research/snippets?sessionId=${session.id}`, {
    token: teacherToken,
  })
  check('snippets are student+feedback pairs', snippets.body.snippets.length === 6)
  check(
    'each snippet holds both turns',
    snippets.body.snippets.every((s) => s.student.text && s.tutor.text),
  )
  // Who wrote the feedback travels with it, or a label on a teacher's own hint
  // and a label on a failed model call are the same row in the dataset.
  check(
    'and says where the feedback came from',
    snippets.body.snippets.every((s) => ['openai', 'scripted', 'fallback'].includes(s.tutor.source)),
  )
  check(
    'including the one the model failed to write',
    snippets.body.snippets.some((s) => s.tutor.source === 'fallback'),
  )
  check('labelling criteria offered', snippets.body.criteria.length === 5)
  check('undecided by default', snippets.body.snippets.every((s) => s.included === null))
  check('no per-criterion notes yet', snippets.body.snippets.every((s) => JSON.stringify(s.notes) === '{}'))

  // The question and the answer travel with each snippet, so a labeller can
  // judge a reply against what the student was actually working on.
  check(
    'each snippet names its question',
    snippets.body.snippets.every((s) => s.question && typeof s.question.code === 'string'),
  )
  const onMarked = snippets.body.snippets.find((s) => s.questionId === markedQ.id)
  check('authored questions carry their code and prompt', onMarked?.question.code === 'Q1' && Boolean(onMarked.question.prompt))
  check('and the answer the student handed in', onMarked?.answer?.draft === 'Water moves in by osmosis.')
  check('without the raw drawing data', onMarked?.answer && !('strokes' in onMarked.answer))
  check(
    'own questions are flagged',
    snippets.body.snippets.some((s) => s.question.isOwnQuestion && s.question.code.startsWith('OWN-')),
  )
  check(
    'and a question with nothing handed in has no answer',
    snippets.body.snippets.some((s) => s.answer === null),
  )
  const allSnippets = await call('GET', '/api/research/snippets', { token: teacherToken })
  check(
    'context is attached across sessions too',
    allSnippets.status === 200 && allSnippets.body.snippets.every((s) => s.question && 'answer' in s),
  )

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

  console.log('\na reason per criterion')
  const firstNote = await call('PATCH', `/api/research/snippets/${target.id}`, {
    token: teacherToken,
    body: { notes: { specific: 'Names the membrane.' } },
  })
  check('a criterion gets its own reason', firstNote.body.label.notes?.specific === 'Names the membrane.')
  const secondNote = await call('PATCH', `/api/research/snippets/${target.id}`, {
    token: teacherToken,
    body: { notes: { tone: 'Warm.' } },
  })
  check(
    "a second criterion's reason does not erase the first",
    secondNote.body.label.notes?.specific === 'Names the membrane.' &&
      secondNote.body.label.notes?.tone === 'Warm.',
  )
  check('the overall note is untouched', secondNote.body.label.note === 'Good nudge, stops short of the answer.')
  const longNote = await call('PATCH', `/api/research/snippets/${target.id}`, {
    token: teacherToken,
    body: { notes: { accurate: 'x'.repeat(5000) } },
  })
  check('a reason is capped', longNote.body.label.notes?.accurate.length === 4000)
  const badNoteCriterion = await call('PATCH', `/api/research/snippets/${target.id}`, {
    token: teacherToken,
    body: { notes: { invented: 'why' } },
  })
  check('a reason for an unknown criterion is rejected', badNoteCriterion.status === 400)
  const badNoteValue = await call('PATCH', `/api/research/snippets/${target.id}`, {
    token: teacherToken,
    body: { notes: { specific: 3 } },
  })
  check('a reason must be text', badNoteValue.status === 400)
  const badNotes = await call('PATCH', `/api/research/snippets/${target.id}`, {
    token: teacherToken,
    body: { notes: ['specific'] },
  })
  check('"notes" must be an object', badNotes.status === 400)
  const legacyNote = await call('PATCH', `/api/research/snippets/${target.id}`, {
    token: teacherToken,
    body: { note: 'Still a good nudge.' },
  })
  check(
    'the single overall note still saves, beside the per-criterion ones',
    legacyNote.body.label.note === 'Still a good nudge.' && legacyNote.body.label.notes?.tone === 'Warm.',
  )
  const reread = await call('GET', `/api/research/snippets?sessionId=${session.id}`, {
    token: teacherToken,
  })
  const rereadTarget = reread.body.snippets.find((s) => s.id === target.id)
  check(
    'and both read back',
    rereadTarget?.note === 'Still a good nudge.' && rereadTarget?.notes.specific === 'Names the membrane.',
  )

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
  check('export carries the per-criterion reasons', exportJson.body.snippets[0]?.notes?.tone === 'Warm.')
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
  check('csv keeps the overall note column', csv.split('\n')[0].includes('"note"'))
  check('csv adds a reason column per criterion', csv.includes('note_specific') && csv.includes('"Warm."'))

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

  console.log('\nten tutor turns per question, then two hours closed')
  const turnSession = (
    await call('POST', '/api/sessions', { body: { consent: true, activityId: activity.id } })
  ).body.session
  const turnsUrl = `/api/sessions/${turnSession.id}/questions/${bareQ.id}/messages`
  let lastTurn = null
  for (let n = 0; n < TURN_LIMIT; n += 1) {
    lastTurn = await call('POST', turnsUrl, { body: { text: `Question number ${n + 1}?` } })
  }
  check('all ten are answered', lastTurn.status === 201)
  check('and the reply says none are left', lastTurn.body.turns.remaining === 0)
  check('with when the chat reopens', typeof lastTurn.body.turns.lockedUntil === 'string')

  const eleventh = await call('POST', turnsUrl, { body: { text: 'One more?' } })
  check('the eleventh is refused with 429', eleventh.status === 429)
  check('carrying the lock in its details', eleventh.body.error.details.turns.remaining === 0)
  const eleventhAction = await call('POST', turnsUrl, { body: { action: 'hint' } })
  check('a quick action counts too', eleventhAction.status === 429)
  check(
    'and nothing was written for either',
    (await call('GET', turnsUrl)).body.messages.length === TURN_LIMIT * 2,
  )

  const otherQuestion = await call(
    'POST',
    `/api/sessions/${turnSession.id}/questions/${markedQ.id}/messages`,
    { body: { text: 'A different question still works?' } },
  )
  check('the limit is per question', otherQuestion.status === 201)
  check('and counts from ten again there', otherQuestion.body.turns.remaining === TURN_LIMIT - 1)

  const asks = (count, from) =>
    Array.from({ length: count }, (_, n) => ({
      from: 'student',
      createdAt: new Date(from + n * 1000).toISOString(),
    }))
  const start = Date.parse('2026-01-01T10:00:00Z')
  const tenth = start + (TURN_LIMIT - 1) * 1000
  check('turnState: locked until two hours after the tenth', turnState(asks(TURN_LIMIT, start), tenth + 1).lockedUntil === new Date(tenth + TURN_LOCK_MS).toISOString())
  check('turnState: a fresh ten once the lock lifts', turnState(asks(TURN_LIMIT, start), tenth + TURN_LOCK_MS).remaining === TURN_LIMIT)
  check(
    'turnState: an ask after the lock opens a new window',
    turnState([...asks(TURN_LIMIT, start), ...asks(1, tenth + TURN_LOCK_MS + 5)], tenth + TURN_LOCK_MS + 10).remaining === TURN_LIMIT - 1,
  )
  check(
    'turnState: tutor replies do not count',
    turnState([{ from: 'tutor', createdAt: new Date(start).toISOString() }]).used === 0,
  )

  console.log('\nwithdrawal')
  const deleted = await call('DELETE', `/api/sessions/${session.id}`)
  check('session deleted', deleted.body.deleted === true)
  // Two board exports, three photos (every attempt is kept) and the
  // photographed own question.
  check('its files were removed', deleted.body.files === 6)
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
  // Students sign in with their number and have no password at all; staff do.
  const studentChange = await call('POST', '/api/auth/password', {
    token: studentToken,
    body: { currentPassword: 'anything', newPassword: 'a whole new password' },
  })
  check('a student has no password to change', studentChange.status === 400)

  const wrongCurrent = await call('POST', '/api/auth/password', {
    token: teacherToken,
    body: { currentPassword: 'not it at all', newPassword: 'a whole new password' },
  })
  check('changing a password needs the current one', wrongCurrent.status === 403)

  const changed = await call('POST', '/api/auth/password', {
    token: teacherToken,
    body: { currentPassword: 'correct horse battery', newPassword: 'a whole new password' },
  })
  check('password changed', changed.body.changed === true)
  const staleToken = await call('GET', '/api/auth/me', { token: teacherToken })
  check('a password change signs out the old token', staleToken.status === 401)
  teacherToken = changed.body.token
  check('and hands back a working one', (await call('GET', '/api/auth/me', { token: teacherToken })).status === 200)

  const selfReset = await call('POST', `/api/users/${teacher.id}/password`, {
    token: teacherToken,
    body: { newPassword: 'trying to skip the check' },
  })
  check('the reset route is not a way around the current password', selfReset.status === 400)

  const studentReset = await call('POST', `/api/users/${student.id}/password`, {
    token: teacherToken,
    body: { newPassword: 'teacher set this one' },
  })
  check('a student has no password to reset', studentReset.status === 400)
  check(
    'not even by an admin',
    (
      await call('POST', `/api/users/${student.id}/password`, {
        token: adminToken,
        body: { newPassword: 'admin set this one' },
      })
    ).status === 400,
  )

  const reset = await call('POST', `/api/users/${teacher.id}/password`, {
    token: managerToken,
    body: { newPassword: 'manager set this one' },
  })
  check('a manager resets their teacher', reset.body.reset === true)
  check('the reset revoked their sessions', reset.body.sessionsRevoked === 1)
  check(
    'the old password stops working',
    (
      await call('POST', '/api/auth/login', {
        body: { email: 'tia@example.com', password: 'a whole new password' },
      })
    ).status === 401,
  )
  const reLogin = await call('POST', '/api/auth/login', {
    body: { email: 'tia@example.com', password: 'manager set this one' },
  })
  check('the new one works', reLogin.status === 200)
  teacherToken = reLogin.body.token

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

  const backIn = await call('POST', '/api/auth/student', { body: { studentNumber: '10000001' } })
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
  const deactivatedLogin = await call('POST', '/api/auth/student', { body: { studentNumber: '10000001' } })
  check('a deactivated account cannot sign in', deactivatedLogin.status === 401)

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
      body: { role: 'student', name: 'Temp Student', email: 'temp@example.com' },
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
    body: { role: 'student', name: 'Reuse', email: 'temp@example.com' },
  })
  check('the email is free again', emailFreed.status === 201)

  console.log('\na grade or level next to the topic')
  const leveled = await call('POST', '/api/activities', {
    token: teacherToken,
    body: { title: 'Levelled', topic: 'functions', level: '  9. sınıf  ' },
  })
  check('an activity carries a level', leveled.body.activity.level === '9. sınıf')
  const releveled = await call('PATCH', `/api/activities/${leveled.body.activity.id}`, {
    token: teacherToken,
    body: { level: 'x'.repeat(200) },
  })
  check('capped, not refused', releveled.body.activity.level.length === 60)
  const unleveled = await call('PATCH', `/api/activities/${leveled.body.activity.id}`, {
    token: teacherToken,
    body: { level: null },
  })
  check('and null clears it', unleveled.body.activity.level === '')
  await call('DELETE', `/api/activities/${leveled.body.activity.id}`, { token: teacherToken })

  console.log('\nthe Functions seed')
  const { seedFunctions } = await import('./seed-functions.mjs')
  const seeded = await seedFunctions(app.locals.store, { ownerId: teacher.id })
  check('it creates five questions', seeded.created && seeded.questions.length === 5)
  check(
    'students see the level in their list',
    (await call('PATCH', `/api/activities/${seeded.activity.id}`, { token: teacherToken, body: { level: 'Grade 11' } })).status === 200 &&
      (await call('GET', '/api/activities/available')).body.activities.some((entry) => entry.level === 'Grade 11'),
  )
  check('published, under the functions topic', seeded.activity.status === 'published' && seeded.activity.topic === 'functions')
  check(
    'every question is written in both languages',
    seeded.questions.every((question) => question.promptByLang.en && question.promptByLang.tr),
  )
  check(
    'and the switch picks between them',
    promptFor(seeded.questions[3], 'tr').includes('değerini bulun') &&
      promptFor(seeded.questions[3], 'en').startsWith('If $f(x)'),
  )
  const seededForStudent = await call('POST', '/api/sessions', {
    body: { consent: true, activityId: seeded.activity.id },
  })
  check('a student can open it', seededForStudent.status === 201)
  check(
    'with no teacher answer in what they receive',
    !JSON.stringify(seededForStudent.body).includes('Answer: 72'),
  )
  const reseeded = await seedFunctions(app.locals.store, { ownerId: teacher.id })
  check('running it again changes nothing', !reseeded.created && reseeded.activity.id === seeded.activity.id)

  console.log('\na class list, and signing in with a student number')
  const pasted = await call('POST', '/api/users/class-list', {
    token: teacherToken,
    body: { studentNumbers: ['20230001', ' 2023 0002 ', 'not a number!', '2023001', '20230001'] },
  })
  check('a teacher pastes their class list', pasted.status === 201)
  check('each number once, cleaned', pasted.body.added.join() === '20230001,20230002')
  check('and the bad lines are reported, not fatal', pasted.body.invalid.length === 2)
  check('a number that is not 8 digits is not a username', pasted.body.invalid.includes('2023001'))
  const pastedAgain = await call('POST', '/api/users/class-list', {
    token: teacherToken,
    body: { studentNumbers: ['20230001', '20230002'] },
  })
  check('pasting the same list twice is harmless', pastedAgain.status === 200 && pastedAgain.body.already.length === 2)
  const managerPaste = await call('POST', '/api/users/class-list', {
    token: managerToken,
    body: { studentNumbers: ['20230003'] },
  })
  check('a manager has to name the teacher', managerPaste.status === 400)
  const taken = await call('POST', '/api/users/class-list', {
    token: adminToken,
    body: { studentNumbers: ['20230001'], teacherId: null },
  })
  check('an admin with no teacher named is refused too', taken.status === 400)

  const numberLogin = await call('POST', '/api/auth/student', { body: { studentNumber: ' 20230001 ' } })
  check('a listed number signs in with nothing else', numberLogin.status === 200 && Boolean(numberLogin.body.token))
  check('as a student on that teacher\'s list', numberLogin.body.user.role === 'student' && numberLogin.body.user.teacherId === teacher.id)
  check('with no email shown', numberLogin.body.user.email === null)
  check('and not yet consented — asked once, on first sign-in', numberLogin.body.user.consented === false)
  const numberToken = numberLogin.body.token
  const studentPaste = await call('POST', '/api/users/class-list', {
    token: numberToken,
    body: { studentNumbers: ['20230009'] },
  })
  check('a student cannot keep a class list', studentPaste.status === 403)
  check(
    'an unlisted number is refused',
    (await call('POST', '/api/auth/student', { body: { studentNumber: '99999999' } })).status === 401,
  )
  check(
    'and the password door stays shut for them',
    (await call('POST', '/api/auth/login', { body: { email: '20230001@class-list.invalid', password: 'anything at all' } })).status === 401,
  )

  config.studentSignInRequired = true
  const anonymousNow = await call('POST', '/api/sessions', { body: { consent: true, activityId: seeded.activity.id } })
  check('with sign-in required, no anonymous session starts', anonymousNow.status === 401)

  const consentOnce = await call('POST', '/api/auth/consent', { token: numberToken })
  check('their consent is recorded against the number', consentOnce.body.user.consented === true)
  const firstVisit = await call('POST', '/api/sessions', {
    token: numberToken,
    body: { activityId: seeded.activity.id },
  })
  check('they start without being asked again', firstVisit.status === 201)
  check('carrying the date they first agreed', Boolean(firstVisit.body.session.consent.firstGivenAt))
  await call('PUT', `/api/sessions/${firstVisit.body.session.id}/answers/${seeded.questions[0].id}`, {
    token: numberToken,
    body: { mode: 'write', draft: 'f and g agree everywhere' },
  })

  const relogin = await call('POST', '/api/auth/student', { body: { studentNumber: '20230001' } })
  check('signing in again needs no consent', relogin.body.user.consented === true)
  const secondVisit = await call('POST', '/api/sessions', {
    token: relogin.body.token,
    body: { activityId: seeded.activity.id },
  })
  check('reopening the activity goes back into the same work', secondVisit.status === 200 && secondVisit.body.resumed === true)
  check('the same session', secondVisit.body.session.id === firstVisit.body.session.id)
  const backInWork = await call('GET', `/api/sessions/${secondVisit.body.session.id}`)
  check(
    'with the answer where they left it',
    backInWork.body.answers.some((answer) => answer.draft === 'f and g agree everywhere'),
  )
  const listedForThem = await call('GET', '/api/activities/available', { token: relogin.body.token })
  check(
    'and the list says they have started it',
    listedForThem.body.activities.find((entry) => entry.id === seeded.activity.id)?.started === true,
  )

  // Withdrawing consent from the profile, only during the sign-in it was given in.
  check('the sign-in that agreed may withdraw', consentOnce.body.user.canWithdrawConsent === true)
  check('which sign-in that was is never sent', consentOnce.body.user.consent.signInKey === undefined)
  check(
    'and still may after a reload',
    (await call('GET', '/api/auth/me', { token: numberToken })).body.user.canWithdrawConsent === true,
  )
  check(
    'a later sign-in may not',
    (await call('GET', '/api/auth/me', { token: relogin.body.token })).body.user.canWithdrawConsent === false,
  )
  check(
    'and is refused if it tries',
    (await call('POST', '/api/auth/consent/withdraw', { token: relogin.body.token })).status === 403,
  )
  const withdrawn = await call('POST', '/api/auth/consent/withdraw', { token: numberToken })
  check('withdrawing works from the sign-in that agreed', withdrawn.status === 200 && withdrawn.body.withdrawn === true)
  check('it keeps their work', (await call('GET', `/api/sessions/${firstVisit.body.session.id}`)).status === 200)
  check('no longer consented', withdrawn.body.user.consented === false && withdrawn.body.user.canWithdrawConsent === false)
  check('but marked withdrawn, so they are not asked again', withdrawn.body.user.withdrawn === true)
  check(
    'and they can carry on with their work',
    (await call('POST', '/api/sessions', { token: numberToken, body: { activityId: seeded.activity.id } })).status === 200,
  )
  check(
    'withdrawing twice is refused',
    (await call('POST', '/api/auth/consent/withdraw', { token: numberToken })).status === 400,
  )
  const againConsent = await call('POST', '/api/auth/consent', { token: numberToken })
  check('agreeing again records a fresh consent', againConsent.body.recorded === true && againConsent.body.user.consented === true)
  check('which clears the withdrawal', againConsent.body.user.withdrawn === false)

  // Work started after withdrawing is kept, but recorded as not consented.
  const otherLogin = await call('POST', '/api/auth/student', { body: { studentNumber: '20230002' } })
  check('a student who never agreed is not withdrawn', otherLogin.body.user.withdrawn === false)
  await call('POST', '/api/auth/consent', { token: otherLogin.body.token })
  await call('POST', '/api/auth/consent/withdraw', { token: otherLogin.body.token })
  const afterWithdrawing = await call('POST', '/api/sessions', {
    token: otherLogin.body.token,
    body: { consent: true, activityId: seeded.activity.id },
  })
  check('a withdrawn student can start a new session', afterWithdrawing.status === 201)
  check(
    'recorded as not consented, with when they withdrew',
    afterWithdrawing.body.session.consent.given === false && Boolean(afterWithdrawing.body.session.consent.withdrawnAt),
  )

  // A consent recorded before sign-in keys existed has no `signInKey`: the
  // sign-in issued before it may still withdraw, a later one may not.
  await app.locals.store.users.update(numberLogin.body.user.id, {
    consent: { given: true, at: new Date().toISOString(), version: config.consentVersion },
  })
  check(
    'a pre-key consent can be withdrawn from the sign-in it was given in',
    (await call('GET', '/api/auth/me', { token: numberToken })).body.user.canWithdrawConsent === true,
  )
  // A clock tick apart, so the new token is unambiguously issued after the agreement.
  await new Promise((resolve) => setTimeout(resolve, 5))
  const laterSignIn = await call('POST', '/api/auth/student', { body: { studentNumber: '20230001' } })
  check(
    'but not from a sign-in after it',
    (await call('POST', '/api/auth/consent/withdraw', { token: laterSignIn.body.token })).status === 403,
  )

  const removed = await call('PATCH', `/api/users/${numberLogin.body.user.id}`, {
    token: teacherToken,
    body: { active: false },
  })
  check('a teacher removes a number by deactivating it', removed.body.user.active === false)
  check(
    'and it stops signing in',
    (await call('POST', '/api/auth/student', { body: { studentNumber: '20230001' } })).status === 401,
  )
  const putBack = await call('POST', '/api/users/class-list', {
    token: teacherToken,
    body: { studentNumbers: ['20230001'] },
  })
  check('pasting it again puts them back', putBack.body.added.join() === '20230001')
  check(
    'a class-list student has no email to edit',
    (await call('PATCH', `/api/users/${numberLogin.body.user.id}`, { token: teacherToken, body: { email: 'x@example.com' } })).status === 400,
  )
  config.studentSignInRequired = false

  console.log('\nsupport and suggestions')
  const writer = (await call('POST', '/api/auth/student', { body: { studentNumber: '20230001' } })).body.token
  // Deleting an account's session follows the withdrawal rule too.
  const writerStart = await call('POST', '/api/sessions', { token: writer, body: { activityId: seeded.activity.id } })
  const writerSession = writerStart.body.session
  check(
    "an account's session cannot be deleted without its token",
    (await call('DELETE', `/api/sessions/${writerSession.id}`)).status === 401,
  )
  check(
    'nor by someone else',
    (await call('DELETE', `/api/sessions/${writerSession.id}`, { token: teacherToken })).status === 403,
  )
  check(
    'nor by its owner from a later sign-in',
    (await call('DELETE', `/api/sessions/${writerSession.id}`, { token: writer })).status === 403,
  )

  check('anonymous cannot write in', (await call('POST', '/api/support', { body: {} })).status === 401)
  check(
    'a category is required',
    (await call('POST', '/api/support', { token: writer, body: { category: 'rant', subject: 'x', body: 'y' } })).status === 400,
  )
  check(
    'a title and a message are required',
    (await call('POST', '/api/support', { token: writer, body: { category: 'support', subject: ' ', body: 'y' } })).status === 400,
  )
  const ticket = await call('POST', '/api/support', {
    token: writer,
    body: { category: 'support', subject: 'Upload fails', body: 'My photo does not upload.' },
  })
  check('a student writes in', ticket.status === 201 && ticket.body.message.replies.length === 0)
  check('and is shown no staff ids', ticket.body.message.teacherId === undefined)
  await call('POST', '/api/support', {
    token: writer,
    body: { category: 'suggestion', subject: 'Dark mode', body: 'Please add one.' },
  })
  const teacherInbox = await call('GET', '/api/support', { token: teacherToken })
  check('their teacher sees both', teacherInbox.status === 200 && teacherInbox.body.messages.length === 2)
  check('filed with their teacher', teacherInbox.body.messages.every((message) => message.teacherId === teacher.id))
  const onlySuggestions = await call('GET', '/api/support?category=suggestion', { token: teacherToken })
  check('filtered by category', onlySuggestions.body.messages.length === 1 && onlySuggestions.body.messages[0].category === 'suggestion')
  check('another teacher sees none', (await call('GET', '/api/support', { token: otherTeacherToken })).body.messages.length === 0)
  check('an admin sees them all', (await call('GET', '/api/support', { token: adminToken })).body.messages.length >= 2)
  check('a student has no inbox', (await call('GET', '/api/support', { token: writer })).status === 403)
  check(
    'another teacher cannot reply',
    (await call('POST', `/api/support/${ticket.body.message.id}/reply`, { token: otherTeacherToken, body: { text: 'hi' } })).status === 403,
  )
  const replied = await call('POST', `/api/support/${ticket.body.message.id}/reply`, {
    token: teacherToken,
    body: { text: 'Try a JPG under 10 MB.' },
  })
  check('their teacher replies', replied.status === 200 && replied.body.message.replies.at(-1).text === 'Try a JPG under 10 MB.')
  check('which is unread for the student', (await call('GET', '/api/support/unread', { token: writer })).body.unread === 1)
  const mine = await call('GET', '/api/support/mine', { token: writer })
  const mineTicket = mine.body.messages.find((message) => message.id === ticket.body.message.id)
  check('they see the reply when they come back', mineTicket.replies[0].text === 'Try a JPG under 10 MB.' && mineTicket.unread)
  check('without the staff ids behind it', mineTicket.teacherId === undefined && mineTicket.replies[0].byId === undefined)

  // A second reply lands after the list was read: it must survive being marked
  // seen, and stay unread.
  await new Promise((resolve) => setTimeout(resolve, 5))
  await call('POST', `/api/support/${ticket.body.message.id}/reply`, {
    token: teacherToken,
    body: { text: 'Also check it is under 10 MB.' },
  })
  check('a seen receipt needs the list it read', (await call('POST', '/api/support/mine/seen', { token: writer, body: {} })).status === 400)
  await call('POST', '/api/support/mine/seen', { token: writer, body: { asOf: mine.body.asOf } })
  const afterSeen = (await call('GET', '/api/support/mine', { token: writer })).body.messages.find(
    (message) => message.id === ticket.body.message.id,
  )
  check('a second reply keeps the first', afterSeen.replies.map((reply) => reply.text).join(' | ') === 'Try a JPG under 10 MB. | Also check it is under 10 MB.')
  check('and one posted after the list was read stays unread', afterSeen.unread === true)
  await call('POST', '/api/support/mine/seen', {
    token: writer,
    body: { asOf: (await call('GET', '/api/support/mine', { token: writer })).body.asOf },
  })
  check('and once read it is no longer unread', (await call('GET', '/api/support/unread', { token: writer })).body.unread === 0)

  // The writer answers back in the same thread instead of opening a new one.
  const ticketId = ticket.body.message.id
  check(
    'a follow-up needs text',
    (await call('POST', `/api/support/mine/${ticketId}/reply`, { token: writer, body: { text: '  ' } })).status === 400,
  )
  check(
    'nobody else can follow up on it',
    (await call('POST', `/api/support/mine/${ticketId}/reply`, { token: teacherToken, body: { text: 'hi' } })).status === 404,
  )
  check(
    'nor anonymously',
    (await call('POST', `/api/support/mine/${ticketId}/reply`, { body: { text: 'hi' } })).status === 401,
  )
  const followed = await call('POST', `/api/support/mine/${ticketId}/reply`, {
    token: writer,
    body: { text: 'Still failing with a JPG.' },
  })
  check(
    'the writer follows up in the same thread',
    followed.status === 200 &&
      followed.body.message.replies.length === 3 &&
      followed.body.message.replies.at(-1).fromWriter === true &&
      followed.body.message.replies.at(-1).byId === undefined,
  )
  check('their own follow-up is not unread for them', (await call('GET', '/api/support/unread', { token: writer })).body.unread === 0)
  const inboxThread = (await call('GET', '/api/support', { token: teacherToken })).body.messages.find((m) => m.id === ticketId)
  check('their teacher sees the follow-up in the thread', inboxThread.replies.at(-1).text === 'Still failing with a JPG.')
  check('and no new message was opened', (await call('GET', '/api/support/mine', { token: writer })).body.messages.length === 2)
  await new Promise((resolve) => setTimeout(resolve, 5))
  await call('POST', `/api/support/${ticketId}/reply`, { token: teacherToken, body: { text: 'Send me the file.' } })
  check('a staff reply after the follow-up is unread again', (await call('GET', '/api/support/unread', { token: writer })).body.unread === 1)

  /* ================================================== annotators and labelling */

  console.log('\nannotators')
  const annotatorMade = await call('POST', '/api/users', {
    token: adminToken,
    body: { role: 'annotator', name: 'Ann Annotator', email: 'ann@example.com', password: 'correct horse battery' },
  })
  const annotator = annotatorMade.body.user
  check('an admin creates an annotator', annotatorMade.status === 201 && annotator.role === 'annotator')
  check('who sits outside the tree', annotator.teacherId === null && annotator.managerId === null)
  check(
    'a manager cannot create one',
    (
      await call('POST', '/api/users', {
        token: managerToken,
        body: { role: 'annotator', name: 'Nope', email: 'nope-ann@example.com', password: 'correct horse battery' },
      })
    ).status === 403,
  )
  check(
    'nor give one a parent',
    (
      await call('POST', '/api/users', {
        token: adminToken,
        body: {
          role: 'annotator',
          name: 'Nope',
          email: 'nope-ann@example.com',
          password: 'correct horse battery',
          managerId: manager.id,
        },
      })
    ).status === 400,
  )
  check(
    'the role list in errors names the annotator',
    (
      await call('POST', '/api/users', {
        token: adminToken,
        body: { role: 'headmaster', name: 'Nope', email: 'nope-ann@example.com', password: 'correct horse battery' },
      })
    ).body.error.message.includes('annotator'),
  )
  const annotatorLogin = await call('POST', '/api/auth/login', {
    body: { email: 'ann@example.com', password: 'correct horse battery' },
  })
  check('an annotator signs in at the staff door', annotatorLogin.status === 200)
  let annotatorToken = annotatorLogin.body.token
  const annotatorMe = (await call('GET', '/api/auth/me', { token: annotatorToken })).body.user
  check('me reports the annotator role', annotatorMe.role === 'annotator')
  check('with no labelling switch, which is a teacher thing', !('canLabel' in annotatorMe))

  const secondAnnotator = (
    await call('POST', '/api/users', {
      token: adminToken,
      body: { role: 'annotator', name: 'Ben Annotator', email: 'ben@example.com', password: 'correct horse battery' },
    })
  ).body.user
  const secondAnnotatorToken = (
    await call('POST', '/api/auth/login', { body: { email: 'ben@example.com', password: 'correct horse battery' } })
  ).body.token
  const retired = (
    await call('POST', '/api/users', {
      token: adminToken,
      body: { role: 'annotator', name: 'Cid Retired', email: 'cid@example.com', password: 'correct horse battery' },
    })
  ).body.user
  await call('PATCH', `/api/users/${retired.id}`, { token: adminToken, body: { active: false } })
  check(
    'a deactivated staff account is refused at the email door',
    (await call('POST', '/api/auth/login', { body: { email: 'cid@example.com', password: 'correct horse battery' } }))
      .status === 403,
  )

  console.log('\nan annotator is kept out of every staff area')
  const closedToAnnotators = [
    ['GET', '/api/activities', undefined, 403],
    ['POST', '/api/activities', { title: 'Sneaky' }, 403],
    ['GET', `/api/activities/${activity.id}`, undefined, 404],
    ['GET', `/api/activities/${activity.id}/preview`, undefined, 404],
    ['GET', '/api/research/sessions', undefined, 403],
    ['GET', `/api/research/sessions/${turnSession.id}/transcript`, undefined, 403],
    ['GET', '/api/research/export', undefined, 403],
    ['GET', '/api/research/export?format=csv', undefined, 403],
    ['GET', '/api/research/annotators', undefined, 403],
    ['POST', '/api/research/snippets/assign', { snippetIds: ['x'], assigneeId: null }, 403],
    ['GET', '/api/support', undefined, 403],
    ['POST', `/api/support/${ticket.body.message.id}/reply`, { text: 'hi' }, 403],
    ['POST', '/api/prompts', { text: 'Be terse.' }, 403],
    ['POST', '/api/translate', { text: 'hello', to: 'tr' }, 403],
    ['POST', '/api/tutor-prompt/enhance', { text: 'hello' }, 403],
    ['POST', '/api/users', { role: 'student', name: 'Nope', studentNumber: '10000099' }, 403],
    ['POST', '/api/users/class-list', { studentNumbers: ['10000099'], teacherId: teacher.id }, 403],
    ['GET', `/api/users/${teacher.id}`, undefined, 404],
    ['GET', `/api/users/${student.id}/sessions`, undefined, 404],
    ['PATCH', `/api/users/${teacher.id}`, { name: 'Renamed' }, 404],
    ['POST', `/api/users/${teacher.id}/password`, { newPassword: 'not their call' }, 404],
    ['POST', '/api/sessions', { consent: true, activityId: activity.id }, 403],
  ]
  for (const [method, url, body, expected] of closedToAnnotators) {
    const got = await call(method, url, { token: annotatorToken, body })
    check(`annotator: ${method} ${url.replace(/\/(act|usr|ses|sup)_[\w-]+/g, '/:id')} → ${expected}`, got.status === expected, `got ${got.status}`)
  }
  const annotatorUsers = await call('GET', '/api/users', { token: annotatorToken })
  check(
    'an annotator lists only themselves',
    annotatorUsers.body.users.length === 1 && annotatorUsers.body.users[0].id === annotator.id,
  )
  check(
    'and may rename themselves',
    (await call('PATCH', `/api/users/${annotator.id}`, { token: annotatorToken, body: { name: 'Ann A.' } })).body.user
      .name === 'Ann A.',
  )
  const annotatorChange = await call('POST', '/api/auth/password', {
    token: annotatorToken,
    body: { currentPassword: 'correct horse battery', newPassword: 'annotator chose this' },
  })
  check('and change their own password', annotatorChange.body.changed === true)
  annotatorToken = annotatorChange.body.token

  /**
   * A second branch of the tree with work of its own, so "a manager sees their
   * own branch" is tested against a branch they must not see.
   */
  console.log('\na second branch, with work in it')
  const otherManager = (
    await call('POST', '/api/users', {
      token: adminToken,
      body: { role: 'manager', name: 'Max Manager', email: 'max@example.com', password: 'correct horse battery' },
    })
  ).body.user
  const otherManagerToken = (
    await call('POST', '/api/auth/login', { body: { email: 'max@example.com', password: 'correct horse battery' } })
  ).body.token
  const farTeacher = (
    await call('POST', '/api/users', {
      token: otherManagerToken,
      body: { role: 'teacher', name: 'Theo Far', email: 'theo@example.com', password: 'correct horse battery' },
    })
  ).body.user
  const farTeacherToken = (
    await call('POST', '/api/auth/login', { body: { email: 'theo@example.com', password: 'correct horse battery' } })
  ).body.token
  const farActivity = (
    await call('POST', '/api/activities', { token: farTeacherToken, body: { title: 'Far away' } })
  ).body.activity
  const farQuestion = (
    await call('POST', `/api/activities/${farActivity.id}/questions`, { token: farTeacherToken, body: BARE_QUESTION })
  ).body.question
  await call('PATCH', `/api/activities/${farActivity.id}`, { token: farTeacherToken, body: { status: 'published' } })
  const farSession = (
    await call('POST', '/api/sessions', { body: { consent: true, activityId: farActivity.id } })
  ).body.session
  await call('POST', `/api/sessions/${farSession.id}/questions/${farQuestion.id}/messages`, {
    body: { text: 'Where do I start?' },
  })
  const farSnippets = await call('GET', `/api/research/snippets?sessionId=${farSession.id}`, {
    token: farTeacherToken,
  })
  check('the far teacher has a snippet of their own', farSnippets.body.count === 1)
  const farSnippet = farSnippets.body.snippets[0]

  console.log('\nassigning snippets')
  const nearSnippets = (
    await call('GET', `/api/research/snippets?sessionId=${turnSession.id}`, { token: managerToken })
  ).body.snippets
  check('there is near work to assign', nearSnippets.length >= 3)
  check(
    'unassigned to begin with',
    nearSnippets.every((entry) => entry.assigneeId === null && entry.assigneeName === null),
  )
  const [nearA, nearB, nearC] = nearSnippets

  const annotatorsForManager = await call('GET', '/api/research/annotators', { token: managerToken })
  const pickable = annotatorsForManager.body.annotators
  check('a manager can list annotators to assign to', annotatorsForManager.status === 200)
  check(
    'active ones only',
    pickable.some((entry) => entry.id === annotator.id) &&
      pickable.some((entry) => entry.id === secondAnnotator.id) &&
      !pickable.some((entry) => entry.id === retired.id),
  )
  check(
    'and nothing but a name',
    pickable.every((entry) => Object.keys(entry).sort().join() === 'id,name'),
  )
  check(
    'while the users list still hides annotators from a manager',
    !(await call('GET', '/api/users', { token: managerToken })).body.users.some((u) => u.role === 'annotator'),
  )
  check(
    'a teacher cannot list annotators',
    (await call('GET', '/api/research/annotators', { token: teacherToken })).status === 403,
  )

  const managerAssigns = await call('POST', '/api/research/snippets/assign', {
    token: managerToken,
    body: { snippetIds: [nearA.id, nearB.id, nearA.id], assigneeId: annotator.id },
  })
  check('a manager assigns snippets in their branch', managerAssigns.status === 200 && managerAssigns.body.count === 2)
  const outOfBranch = await call('POST', '/api/research/snippets/assign', {
    token: managerToken,
    body: { snippetIds: [farSnippet.id], assigneeId: annotator.id },
  })
  check("but not another manager's", outOfBranch.status === 404)
  const mixed = await call('POST', '/api/research/snippets/assign', {
    token: managerToken,
    body: { snippetIds: [nearC.id, farSnippet.id], assigneeId: secondAnnotator.id },
  })
  check('a batch with one out of reach is refused whole', mixed.status === 404)
  check(
    'and changes nothing',
    (await call('GET', `/api/research/snippets?sessionId=${turnSession.id}`, { token: managerToken })).body.snippets.find(
      (entry) => entry.id === nearC.id,
    ).assigneeId === null,
  )
  const adminAssigns = await call('POST', '/api/research/snippets/assign', {
    token: adminToken,
    body: { snippetIds: [farSnippet.id], assigneeId: annotator.id },
  })
  check('an admin assigns anywhere', adminAssigns.status === 200)
  check(
    'a teacher cannot assign',
    (
      await call('POST', '/api/research/snippets/assign', {
        token: teacherToken,
        body: { snippetIds: [nearC.id], assigneeId: annotator.id },
      })
    ).status === 403,
  )
  check(
    'only to an annotator',
    (
      await call('POST', '/api/research/snippets/assign', {
        token: adminToken,
        body: { snippetIds: [nearC.id], assigneeId: teacher.id },
      })
    ).status === 400,
  )
  check(
    'an active one',
    (
      await call('POST', '/api/research/snippets/assign', {
        token: adminToken,
        body: { snippetIds: [nearC.id], assigneeId: retired.id },
      })
    ).status === 400,
  )
  check(
    'naming the assignee or null',
    (await call('POST', '/api/research/snippets/assign', { token: adminToken, body: { snippetIds: [nearC.id] } }))
      .status === 400,
  )
  check(
    'a snippet that does not exist is refused',
    (
      await call('POST', '/api/research/snippets/assign', {
        token: adminToken,
        body: { snippetIds: [`${turnSession.id}:nope:1`], assigneeId: annotator.id },
      })
    ).status === 404,
  )
  check(
    'the batch is capped',
    (
      await call('POST', '/api/research/snippets/assign', {
        token: adminToken,
        body: { snippetIds: Array.from({ length: 501 }, (_, n) => `${turnSession.id}:q:${n}`), assigneeId: null },
      })
    ).status === 400,
  )
  const adminView = (
    await call('GET', `/api/research/snippets?sessionId=${turnSession.id}`, { token: adminToken })
  ).body.snippets.find((entry) => entry.id === nearA.id)
  check(
    'staff who assign see to whom, by name',
    adminView.assigneeId === annotator.id && adminView.assigneeName === 'Ann A.' && adminView.assignedBy === manager.id,
  )
  const teacherView = (
    await call('GET', `/api/research/snippets?sessionId=${turnSession.id}`, { token: teacherToken })
  ).body.snippets.find((entry) => entry.id === nearA.id)
  check(
    'a teacher sees that it is assigned, not the name',
    teacherView.assigneeId === annotator.id && !('assigneeName' in teacherView),
  )

  console.log('\nan annotator labels what is assigned to them')
  // Annotators are given handles, never snippet ids (services/snippets.js
  // `snippetHandle`), so their list is compared against the handles the
  // server should have made for these snippets.
  const handleOf = (snippet, who = annotator) => snippetHandle(who.id, snippet.id)
  const mineToLabel = await call('GET', '/api/research/snippets', { token: annotatorToken })
  const mineIds = mineToLabel.body.snippets.map((entry) => entry.id).sort()
  check(
    'an annotator sees exactly their assignments, by handle',
    mineToLabel.status === 200 && mineIds.join() === [nearA, nearB, farSnippet].map((e) => handleOf(e)).sort().join(),
  )
  check(
    'with the question and answer context a teacher gets',
    mineToLabel.body.snippets.every((entry) => entry.question && 'answer' in entry && entry.student.text && entry.tutor.text),
  )
  check(
    'but not who wrote the feedback — they label blind',
    mineToLabel.body.snippets.every((entry) => !('source' in entry.tutor) && !('model' in entry.tutor)),
  )
  check(
    'nor which session or question it came from',
    mineToLabel.body.snippets.every((entry) => !('sessionId' in entry) && !('questionId' in entry) && !('assignedBy' in entry)),
  )
  check(
    'and no session id anywhere in it',
    ![turnSession.id, farSession.id].some((sessionId) => JSON.stringify(mineToLabel.body).includes(sessionId)),
  )
  check(
    'handles differ per annotator',
    handleOf(nearA) !== handleOf(nearA, secondAnnotator) && !handleOf(nearA).includes(':'),
  )

  /**
   * The `sessionId` filter is ignored for an annotator. It used to narrow the
   * list and 404 a session with nothing of theirs in it, which made it a way to
   * confirm a guessed session id. Every answer below is the unfiltered one.
   */
  const unfiltered = JSON.stringify(mineToLabel.body)
  for (const [what, sessionId] of [
    ['one with their work in it', farSession.id],
    ['one with none of their work', seededForStudent.body.session.id],
    ['one that does not exist', 'ses_doesnotexist0000000'],
  ]) {
    const filtered = await call('GET', `/api/research/snippets?sessionId=${sessionId}`, { token: annotatorToken })
    check(
      `?sessionId= is no oracle: ${what} gets the unfiltered list`,
      filtered.status === 200 && JSON.stringify(filtered.body) === unfiltered,
      `got ${filtered.status}`,
    )
  }
  check(
    'another annotator sees none of it',
    (await call('GET', '/api/research/snippets', { token: secondAnnotatorToken })).body.count === 0,
  )

  const annotatorLabels = await call('PATCH', `/api/research/snippets/${handleOf(nearA)}`, {
    token: annotatorToken,
    body: { labels: { specific: 'yes', tone: 'partly' }, notes: { tone: 'A bit curt.' }, assigneeId: secondAnnotator.id },
  })
  check('an annotator labels an assigned snippet by its handle', annotatorLabels.status === 200)
  check('attributed to them', annotatorLabels.body.label.labelledBy === annotator.id)
  check('and cannot move the assignment while at it', annotatorLabels.body.label.assigneeId === annotator.id)
  check(
    'answered with the handle, not the snippet id',
    annotatorLabels.body.label.id === handleOf(nearA) &&
      !('snippetId' in annotatorLabels.body.label) &&
      !JSON.stringify(annotatorLabels.body).includes(turnSession.id),
  )
  check(
    'and it saved',
    (await call('GET', '/api/research/snippets', { token: annotatorToken })).body.snippets.find(
      (entry) => entry.id === handleOf(nearA),
    ).notes.tone === 'A bit curt.',
  )
  check(
    'the real snippet id is refused, even for their own snippet',
    (await call('PATCH', `/api/research/snippets/${nearA.id}`, { token: annotatorToken, body: { labels: { tone: 'yes' } } }))
      .status === 404,
  )
  check(
    'but may not keep or drop it',
    (await call('PATCH', `/api/research/snippets/${handleOf(nearA)}`, { token: annotatorToken, body: { included: true } }))
      .status === 403,
  )
  check(
    'nor label one not assigned to them, by handle or by id',
    (await call('PATCH', `/api/research/snippets/${handleOf(nearC)}`, { token: annotatorToken, body: { labels: { tone: 'yes' } } }))
      .status === 404 &&
      (await call('PATCH', `/api/research/snippets/${nearC.id}`, { token: annotatorToken, body: { labels: { tone: 'yes' } } }))
        .status === 404,
  )
  check(
    'nor a made-up handle',
    (await call('PATCH', '/api/research/snippets/AAAAAAAAAAAAAAAAAAAAAA', { token: annotatorToken, body: { labels: { tone: 'yes' } } }))
      .status === 404,
  )
  check(
    "nor another annotator's — neither their own handle for it, nor the other's",
    (await call('PATCH', `/api/research/snippets/${handleOf(nearA, secondAnnotator)}`, { token: secondAnnotatorToken, body: { labels: { tone: 'yes' } } }))
      .status === 404 &&
      (await call('PATCH', `/api/research/snippets/${nearA.id}`, { token: secondAnnotatorToken, body: { labels: { tone: 'yes' } } }))
        .status === 404,
  )
  // Given to the second annotator for a moment, so the first can try that
  // annotator's handle for it, then taken back so nothing below sees it.
  await call('POST', '/api/research/snippets/assign', {
    token: adminToken,
    body: { snippetIds: [nearC.id], assigneeId: secondAnnotator.id },
  })
  check(
    "a handle copied from another annotator is nothing to this one",
    (await call('PATCH', `/api/research/snippets/${handleOf(nearC, secondAnnotator)}`, { token: annotatorToken, body: { labels: { tone: 'yes' } } }))
      .status === 404,
  )
  check(
    'while it works for the annotator it was made for',
    (await call('PATCH', `/api/research/snippets/${handleOf(nearC, secondAnnotator)}`, { token: secondAnnotatorToken, body: { labels: { tone: 'yes' } } }))
      .status === 200,
  )
  await call('POST', '/api/research/snippets/assign', {
    token: adminToken,
    body: { snippetIds: [nearC.id], assigneeId: null },
  })
  const unassigning = await call('POST', '/api/research/snippets/assign', {
    token: managerToken,
    body: { snippetIds: [nearB.id], assigneeId: null },
  })
  check('a manager takes a snippet back', unassigning.status === 200)
  check(
    'and it leaves the annotator’s list',
    !(await call('GET', '/api/research/snippets', { token: annotatorToken })).body.snippets.some((e) => e.id === handleOf(nearB)),
  )
  check(
    'and their reach',
    (await call('PATCH', `/api/research/snippets/${handleOf(nearB)}`, { token: annotatorToken, body: { labels: { tone: 'yes' } } }))
      .status === 404,
  )
  /**
   * Was a check on the shared `notes`. An annotator's labelling is now their
   * own entry (`annotations` on the record), so staff read it as `annotation`
   * and the shared notes stay the staff's.
   */
  const nearAForAdmin = (await call('GET', `/api/research/snippets?sessionId=${turnSession.id}`, { token: adminToken })).body.snippets.find(
    (entry) => entry.id === nearA.id,
  )
  check(
    'the labels an annotator wrote survive for staff, as theirs',
    nearAForAdmin.annotation?.annotatorId === annotator.id &&
      nearAForAdmin.annotation.notes.tone === 'A bit curt.' &&
      nearAForAdmin.annotation.labels.tone === 'partly' &&
      nearAForAdmin.notes.tone === undefined &&
      nearAForAdmin.labels.tone === undefined,
  )

  /**
   * An annotator's labels are their own. A teacher labels a snippet, an admin
   * hands it to an annotator, and the annotator must neither see nor
   * overwrite the teacher's work; a second annotator after them starts from
   * their own (here, blank of the first one's), and staff see everyone's.
   */
  console.log('\nan annotator’s labels are their own')
  const teacherNote = 'TEACHER-NOTE-only-the-teacher-wrote-this'
  // In a dataset of theirs first: a teacher labels nothing else.
  await call('POST', '/api/research/datasets/ds_default/snippets', { token: adminToken, body: { snippetIds: [nearC.id] } })
  const teacherLabelled = await call('PATCH', `/api/research/snippets/${nearC.id}`, {
    token: teacherToken,
    body: { labels: { specific: 'no', accurate: 'partly' }, notes: { accurate: teacherNote } },
  })
  check(
    'a teacher labels a snippet, and the answer is the shared record without annotators',
    teacherLabelled.status === 200 &&
      teacherLabelled.body.label.labelledBy === teacher.id &&
      !('annotations' in teacherLabelled.body.label) &&
      !('annotation' in teacherLabelled.body.label),
  )
  await call('POST', '/api/research/snippets/assign', {
    token: adminToken,
    body: { snippetIds: [nearC.id], assigneeId: annotator.id },
  })
  const nearCForAnnotator = async (who = annotator, token = annotatorToken) =>
    (await call('GET', '/api/research/snippets', { token })).body.snippets.find((entry) => entry.id === handleOf(nearC, who))
  const blank = await nearCForAnnotator()
  const blankJson = JSON.stringify(blank)
  check(
    'assigned a labelled snippet, the annotator sees it blank',
    blank &&
      Object.keys(blank.labels).length === 0 &&
      Object.keys(blank.notes).length === 0 &&
      blank.note === '',
    blankJson,
  )
  check(
    'with none of the teacher’s label values, note text or id, nor the earlier annotator’s',
    !blankJson.includes(teacherNote) &&
      !blankJson.includes('"partly"') &&
      !blankJson.includes('"no"') &&
      !blankJson.includes(teacher.id) &&
      !blankJson.includes(secondAnnotator.id) &&
      !blankJson.includes('labelledBy'),
    blankJson,
  )
  const annotatorOnC = await call('PATCH', `/api/research/snippets/${handleOf(nearC)}`, {
    token: annotatorToken,
    body: { labels: { specific: 'yes', tone: 'yes' }, notes: { specific: 'ANN-NOTE-points-at-x' } },
  })
  check(
    'the annotator labels it, and is answered with their own work only',
    annotatorOnC.status === 200 &&
      annotatorOnC.body.label.labels.specific === 'yes' &&
      annotatorOnC.body.label.labels.accurate === undefined &&
      annotatorOnC.body.label.notes.specific === 'ANN-NOTE-points-at-x' &&
      annotatorOnC.body.label.notes.accurate === undefined &&
      annotatorOnC.body.label.labelledBy === annotator.id &&
      !JSON.stringify(annotatorOnC.body).includes(teacher.id) &&
      !JSON.stringify(annotatorOnC.body).includes(teacherNote),
  )
  const sharedC = await app.locals.store.snippetLabels.get(nearC.id)
  check(
    'the shared record is unchanged: the teacher’s labels, notes and labelledBy',
    sharedC.labels.specific === 'no' &&
      sharedC.labels.accurate === 'partly' &&
      sharedC.labels.tone === undefined &&
      sharedC.notes.accurate === teacherNote &&
      sharedC.notes.specific === undefined &&
      sharedC.labelledBy === teacher.id,
  )
  const nearCForTeacher = (await call('GET', `/api/research/snippets?sessionId=${turnSession.id}`, { token: teacherToken })).body.snippets.find(
    (entry) => entry.id === nearC.id,
  )
  check(
    'the teacher still sees their own labels, and no annotator’s work at all',
    nearCForTeacher.labels.specific === 'no' &&
      nearCForTeacher.notes.accurate === teacherNote &&
      !('annotation' in nearCForTeacher) &&
      !('annotations' in nearCForTeacher) &&
      !JSON.stringify(nearCForTeacher).includes('ANN-NOTE-points-at-x'),
  )
  const nearCRow = async (token) =>
    (await call('GET', `/api/research/snippets?sessionId=${turnSession.id}`, { token })).body.snippets.find(
      (entry) => entry.id === nearC.id,
    )
  for (const [who, token] of [['an admin', adminToken], ['a manager', managerToken], ['the research token', 'smoke-token']]) {
    const row = await nearCRow(token)
    check(
      `${who} sees both: the shared labels, and the assignee’s, attributed`,
      row.labels.specific === 'no' &&
        row.annotation?.annotatorId === annotator.id &&
        row.annotation.annotatorName === 'Ann A.' &&
        row.annotation.labels.specific === 'yes' &&
        row.annotation.notes.specific === 'ANN-NOTE-points-at-x' &&
        typeof row.annotation.labelledAt === 'string',
      JSON.stringify(row.annotation),
    )
  }
  const bothOnC = (await nearCRow(adminToken)).annotations
  check(
    'and every annotator’s entry, the earlier one kept',
    bothOnC.length === 2 &&
      bothOnC.some((entry) => entry.annotatorId === secondAnnotator.id && entry.labels.tone === 'yes') &&
      bothOnC.some((entry) => entry.annotatorId === annotator.id),
  )

  // Reassigned: the second annotator sees only what they wrote themselves.
  await call('POST', '/api/research/snippets/assign', {
    token: adminToken,
    body: { snippetIds: [nearC.id], assigneeId: secondAnnotator.id },
  })
  const secondView = await nearCForAnnotator(secondAnnotator, secondAnnotatorToken)
  const secondJson = JSON.stringify(secondView)
  check(
    'reassigned, the next annotator sees their own work and none of the first one’s',
    secondView &&
      secondView.labels.tone === 'yes' &&
      secondView.labels.specific === undefined &&
      Object.keys(secondView.notes).length === 0 &&
      !secondJson.includes('ANN-NOTE-points-at-x') &&
      !secondJson.includes(annotator.id) &&
      !secondJson.includes(teacherNote),
    secondJson,
  )
  // Two saves at once on different criteria: neither may clobber the other.
  const [notesOne, notesTwo] = await Promise.all([
    call('PATCH', `/api/research/snippets/${handleOf(nearC, secondAnnotator)}`, {
      token: secondAnnotatorToken,
      body: { notes: { tone: 'SECOND-tone' } },
    }),
    call('PATCH', `/api/research/snippets/${handleOf(nearC, secondAnnotator)}`, {
      token: secondAnnotatorToken,
      body: { notes: { accurate: 'SECOND-accurate' } },
    }),
  ])
  const secondEntry = (await app.locals.store.snippetLabels.get(nearC.id)).annotations[secondAnnotator.id]
  check(
    'two saves at once on one annotator’s entry both land',
    notesOne.status === 200 &&
      notesTwo.status === 200 &&
      secondEntry.notes.tone === 'SECOND-tone' &&
      secondEntry.notes.accurate === 'SECOND-accurate' &&
      secondEntry.labels.tone === 'yes',
  )
  const afterReassign = await nearCRow(adminToken)
  check(
    'staff now see the second as the assignee’s work, with the first one’s kept',
    afterReassign.annotation?.annotatorId === secondAnnotator.id &&
      afterReassign.annotations.length === 2 &&
      afterReassign.annotations.find((entry) => entry.annotatorId === annotator.id)?.notes.specific === 'ANN-NOTE-points-at-x' &&
      afterReassign.labels.specific === 'no',
  )
  check(
    'and the first annotator no longer reaches it',
    !(await call('GET', '/api/research/snippets', { token: annotatorToken })).body.snippets.some((entry) => entry.id === handleOf(nearC)),
  )

  // Kept on the export, appended after the existing columns.
  await call('PATCH', `/api/research/snippets/${nearC.id}`, { token: adminToken, body: { included: true } })
  await call('POST', '/api/research/snippets/assign', { token: adminToken, body: { snippetIds: [nearC.id], assigneeId: null } })
  check(
    'unassigned, the work stays for staff, with no current annotation',
    (await nearCRow(adminToken)).annotation === null && (await nearCRow(adminToken)).annotations.length === 2,
  )
  const csvAfter = await (
    await fetch(`${base}/api/research/export?format=csv`, { headers: { authorization: 'Bearer smoke-token' } })
  ).text()
  const csvHeader = csvAfter.split('\n')[0].split(',').map((cell) => cell.replaceAll('"', ''))
  const criterionIds = ['specific', 'actionable', 'no-answer', 'accurate', 'tone']
  const expectedHeader = [
    'snippet_id', 'session_id', 'question_id', 'student_text', 'tutor_text', 'tutor_label', 'student_rating', 'note',
    ...criterionIds.map((id) => `label_${id}`),
    ...criterionIds.map((id) => `note_${id}`),
    'annotator_id',
    ...criterionIds.map((id) => `annotator_label_${id}`),
    ...criterionIds.map((id) => `annotator_note_${id}`),
    'annotator_count',
  ]
  check('the CSV keeps every existing column where it was and appends the annotator’s', csvHeader.join() === expectedHeader.join(), csvHeader.join())
  const csvRow = csvAfter.split('\n').find((line) => line.startsWith(`"${nearC.id}"`))
  check(
    'a row carries the shared labels and, unassigned, the latest annotator’s',
    csvRow?.includes(`"${secondAnnotator.id}"`) &&
      csvRow.includes('"SECOND-tone"') &&
      csvRow.includes(`"${teacherNote}"`) &&
      csvRow.endsWith('"2"'),
    csvRow,
  )
  const jsonAfter = (await call('GET', '/api/research/export', { token: 'smoke-token' })).body.snippets.find((entry) => entry.id === nearC.id)
  check(
    'the JSON export carries every annotator’s entry',
    jsonAfter?.annotation === null && jsonAfter.annotations.length === 2 && jsonAfter.labels.specific === 'no',
  )

  // An annotator deleted: their entry stays, under the name stamped on it.
  const erstwhile = (
    await call('POST', '/api/users', {
      token: adminToken,
      body: { role: 'annotator', name: 'Eve Erstwhile', email: 'eve@example.com', password: 'correct horse battery' },
    })
  ).body.user
  const erstwhileToken = (
    await call('POST', '/api/auth/login', { body: { email: 'eve@example.com', password: 'correct horse battery' } })
  ).body.token
  await call('POST', '/api/research/snippets/assign', { token: adminToken, body: { snippetIds: [nearC.id], assigneeId: erstwhile.id } })
  await call('PATCH', `/api/research/snippets/${handleOf(nearC, erstwhile)}`, {
    token: erstwhileToken,
    body: { labels: { actionable: 'no' } },
  })
  await call('DELETE', `/api/users/${erstwhile.id}`, { token: adminToken })
  const afterAnnotatorDeleted = await nearCRow(adminToken)
  check(
    'a deleted annotator’s work is kept, under the name they had',
    afterAnnotatorDeleted.assigneeId === null &&
      afterAnnotatorDeleted.annotations.length === 3 &&
      afterAnnotatorDeleted.annotations.find((entry) => entry.annotatorId === erstwhile.id)?.annotatorName === 'Eve Erstwhile',
  )
  // Back out of the export, so nothing below counts it.
  await call('PATCH', `/api/research/snippets/${nearC.id}`, { token: adminToken, body: { included: null } })

  /**
   * The whole payload, against a signed-in student's session with everything
   * a student can hand in: a draft, a photo on the answer, and a photographed
   * question of their own. Serialised and searched, so a field added later
   * that carries the session id or the student's id fails here.
   */
  console.log('\nan annotator never learns a session id or a student id')
  // A student of their own: Sam was deactivated further up.
  const leakStudent = (
    await call('POST', '/api/users', {
      token: teacherToken,
      body: { role: 'student', name: 'Lee Leak', studentNumber: '10000077' },
    })
  ).body.user
  const leakStudentToken = (await call('POST', '/api/auth/student', { body: { studentNumber: '10000077' } })).body.token
  // Consent given in this sign-in, so the session can be withdrawn again below.
  await call('POST', '/api/auth/consent', { token: leakStudentToken })
  const leakStart = await call('POST', '/api/sessions', {
    token: leakStudentToken,
    body: { consent: true, activityId: activity.id },
  })
  const leakSession = leakStart.body.session
  check('a signed-in student session to look for', leakStart.status === 201 && leakSession.userId === leakStudent.id)
  await call('PUT', `/api/sessions/${leakSession.id}/answers/${bareQ.id}`, { body: { draft: 'I think x = 4' } })
  await call('POST', `/api/sessions/${leakSession.id}/questions/${bareQ.id}/uploads`, {
    body: { name: 'working.png', dataUrl: PNG },
  })
  await call('POST', `/api/sessions/${leakSession.id}/questions/${bareQ.id}/messages`, { body: { text: 'Is this right?' } })
  const leakOwn = await call('POST', `/api/sessions/${leakSession.id}/own-questions`, {
    body: { prompt: 'From my worksheet', image: { name: 'sheet.png', dataUrl: PNG } },
  })
  await call('POST', `/api/sessions/${leakSession.id}/questions/${leakOwn.body.question.id}/messages`, {
    body: { text: 'How do I start this one?' },
  })
  const leakForAdmin = await call('GET', `/api/research/snippets?sessionId=${leakSession.id}`, { token: adminToken })
  check(
    'staff get the context in full: the photos, by URL',
    leakForAdmin.body.count === 2 &&
      leakForAdmin.body.snippets.some((entry) => entry.answer?.attachments.length === 1) &&
      leakForAdmin.body.snippets.some((entry) => entry.question.isOwnQuestion && entry.question.image?.url),
  )
  await call('POST', '/api/research/snippets/assign', {
    token: adminToken,
    body: { snippetIds: leakForAdmin.body.snippets.map((entry) => entry.id), assigneeId: annotator.id },
  })
  const leakForAnnotator = await call('GET', '/api/research/snippets', { token: annotatorToken })
  const leakJson = JSON.stringify(leakForAnnotator.body)
  check(
    'the annotator has them',
    leakForAdmin.body.snippets.every((entry) => leakForAnnotator.body.snippets.some((mine) => mine.id === handleOf(entry))),
  )
  check('no session id anywhere in the annotator’s payload', ![leakSession.id, turnSession.id, farSession.id].some((id) => leakJson.includes(id)))
  check('nor the student’s user id', !leakJson.includes(leakStudent.id))
  check(
    'nor a single snippet id',
    [...leakForAdmin.body.snippets, nearA, farSnippet].every((entry) => !leakJson.includes(entry.id)),
  )
  /**
   * The student's files reach the annotator through their own file route,
   * named by handle and index — not by `/api/uploads/<uploadId>`, which on
   * Spaces redirects to a key with the session id in it. Replaces the check
   * that they were withheld and counted (`filesWithheld`, `imageWithheld`).
   */
  const leakAnswerSnippet = leakForAdmin.body.snippets.find((entry) => entry.answer?.attachments.length === 1)
  const leakOwnSnippet = leakForAdmin.body.snippets.find((entry) => entry.question.isOwnQuestion)
  const leakUploadIds = [
    leakAnswerSnippet.answer.attachments[0].id,
    leakOwnSnippet.question.image.url.split('/').pop(),
  ]
  const mineOf = (entry) => leakForAnnotator.body.snippets.find((mine) => mine.id === handleOf(entry))
  const answerFiles = mineOf(leakAnswerSnippet).answer.attachments
  const ownImage = mineOf(leakOwnSnippet).question.image
  check(
    'the student’s files come by the annotator file route, not /api/uploads/',
    !leakJson.includes('/api/uploads/') &&
      answerFiles.length === 1 &&
      answerFiles[0].url === `/api/research/snippets/${handleOf(leakAnswerSnippet)}/files/0` &&
      answerFiles[0].type === 'image/png' &&
      ownImage?.url === `/api/research/snippets/${handleOf(leakOwnSnippet)}/files/0` &&
      ownImage.type === 'image/png',
  )
  check(
    'carrying only url and type (and which kind of answer file)',
    Object.keys(answerFiles[0]).sort().join() === 'source,type,url' &&
      Object.keys(ownImage).sort().join() === 'type,url' &&
      !leakJson.includes('filesWithheld') &&
      !leakJson.includes('imageWithheld'),
  )
  check(
    'nor an upload id, nor the names the student gave the files',
    leakUploadIds.every((uploadId) => !leakJson.includes(uploadId)) &&
      !leakJson.includes('working.png') &&
      !leakJson.includes('sheet.png'),
  )
  check(
    'while the words of the answer stay',
    leakForAnnotator.body.snippets.some((entry) => entry.answer?.draft === 'I think x = 4'),
  )
  const leakHandle = handleOf(leakForAdmin.body.snippets[0])
  const leakLabel = await call('PATCH', `/api/research/snippets/${leakHandle}`, {
    token: annotatorToken,
    body: { notes: { specific: 'Names the step.' } },
  })
  check(
    'a label on it answers with nothing of the session either',
    leakLabel.status === 200 && ![leakSession.id, leakStudent.id].some((id) => JSON.stringify(leakLabel.body).includes(id)),
  )
  const leakErrors = [
    await call('PATCH', `/api/research/snippets/${leakForAdmin.body.snippets[0].id}`, { token: annotatorToken, body: { labels: { tone: 'yes' } } }),
    await call('PATCH', `/api/research/snippets/${leakHandle}`, { token: annotatorToken, body: { labels: { nope: 'yes' } } }),
    await call('PATCH', `/api/research/snippets/${leakHandle}`, { token: annotatorToken, body: {} }),
  ]
  check(
    'and neither do its refusals',
    leakErrors.every((got) => got.status >= 400 && !JSON.stringify(got.body).includes(leakSession.id)),
  )

  /**
   * The file route itself: the bytes, streamed, for the annotator the snippet
   * is assigned to, and nothing that names where they came from.
   */
  console.log('\nan annotator opens the student’s files without learning where they live')
  const raw = async (method, url, { token, headers = {}, body } = {}) => {
    const res = await fetch(`${base}${url}`, {
      method,
      headers: { ...headers, ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body,
    })
    return { status: res.status, headers: res.headers, bytes: Buffer.from(await res.arrayBuffer()) }
  }
  const pngBytes = Buffer.from(PNG.split(',')[1], 'base64')
  const leaky = [leakSession.id, leakStudent.id, ...leakUploadIds, 'working.png', 'sheet.png']
  const headersOf = (got) => JSON.stringify([...got.headers.entries()])
  for (const [what, url] of [
    ['an answer photo', answerFiles[0].url],
    ['an own question’s photo', ownImage.url],
  ]) {
    const got = await raw('GET', url, { token: annotatorToken })
    check(`${what}: the bytes themselves`, got.status === 200 && got.bytes.equals(pngBytes), `got ${got.status}`)
    check(
      `${what}: as a PNG, private and uncached, under a neutral name`,
      got.headers.get('content-type')?.startsWith('image/png') &&
        got.headers.get('cache-control') === 'private, no-store' &&
        got.headers.get('content-disposition') === 'inline; filename="snippet-file-1.png"',
      headersOf(got),
    )
    check(
      `${what}: no redirect, and no session, student or upload id in any header`,
      !got.headers.get('location') && !leaky.some((needle) => headersOf(got).includes(needle)),
      headersOf(got),
    )
  }
  const fileStatus = async (url, token) => (await raw('GET', url, { token })).status
  const answerHandle = handleOf(leakAnswerSnippet)
  check('an index past the end is 404', (await fileStatus(`/api/research/snippets/${answerHandle}/files/1`, annotatorToken)) === 404)
  check('so is one that is not a number', (await fileStatus(`/api/research/snippets/${answerHandle}/files/x`, annotatorToken)) === 404)
  check(
    'a snippet not assigned to them is 404',
    (await fileStatus(`/api/research/snippets/${handleOf(nearC)}/files/0`, annotatorToken)) === 404,
  )
  check(
    'another annotator gets 404, with their own handle for it or with this one’s',
    (await fileStatus(`/api/research/snippets/${handleOf(leakAnswerSnippet, secondAnnotator)}/files/0`, secondAnnotatorToken)) === 404 &&
      (await fileStatus(answerFiles[0].url, secondAnnotatorToken)) === 404,
  )
  check(
    'a real snippet id in place of the handle is 404',
    (await fileStatus(`/api/research/snippets/${encodeURIComponent(leakAnswerSnippet.id)}/files/0`, annotatorToken)) === 404,
  )
  for (const [who, token, expected] of [
    ['an admin', adminToken, 403],
    ['a manager', managerToken, 403],
    ['a teacher', teacherToken, 403],
    ['the research token', 'smoke-token', 403],
    ['nobody signed in', undefined, 403],
  ]) {
    const got = await fileStatus(answerFiles[0].url, token)
    check(`${who} is refused the annotator file route (${expected})`, got === expected, `got ${got}`)
  }

  /**
   * A PATCH with no JSON body leaves `req.body` undefined in Express 5. Each of
   * these used to read a field off it and answer 500.
   */
  console.log('\na request with no body is a 400, not a 500')
  for (const [what, method, url, token] of [
    ['an annotator labelling', 'PATCH', `/api/research/snippets/${answerHandle}`, annotatorToken],
    ['staff labelling', 'PATCH', `/api/research/snippets/${encodeURIComponent(leakAnswerSnippet.id)}`, adminToken],
    ['an admin assigning', 'POST', '/api/research/snippets/assign', adminToken],
    ['an admin editing a user', 'PATCH', `/api/users/${secondAnnotator.id}`, adminToken],
  ]) {
    const bare = await raw(method, url, { token })
    const textual = await raw(method, url, { token, headers: { 'content-type': 'text/plain' }, body: '{"labels":{}}' })
    check(`${what}: no body → 400, a text body → 400`, bare.status === 400 && textual.status === 400, `got ${bare.status}, ${textual.status}`)
  }

  console.log('\nstaff and the research token still get real ids')
  for (const [who, token] of [
    ['an admin', adminToken],
    ['a manager', managerToken],
    ['a teacher', teacherToken],
    ['the research token', 'smoke-token'],
  ]) {
    const got = await call('GET', `/api/research/snippets?sessionId=${leakSession.id}`, { token })
    check(
      `${who}: snippet ids, session and question ids as before`,
      got.status === 200 &&
        got.body.count === 2 &&
        got.body.snippets.every(
          (entry) => entry.id.startsWith(`${leakSession.id}:`) && entry.sessionId === leakSession.id && entry.questionId,
        ),
      `got ${got.status}`,
    )
  }
  check(
    'and a staff PATCH still answers with the snippet id',
    (
      await call('PATCH', `/api/research/snippets/${leakForAdmin.body.snippets[0].id}`, {
        token: adminToken,
        body: { included: true },
      })
    ).body.label.snippetId === leakForAdmin.body.snippets[0].id,
  )
  // Withdrawn again, student and all, so the sections below count what they
  // counted before — and so the withdrawal can be checked from the
  // annotator's side.
  check(
    'before withdrawal, its record holds the annotator’s own entry',
    (await app.locals.store.snippetLabels.get(leakForAdmin.body.snippets[0].id))?.annotations?.[annotator.id]?.notes
      ?.specific === 'Names the step.',
  )
  check(
    'and cleared away again',
    (await call('DELETE', `/api/sessions/${leakSession.id}`, { token: leakStudentToken })).status === 200 &&
      (await call('DELETE', `/api/users/${leakStudent.id}`, { token: teacherToken })).status === 200,
  )

  console.log('\na withdrawn session is gone for its annotator too')
  const afterWithdrawal = await call('GET', '/api/research/snippets', { token: annotatorToken })
  check(
    'it leaves the annotator’s list',
    afterWithdrawal.status === 200 &&
      !leakForAdmin.body.snippets.some((entry) => afterWithdrawal.body.snippets.some((mine) => mine.id === handleOf(entry))),
  )
  check(
    'a label on it is 404',
    (await call('PATCH', `/api/research/snippets/${leakHandle}`, { token: annotatorToken, body: { notes: { tone: 'Still here?' } } }))
      .status === 404,
  )
  check('and so are its files', (await fileStatus(answerFiles[0].url, annotatorToken)) === 404)
  const labelsLeft = await Promise.all(
    leakForAdmin.body.snippets.map((entry) => app.locals.store.snippetLabels.get(entry.id)),
  )
  check('its label records went with it: labels, notes, assignment and annotators’ entries', labelsLeft.every((label) => label === null))
  check(
    'while other sessions’ label records stay',
    (await app.locals.store.snippetLabels.get(nearA.id))?.annotations?.[annotator.id]?.notes?.tone === 'A bit curt.',
  )
  /**
   * A label record that outlived its snippet — written before withdrawal
   * removed them, say. Assigned and resolvable, but with no messages behind
   * it, so it must still read as missing to the annotator.
   */
  const orphanId = 'ses_orphan0000000000000:q_gone:1'
  await app.locals.store.snippetLabels.upsert(orphanId, {
    assigneeId: annotator.id,
    assignedBy: admin.id,
    assignedAt: new Date().toISOString(),
    notes: { tone: 'about words that are gone' },
  })
  check(
    'an orphaned label record still assigned to them is 404 to label',
    (await call('PATCH', `/api/research/snippets/${handleOf({ id: orphanId })}`, { token: annotatorToken, body: { labels: { tone: 'yes' } } }))
      .status === 404,
  )
  check(
    'and to open a file through',
    (await fileStatus(`/api/research/snippets/${handleOf({ id: orphanId })}/files/0`, annotatorToken)) === 404,
  )
  check(
    'and is not listed',
    (await call('GET', '/api/research/snippets', { token: annotatorToken })).body.snippets.every(
      (mine) => mine.id !== handleOf({ id: orphanId }),
    ),
  )
  check(
    'nor was it written to',
    (await app.locals.store.snippetLabels.get(orphanId)).labels === undefined,
  )
  await app.locals.store.snippetLabels.upsert(orphanId, { assigneeId: null, assignedBy: null, assignedAt: null })

  /**
   * Assignments sit on the label records under the annotator's id, so they
   * have to follow the account: kept and flagged while it is deactivated,
   * taken back when it is deleted or stops being an annotator.
   */
  console.log('\nassignments follow the annotator’s account')
  const makeAnnotator = async (name, email) =>
    (
      await call('POST', '/api/users', {
        token: adminToken,
        body: { role: 'annotator', name, email, password: 'correct horse battery' },
      })
    ).body.user
  const nearCFor = async (token) =>
    (await call('GET', `/api/research/snippets?sessionId=${turnSession.id}`, { token })).body.snippets.find(
      (entry) => entry.id === nearC.id,
    )
  const assignNearC = (assigneeId) =>
    call('POST', '/api/research/snippets/assign', { token: adminToken, body: { snippetIds: [nearC.id], assigneeId } })

  const leaving = await makeAnnotator('Dee Leaving', 'dee@example.com')
  check('assigned to a new annotator', (await assignNearC(leaving.id)).status === 200)
  check(
    'an active assignee is flagged active',
    (await nearCFor(adminToken)).assigneeActive === true &&
      (await call('GET', `/api/research/snippets?sessionId=${turnSession.id}`, { token: adminToken })).body.snippets.find(
        (entry) => entry.id === nearB.id,
      ).assigneeActive === null,
  )
  await call('PATCH', `/api/users/${leaving.id}`, { token: adminToken, body: { active: false } })
  for (const [who, token] of [['an admin', adminToken], ['a manager', managerToken]]) {
    const row = await nearCFor(token)
    check(
      `deactivated, the assignment stays, and ${who} sees whose and that they are inactive`,
      row.assigneeId === leaving.id && row.assigneeName === 'Dee Leaving' && row.assigneeActive === false,
      JSON.stringify({ id: row.assigneeId, name: row.assigneeName, active: row.assigneeActive }),
    )
  }
  check(
    'a teacher is still told neither',
    !('assigneeActive' in (await nearCFor(teacherToken))) && !('assigneeName' in (await nearCFor(teacherToken))),
  )
  check(
    'and the annotator list for pickers still leaves them out',
    !(await call('GET', '/api/research/annotators', { token: adminToken })).body.annotators.some((entry) => entry.id === leaving.id),
  )
  check(
    'deleting them takes their snippets back',
    (await call('DELETE', `/api/users/${leaving.id}`, { token: adminToken })).status === 200 &&
      (await nearCFor(adminToken)).assigneeId === null &&
      (await app.locals.store.snippetLabels.get(nearC.id)).assignedBy === null &&
      (await app.locals.store.snippetLabels.get(nearC.id)).assignedAt === null,
  )

  const moving = await makeAnnotator('Moe Moving', 'moe@example.com')
  await assignNearC(moving.id)
  check('assigned to another', (await nearCFor(adminToken)).assigneeId === moving.id)
  check(
    'a rename keeps the assignment',
    (await call('PATCH', `/api/users/${moving.id}`, { token: adminToken, body: { name: 'Moe M.' } })).status === 200 &&
      (await nearCFor(adminToken)).assigneeId === moving.id,
  )
  const movedAway = await call('PATCH', `/api/users/${moving.id}`, { token: adminToken, body: { role: 'manager' } })
  check(
    'a move to another role takes their snippets back',
    movedAway.status === 200 && movedAway.body.user.role === 'manager' && (await nearCFor(adminToken)).assigneeId === null,
    `got ${movedAway.status}`,
  )
  check(
    'while an annotator nobody touched keeps theirs',
    (await call('GET', `/api/research/snippets?sessionId=${turnSession.id}`, { token: adminToken })).body.snippets.find(
      (entry) => entry.id === nearA.id,
    ).assigneeId === annotator.id,
  )
  // Gone again, so the user counts further down are what they were.
  await call('DELETE', `/api/users/${moving.id}`, { token: adminToken })

  console.log('\nthe teacher labelling switch')
  check(
    'a teacher can label by default',
    (await call('GET', '/api/auth/me', { token: teacherToken })).body.user.canLabel === true,
  )
  check(
    'and it travels on user payloads',
    (await call('GET', `/api/users/${teacher.id}`, { token: managerToken })).body.user.canLabel === true,
  )
  check(
    'a teacher cannot switch their own',
    (await call('PATCH', `/api/users/${teacher.id}`, { token: teacherToken, body: { canLabel: false } })).status === 403,
  )
  check(
    "another manager cannot switch someone else's teacher",
    (await call('PATCH', `/api/users/${teacher.id}`, { token: otherManagerToken, body: { canLabel: false } })).status ===
      404,
  )
  check(
    'only a teacher has the switch',
    (await call('PATCH', `/api/users/${otherManager.id}`, { token: adminToken, body: { canLabel: false } })).status ===
      400 &&
      (await call('PATCH', `/api/users/${annotator.id}`, { token: adminToken, body: { canLabel: false } })).status === 400,
  )
  check(
    'and it is a boolean',
    (await call('PATCH', `/api/users/${teacher.id}`, { token: managerToken, body: { canLabel: 'no' } })).status === 400,
  )
  const switchedOff = await call('PATCH', `/api/users/${teacher.id}`, {
    token: managerToken,
    body: { canLabel: false },
  })
  check('their manager switches it off', switchedOff.status === 200 && switchedOff.body.user.canLabel === false)
  check(
    'me says so, for the client to hide the screen',
    (await call('GET', '/api/auth/me', { token: teacherToken })).body.user.canLabel === false,
  )
  check(
    'the snippets are refused',
    (await call('GET', '/api/research/snippets', { token: teacherToken })).status === 403,
  )
  check(
    'and so is labelling one',
    (await call('PATCH', `/api/research/snippets/${nearC.id}`, { token: teacherToken, body: { labels: { tone: 'yes' } } }))
      .status === 403,
  )
  check('their activities still open', (await call('GET', '/api/activities', { token: teacherToken })).status === 200)
  check(
    "their students' sessions still open",
    (await call('GET', '/api/research/sessions', { token: teacherToken })).status === 200 &&
      (await call('GET', `/api/research/sessions/${turnSession.id}/transcript`, { token: teacherToken })).status === 200,
  )
  check('their roster still opens', (await call('GET', '/api/users', { token: teacherToken })).status === 200)
  check('their inbox still opens', (await call('GET', '/api/support', { token: teacherToken })).status === 200)
  const switchedOn = await call('PATCH', `/api/users/${teacher.id}`, { token: adminToken, body: { canLabel: true } })
  check('an admin switches it back on', switchedOn.body.user.canLabel === true)
  check(
    'and labelling opens again',
    (await call('GET', '/api/research/snippets', { token: teacherToken })).status === 200,
  )

  console.log('\na manager sees their own branch and nothing else')
  const nearManagerSnippets = (await call('GET', '/api/research/snippets', { token: managerToken })).body.snippets
  check(
    'snippets: their teachers’ work only',
    nearManagerSnippets.length > 0 && !nearManagerSnippets.some((entry) => entry.sessionId === farSession.id),
  )
  const farManagerSnippets = (await call('GET', '/api/research/snippets', { token: otherManagerToken })).body.snippets
  check(
    'and the other manager theirs',
    farManagerSnippets.length === 1 && farManagerSnippets[0].id === farSnippet.id,
  )
  check(
    'sessions: likewise',
    !(await call('GET', '/api/research/sessions', { token: managerToken })).body.sessions.some(
      (row) => row.id === farSession.id,
    ) &&
      (await call('GET', '/api/research/sessions', { token: otherManagerToken })).body.sessions.some(
        (row) => row.id === farSession.id,
      ),
  )
  check(
    'transcripts: likewise',
    (await call('GET', `/api/research/sessions/${farSession.id}/transcript`, { token: managerToken })).status === 404 &&
      (await call('GET', `/api/research/sessions/${farSession.id}/transcript`, { token: otherManagerToken })).status ===
        200,
  )
  check(
    'labels: likewise',
    (await call('PATCH', `/api/research/snippets/${farSnippet.id}`, { token: managerToken, body: { included: true } }))
      .status === 404 &&
      (await call('PATCH', `/api/research/snippets/${farSnippet.id}`, { token: otherManagerToken, body: { included: true } }))
        .status === 200,
  )
  check(
    'activities: likewise',
    !(await call('GET', '/api/activities', { token: managerToken })).body.activities.some((a) => a.id === farActivity.id) &&
      (await call('GET', '/api/activities', { token: otherManagerToken })).body.activities.some(
        (a) => a.id === farActivity.id,
      ),
  )

  const adminAll = (await call('GET', '/api/research/snippets', { token: adminToken })).body.snippets
  check(
    'an admin sees both branches',
    adminAll.some((entry) => entry.id === farSnippet.id) && adminAll.some((entry) => entry.id === nearA.id),
  )
  check(
    'and keeps or drops anywhere, an assigned snippet included',
    (await call('PATCH', `/api/research/snippets/${nearA.id}`, { token: adminToken, body: { included: true } })).body.label
      .included === true,
  )
  check(
    'and reads any transcript',
    (await call('GET', `/api/research/sessions/${farSession.id}/transcript`, { token: adminToken })).status === 200,
  )

  const farTicket = await call('POST', '/api/support', {
    token: farTeacherToken,
    body: { category: 'support', subject: 'From far away', body: 'A teacher writing in.' },
  })
  const annTicket = await call('POST', '/api/support', {
    token: annotatorToken,
    body: { category: 'suggestion', subject: 'Keyboard shortcuts', body: 'For labelling.' },
  })
  check('an annotator may write in', annTicket.status === 201)
  const nearInbox = (await call('GET', '/api/support', { token: managerToken })).body.messages
  const farInbox = (await call('GET', '/api/support', { token: otherManagerToken })).body.messages
  const adminInbox = (await call('GET', '/api/support', { token: adminToken })).body.messages
  check(
    "support: a manager reads their teachers' students",
    nearInbox.some((m) => m.id === ticket.body.message.id) && !farInbox.some((m) => m.id === ticket.body.message.id),
  )
  check(
    'and their own teachers, not another branch’s',
    farInbox.some((m) => m.id === farTicket.body.message.id) && !nearInbox.some((m) => m.id === farTicket.body.message.id),
  )
  check(
    'what belongs to no branch goes to the admin',
    adminInbox.some((m) => m.id === annTicket.body.message.id) &&
      !nearInbox.some((m) => m.id === annTicket.body.message.id) &&
      !farInbox.some((m) => m.id === annTicket.body.message.id),
  )
  check(
    "a manager cannot answer another branch's message",
    (await call('POST', `/api/support/${farTicket.body.message.id}/reply`, { token: managerToken, body: { text: 'hi' } }))
      .status === 403,
  )
  check(
    'their own manager can',
    (await call('POST', `/api/support/${farTicket.body.message.id}/reply`, { token: otherManagerToken, body: { text: 'On it.' } }))
      .status === 200,
  )

  console.log('\npasswords for staff, refused for students')
  check(
    'a manager cannot reset an annotator',
    (await call('POST', `/api/users/${annotator.id}/password`, { token: managerToken, body: { newPassword: 'manager says so' } }))
      .status === 404,
  )
  const annotatorReset = await call('POST', `/api/users/${annotator.id}/password`, {
    token: adminToken,
    body: { newPassword: 'admin reset this one' },
  })
  check('an admin resets an annotator', annotatorReset.body.reset === true && annotatorReset.body.sessionsRevoked === 1)
  check(
    'whose new password works',
    (await call('POST', '/api/auth/login', { body: { email: 'ann@example.com', password: 'admin reset this one' } }))
      .status === 200,
  )
  const managerReset = await call('POST', `/api/users/${otherManager.id}/password`, {
    token: adminToken,
    body: { newPassword: 'admin reset this one' },
  })
  check('an admin resets a manager', managerReset.body.reset === true)
  check(
    'and a teacher',
    (await call('POST', `/api/users/${farTeacher.id}/password`, { token: adminToken, body: { newPassword: 'admin reset this one' } }))
      .body.reset === true,
  )
  check(
    'a manager resets a teacher in their branch only',
    (await call('POST', `/api/users/${farTeacher.id}/password`, { token: managerToken, body: { newPassword: 'not my teacher' } }))
      .status === 404,
  )

  // A student made before passwords were dropped may still have a hash. The
  // email door no longer opens for them, and says so the way it does for a
  // wrong password.
  const { hashPassword } = await import('./lib/password.js')
  const legacy = emailFreed.body.user
  await app.locals.store.users.update(legacy.id, { passwordHash: await hashPassword('an old student password') })
  const legacyLogin = await call('POST', '/api/auth/login', {
    body: { email: 'temp@example.com', password: 'an old student password' },
  })
  check('a student is refused at the email door, even with the right password', legacyLogin.status === 401)
  check(
    'in the same words as a wrong password',
    legacyLogin.body.error.message === wrongPassword.body.error.message,
  )

  console.log('\nnot found')
  const nowhere = await call('GET', '/api/nope')
  check('unknown route is 404 json', nowhere.status === 404 && Boolean(nowhere.body.error))
  const badSession = await call('GET', '/api/sessions/ses_missing')
  check('unknown session is 404', badSession.status === 404)
  const badActivity = await call('GET', '/api/activities/act_missing', { token: teacherToken })
  check('unknown activity is 404', badActivity.status === 404)

  const finalHealth = await call('GET', '/api/health')
  check('health counts users', finalHealth.body.users === 15)

  /* ================================================================= datasets */

  /**
   * Datasets: an admin makes several and assigns each to teachers and
   * annotators; staff pick dialogs into one; a labeller sees only their own.
   * After the health count above on purpose — this makes accounts of its own.
   */
  console.log('\ndatasets: the default one holds what was kept before')
  // The password section above signed these two out; sign them back in.
  annotatorToken = (await call('POST', '/api/auth/login', { body: { email: 'ann@example.com', password: 'admin reset this one' } })).body.token
  const freshOtherManagerToken = (
    await call('POST', '/api/auth/login', { body: { email: 'max@example.com', password: 'admin reset this one' } })
  ).body.token
  const dsList = async (token) => call('GET', '/api/research/datasets', { token })
  const adminDatasets = await dsList(adminToken)
  const defaultRow = adminDatasets.body.datasets?.find((entry) => entry.id === 'ds_default')
  check('there is a default dataset, made on first use', adminDatasets.status === 200 && defaultRow?.isDefault === true)
  check('it holds the snippets kept before datasets existed', defaultRow.count >= 1)
  check('the admin sees who it is assigned to', defaultRow.members.some((m) => m.id === teacher.id && m.role === 'teacher'))
  const { defaultDatasetDoc } = await import('./services/datasets.js')
  await call('PATCH', '/api/research/datasets/ds_default', { token: adminToken, body: { name: 'Kept before datasets' } })
  await app.locals.store.datasets.ensure(defaultDatasetDoc())
  await app.locals.store.datasets.ensure(defaultDatasetDoc())
  const afterEnsure = (await dsList(adminToken)).body.datasets.filter((entry) => entry.isDefault)
  check(
    'making sure of it again, twice, changes nothing — not even a rename',
    afterEnsure.length === 1 && afterEnsure[0].name === 'Kept before datasets' && afterEnsure[0].memberIds.includes(teacher.id),
  )

  console.log('\ndatasets: an admin makes them')
  const makeDataset = (token, body) => call('POST', '/api/research/datasets', { token, body })
  const pilotA = await makeDataset(adminToken, { name: 'Pilot A', description: 'First round' })
  check('an admin creates a dataset', pilotA.status === 201 && pilotA.body.dataset.name === 'Pilot A' && pilotA.body.dataset.count === 0)
  const dsA = pilotA.body.dataset.id
  const pilotB = await makeDataset(adminToken, { name: 'Pilot B' })
  const dsB = pilotB.body.dataset.id
  check('and another', pilotB.status === 201 && dsB !== dsA && pilotB.body.dataset.description === '')
  check('a name is required', (await makeDataset(adminToken, { description: 'x' })).status === 400)
  check('a blank name is refused', (await makeDataset(adminToken, { name: '   ' })).status === 400)
  check('a long name is refused', (await makeDataset(adminToken, { name: 'x'.repeat(121) })).status === 400)
  check('two datasets cannot share a name', (await makeDataset(adminToken, { name: ' pilot a ' })).status === 409)
  check(
    'renaming',
    (await call('PATCH', `/api/research/datasets/${dsB}`, { token: adminToken, body: { name: 'Pilot B (geometry)', description: 'Second' } }))
      .body.dataset?.name === 'Pilot B (geometry)',
  )
  check(
    'not onto another’s name',
    (await call('PATCH', `/api/research/datasets/${dsB}`, { token: adminToken, body: { name: 'PILOT A' } })).status === 409,
  )
  check(
    'and not with nothing to change',
    (await call('PATCH', `/api/research/datasets/${dsB}`, { token: adminToken, body: {} })).status === 400,
  )

  // A student with an account and some work of their own, for the selection screens.
  const dsStudentToken = (await call('POST', '/api/auth/student', { body: { studentNumber: '20230001' } })).body.token
  const dsActivity = (await call('POST', '/api/activities', { token: teacherToken, body: { title: 'Dataset work' } })).body.activity
  const dsQuestion = (
    await call('POST', `/api/activities/${dsActivity.id}/questions`, { token: teacherToken, body: BARE_QUESTION })
  ).body.question
  await call('PATCH', `/api/activities/${dsActivity.id}`, { token: teacherToken, body: { status: 'published' } })
  const dsSession = (
    await call('POST', '/api/sessions', { token: dsStudentToken, body: { consent: true, activityId: dsActivity.id } })
  ).body.session
  await call('POST', `/api/sessions/${dsSession.id}/questions/${dsQuestion.id}/messages`, { token: dsStudentToken, body: { text: 'Where do I start?' } })
  await call('POST', `/api/sessions/${dsSession.id}/questions/${dsQuestion.id}/messages`, { token: dsStudentToken, body: { text: 'And then?' } })
  await call('PUT', `/api/sessions/${dsSession.id}/answers/${dsQuestion.id}`, {
    token: dsStudentToken,
    body: { mode: 'write', draft: 'My working so far.' },
  })
  const dsSnippets = (await call('GET', `/api/research/snippets?sessionId=${dsSession.id}`, { token: adminToken })).body.snippets
  check('the student has two dialogs to pick from', dsSnippets?.length === 2)
  const [dsX, dsY] = dsSnippets
  const fresh = (await call('GET', `/api/research/snippets?sessionId=${turnSession.id}`, { token: adminToken })).body.snippets.filter(
    (entry) => entry.assigneeId === null && entry.included === null,
  )
  const dsZ = fresh[0]
  check('and there is undecided anonymous work too', Boolean(dsZ))

  console.log('\ndatasets: assigning them')
  const assignTo = (datasetId, userId, token = adminToken) =>
    call('POST', `/api/research/datasets/${datasetId}/members`, { token, body: { userId } })
  const toAnnotator = await assignTo(dsA, annotator.id)
  check('an admin assigns Pilot A to an annotator', toAnnotator.status === 200 && toAnnotator.body.dataset.memberIds.includes(annotator.id))
  check('and Pilot B to a teacher', (await assignTo(dsB, teacher.id)).body.dataset?.members.some((m) => m.id === teacher.id))
  check('assigning twice is harmless', (await assignTo(dsB, teacher.id)).body.dataset?.memberIds.filter((id) => id === teacher.id).length === 1)
  const studentUser = (await call('GET', '/api/auth/me', { token: dsStudentToken })).body.user
  check(
    'only teachers and annotators can be assigned',
    (await assignTo(dsA, studentUser.id)).status === 400 &&
      (await assignTo(dsA, otherManager.id)).status === 400 &&
      (await assignTo(dsA, 'usr_nobody')).status === 400 &&
      (await call('POST', `/api/research/datasets/${dsA}/members`, { token: adminToken, body: {} })).status === 400,
  )
  check('to a dataset that exists', (await assignTo('ds_missing', annotator.id)).status === 404)
  check(
    'and only by an admin',
    (await assignTo(dsA, secondAnnotator.id, managerToken)).status === 403 &&
      (await assignTo(dsA, secondAnnotator.id, teacherToken)).status === 403 &&
      (await assignTo(dsA, secondAnnotator.id, annotatorToken)).status === 403 &&
      (await assignTo(dsA, secondAnnotator.id, 'smoke-token')).status === 403,
  )

  console.log('\ndatasets: picking dialogs into one')
  const addTo = (datasetId, snippetIds, token) =>
    call('POST', `/api/research/datasets/${datasetId}/snippets`, { token, body: { snippetIds } })
  const removeFrom = (datasetId, snippetIds, token) =>
    call('POST', `/api/research/datasets/${datasetId}/snippets/remove`, { token, body: { snippetIds } })
  const teacherAdds = await addTo(dsA, [dsX.id], teacherToken)
  check(
    'a teacher adds their student’s dialog to any active dataset',
    teacherAdds.status === 200 &&
      teacherAdds.body.memberships[dsX.id].datasetIds.join() === dsA &&
      teacherAdds.body.memberships[dsX.id].included === true,
  )
  check('the dataset says it has it', (await dsList(adminToken)).body.datasets.find((d) => d.id === dsA).count === 1)
  const adminAdds = await addTo(dsB, [dsY.id, dsX.id], adminToken)
  check(
    'one dialog can be in two datasets',
    adminAdds.status === 200 && [...adminAdds.body.memberships[dsX.id].datasetIds].sort().join() === [dsA, dsB].sort().join(),
  )
  check(
    'and reads back with both, for staff',
    (await call('GET', `/api/research/snippets?sessionId=${dsSession.id}`, { token: teacherToken })).body.snippets
      .find((entry) => entry.id === dsX.id)
      ?.datasetIds.length === 2,
  )
  check('adding again is harmless', (await addTo(dsA, [dsX.id], teacherToken)).body.memberships[dsX.id].datasetIds.length === 2)
  check('nothing out of scope', (await addTo(dsA, [farSnippet.id], teacherToken)).status === 404)
  const mixedAdd = await addTo(dsA, [dsZ.id, `${turnSession.id}:nope:999`], teacherToken)
  check(
    'and all or nothing',
    mixedAdd.status === 404 &&
      mixedAdd.body.error.details.snippetIds.length === 1 &&
      (await app.locals.store.snippetLabels.get(dsZ.id))?.datasetIds === undefined,
  )
  check(
    'into a dataset that exists',
    (await addTo('ds_missing', [dsX.id], teacherToken)).status === 404,
  )
  check(
    'with snippet ids',
    (await addTo(dsA, [], teacherToken)).status === 400 &&
      (await call('POST', `/api/research/datasets/${dsA}/snippets`, { token: teacherToken, body: {} })).status === 400 &&
      (await addTo(dsA, [42], teacherToken)).status === 400,
  )
  check(
    'never by an annotator, a student or nobody',
    (await addTo(dsA, [dsX.id], annotatorToken)).status === 403 &&
      (await addTo(dsA, [dsX.id], dsStudentToken)).status === 403 &&
      (await addTo(dsA, [dsX.id])).status === 403,
  )
  check('a manager picks within their branch', (await addTo(dsA, [dsZ.id], managerToken)).status === 200)
  check('not outside it', (await addTo(dsA, [farSnippet.id], managerToken)).status === 404)
  check(
    'taking one out keeps it in the other',
    (await removeFrom(dsB, [dsX.id], adminToken)).body.memberships[dsX.id].datasetIds.join() === dsA,
  )
  check('and back in', (await addTo(dsB, [dsX.id], adminToken)).status === 200)

  console.log('\ndatasets: an annotator sees only theirs')
  const annDatasets = await dsList(annotatorToken)
  check(
    'their list is the dataset assigned to them, and nothing else',
    annDatasets.status === 200 && annDatasets.body.datasets.map((d) => d.id).join() === dsA && annDatasets.body.datasets[0].assigned === true,
    JSON.stringify(annDatasets.body),
  )
  check('with how much is assigned to them one by one', typeof annDatasets.body.individualCount === 'number')
  check('without who else it is assigned to', !('members' in annDatasets.body.datasets[0]))
  check(
    'an annotator with none assigned sees an empty list',
    (await dsList(secondAnnotatorToken)).body.datasets.length === 0,
  )
  const annA = await call('GET', `/api/research/snippets?datasetId=${dsA}`, { token: annotatorToken })
  check(
    'they read their dataset, as handles',
    annA.status === 200 &&
      annA.body.snippets.some((entry) => entry.id === handleOf(dsX)) &&
      annA.body.snippets.some((entry) => entry.id === handleOf(dsZ)),
  )
  check(
    'with no session id, no student id, no dataset ids',
    !JSON.stringify(annA.body).includes(dsSession.id) &&
      !JSON.stringify(annA.body).includes(studentUser.id) &&
      annA.body.snippets.every((entry) => !('sessionId' in entry) && !('datasetIds' in entry)),
  )
  check('another dataset is refused', (await call('GET', `/api/research/snippets?datasetId=${dsB}`, { token: annotatorToken })).status === 403)
  check('the default one too', (await call('GET', '/api/research/snippets?datasetId=ds_default', { token: annotatorToken })).status === 403)
  check('one that is not there is 404', (await call('GET', '/api/research/snippets?datasetId=ds_missing', { token: annotatorToken })).status === 404)
  const annLabels = await call('PATCH', `/api/research/snippets/${handleOf(dsX)}`, {
    token: annotatorToken,
    body: { labels: { tone: 'yes' }, notes: { tone: 'DS-ANN-NOTE' } },
  })
  check('they label a dialog in their dataset', annLabels.status === 200 && annLabels.body.label.labels.tone === 'yes')
  check(
    'but not one only in a dataset that is not theirs',
    (await call('PATCH', `/api/research/snippets/${handleOf(dsY)}`, { token: annotatorToken, body: { labels: { tone: 'yes' } } }))
      .status === 404,
  )
  check(
    'and the second annotator, with none, labels none of it',
    (await call('PATCH', `/api/research/snippets/${handleOf(dsX, secondAnnotator)}`, { token: secondAnnotatorToken, body: { labels: { tone: 'yes' } } }))
      .status === 404,
  )

  console.log('\ndatasets: a teacher sees only theirs')
  const teacherDatasets = (await dsList(teacherToken)).body.datasets
  check(
    'a teacher is shown every active dataset to pick into, marked with the ones they label',
    teacherDatasets.find((d) => d.id === dsB)?.assigned === true &&
      teacherDatasets.find((d) => d.id === dsA)?.assigned === false &&
      teacherDatasets.find((d) => d.id === 'ds_default')?.assigned === true,
  )
  check('and reads only the ones assigned', (await call('GET', `/api/research/snippets?datasetId=${dsA}`, { token: teacherToken })).status === 403)
  const teacherB = await call('GET', `/api/research/snippets?datasetId=${dsB}`, { token: teacherToken })
  check(
    'theirs, with real ids and datasets',
    teacherB.status === 200 &&
      teacherB.body.snippets.map((entry) => entry.id).sort().join() === [dsX.id, dsY.id].sort().join() &&
      teacherB.body.snippets.every((entry) => entry.datasetIds.includes(dsB)),
  )
  check(
    'a teacher labels a dialog in their dataset',
    (await call('PATCH', `/api/research/snippets/${dsY.id}`, { token: teacherToken, body: { labels: { specific: 'yes' } } })).status === 200,
  )
  check(
    'but not one in no dataset of theirs',
    (await call('PATCH', `/api/research/snippets/${dsZ.id}`, { token: teacherToken, body: { labels: { specific: 'yes' } } }))
      .status === 403 &&
      (await call('PATCH', `/api/research/snippets/${dsZ.id}`, { token: teacherToken, body: { notes: { specific: 'x' } } }))
        .status === 403,
  )
  check(
    'while keeping or dropping stays theirs to do',
    (await call('PATCH', `/api/research/snippets/${dsZ.id}`, { token: teacherToken, body: { included: true } })).body.label
      ?.datasetIds.join() === dsA,
  )
  check(
    'another teacher reads none of it',
    (await call('GET', `/api/research/snippets?datasetId=${dsB}`, { token: otherTeacherToken })).status === 403,
  )
  check(
    'a manager reads any active dataset, within their branch',
    (await call('GET', `/api/research/snippets?datasetId=${dsA}`, { token: managerToken })).body.snippets?.some((e) => e.id === dsX.id) &&
      (await call('GET', `/api/research/snippets?datasetId=${dsA}`, { token: freshOtherManagerToken })).body.snippets?.length === 0,
  )
  check(
    'an admin and the research token read everything in it',
    (await call('GET', `/api/research/snippets?datasetId=${dsA}`, { token: adminToken })).body.snippets?.length === 2 &&
      (await call('GET', `/api/research/snippets?datasetId=${dsA}`, { token: 'smoke-token' })).body.snippets?.length === 2,
  )

  console.log('\ndatasets: browsing dialogs by student')
  const teacherStudents = await call('GET', '/api/research/students', { token: teacherToken })
  const signedInRow = teacherStudents.body.students?.find((row) => row.key === `u:${studentUser.id}`)
  check(
    'a teacher lists their students, by name where they have one',
    teacherStudents.status === 200 && signedInRow?.kind === 'account' && signedInRow.name === studentUser.name,
  )
  check(
    'with how many dialogs, and how many are in a dataset',
    signedInRow.dialogCount >= 2 && signedInRow.inDatasetCount >= 2 && signedInRow.questionCount >= 1,
  )
  const anonRowDs = teacherStudents.body.students.find((row) => row.key === `s:${turnSession.id}`)
  check('an anonymous session is a student of its own', anonRowDs?.kind === 'anonymous' && anonRowDs.name === null && Boolean(anonRowDs.code))
  check('nobody from another branch', !teacherStudents.body.students.some((row) => row.key === `s:${farSession.id}`))
  check(
    'a manager sees their branch, the other manager theirs',
    (await call('GET', '/api/research/students', { token: managerToken })).body.students.some((row) => row.key === `s:${turnSession.id}`) &&
      (await call('GET', '/api/research/students', { token: freshOtherManagerToken })).body.students.some((row) => row.key === `s:${farSession.id}`) &&
      !(await call('GET', '/api/research/students', { token: freshOtherManagerToken })).body.students.some((row) => row.key === `s:${turnSession.id}`),
  )
  const studentDialogs = await call('GET', `/api/research/students/${encodeURIComponent(`u:${studentUser.id}`)}/dialogs`, { token: teacherToken })
  const dsGroup = studentDialogs.body.questions?.find((group) => group.questionId === dsQuestion.id)
  check(
    'one student’s dialogs, grouped by question',
    studentDialogs.status === 200 && dsGroup?.dialogs.length === 2 && dsGroup.question?.code === 'Q1',
  )
  check('with what they handed in', dsGroup.answer?.draft === 'My working so far.')
  check(
    'each with both turns, their times, and its datasets',
    dsGroup.dialogs.every((d) => d.student.text && d.student.at && d.tutor.text && d.tutor.at && Array.isArray(d.datasetIds)) &&
      dsGroup.dialogs.find((d) => d.id === dsX.id).datasetIds.length === 2,
  )
  check('and not who wrote the reply', dsGroup.dialogs.every((d) => !('source' in d.tutor) && !('model' in d.tutor)))
  check(
    'a student out of scope is 404',
    (await call('GET', `/api/research/students/${encodeURIComponent(`s:${farSession.id}`)}/dialogs`, { token: teacherToken })).status === 404 &&
      (await call('GET', '/api/research/students/u:usr_nobody/dialogs', { token: teacherToken })).status === 404,
  )
  check(
    'never for an annotator, a student or nobody',
    (await call('GET', '/api/research/students', { token: annotatorToken })).status === 403 &&
      (await call('GET', '/api/research/students', { token: dsStudentToken })).status === 403 &&
      (await call('GET', '/api/research/students')).status === 403 &&
      (await call('GET', `/api/research/students/s:${turnSession.id}/dialogs`, { token: annotatorToken })).status === 403,
  )

  console.log('\ndatasets: archiving, deleting')
  const archived = await call('PATCH', `/api/research/datasets/${dsA}`, { token: adminToken, body: { archived: true } })
  check('an admin archives a dataset', archived.status === 200 && archived.body.dataset.archived === true && Boolean(archived.body.dataset.archivedAt))
  check('it leaves the annotator’s list', (await dsList(annotatorToken)).body.datasets.length === 0)
  check('and their reading of it', (await call('GET', `/api/research/snippets?datasetId=${dsA}`, { token: annotatorToken })).status === 404)
  check(
    'and their labelling of it',
    (await call('PATCH', `/api/research/snippets/${handleOf(dsX)}`, { token: annotatorToken, body: { labels: { tone: 'no' } } })).status === 404,
  )
  check('nothing is picked into it', (await addTo(dsA, [dsY.id], adminToken)).status === 409 && (await addTo(dsA, [dsY.id], teacherToken)).status === 404)
  check('staff other than the admin no longer see it', !(await dsList(teacherToken)).body.datasets.some((d) => d.id === dsA))
  check('the admin still reads it whole', (await call('GET', `/api/research/snippets?datasetId=${dsA}`, { token: adminToken })).body.snippets?.length === 2)
  check('and brings it back', (await call('PATCH', `/api/research/datasets/${dsA}`, { token: adminToken, body: { archived: false } })).body.dataset?.archived === false)
  check('the annotator has it again', (await dsList(annotatorToken)).body.datasets.length === 1)
  check(
    'the default dataset is never archived',
    (await call('PATCH', '/api/research/datasets/ds_default', { token: adminToken, body: { archived: true } })).status === 400,
  )
  check('"archived" is a boolean', (await call('PATCH', `/api/research/datasets/${dsA}`, { token: adminToken, body: { archived: 'yes' } })).status === 400)
  const refusedDelete = await call('DELETE', `/api/research/datasets/${dsA}`, { token: adminToken })
  check('a dataset with dialogs in it is not deleted', refusedDelete.status === 409 && refusedDelete.body.error.details.count === 2)
  check('nor the default one', (await call('DELETE', '/api/research/datasets/ds_default', { token: adminToken })).status === 409)
  const emptyDataset = (await makeDataset(adminToken, { name: 'Empty one' })).body.dataset
  check('an empty one is', (await call('DELETE', `/api/research/datasets/${emptyDataset.id}`, { token: adminToken })).body.deleted === true)
  check('and then it is gone', (await call('DELETE', `/api/research/datasets/${emptyDataset.id}`, { token: adminToken })).status === 404)
  check('only by an admin', (await call('DELETE', `/api/research/datasets/${dsA}`, { token: managerToken })).status === 403)

  console.log('\ndatasets: unassigning keeps the labels')
  const unassignedDs = await call('DELETE', `/api/research/datasets/${dsA}/members/${annotator.id}`, { token: adminToken })
  check('an admin takes a dataset back from an annotator', unassignedDs.status === 200 && !unassignedDs.body.dataset.memberIds.includes(annotator.id))
  check('they can no longer read it', (await call('GET', `/api/research/snippets?datasetId=${dsA}`, { token: annotatorToken })).status === 403)
  check(
    'nor label in it',
    (await call('PATCH', `/api/research/snippets/${handleOf(dsX)}`, { token: annotatorToken, body: { labels: { tone: 'no' } } })).status === 404,
  )
  const dsXForAdmin = (await call('GET', `/api/research/snippets?datasetId=${dsA}`, { token: adminToken })).body.snippets.find((e) => e.id === dsX.id)
  check(
    'and what they labelled stays, as theirs',
    dsXForAdmin?.annotations.some((entry) => entry.annotatorId === annotator.id && entry.notes.tone === 'DS-ANN-NOTE'),
  )
  await call('DELETE', `/api/research/datasets/${dsB}/members/${teacher.id}`, { token: adminToken })
  check('a teacher taken off reads it no more', (await call('GET', `/api/research/snippets?datasetId=${dsB}`, { token: teacherToken })).status === 403)
  check(
    'and their labels stay on the dialog',
    (await call('GET', `/api/research/snippets?datasetId=${dsB}`, { token: adminToken })).body.snippets.find((e) => e.id === dsY.id)?.labels
      .specific === 'yes',
  )
  check('unassigning only by an admin', (await call('DELETE', `/api/research/datasets/${dsB}/members/${teacher.id}`, { token: managerToken })).status === 403)

  console.log('\ndatasets: old records and old clients')
  // A record written before datasets existed: kept, with no `datasetIds`.
  const noRecordYet = []
  for (const entry of fresh) if (!(await app.locals.store.snippetLabels.get(entry.id))) noRecordYet.push(entry)
  const legacyRecord = noRecordYet[0]
  check('there is a dialog nobody has decided anything about', Boolean(legacyRecord))
  await app.locals.store.snippetLabels.upsert(legacyRecord.id, { included: true })
  check(
    'a kept record with no datasets reads as in the default dataset',
    (await call('GET', '/api/research/snippets?datasetId=ds_default', { token: adminToken })).body.snippets.some((e) => e.id === legacyRecord.id),
  )
  check(
    'and adding it to another keeps it in the default one',
    [...(await addTo(dsB, [legacyRecord.id], adminToken)).body.memberships[legacyRecord.id].datasetIds].sort().join() === ['ds_default', dsB].sort().join(),
  )
  const droppedDialog = await call('PATCH', `/api/research/snippets/${legacyRecord.id}`, { token: adminToken, body: { included: false } })
  check('dropping a dialog takes it out of every dataset', droppedDialog.body.label.included === false && droppedDialog.body.label.datasetIds.length === 0)
  const keptDialog = await call('PATCH', `/api/research/snippets/${legacyRecord.id}`, { token: adminToken, body: { included: true } })
  check('keeping it, with no dataset named, puts it in the default one', keptDialog.body.label.datasetIds.join() === 'ds_default')
  const outOfLast = await removeFrom('ds_default', [legacyRecord.id], adminToken)
  check('taken out of its last dataset, it is undecided again', outOfLast.body.memberships[legacyRecord.id].included === null)

  console.log('\ndatasets: export by dataset')
  const exportB = await call('GET', `/api/research/export?datasetId=${dsB}`, { token: 'smoke-token' })
  check(
    'the export takes one dataset',
    exportB.status === 200 &&
      exportB.body.snippets.map((e) => e.id).sort().join() === [dsX.id, dsY.id].sort().join() &&
      exportB.body.snippets.every((e) => e.datasetIds.includes(dsB)),
  )
  check('not one that is not there', (await call('GET', '/api/research/export?datasetId=ds_missing', { token: 'smoke-token' })).status === 404)

  console.log('\ndatasets: who may do what')
  const dsMatrix = [
    // [what, method, url, body, { anonymous, student, annotator, teacher, manager, admin }]
    ['list datasets', 'GET', '/api/research/datasets', undefined, { anonymous: 403, student: 403, annotator: 200, teacher: 200, manager: 200, admin: 200 }],
    ['create a dataset', 'POST', '/api/research/datasets', { name: 'Matrix' }, { anonymous: 403, student: 403, annotator: 403, teacher: 403, manager: 403, admin: 201 }],
    ['rename one', 'PATCH', `/api/research/datasets/${dsB}`, { description: 'Matrix' }, { anonymous: 403, student: 403, annotator: 403, teacher: 403, manager: 403, admin: 200 }],
    ['assign one', 'POST', `/api/research/datasets/${dsB}/members`, { userId: secondAnnotator.id }, { anonymous: 403, student: 403, annotator: 403, teacher: 403, manager: 403, admin: 200 }],
    ['pick into one', 'POST', `/api/research/datasets/${dsB}/snippets`, { snippetIds: [dsY.id] }, { anonymous: 403, student: 403, annotator: 403, teacher: 200, manager: 200, admin: 200 }],
    ['list students', 'GET', '/api/research/students', undefined, { anonymous: 403, student: 403, annotator: 403, teacher: 200, manager: 200, admin: 200 }],
    ['read a dataset', 'GET', `/api/research/snippets?datasetId=${dsB}`, undefined, { anonymous: 403, student: 403, annotator: 403, teacher: 403, manager: 200, admin: 200 }],
  ]
  const dsTokens = {
    anonymous: undefined,
    student: dsStudentToken,
    annotator: annotatorToken,
    teacher: teacherToken,
    manager: managerToken,
    admin: adminToken,
  }
  for (const [what, method, url, body, expected] of dsMatrix) {
    const got = {}
    for (const [who, token] of Object.entries(dsTokens)) got[who] = (await call(method, url, { token, body })).status
    check(`${what}: ${Object.entries(expected).map(([who, status]) => `${who} ${status}`).join(', ')}`, JSON.stringify(got) === JSON.stringify(expected), JSON.stringify(got))
  }
  check('a second annotator assigned reads it', (await call('GET', `/api/research/snippets?datasetId=${dsB}`, { token: secondAnnotatorToken })).status === 200)

  console.log('\ndatasets: assignments follow the account')
  const passing = (
    await call('POST', '/api/users', {
      token: adminToken,
      body: { role: 'annotator', name: 'Pat Passing', email: 'pat-ds@example.com', password: 'correct horse battery' },
    })
  ).body.user
  await assignTo(dsB, passing.id)
  check('a deactivated account cannot be assigned', await (async () => {
    await call('PATCH', `/api/users/${passing.id}`, { token: adminToken, body: { active: false } })
    const refused = (await assignTo(dsA, passing.id)).status === 400
    await call('PATCH', `/api/users/${passing.id}`, { token: adminToken, body: { active: true } })
    return refused
  })())
  await call('DELETE', `/api/users/${passing.id}`, { token: adminToken })
  check(
    'a deleted account is taken off every dataset',
    !(await dsList(adminToken)).body.datasets.some((d) => d.memberIds.includes(passing.id)),
  )
  await assignTo(dsB, secondAnnotator.id)
  await call('PATCH', `/api/users/${secondAnnotator.id}`, { token: adminToken, body: { role: 'manager' } })
  check(
    'and so is one moved to a role that does not label by assignment',
    !(await dsList(adminToken)).body.datasets.some((d) => d.memberIds.includes(secondAnnotator.id)),
  )

  /* ============================================== deleting Student work entries */

  // A block of its own, so its names cannot collide with the sections above.
  {
    console.log('\ndeleting student work: setting up')
    // A world of its own: a manager with two teachers, a second manager with one,
    // signed-in students with answers, a tutor exchange and a photo each.
    const delStaff = async (body) => {
      const made = (await call('POST', '/api/users', { token: adminToken, body: { password: 'correct horse battery', ...body } })).body.user
      const token = (await call('POST', '/api/auth/login', { body: { email: body.email, password: 'correct horse battery' } })).body.token
      return { user: made, token }
    }
    const delManager = await delStaff({ role: 'manager', name: 'Del Manager', email: 'del-mgr@example.com' })
    const delTeacher = await delStaff({ role: 'teacher', name: 'Del Teacher', email: 'del-t1@example.com', managerId: delManager.user.id })
    const delSibling = await delStaff({ role: 'teacher', name: 'Del Sibling', email: 'del-t2@example.com', managerId: delManager.user.id })
    const delFarManager = await delStaff({ role: 'manager', name: 'Del Far Manager', email: 'del-mgr2@example.com' })
    const delFarTeacher = await delStaff({ role: 'teacher', name: 'Del Far', email: 'del-t3@example.com', managerId: delFarManager.user.id })

    const delActivity = async (teacherToken_) => {
      const activity = (await call('POST', '/api/activities', { token: teacherToken_, body: { title: 'Deletable work' } })).body.activity
      const question = (await call('POST', `/api/activities/${activity.id}/questions`, { token: teacherToken_, body: BARE_QUESTION })).body.question
      await call('PATCH', `/api/activities/${activity.id}`, { token: teacherToken_, body: { status: 'published' } })
      return { activity, question }
    }
    const delNear = await delActivity(delTeacher.token)
    const delFar = await delActivity(delFarTeacher.token)

    const delStudent = async (teacherToken_, number) => {
      await call('POST', '/api/users/class-list', { token: teacherToken_, body: { studentNumbers: [number] } })
      const login = (await call('POST', '/api/auth/student', { body: { studentNumber: number } })).body
      await call('POST', '/api/auth/consent', { token: login.token })
      return { user: login.user, token: login.token }
    }
    /** One entry with everything an entry can hold: an answer, a tutor exchange, a photo. */
    const delWork = async (who, { activity, question }) => {
      const started = await call('POST', '/api/sessions', { token: who?.token, body: { consent: true, activityId: activity.id } })
      const session = started.body.session
      await call('PUT', `/api/sessions/${session.id}/answers/${question.id}`, { token: who?.token, body: { mode: 'write', draft: 'my working' } })
      await call('POST', `/api/sessions/${session.id}/questions/${question.id}/messages`, { token: who?.token, body: { text: 'Where do I start?' } })
      const photo = (await call('POST', `/api/sessions/${session.id}/questions/${question.id}/uploads`, { token: who?.token, body: { name: 'w.png', dataUrl: PNG } })).body.upload
      return { session, photo, snippetId: `${session.id}:${question.id}:` }
    }
    const delStudents = []
    for (let i = 1; i <= 7; i += 1) delStudents.push(await delStudent(delTeacher.token, `5050000${i}`))
    const farStudent = await delStudent(delFarTeacher.token, '50500009')
    const work = []
    for (const who of delStudents) work.push(await delWork(who, delNear))
    const anonWork = await delWork(null, delNear) // anonymous, reached through the activity
    const farWork = await delWork(farStudent, delFar)
    const snippetOf = async (sessionId) =>
      (await call('GET', `/api/research/snippets?sessionId=${sessionId}`, { token: adminToken })).body.snippets[0]
    check('every entry has a dialog and a photo', (await snippetOf(work[0].session.id))?.id && Boolean(work[0].photo?.id))

    const exists = async (sessionId) => (await call('GET', `/api/research/sessions/${sessionId}/transcript`, { token: adminToken })).status === 200
    const deleteMany = (sessionIds, token, extra = {}) =>
      call('POST', '/api/research/sessions/delete', { token, body: { sessionIds, ...extra } })
    const filesOnDisk = async (sessionId) => {
      try {
        return (await fs.readdir(path.join(uploadDir, config.spaces.prefix, sessionId))).length
      } catch {
        return 0
      }
    }

    console.log('\ndeleting student work: who may')
    const target = work[0].session.id
    const refused = {
      anonymous: undefined,
      student: delStudents[0].token,
      annotator: annotatorToken,
      'the research token alone': 'smoke-token',
    }
    for (const [who, token] of Object.entries(refused)) {
      const answer = await deleteMany([target], token)
      check(`${who} is refused (${answer.status})`, answer.status === 401 || answer.status === 403, String(answer.status))
      const single = await call('DELETE', `/api/research/sessions/${target}`, { token })
      check(`${who} is refused one at a time too (${single.status})`, single.status === 401 || single.status === 403, String(single.status))
    }
    check('and the entry is still there', await exists(target))
    check('the older student door still refuses a teacher', (await call('DELETE', `/api/sessions/${target}`, { token: delTeacher.token })).status === 403)

    console.log('\ndeleting student work: scope')
    const sibling = await deleteMany([target], delSibling.token)
    check('another teacher, same manager: 404', sibling.status === 404 && sibling.body.error.details.sessionIds.join() === target)
    const unknown = await deleteMany(['ses_doesnotexist'], delTeacher.token)
    check(
      'an unknown id answers exactly as an out-of-scope one',
      unknown.status === 404 && unknown.body.error.message === sibling.body.error.message,
    )
    const farManager = await deleteMany([target], delFarManager.token)
    check('a manager outside the branch: 404', farManager.status === 404)
    const mixed = await deleteMany([work[1].session.id, farWork.session.id], delTeacher.token)
    check(
      'one id out of scope and nothing is deleted',
      mixed.status === 404 &&
        mixed.body.error.details.sessionIds.join() === farWork.session.id &&
        (await exists(work[1].session.id)) &&
        (await exists(farWork.session.id)),
    )

    console.log('\ndeleting student work: limits')
    check('ids are required', (await call('POST', '/api/research/sessions/delete', { token: delTeacher.token, body: {} })).status === 400)
    check('an empty list is refused', (await deleteMany([], delTeacher.token)).status === 400)
    check('ids are strings', (await deleteMany([42], delTeacher.token)).status === 400)
    check('a string is not a list', (await call('POST', '/api/research/sessions/delete', { token: delTeacher.token, body: { sessionIds: target } })).status === 400)
    const tooMany = Array.from({ length: 101 }, (_, i) => `ses_bulk_${i}`)
    check('at most 100 per request', (await deleteMany(tooMany, delTeacher.token)).status === 400)
    check('a teacher cannot force', (await deleteMany([target], delTeacher.token, { force: true })).status === 403 && (await exists(target)))
    check('nor a manager', (await deleteMany([target], delManager.token, { force: true })).status === 403 && (await exists(target)))

    console.log('\ndeleting student work: a teacher deletes two at once')
    const before = await call('GET', '/api/research/sessions', { token: delTeacher.token })
    check('the teacher sees all eight entries', before.body.sessions.filter((s) => s.activityId === delNear.activity.id).length === 8)
    check('the photos are on disk', (await filesOnDisk(work[0].session.id)) === 1 && (await filesOnDisk(work[1].session.id)) === 1)
    const pair = await deleteMany([work[0].session.id, work[1].session.id, work[0].session.id], delTeacher.token)
    check(
      'both deleted, duplicates ignored',
      pair.status === 200 &&
        pair.body.deleted.join() === [work[0].session.id, work[1].session.id].join() &&
        pair.body.protected.length === 0 &&
        pair.body.failed.length === 0 &&
        pair.body.files === 2,
      JSON.stringify(pair.body),
    )
    check('their transcripts are gone', !(await exists(work[0].session.id)) && !(await exists(work[1].session.id)))
    check('so is the session itself', (await call('GET', `/api/sessions/${work[0].session.id}`, { token: delStudents[0].token })).status === 404)
    check('the photo is no longer served', (await fetch(`${base}${work[0].photo.url}`)).status === 404)
    check('nor left on disk', (await filesOnDisk(work[0].session.id)) === 0 && (await filesOnDisk(work[1].session.id)) === 0)
    check('the store has nothing left for it', (await app.locals.store.answers.listBySession(work[0].session.id)).length === 0 &&
      (await app.locals.store.messages.listBySession(work[0].session.id)).length === 0 &&
      (await app.locals.store.uploads.listBySession(work[0].session.id)).length === 0 &&
      (await app.locals.store.events.countBySession(work[0].session.id)) === 0)
    const after = await call('GET', '/api/research/sessions', { token: delTeacher.token })
    check('the list no longer has them', after.body.sessions.filter((s) => s.activityId === delNear.activity.id).length === 6)
    check(
      'nor the students list',
      !(await call('GET', '/api/research/students', { token: delTeacher.token })).body.students.some(
        (row) => row.key === `u:${delStudents[0].user.id}`,
      ),
    )
    check(
      'and who did it is recorded, as an account event',
      (await app.locals.store.events.listBySession(null)).some(
        (event) =>
          event.type === 'student_work_deleted' &&
          event.userId === delTeacher.user.id &&
          event.payload.sessionIds.join() === [work[0].session.id, work[1].session.id].join(),
      ),
    )

    console.log('\ndeleting student work: the student starts fresh')
    const me = await call('GET', '/api/auth/me', { token: delStudents[0].token })
    check('their sign-in still works', me.status === 200 && me.body.user.id === delStudents[0].user.id)
    check('their consent is untouched', me.body.user.consented === true)
    check('their account is still on the roster', (await call('GET', `/api/users/${delStudents[0].user.id}`, { token: delTeacher.token })).status === 200)
    const fresh = await call('POST', '/api/sessions', { token: delStudents[0].token, body: { activityId: delNear.activity.id } })
    check('opening the activity again starts a new entry', fresh.status === 201 && !fresh.body.resumed && fresh.body.session.id !== work[0].session.id)
    const freshRead = await call('GET', `/api/sessions/${fresh.body.session.id}`, { token: delStudents[0].token })
    check('with nothing carried over', freshRead.body.answers.length === 0 && freshRead.body.messages.length === 0)

    console.log('\ndeleting student work: one at a time, manager, admin')
    const one = await call('DELETE', `/api/research/sessions/${work[2].session.id}`, { token: delTeacher.token })
    check('a teacher deletes one entry', one.status === 200 && one.body.deleted.join() === work[2].session.id && !(await exists(work[2].session.id)))
    check('one out of scope is 404', (await call('DELETE', `/api/research/sessions/${farWork.session.id}`, { token: delTeacher.token })).status === 404)
    check('and again is 404', (await call('DELETE', `/api/research/sessions/${work[2].session.id}`, { token: delTeacher.token })).status === 404)
    const byManager = await deleteMany([work[3].session.id, anonWork.session.id], delManager.token)
    check('a manager deletes in their branch, anonymous work included', byManager.status === 200 && byManager.body.deleted.length === 2)
    const byFarManager = await deleteMany([farWork.session.id], delFarManager.token)
    check('the other manager deletes in theirs', byFarManager.status === 200 && byFarManager.body.deleted.length === 1)

    console.log('\ndeleting student work: research data is protected')
    const keptSnippet = await snippetOf(work[4].session.id)
    const labelledSnippet = await snippetOf(work[5].session.id)
    const assignedSnippet = await snippetOf(work[6].session.id)
    await call('POST', '/api/research/datasets/ds_default/snippets', { token: adminToken, body: { snippetIds: [keptSnippet.id] } })
    await call('PATCH', `/api/research/snippets/${encodeURIComponent(labelledSnippet.id)}`, { token: adminToken, body: { labels: { specific: 'yes' } } })
    await call('POST', '/api/research/snippets/assign', { token: adminToken, body: { snippetIds: [assignedSnippet.id], assigneeId: annotator.id } })
    const datasetCount = async () =>
      (await call('GET', '/api/research/datasets', { token: adminToken })).body.datasets.find((d) => d.id === 'ds_default').count
    const countBefore = await datasetCount()
    const guarded = await deleteMany([work[4].session.id, work[5].session.id, work[6].session.id], delTeacher.token)
    check(
      'in a dataset or labelled: skipped and reported, the rest deleted',
      guarded.status === 200 &&
        guarded.body.deleted.join() === work[6].session.id &&
        guarded.body.protected.map((p) => p.sessionId).sort().join() === [work[4].session.id, work[5].session.id].sort().join() &&
        guarded.body.protected.every((p) => p.dialogs === 1),
      JSON.stringify(guarded.body),
    )
    check('an assigned-only dialog is not research data, and its record goes with it', (await app.locals.store.snippetLabels.get(assignedSnippet.id)) === null)
    check('the protected entries are untouched', (await exists(work[4].session.id)) && (await exists(work[5].session.id)) && (await filesOnDisk(work[4].session.id)) === 1)
    check('their records are untouched', Boolean(await app.locals.store.snippetLabels.get(keptSnippet.id)) && Boolean(await app.locals.store.snippetLabels.get(labelledSnippet.id)))
    const singleGuarded = await call('DELETE', `/api/research/sessions/${work[4].session.id}`, { token: delManager.token })
    check('one at a time, a protected entry is a 409', singleGuarded.status === 409 && singleGuarded.body.error.details.protected[0].dialogs === 1 && (await exists(work[4].session.id)))

    const forced = await deleteMany([work[4].session.id, work[5].session.id], adminToken, { force: true })
    check(
      'an admin forces it',
      forced.status === 200 && forced.body.deleted.length === 2 && forced.body.protected.length === 0 && forced.body.labelRecords === 2,
      JSON.stringify(forced.body),
    )
    check('the label records go with it', (await app.locals.store.snippetLabels.get(keptSnippet.id)) === null && (await app.locals.store.snippetLabels.get(labelledSnippet.id)) === null)
    check('so the dataset counts one fewer', (await datasetCount()) === countBefore - 1)
    check('no record anywhere names a deleted session', ![...(await app.locals.store.snippetLabels.map()).keys()].some((key) =>
      work.some((entry) => key.startsWith(`${entry.session.id}:`)),
    ))
    const exportAfter = await call('GET', '/api/research/export', { token: 'smoke-token' })
    check('the export still works and leaves them out', exportAfter.status === 200 && !exportAfter.body.snippets.some((s) => s.id === keptSnippet.id))
    const csvAfter = await fetch(`${base}/api/research/export?format=csv`, { headers: { authorization: 'Bearer smoke-token' } })
    check('the CSV export too', csvAfter.status === 200 && !(await csvAfter.text()).includes(work[4].session.id))
    check('the annotator’s list is still readable', (await call('GET', '/api/research/snippets', { token: annotatorToken })).status === 200)

    const forcedOne = await deleteMany([fresh.body.session.id], adminToken)
    check('an admin deletes without force when nothing is protected', forcedOne.status === 200 && forcedOne.body.deleted.length === 1)
  }
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
