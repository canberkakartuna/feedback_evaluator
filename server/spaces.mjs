/**
 * Create the Spaces bucket and prove it works.
 *
 *   npm run setup:spaces
 *
 * Idempotent — a bucket that already exists is a success, so this is safe to
 * re-run. After creating it, the script writes a small private object, reads it
 * back through a signed URL, checks the bytes match, confirms the object is
 * **not** publicly readable, and deletes it. That last check is the one worth
 * having: a bucket that quietly allows anonymous reads would expose every
 * photograph of student work in it, and the failure is invisible from inside
 * the application.
 */
import { config } from './config.js'
import { createStorage } from './lib/storage.js'

if (!config.spaces.configured) {
  console.error(`
SPACES_KEY and SPACES_SECRET are not set.

Create a Spaces access key at
  DigitalOcean → API → Spaces Keys → Generate New Key

then put both halves in .env.local, which is gitignored:

  SPACES_KEY=...
  SPACES_SECRET=...

The bucket name, region and endpoint live in .env and are already set.
`)
  process.exit(1)
}

const files = createStorage()
const { bucket, region, endpoint } = config.spaces

console.log(`\nbucket   ${bucket}`)
console.log(`region   ${region}`)
console.log(`endpoint ${endpoint}\n`)

const result = await files.ensureBucket()
console.log(result.created ? `created "${bucket}"` : `"${bucket}" already exists`)

/* ------------------------------------------------------------- round trip */

const key = `__setup-check/${Date.now()}.txt`
const body = Buffer.from(`storage check ${new Date().toISOString()}`)

await files.put(key, body, 'text/plain')
console.log('wrote a test object')

const url = await files.signedUrl(key, { expiresIn: 60 })
const signed = await fetch(url)
const readBack = Buffer.from(await signed.arrayBuffer())

if (!readBack.equals(body)) {
  console.error('MISMATCH: what came back is not what went in')
  process.exit(1)
}
console.log('read it back through a signed URL, bytes match')

/**
 * The same object without the signature. A 403 is the correct answer and the
 * whole point of the bucket being private.
 */
const naked = `${endpoint.replace('https://', `https://${bucket}.`)}/${key}`
const anonymous = await fetch(naked)

if (anonymous.ok) {
  console.error(`
PUBLIC READ IS ENABLED — anyone with the URL can read uploads.
  ${naked}
Set the bucket to restricted in the DigitalOcean control panel before putting
student work in it.`)
  await files.remove(key)
  process.exit(1)
}
console.log(`unsigned read is refused (HTTP ${anonymous.status}) — objects are private`)

await files.remove(key)
console.log('cleaned up the test object')

console.log(`\nUploads will go to Spaces from the next server start.\n`)
