import express from 'express'
import { isStaff } from '../../shared/roles.js'
import { SUPPORT_CATEGORIES } from '../../shared/support.js'
import { requireAuth, requireRole } from '../lib/auth.js'
import { badRequest, forbidden, id, notFound, now, requireString, route } from '../lib/http.js'

/**
 * The support / suggestion channel (3 Nov 2026 doc).
 *
 * Anyone signed in writes a message under a category — support or suggestion —
 * with a title, and reads the reply on their own support page the next time
 * they come in. Staff read an inbox, filtered by category, and reply.
 *
 * Who reads whose: a teacher answers their own students (`teacherId` is copied
 * onto the message when it is written, so a later reassignment does not move
 * old threads); a manager or an admin reads everything, which is also where a
 * teacher's own messages land.
 */
export function supportRoutes(store) {
  const router = express.Router()

  /** What the writer sees: no staff ids, just who answered. */
  const forWriter = (message) => ({
    ...message,
    unread: Boolean(message.reply && !message.reply.seenAt),
  })

  const inScope = (actor, message) =>
    actor.role === 'admin' || actor.role === 'manager' || message.teacherId === actor.id

  router.post(
    '/',
    requireAuth,
    route(async (req, res) => {
      const category = req.body?.category
      if (!SUPPORT_CATEGORIES.includes(category)) {
        throw badRequest(`"category" must be one of: ${SUPPORT_CATEGORIES.join(', ')}`)
      }
      const subject = requireString(req.body, 'subject', { max: 160 }).trim()
      const body = requireString(req.body, 'body', { max: 5000 }).trim()
      if (!subject || !body) throw badRequest('A title and a message are both needed')

      const message = await store.support.insert({
        id: id('sup'),
        userId: req.user.id,
        userName: req.user.name,
        role: req.user.role,
        // Staff messages go to the managers and admins; a student's to their teacher.
        teacherId: isStaff(req.user.role) ? null : (req.user.teacherId ?? null),
        category,
        subject,
        body,
        reply: null,
        createdAt: now(),
      })

      res.status(201).json({ message: forWriter(message) })
    }),
  )

  /** Your own messages, newest first, with any replies. */
  router.get(
    '/mine',
    requireAuth,
    route(async (req, res) => {
      const messages = await store.support.list({ userId: req.user.id })
      res.json({ messages: messages.map(forWriter) })
    }),
  )

  /** Read receipts for replies, so the navbar dot goes out once they are read. */
  router.post(
    '/mine/seen',
    requireAuth,
    route(async (req, res) => {
      const messages = await store.support.list({ userId: req.user.id })
      const at = now()
      const unseen = messages.filter((message) => message.reply && !message.reply.seenAt)
      await Promise.all(
        unseen.map((message) =>
          store.support.update(message.id, { reply: { ...message.reply, seenAt: at } }),
        ),
      )
      res.json({ seen: unseen.length })
    }),
  )

  router.get(
    '/unread',
    requireAuth,
    route(async (req, res) => {
      const messages = await store.support.list({ userId: req.user.id })
      res.json({ unread: messages.filter((message) => message.reply && !message.reply.seenAt).length })
    }),
  )

  /** The staff inbox, optionally one category. */
  router.get(
    '/',
    requireAuth,
    requireRole('teacher', 'manager', 'admin'),
    route(async (req, res) => {
      const category = req.query.category
      if (category !== undefined && !SUPPORT_CATEGORIES.includes(category)) {
        throw badRequest(`"category" must be one of: ${SUPPORT_CATEGORIES.join(', ')}`)
      }
      const filter = { category }
      if (req.user.role === 'teacher') filter.teacherId = req.user.id
      res.json({ messages: await store.support.list(filter) })
    }),
  )

  router.post(
    '/:messageId/reply',
    requireAuth,
    requireRole('teacher', 'manager', 'admin'),
    route(async (req, res) => {
      const message = await store.support.findById(req.params.messageId)
      if (!message) throw notFound('No such message')
      if (!inScope(req.user, message)) throw forbidden('This message is not in your inbox')

      const text = requireString(req.body, 'text', { max: 5000 }).trim()
      if (!text) throw badRequest('Write a reply first')

      const updated = await store.support.update(message.id, {
        reply: { text, at: now(), byId: req.user.id, byName: req.user.name, seenAt: null },
      })
      res.json({ message: updated })
    }),
  )

  return router
}
