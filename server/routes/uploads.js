import express from 'express'
import { config } from '../config.js'
import { objectKey, storage } from '../lib/storage.js'
import { EXTENSIONS, decodeDataUrl, safeName } from '../lib/attachments.js'
import { id, notFound, now, route } from '../lib/http.js'

export function uploadRoutes(store, { resolveQuestion }) {
  const router = express.Router()

  router.post(
    '/:sessionId/questions/:questionId/uploads',
    route(async (req, res) => {
      const { session, question } = await resolveQuestion(req)

      const source = req.body.source === 'whiteboard' ? 'whiteboard' : 'file'
      const { type, bytes } = decodeDataUrl(req.body.dataUrl)
      const name = safeName(req.body.name, type)

      const uploadId = id('upl')
      const files = storage()
      const key = objectKey(session.id, uploadId, EXTENSIONS[type])
      const written = await files.put(key, bytes, type)

      const upload = await store.uploads.insert({
        id: uploadId,
        sessionId: session.id,
        questionId: question.id,
        name,
        type,
        size: bytes.length,
        source,
        /**
         * Both recorded, and both may be null depending on the backend: `key`
         * on Spaces, `path` on disk. Storing which one it went to is what lets
         * a deployment that switches backends still read what came before,
         * rather than losing every file written under the old one.
         */
        storage: files.kind,
        key,
        path: written.path,
        url: `/api/uploads/${uploadId}`,
        createdAt: now(),
      })

      /** A board replaces its previous export rather than stacking copies. */
      const stored = await store.answers.find(session.id, question.id)
      const kept = (stored?.attachments ?? []).filter((item) =>
        source === 'whiteboard' ? item.source !== 'whiteboard' : true,
      )

      const answer = await store.answers.upsert(session.id, question.id, {
        attachments: [
          ...kept,
          { id: upload.id, name, type, size: upload.size, source, url: upload.url },
        ],
      })

      await store.events.insertMany([
        {
          id: id('evt'),
          sessionId: session.id,
          questionId: question.id,
          type: 'student_uploaded_image',
          at: now(),
          payload: { uploadId: upload.id, source, type, size: upload.size, storage: files.kind },
        },
      ])

      // `path` and `key` are internal placement, not the client's business.
      res.status(201).json({ upload: { ...upload, path: undefined, key: undefined }, answer })
    }),
  )

  router.delete(
    '/:sessionId/questions/:questionId/uploads/:uploadId',
    route(async (req, res) => {
      const { session, question } = await resolveQuestion(req)
      const upload = await store.uploads.findById(req.params.uploadId)
      if (!upload || upload.sessionId !== session.id) throw notFound('No such upload')

      const stored = await store.answers.find(session.id, question.id)
      const answer = await store.answers.upsert(session.id, question.id, {
        attachments: (stored?.attachments ?? []).filter((item) => item.id !== upload.id),
      })

      await removeBytes(upload)
      res.json({ deleted: true, answer })
    }),
  )

  return router
}

/**
 * Deleting the bytes behind an upload, whichever backend they went to.
 *
 * Exported because withdrawal — `DELETE /api/sessions/:id` — has to remove
 * every file in a session too, or "delete my session" is a lie. Failing to
 * unlink one file is logged rather than thrown: the records are already gone
 * by then, and turning that into a 500 would tell the student their withdrawal
 * failed when almost all of it succeeded.
 */
export async function removeBytes(upload) {
  const files = storage()

  try {
    if (upload.key && files.kind === upload.storage) {
      await files.remove(upload.key)
      return true
    }

    // Written under a different backend than the one running now — fall back to
    // whatever placement was recorded at the time.
    if (upload.path) {
      const fs = await import('node:fs/promises')
      await fs.rm(upload.path, { force: true })
      return true
    }
  } catch (error) {
    console.error(`[api] could not delete upload ${upload.id}: ${error.message}`)
    return false
  }

  return false
}

/**
 * Serving the bytes back. Public by id, which is unguessable.
 *
 * On Spaces the object itself is private, so this hands out a short-lived
 * signed URL and redirects to it rather than proxying the bytes through the
 * function — a 10 MB photo streamed through a serverless invocation is paid
 * for twice and slower both times. On disk there is no such thing, so the file
 * is streamed directly.
 */
export function uploadFileRoutes(store) {
  const router = express.Router()

  router.get(
    '/:uploadId',
    route(async (req, res) => {
      const upload = await store.uploads.findById(req.params.uploadId)
      if (!upload) throw notFound('No such upload')

      const files = storage()

      if (files.kind === 'spaces' && upload.key && upload.storage === 'spaces') {
        const url = await files.signedUrl(upload.key, {
          expiresIn: config.spaces.urlTtl,
          filename: upload.name,
        })
        // 302, not 301: the URL expires, so nothing about this may be cached.
        res.redirect(302, url)
        return
      }

      if (!upload.path) throw notFound('That file is no longer available')

      res.type(upload.type)
      res.setHeader('Content-Disposition', `inline; filename="${upload.name}"`)

      /**
       * `dotfiles: 'allow'` is load-bearing, not a loosening.
       *
       * The default upload directory is `server/.uploads`, and `send` refuses
       * any path with a dot-prefixed segment unless told otherwise — so with
       * the default configuration every locally stored file 404s inside
       * sendFile and surfaces as a 500. The path here is not user input: it is
       * read from the upload record, which the server wrote from an id it
       * minted itself, so there is no traversal to defend against.
       */
      res.sendFile(upload.path, { dotfiles: 'allow' }, (error) => {
        if (!error) return
        // The record exists but the bytes do not — a disk-backed file after an
        // instance recycled, most often. 404 is the honest answer, and it must
        // not be a 500 with a stack trace.
        if (!res.headersSent) {
          res.status(404).json({ error: { message: 'That file is no longer available' } })
        }
      })
    }),
  )

  return router
}
