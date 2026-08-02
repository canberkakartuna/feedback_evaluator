/**
 * Check that uploads can reach Spaces, and that what lands there is private.
 *
 *   npm run setup:spaces
 *
 * Does **not** create the bucket. `mezqr-bucket` is shared with another
 * application and already exists; this writes under the `dropshot/` prefix and
 * touches nothing else in it.
 *
 * The privacy check is the point of the script. The bucket is publicly
 * listable, which means anyone can enumerate object names in it — so the only
 * thing standing between a photograph of a student's exercise book and the open
 * internet is the per-object `private` ACL. That is worth verifying on every
 * run rather than assuming, because it is silent when it is wrong.
 */
import { config } from './config.js'
import { createStorage } from './lib/storage.js'

if (!config.spaces.configured) {
  console.error(`
SPACES_KEY and SPACES_SECRET are not set, so uploads are going to local disk.

Create a Spaces access key at
  DigitalOcean → API → Spaces Keys → Generate New Key

then put both halves in .env.local, which is gitignored:

  SPACES_KEY=...
  SPACES_SECRET=...

The bucket and folder live in .env and are already set.
`)
  process.exit(1)
}

const files = createStorage()
const { bucket, prefix, endpoint } = config.spaces

console.log(`\nbucket   ${bucket}`)
console.log(`folder   ${prefix}/`)
console.log(`endpoint ${endpoint}\n`)

await files.requireBucket()
console.log(`reached "${bucket}"`)

/* ------------------------------------------------------------- round trip */

const key = `${prefix}/__setup-check/${Date.now()}.txt`
const body = Buffer.from(`storage check ${new Date().toISOString()}`)

await files.put(key, body, 'text/plain')
console.log(`wrote ${key}`)

const url = await files.signedUrl(key, { expiresIn: 60 })
const signed = await fetch(url)
const readBack = Buffer.from(await signed.arrayBuffer())

if (!readBack.equals(body)) {
  console.error('MISMATCH: what came back is not what went in')
  process.exit(1)
}
console.log('read it back through a signed URL, bytes match')

/**
 * The same object with no signature. A 403 is the correct answer, and the only
 * thing keeping student uploads out of public view in a bucket that anyone can
 * list. If this ever returns 200, stop and fix the bucket before collecting
 * anything real.
 */
const naked = `${endpoint.replace('https://', `https://${bucket}.`)}/${key}`
const anonymous = await fetch(naked)

await files.remove(key)

if (anonymous.ok) {
  console.error(`
PUBLIC READ IS ENABLED — anyone with the URL can read uploads:
  ${naked}

This bucket is shared and its listing is public, so object names are
discoverable too. Do not collect student work until objects are private.`)
  process.exit(1)
}

console.log(`unsigned read refused (HTTP ${anonymous.status}) — objects are private`)
console.log('cleaned up the test object')
console.log(`\nUploads go to ${bucket}/${prefix}/ from the next server start.\n`)
