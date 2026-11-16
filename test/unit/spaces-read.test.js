/**
 * The Spaces read path — `storage().stream` (GetObjectCommand), reached through
 * `readBytes` and the annotator file route — against a fake, never the real
 * bucket.
 *
 * The fake is a small HTTP server on 127.0.0.1 speaking just enough of S3 for
 * the SDK: PUT, GET, HEAD and DELETE of an object, and the `NoSuchKey` error
 * document. The env is set before config.js is imported, and the .env loader
 * never overrides a key that is already set, so whatever `.env.local` holds —
 * real Spaces keys, a real MONGODB_URI, an OpenAI key — is not used here: the
 * keys are fake, the endpoint is the fake, the store is in memory and the tutor
 * is scripted.
 *
 * What this proves: the S3 client this code builds signs and sends a
 * GetObject for the key the upload record holds, the SDK's response body is a
 * stream the route can pipe, the bytes and the type arrive intact through the
 * route, and a missing object or a failing endpoint is a clean 404 that names
 * no key. What it cannot prove: real DigitalOcean credentials, the real
 * endpoint's TLS and virtual-host addressing, network failures mid-stream, or
 * the bucket's ACLs — `npm run setup:spaces` is the check against the real thing.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { once } from 'node:events'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/* ------------------------------------------------------------- the fake */

const BUCKET = 'fake-bucket'
const objects = new Map() // key -> { body, type }
const requests = [] // { method, key, host, signed }
/** Set to make the next requests fail as a broken endpoint would. */
let failWith = null
/** GETs the fake stopped serving because the other end hung up. */
let cutShort = 0

/** Path-style `/bucket/key` or virtual-hosted `bucket.host/key`, whichever the SDK sent. */
function keyOf(req) {
  const url = new URL(req.url, 'http://fake')
  const parts = decodeURIComponent(url.pathname).replace(/^\//, '')
  const host = req.headers.host ?? ''
  if (host.startsWith(`${BUCKET}.`)) return parts
  return parts.startsWith(`${BUCKET}/`) ? parts.slice(BUCKET.length + 1) : null
}

const fake = http.createServer(async (req, res) => {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const key = keyOf(req)
  requests.push({
    method: req.method,
    key,
    host: req.headers.host,
    signed: String(req.headers.authorization ?? '').startsWith('AWS4-HMAC-SHA256'),
  })

  if (failWith) {
    res.writeHead(failWith, { 'content-type': 'application/xml' })
    res.end('<?xml version="1.0"?><Error><Code>InternalError</Code><Message>broken</Message></Error>')
    return
  }

  if (req.method === 'PUT' && key) {
    objects.set(key, { body: Buffer.concat(chunks), type: req.headers['content-type'] })
    res.writeHead(200, { etag: '"etag"' })
    res.end()
    return
  }
  if (req.method === 'DELETE' && key) {
    objects.delete(key)
    res.writeHead(204)
    res.end()
    return
  }
  if ((req.method === 'GET' || req.method === 'HEAD') && key !== null) {
    const object = objects.get(key)
    if (!object) {
      res.writeHead(404, { 'content-type': 'application/xml' })
      res.end(
        req.method === 'HEAD'
          ? undefined
          : `<?xml version="1.0"?><Error><Code>NoSuchKey</Code><Message>The specified key does not exist.</Message><Key>${key}</Key></Error>`,
      )
      return
    }
    res.writeHead(200, {
      'content-type': object.type ?? 'application/octet-stream',
      'content-length': object.body.length,
      etag: '"etag"',
      'last-modified': new Date().toUTCString(),
    })
    if (object.slow && req.method === 'GET') {
      // Dribbled out, so a reader can leave halfway and the fake can tell.
      let offset = 0
      const timer = setInterval(() => {
        if (offset >= object.body.length) {
          clearInterval(timer)
          res.end()
          return
        }
        res.write(object.body.subarray(offset, offset + 16 * 1024))
        offset += 16 * 1024
      }, 5)
      res.once('close', () => {
        clearInterval(timer)
        if (!res.writableEnded) cutShort += 1
      })
      return
    }
    res.end(req.method === 'HEAD' ? undefined : object.body)
    return
  }
  res.writeHead(400)
  res.end()
})

fake.listen(0, '127.0.0.1')
await once(fake, 'listening')

/* --------------------------------------------------- env, then the app */

const uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'fe-spaces-read-'))
Object.assign(process.env, {
  SPACES_KEY: 'fake-key',
  SPACES_SECRET: 'fake-secret',
  SPACES_BUCKET: BUCKET,
  SPACES_PREFIX: 'dropshot',
  SPACES_REGION: 'sfo3',
  SPACES_ENDPOINT: `http://127.0.0.1:${fake.address().port}`,
  MONGODB_URI: '',
  OPENAI_API_KEY: '',
  RESEARCH_TOKEN: 'unit-token',
  BOOTSTRAP_TOKEN: 'unit-token',
  SNIPPET_HANDLE_SECRET: 'unit-handle-secret',
  UPLOAD_DIR: uploadDir,
})

