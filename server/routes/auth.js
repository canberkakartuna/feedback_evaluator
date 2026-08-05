import express from 'express'
import { config } from '../config.js'
import { bearerToken, issueToken, requireAuth } from '../lib/auth.js'
import { burnPassword, hashPassword, verifyPassword } from '../lib/password.js'
import { ApiError, badRequest, forbidden, id, now, route } from '../lib/http.js'
import { isDuplicateEmail } from '../store/errors.js'
import {
  hasCurrentConsent,
  newUser,
  publicUser,
  recordedConsent,
  requireEmail,
  requireName,
  requirePassword,
} from '../services/users.js'

/**
 * Signing in, signing out, and the one route that can create a user without an
 * existing one to authorise it.
 */
export function authRoutes(store) {
  const router = express.Router()

  /**
   * The first admin. Every other user is created by someone who already has an
   * account, which leaves exactly one hole to close: the empty database.
   *
   * Two conditions, both required:
   *
   * - **No user exists.** Once one does, this route is permanently closed, so
   *   it cannot be used to add a second admin later.
   * - **The bootstrap token matches**, when one is configured. Without this an
   *   empty database is a race whoever calls first wins. `config.bootstrapToken`
   *   falls back to RESEARCH_TOKEN; a deployment must have one, and
   *   `GET /api/health` warns while it does not.
   */
  router.post(
    '/bootstrap',
    route(async (req, res) => {
      if ((await store.users.count()) > 0) {
        throw forbidden('An account already exists — bootstrap is closed. Ask an admin to add you.')
      }

      if (config.bootstrapToken && bearerToken(req) !== config.bootstrapToken) {
        throw forbidden('Bootstrap requires the bootstrap token')
      }

      const user = await newUser({
        role: 'admin',
        name: requireName(req.body),
        email: requireEmail(req.body),
        password: requirePassword(req.body),
      })

      let created
      try {
        created = await store.users.create(user)
      } catch (error) {
        // Two callers racing an empty database: the loser sees a 409, not a 500.
        if (isDuplicateEmail(error)) throw new ApiError(409, error.message)
        throw error
      }

      const { token, expiresAt } = await issueToken(store, created)

      res.status(201).json({ user: publicUser(created), token, expiresAt })
    }),
  )

  /**
   * A wrong password and an unknown address answer the same way, and take the
   * same time to do it — `burnPassword` does the work a real verify would, so
   * the endpoint cannot be used to find out who has an account.
   */
  router.post(
    '/login',
    route(async (req, res) => {
      const email = requireEmail(req.body)
      const password = req.body?.password

      if (typeof password !== 'string' || !password) {
        throw badRequest('"password" must be a non-empty string')
      }

      const user = await store.users.findByEmail(email)

      if (!user) {
        await burnPassword(password)
        throw new ApiError(401, 'Email or password is incorrect')
      }

      if (!(await verifyPassword(password, user.passwordHash))) {
        throw new ApiError(401, 'Email or password is incorrect')
      }

      // Checked after the password, so a deactivated account is not detectable
      // without its credentials.
      if (!user.active) throw forbidden('This account has been deactivated')

      const { token, expiresAt } = await issueToken(store, user)
      const signedIn = await store.users.update(user.id, { lastLoginAt: now() })

      await store.events.insertMany([
        {
          id: id('evt'),
          sessionId: null,
          userId: user.id,
          type: 'user_signed_in',
          at: now(),
          payload: { role: user.role },
        },
      ])

      res.json({ user: publicUser(signedIn ?? user), token, expiresAt })
    }),
  )

  router.get(
    '/me',
    requireAuth,
    route(async (req, res) => {
      res.json({ user: publicUser(req.user) })
    }),
  )

  /**
   * "I have read the research notice and I agree to it", against the account.
   *
   * Idempotent, and it carries no body: the only thing being recorded is that
   * this person agreed, and to which version of the wording — both of which the
   * server already knows. Sending a payload would invite a client to claim a
   * date or a version it does not own.
   *
   * A repeat call on a still-current consent is a no-op rather than a new
   * timestamp, so "when did they first agree?" survives a reload. Once
   * `CONSENT_VERSION` moves, the same call records the new version, which is how
   * re-consenting to changed wording works.
   *
   * There is no matching route to *withdraw* here, and that is deliberate:
   * withdrawal deletes the work rather than editing a flag, and it lives at
   * `DELETE /api/sessions/:id` where the student actually is.
   */
  router.post(
    '/consent',
    requireAuth,
    route(async (req, res) => {
      if (hasCurrentConsent(req.user)) {
        return res.json({ user: publicUser(req.user), recorded: false })
      }

      const updated = await store.users.update(req.user.id, {
        consent: recordedConsent(),
        updatedAt: now(),
      })

      await store.events.insertMany([
        {
          id: id('evt'),
          sessionId: null,
          userId: req.user.id,
          type: 'consent_recorded',
          at: now(),
          payload: { version: config.consentVersion },
        },
      ])

      res.json({ user: publicUser(updated), recorded: true })
    }),
  )

  /** Revokes the token that made the call. Other devices stay signed in. */
  router.post(
    '/logout',
    requireAuth,
    route(async (req, res) => {
      await store.authTokens.remove(req.authToken.key)
      res.json({ signedOut: true })
    }),
  )

  /**
   * Changing your own password. The current one is required even though the
   * caller is already authenticated — that is what stops a borrowed tab from
   * turning into a permanent takeover.
   *
   * Every other token is revoked, this one included, so a change is a sign-out
   * everywhere; a fresh token comes back so the caller does not have to log in
   * again.
   */
  router.post(
    '/password',
    requireAuth,
    route(async (req, res) => {
      const current = req.body?.currentPassword
      if (typeof current !== 'string' || !current) {
        throw badRequest('"currentPassword" must be a non-empty string')
      }

      const next = requirePassword(req.body, 'newPassword')

      if (!(await verifyPassword(current, req.user.passwordHash))) {
        throw forbidden('Current password is incorrect')
      }

      await store.users.update(req.user.id, {
        passwordHash: await hashPassword(next),
        updatedAt: now(),
      })

      await store.authTokens.removeByUser(req.user.id)
      const { token, expiresAt } = await issueToken(store, req.user)

      res.json({ changed: true, token, expiresAt })
    }),
  )

  return router
}
