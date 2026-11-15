import express from 'express'
import { isStaff } from '../../shared/roles.js'
import { SUPPORT_CATEGORIES } from '../../shared/support.js'
import { requireAuth, requireRole } from '../lib/auth.js'
import { badRequest, forbidden, id, notFound, now, requireString, route } from '../lib/http.js'
import { scopeOf } from '../services/users.js'

/**
 * The support / suggestion channel (3 Nov 2026 doc).
 *
 * Anyone signed in writes a message under a category — support or suggestion —
 * with a title, and reads the reply on their own support page the next time
 * they come in. Staff read an inbox, filtered by category, and reply.
 *
 * Who reads whose: a teacher answers their own students (`teacherId` is copied
 * onto the message when it is written, so a later reassignment does not move
 * old threads); a manager reads their own branch — messages filed with one of
 * their teachers, and anything written by someone in their scope, which is
 * where their teachers' own messages land; an admin reads everything,
 * including what belongs to no branch (an annotator's, an unassigned
 * student's, another manager's). An annotator writes in like anyone else but
 * has no inbox.
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

  /**
   * `null` for an admin (everything), otherwise the ids that put a message in
   * this caller's inbox. A manager's is computed from the same hierarchy as
   * every other scope (services/users.js), so moving a teacher between
   * managers moves their inbox with them.
   */
  async function inboxScope(actor) {
    if (actor.role === 'admin') return null
    if (actor.role === 'manager') {
      const scope = await scopeOf(store, actor)
      return { teacherIds: scope.teacherIds, userIds: [...scope.ids] }
    }
    return { teacherIds: [actor.id], userIds: [] }
  }

  const inScope = (scope, message) =>
    scope === null ||
    scope.teacherIds.includes(message.teacherId) ||
    scope.userIds.includes(message.userId)

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
      const scope = await inboxScope(req.user)
      if (scope === null) {
        res.json({ messages: await store.support.list({ category }) })
        return
      }

      // Two reads rather than one `$or`, so neither store needs a new filter:
      // filed with one of their teachers, or written by someone in their scope.
      // A message can match both, so it is de-duplicated before sorting.
      const [filed, written] = await Promise.all([
        store.support.list({ category, teacherId: scope.teacherIds }),
        scope.userIds.length ? store.support.list({ category, userId: scope.userIds }) : [],
      ])
      const messages = [...new Map([...filed, ...written].map((m) => [m.id, m])).values()].sort(
        (a, b) => b.createdAt.localeCompare(a.createdAt),
      )
      res.json({ messages })
    }),
  )

  router.post(
    '/:messageId/reply',
    requireAuth,
    requireRole('teacher', 'manager', 'admin'),
    route(async (req, res) => {
      const message = await store.support.findById(req.params.messageId)
      if (!message) throw notFound('No such message')
      if (!inScope(await inboxScope(req.user), message)) {
        throw forbidden('This message is not in your inbox')
      }

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