const { config } = await import('../../server/config.js')
config.mongoUri = null
config.openai.apiKey = null
config.studentSignInRequired = false
const { createApp } = await import('../../server/app.js')
const { storage, resetStorage } = await import('../../server/lib/storage.js')
const { readBytes } = await import('../../server/routes/uploads.js')
resetStorage()

const app = createApp()
const server = app.listen(0)
await once(server, 'listening')
const base = `http://127.0.0.1:${server.address().port}`

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
    json = { raw: text }
  }
  return { status: res.status, body: json, text }
}

const PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg=='
const PNG = `data:image/png;base64,${PNG_BASE64}`
const pngBytes = Buffer.from(PNG_BASE64, 'base64')

/* ------------------------------------------- one snippet with a file */

/** Filled in `before`: an annotator, their file URL, and the upload behind it. */
const world = {}

before(async () => {
  assert.equal(storage().kind, 'spaces', 'the Spaces backend is the one under test')

  const admin = await call('POST', '/api/auth/bootstrap', {
    token: 'unit-token',
    body: { name: 'Root', email: 'root@example.com', password: 'correct horse battery' },
  })
  const adminToken = admin.body.token

  const activity = (
    await call('POST', '/api/activities', { token: adminToken, body: { title: 'Read path', topic: 'ratio' } })
  ).body.activity
  await call('POST', `/api/activities/${activity.id}/questions`, {
    token: adminToken,
    body: { prompt: 'Sketch it.', kind: 'Diagram', workingExpected: true },
  })
  await call('PATCH', `/api/activities/${activity.id}`, { token: adminToken, body: { status: 'published' } })

  const session = (
    await call('POST', '/api/sessions', { body: { consent: true, activityId: activity.id } })
  ).body.session
  assert.ok(session?.id, 'a session to hand work in on')

  // A photographed question of the student's own: its photo goes to Spaces.
  const own = await call('POST', `/api/sessions/${session.id}/own-questions`, {
    body: { prompt: 'From my worksheet', image: { name: 'sheet.png', dataUrl: PNG } },
  })
  assert.equal(own.status, 201, own.text)
  await call('POST', `/api/sessions/${session.id}/questions/${own.body.question.id}/messages`, {
    body: { text: 'How do I start?' },
  })

  const annotator = (
    await call('POST', '/api/users', {
      token: adminToken,
      body: { role: 'annotator', name: 'Ann', email: 'ann@example.com', password: 'correct horse battery' },
    })
  ).body.user
  const annotatorToken = (
    await call('POST', '/api/auth/login', { body: { email: 'ann@example.com', password: 'correct horse battery' } })
  ).body.token

  const snippets = (await call('GET', `/api/research/snippets?sessionId=${session.id}`, { token: adminToken })).body
    .snippets
  assert.equal(snippets.length, 1)
  await call('POST', '/api/research/snippets/assign', {
    token: adminToken,
    body: { snippetIds: [snippets[0].id], assigneeId: annotator.id },
  })

  const mine = (await call('GET', '/api/research/snippets', { token: annotatorToken })).body.snippets
  const uploadId = snippets[0].question.image.url.split('/').pop()
  const upload = await app.locals.store.uploads.findById(uploadId)

  Object.assign(world, { session, annotatorToken, fileUrl: mine[0].question.image.url, upload })
})

after(async () => {
  server.close()
  fake.close()
  await fs.rm(uploadDir, { recursive: true, force: true })
  // The store may hold an open handle (timers); nothing else to close.
})

/* ------------------------------------------------------------- tests */

