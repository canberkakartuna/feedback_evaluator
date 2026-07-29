import express from 'express'
import fs from 'node:fs/promises'
import path from 'node:path'
import { config } from '../config.js'
import { badRequest, id, notFound, now, route } from '../lib/http.js'

const EXTENSIONS = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'application/pdf': 'pdf',
}

/** Photographed working and whiteboard exports both arrive as data URLs. */
function decodeDataUrl(value) {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(value ?? '')
  if (!match) throw badRequest('"dataUrl" must be a base64 data URL')

  const [, type, base64] = match
  if (!EXTENSIONS[type]) {
    throw badRequest(`Unsupported type "${type}". Send a JPG, PNG, WebP, HEIC or PDF.`)
  }

  const bytes = Buffer.from(base64, 'base64')
  if (!bytes.length) throw badRequest('Attachment is empty')
  if (bytes.length > config.maxUploadBytes) {
    throw badRequest(
      `Attachment is ${(bytes.length / 1024 / 1024).toFixed(1)} MB; the limit is ${(config.maxUploadBytes / 1024 / 1024).toFixed(0)} MB.`,
    )
  }

  return { type, bytes }
}

export function uploadRoutes(store, { resolveQuestion }) {
  const router = express.Router()

  router.post(
    '/:sessionId/questions/:questionId/uploads',
    route(async (req, res) => {
      const { session, question } = await resolveQuestion(req)

      const source = req.body.source === 'whiteboard' ? 'whiteboard' : 'file'
      const { type, bytes } = decodeDataUrl(req.body.dataUrl)
      const name =
        typeof req.body.name === 'string' && req.body.name.trim()
          ? path.basename(req.body.name).slice(0, 200)
          : `upload.${EXTENSIONS[type]}`

      const uploadId = id('upl')
      const dir = path.join(config.uploadDir, session.id)
      await fs.mkdir(dir, { recursive: true })
      const filePath = path.join(dir, `${uploadId}.${EXTENSIONS[type]}`)
      await fs.writeFile(filePath, bytes)

      const upload = await store.uploads.insert({
        id: uploadId,
        sessionId: session.id,
        questionId: question.id,
        name,
        type,
        size: bytes.length,
        source,
        path: filePath,
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
          payload: { uploadId: upload.id, source, type, size: upload.size },
        },
      ])

      res.status(201).json({ upload: { ...upload, path: undefined }, answer })
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

      await fs.rm(upload.path, { force: true })
      res.json({ deleted: true, answer })
    }),
  )

  return router
}

/** Serving the bytes back. Public by id, which is unguessable. */
export function uploadFileRoutes(store) {
  const router = express.Router()

  router.get(
    '/:uploadId',
    route(async (req, res) => {
      const upload = await store.uploads.findById(req.params.uploadId)
      if (!upload) throw notFound('No such upload')

      res.type(upload.type)
      res.setHeader('Content-Disposition', `inline; filename="${upload.name}"`)
      res.sendFile(upload.path)
    }),
  )

  return router
}
