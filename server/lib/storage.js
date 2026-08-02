import fs from 'node:fs/promises'
import path from 'node:path'
import { createReadStream } from 'node:fs'
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { config } from '../config.js'

/**
 * Where uploaded bytes live.
 *
 * Same shape as store/index.js: two backends, one interface, and exactly one
 * place that decides which is in use. Set `SPACES_KEY` and `SPACES_SECRET` and
 * files go to DigitalOcean Spaces; leave them unset and they go to local disk.
 * routes/uploads.js cannot tell the difference.
 *
 * **Objects are private.** This is student work photographed off a desk —
 * handwriting, sometimes a whole exercise book — collected under a consent
 * notice that promises it is used for research. A public-read bucket would put
 * all of it behind a guessable URL with no account and no audit. So the bucket
 * is created private, every object is written private, and reads go out as a
 * short-lived signed URL that the API mints per request.
 *
 * Spaces is S3-compatible, which is why this is the AWS SDK pointed at a
 * different endpoint rather than a DigitalOcean-specific client.
 */

/** `sessionId/uploadId.ext` — one prefix per session, so a purge is one delete. */
export const objectKey = (sessionId, uploadId, extension) =>
  `${sessionId}/${uploadId}.${extension}`

/* ------------------------------------------------------------------ local disk */

function diskBackend() {
  const pathFor = (key) => path.join(config.uploadDir, key)

  return {
    kind: 'disk',
    location: config.uploadDir,

    async put(key, bytes) {
      const target = pathFor(key)
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.writeFile(target, bytes)
      return { key, path: target }
    },

    async remove(key) {
      await fs.rm(pathFor(key), { force: true })
    },

    /**
     * Disk has no signed URLs, so the caller streams it instead. Returning
     * `null` rather than throwing is what tells routes/uploads.js which of the
     * two paths to take.
     */
    async signedUrl() {
      return null
    },

    stream(key) {
      return createReadStream(pathFor(key))
    },

    async check() {
      await fs.mkdir(config.uploadDir, { recursive: true })
      return { ok: true, error: null }
    },
  }
}

/* --------------------------------------------------------------------- spaces */

function spacesBackend() {
  const client = new S3Client({
    // Spaces ignores the region for routing — the endpoint decides that — but
    // the SDK requires one for request signing.
    region: config.spaces.region,
    endpoint: config.spaces.endpoint,
    forcePathStyle: false,
    credentials: {
      accessKeyId: config.spaces.key,
      secretAccessKey: config.spaces.secret,
    },
  })

  const Bucket = config.spaces.bucket

  return {
    kind: 'spaces',
    location: `${Bucket} @ ${config.spaces.endpoint}`,
    client,
    bucket: Bucket,

    async put(key, bytes, contentType) {
      await client.send(
        new PutObjectCommand({
          Bucket,
          Key: key,
          Body: bytes,
          ContentType: contentType,
          // Explicit, not inherited from the bucket: a bucket that is made
          // public later must not retroactively expose everything in it.
          ACL: 'private',
        }),
      )
      return { key, path: null }
    },

    async remove(key) {
      await client.send(new DeleteObjectCommand({ Bucket, Key: key }))
    },

    /**
     * A URL that works for `expiresIn` seconds and then does not.
     *
     * Long enough for a browser to load an image on a page the student is
     * already looking at, short enough that a copied link is not a permanent
     * back door into somebody's coursework.
     */
    async signedUrl(key, { expiresIn = 300, filename } = {}) {
      return getSignedUrl(
        client,
        new GetObjectCommand({
          Bucket,
          Key: key,
          ...(filename
            ? { ResponseContentDisposition: `inline; filename="${filename}"` }
            : {}),
        }),
        { expiresIn },
      )
    },

    stream() {
      throw new Error('Spaces reads go through a signed URL, not a stream')
    },

    async check() {
      try {
        await client.send(new HeadBucketCommand({ Bucket }))
        return { ok: true, error: null }
      } catch (error) {
        return { ok: false, error: error.message }
      }
    },

    /** Idempotent: an existing bucket you own is a success, not a failure. */
    async ensureBucket() {
      try {
        await client.send(new HeadBucketCommand({ Bucket }))
        return { created: false, existed: true }
      } catch (error) {
        const status = error?.$metadata?.httpStatusCode
        if (status !== 404 && status !== 403) throw error
        if (status === 403) {
          throw new Error(
            `Bucket "${Bucket}" exists but this key cannot reach it. Check the key's permissions, or that the name is not taken by another account.`,
          )
        }
      }

      await client.send(new CreateBucketCommand({ Bucket, ACL: 'private' }))
      return { created: true, existed: false }
    },
  }
}

/* ---------------------------------------------------------------------- pick */

export function createStorage() {
  return config.spaces.configured ? spacesBackend() : diskBackend()
}

/** One per process, like the Mongo pool. */
let shared = null
export function storage() {
  if (!shared) shared = createStorage()
  return shared
}

/** For the smoke test, which switches backends after config is patched. */
export function resetStorage() {
  shared = null
}