test('the upload went to the fake Spaces under the session prefix, not to disk', () => {
  const { upload, session } = world
  assert.equal(upload.storage, 'spaces')
  assert.match(upload.key, new RegExp(`^dropshot/${session.id}/${upload.id}\\.png$`))
  assert.ok(objects.has(upload.key), 'the object is in the fake bucket')
  assert.ok(objects.get(upload.key).body.equals(pngBytes))
})

test('readBytes streams the object back with a signed GetObject for exactly that key', async () => {
  const { upload } = world
  const from = requests.length
  const body = await readBytes(upload)
  const chunks = []
  for await (const chunk of body) chunks.push(chunk)
  assert.ok(Buffer.concat(chunks).equals(pngBytes))

  const gets = requests.slice(from).filter((entry) => entry.method === 'GET')
  assert.equal(gets.length, 1)
  assert.equal(gets[0].key, upload.key)
  assert.ok(gets[0].signed, 'signed with SigV4')
})

test('the annotator file route returns the bytes and type, and no key', async () => {
  const { annotatorToken, fileUrl, upload, session } = world
  const from = requests.length
  const res = await fetch(`${base}${fileUrl}`, { headers: { authorization: `Bearer ${annotatorToken}` } })
  const bytes = Buffer.from(await res.arrayBuffer())

  assert.equal(res.status, 200)
  assert.ok(bytes.equals(pngBytes))
  assert.match(res.headers.get('content-type'), /^image\/png/)
  assert.equal(res.headers.get('cache-control'), 'private, no-store')
  assert.equal(res.headers.get('location'), null)
  const headers = JSON.stringify([...res.headers.entries()])
  for (const needle of [upload.key, session.id, upload.id, BUCKET]) {
    assert.ok(!headers.includes(needle), `no ${needle} in the headers`)
  }
  assert.ok(
    requests.slice(from).some((entry) => entry.method === 'GET' && entry.key === upload.key),
    'read from the fake through GetObject',
  )
})

test('a missing object is a clean 404 that names no key', async () => {
  const { annotatorToken, fileUrl, upload, session } = world
  const saved = objects.get(upload.key)
  objects.delete(upload.key)
  try {
    const got = await call('GET', fileUrl, { token: annotatorToken })
    assert.equal(got.status, 404)
    assert.equal(got.body?.error?.message, 'That file is no longer available')
    for (const needle of [upload.key, session.id, upload.id, BUCKET, 'NoSuchKey']) {
      assert.ok(!got.text.includes(needle), `no ${needle} in the answer`)
    }
  } finally {
    objects.set(upload.key, saved)
  }
})

test('an endpoint that keeps failing is the same 404, not a crash or a leak', async () => {
  const { annotatorToken, fileUrl, upload } = world
  failWith = 500
  try {
    const got = await call('GET', fileUrl, { token: annotatorToken })
    assert.equal(got.status, 404)
    assert.ok(!got.text.includes(upload.key))
    assert.ok(!got.text.includes('InternalError'))
  } finally {
    failWith = null
  }
  // And the server is still serving afterwards.
  const again = await fetch(`${base}${fileUrl}`, { headers: { authorization: `Bearer ${annotatorToken}` } })
  assert.equal(again.status, 200)
  await again.arrayBuffer()
})

test('a reader who leaves mid-file closes the read from Spaces too', async () => {
  const { annotatorToken, fileUrl, upload } = world
  const saved = objects.get(upload.key)
  // 4 MB at 16 KB per 5 ms: over a second to send, so there is a middle to leave in.
  objects.set(upload.key, { body: Buffer.alloc(4 * 1024 * 1024, 1), type: 'image/png', slow: true })
  try {
    const before = cutShort
    const controller = new AbortController()
    const res = await fetch(`${base}${fileUrl}`, {
      headers: { authorization: `Bearer ${annotatorToken}` },
      signal: controller.signal,
    })
    const reader = res.body.getReader()
    await reader.read()
    controller.abort()
    await reader.closed.catch(() => {})

    // The route has to notice the hang-up and drop its GetObject body.
    const deadline = Date.now() + 2000
    while (cutShort === before && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20))
    assert.equal(cutShort, before + 1, 'the fake saw the GetObject read abandoned')
  } finally {
    objects.set(upload.key, saved)
  }
})
