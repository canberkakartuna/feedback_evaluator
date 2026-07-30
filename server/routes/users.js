import express from 'express'
import { canManageRole, isRole, parentField } from '../../shared/roles.js'
import { requireAuth } from '../lib/auth.js'
import { hashPassword } from '../lib/password.js'
import { ApiError, badRequest, forbidden, id, notFound, now, route } from '../lib/http.js'
import { isDuplicateEmail } from '../store/errors.js'
import {
  assertCanManage,
  clearUnusedParents,
  loadInScope,
  newUser,
  publicUser,
  requireEmail,
  requireName,
  requirePassword,
  requireRoleValue,
  resolveParent,
  scopeOf,
} from '../services/users.js'

/**
 * Administering users, within the hierarchy.
 *
 * Every handler here is scoped by services/users.js rather than by its own
 * reading of the rules, and every one of them is behind `requireAuth`. What
 * "scoped" buys, concretely: a teacher asking for another teacher's student
 * gets 404, not 403 — that an id exists at all is not something one teacher
 * should learn from another's roster.
 */

/**
 * The system must not be able to lose its last way in. Deactivating, deleting
 * or demoting the only remaining active admin is refused rather than confirmed.
 *
 * The reachable case is the last admin demoting *themselves*. Acting on another
 * admin cannot trip this — the caller must be an active admin to get here, so
 * two of them exist by definition — which makes this belt-and-braces for that
 * path rather than the thing stopping it. It is cheap, and it is what would
 * catch a future bulk or self-service route that forgot to think about it.
 */
async function assertNotLastAdmin(store, target, { becoming } = {}) {
  if (target.role !== 'admin' || !target.active) return
  if (becoming === 'admin') return

  if ((await store.users.count({ role: 'admin', active: true })) <= 1) {
    throw badRequest('This is the last active admin — promote another admin first')
  }
}

/** Users who point at this one: a teacher's students, a manager's teachers. */
async function childrenOf(store, user) {
  if (user.role === 'teacher') return store.users.list({ role: 'student', teacherId: user.id })
  if (user.role === 'manager') return store.users.list({ role: 'teacher', managerId: user.id })
  return []
}

