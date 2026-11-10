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

  /**
   * Replies are a list, appended to — a second answer adds to the first rather
   * than replacing it. The writer adds to the same list (`fromWriter: true`)
   * when they answer back in the thread, rather than opening a new message
   * (design doc). "Unread" is a staff reply newer than `repliesSeenAt`, the
   * moment the writer last loaded their list (see /mine/seen) — the writer's
   * own follow-ups never count as unread for them.
   */
  const unread = (message) => {
    const last = message.replies?.findLast((reply) => !reply.fromWriter)?.at
    return Boolean(last && (!message.repliesSeenAt || last > message.repliesSeenAt))
  }

  /** What the writer sees: who answered and when, but no staff ids. */
  const forWriter = ({ teacherId: _teacherId, replies = [], ...message }) => ({
    ...message,
    replies: replies.map(({ byId: _byId, ...reply }) => reply),
    unread: unread({ ...message, replies }),
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
        replies: [],
        repliesSeenAt: null,
        createdAt: now(),
      })

      res.status(201).json({ message: forWriter(message) })
    }),
  )

  /**
   * Your own messages, newest first, with any replies. `asOf` is when this
   * list was read; sending it back to /mine/seen marks read exactly what was
   * shown, and nothing that arrived after.
   */
  router.get(
    '/mine',
    requireAuth,
    route(async (req, res) => {
      const asOf = now()
      const messages = await store.support.list({ userId: req.user.id })
      res.json({ messages: messages.map(forWriter), asOf })
    }),
  )

  /**
   * Read receipts, so the navbar dot goes out once replies are read. Only
   * `repliesSeenAt` is written — never the replies — so a reply posted in the
   * meantime can be neither lost nor marked read unseen.
   */
  router.post(
    '/mine/seen',
    requireAuth,
    route(async (req, res) => {
      const asOf = req.body?.asOf
      if (typeof asOf !== 'string' || !Number.isFinite(Date.parse(asOf))) {
        throw badRequest('"asOf" must be the timestamp /mine returned')
      }
      // Never later than now: a client cannot mark future replies read.
      const through = asOf < now() ? asOf : now()
      const messages = await store.support.list({ userId: req.user.id })
      const toMark = messages.filter(
        (message) => message.replies?.length && (!message.repliesSeenAt || message.repliesSeenAt < through),
      )
      await Promise.all(toMark.map((message) => store.support.update(message.id, { repliesSeenAt: through })))
      res.json({ seen: toMark.filter(unread).length })
    }),
  )

  /**
   * The writer answering back in their own thread (design doc): the same
   * conversation continues instead of a new message per follow-up. A
   * different topic is still a new message, through POST /.
   */
  router.post(
    '/mine/:messageId/reply',
    requireAuth,
    route(async (req, res) => {
      const message = await store.support.findById(req.params.messageId)
      // Someone else's message is reported as missing, not forbidden: whether
      // an id exists is not the writer's business.
      if (!message || message.userId !== req.user.id) throw notFound('No such message')

      const text = requireString(req.body, 'text', { max: 5000 }).trim()
      if (!text) throw badRequest('Write a reply first')

      const updated = await store.support.addReply(message.id, {
        text,
        at: now(),
        byId: req.user.id,
        byName: req.user.name,
        fromWriter: true,
      })
      res.json({ message: forWriter(updated) })
    }),
  )

  router.get(
    '/unread',
    requireAuth,
    route(async (req, res) => {
      const messages = await store.support.list({ userId: req.user.id })
      res.json({ unread: messages.filter(unread).length })
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

      // Appended, so an earlier answer is kept (and the writer sees both).
      const updated = await store.support.addReply(message.id, {
        text,
        at: now(),
        byId: req.user.id,
        byName: req.user.name,
      })
      res.json({ message: updated })
    }),
  )

  return router
}