export function userRoutes(store) {
  const router = express.Router()

  router.use(requireAuth)

  /**
   * Creating a user. Who may create whom is `MANAGEABLE` in shared/roles.js;
   * where they land is `resolveParent`, which refuses a parent the caller
   * cannot reach — so a manager cannot put a student on another manager's
   * teacher's roster.
   *
   * A teacher creating a student may omit `teacherId`: themselves is the only
   * answer available to them, so it is filled in.
   */
  router.post(
    '/',
    route(async (req, res) => {
      const role = requireRoleValue(req.body)

      if (!canManageRole(req.user.role, role)) {
        throw forbidden(`A ${req.user.role} cannot create a ${role}`)
      }

      const field = parentField(role)
      const requested = field ? req.body[field] : (req.body.teacherId ?? req.body.managerId)

      const scope = await scopeOf(store, req.user)
      const parent = await resolveParent(store, req.user, role, requested, { scope })

      const doc = await newUser({
        role,
        name: requireName(req.body),
        email: requireEmail(req.body),
        password: requirePassword(req.body),
        parent,
      })

      let created
      try {
        created = await store.users.create(doc)
      } catch (error) {
        if (isDuplicateEmail(error)) throw new ApiError(409, error.message)
        throw error
      }

      await store.events.insertMany([
        {
          id: id('evt'),
          sessionId: null,
          userId: created.id,
          type: 'user_created',
          at: now(),
          payload: { role, by: req.user.id, byRole: req.user.role },
        },
      ])

      res.status(201).json({ user: publicUser(created) })
    }),
  )

  /**
   * Everyone the caller can see. A student's scope is themselves, so this is
   * their own record and not an error.
   *
   * `?role=`, `?teacherId=`, `?managerId=` and `?active=` narrow it. The scope
   * is applied as an id filter rather than trusted from the query, so a
   * `teacherId` belonging to someone else's roster returns nothing instead of
   * leaking it.
   */
  router.get(
    '/',
    route(async (req, res) => {
      const scope = await scopeOf(store, req.user)

      const query = {}

      if (req.query.role !== undefined) {
        if (!isRole(req.query.role)) throw badRequest('"role" must be a known role')
        query.role = req.query.role
      }
      if (req.query.teacherId !== undefined) query.teacherId = String(req.query.teacherId)
      if (req.query.managerId !== undefined) query.managerId = String(req.query.managerId)
      if (req.query.active !== undefined) query.active = req.query.active !== 'false'

      if (!scope.all) query.ids = [...scope.ids]

      const users = await store.users.list(query)
      res.json({ users: users.map(publicUser), scope: scope.all ? 'all' : 'assigned' })
    }),
  )

  router.get(
    '/:userId',
    route(async (req, res) => {
      const { user } = await loadInScope(store, req.user, req.params.userId)
      res.json({ user: publicUser(user) })
    }),
  )

  /**
   * Updating a user.
   *
   * `name` and `email` are yours to change about yourself. Everything else —
   * `active`, `role`, and the parent pointer — is administrative and needs
   * authority over the target, which nobody has over themselves.
   */
  router.patch(
    '/:userId',
    route(async (req, res) => {
      const { user: target, scope } = await loadInScope(store, req.user, req.params.userId)
      const isSelf = target.id === req.user.id

      // Authority over anyone but yourself is checked once, here. The
      // administrative branches below therefore only have to refuse the *self*
      // case, which is the one this check deliberately lets through.
      if (!isSelf) assertCanManage(req.user, target)

      const patch = {}

      if (req.body.name !== undefined) patch.name = requireName(req.body)
      if (req.body.email !== undefined) patch.email = requireEmail(req.body)

      if (req.body.active !== undefined) {
        if (typeof req.body.active !== 'boolean') throw badRequest('"active" must be a boolean')
        if (isSelf) throw badRequest('You cannot change your own account status')
        if (!req.body.active) await assertNotLastAdmin(store, target)
        patch.active = req.body.active
      }

      // A role change moves a user between layers, so the parent pointer has to
      // be re-decided with it — which is why the parent handling below reads the
      // incoming `role` rather than the stored one.
      const role = req.body.role === undefined ? target.role : requireRoleValue(req.body)

      if (role !== target.role) {
        if (req.user.role !== 'admin') throw forbidden('Only an admin can change a role')
        if (isSelf) throw badRequest('You cannot change your own role — ask another admin')
        await assertNotLastAdmin(store, target, { becoming: role })
        patch.role = role
        Object.assign(patch, clearUnusedParents(role))
      }

      const field = parentField(role)
      const requested = field ? req.body[field] : (req.body.teacherId ?? req.body.managerId)

      if (requested !== undefined || role !== target.role) {
        if (isSelf) throw badRequest('You cannot reassign your own place in the hierarchy')

        // On a role change with no parent named, resolveParent applies the same
        // rules a fresh user of that role would get.
        const parent = await resolveParent(store, req.user, role, requested, { scope })
        if (parent.field) patch[parent.field] = parent.value
      }

      if (!Object.keys(patch).length) throw badRequest('Nothing to update')

      patch.updatedAt = now()

      let updated
      try {
        updated = await store.users.update(target.id, patch)
      } catch (error) {
        if (isDuplicateEmail(error)) throw new ApiError(409, error.message)
        throw error
      }
      if (!updated) throw notFound('No such user')

      // A deactivated account must stop working now, not when its token expires.
      if (patch.active === false) await store.authTokens.removeByUser(target.id)

      res.json({ user: publicUser(updated) })
    }),
  )

  /**
   * Resetting someone else's password — no current password, because the point
   * is that they have lost it. Their sessions are revoked, so a reset also ends
   * whatever access the old password had already granted.
   *
   * Changing your own password is `POST /api/auth/password`, which does require
   * the current one.
   */
  router.post(
    '/:userId/password',
    route(async (req, res) => {
      const { user: target } = await loadInScope(store, req.user, req.params.userId)

      if (target.id === req.user.id) {
        throw badRequest('Use POST /api/auth/password to change your own password')
      }
      assertCanManage(req.user, target)

      const password = requirePassword(req.body, 'newPassword')

      await store.users.update(target.id, {
        passwordHash: await hashPassword(password),
        updatedAt: now(),
      })
      const revoked = await store.authTokens.removeByUser(target.id)

      res.json({ reset: true, userId: target.id, sessionsRevoked: revoked })
    }),
  )

  /**
   * Deleting a user, which is deliberately hard.
   *
   * Deactivation (`PATCH { active: false }`) is the normal way to remove
   * someone's access: it keeps their work attributable, which for a study is
   * the whole point. A delete is refused rather than cascaded whenever it would
   * destroy or orphan something:
   *
   * - **they still have people under them** — reassign the roster first, or the
   *   pointer left behind names nobody;
   * - **they have work sessions** — those are research data, and deleting a
   *   student is not consent withdrawal. `DELETE /api/sessions/:id` is;
   * - **they are the last active admin**, or they are the caller.
   */
  router.delete(
    '/:userId',
    route(async (req, res) => {
      const { user: target } = await loadInScope(store, req.user, req.params.userId)

      if (target.id === req.user.id) throw badRequest('You cannot delete your own account')
      assertCanManage(req.user, target)
      await assertNotLastAdmin(store, target)

      const children = await childrenOf(store, target)
      if (children.length) {
        throw new ApiError(
          409,
          `This ${target.role} still has ${children.length} ${target.role === 'manager' ? 'teacher' : 'student'}(s) assigned — reassign them first`,
          { children: children.map((child) => ({ id: child.id, name: child.name })) },
        )
      }

      const sessions = await store.sessions.list({ userId: target.id, limit: 1 })
      if (sessions.length) {
        throw new ApiError(
          409,
          'This user has recorded work sessions — deactivate the account instead of deleting it',
        )
      }

      await store.authTokens.removeByUser(target.id)
      await store.users.remove(target.id)

      res.json({ deleted: true, userId: target.id })
    }),
  )

  /**
   * A user's work sessions, with the same counts the researcher list reports.
   *
   * This is what the hierarchy is for: a teacher can see how their own students
   * are getting on without being given the researcher token, which reads
   * everybody's. Full transcripts stay on `/api/research/*`.
   */
  router.get(
    '/:userId/sessions',
    route(async (req, res) => {
      const { user: target } = await loadInScope(store, req.user, req.params.userId)

      const sessions = await store.sessions.list({
        userId: target.id,
        limit: Number(req.query.limit ?? 100),
      })

      const rows = await Promise.all(
        sessions.map(async (session) => {
          const [messages, answers, events] = await Promise.all([
            store.messages.listBySession(session.id),
            store.answers.listBySession(session.id),
            store.events.countBySession(session.id),
          ])

          return {
            ...session,
            counts: {
              messages: messages.length,
              answers: answers.length,
              events,
              questionsWithChat: new Set(messages.map((m) => m.questionId)).size,
            },
          }
        }),
      )

      res.json({ user: publicUser(target), sessions: rows })
    }),
  )

  return router
}
