import { createHash, randomBytes } from 'node:crypto'
import { config } from '../config.js'
import { ApiError } from './http.js'

/**
 * Login tokens, and the middleware that turns one into `req.user`.
 *
 * Two decisions worth knowing before editing this:
 *
 * - **The database never holds the token itself**, only its SHA-256. A stolen
 *   dump therefore grants nobody a session. Plain SHA-256 is the right tool
 *   here and scrypt would not be: the token is 32 random bytes, so there is no
 *   low-entropy secret to slow an attacker down over.
 * - **Authentication is optional at the door and required at the route.**
 *   `optionalAuth` attaches a user when there is a valid token and otherwise
 *   just moves on, because most of this API is deliberately anonymous — a
 *   student can work through a session without an account. `requireAuth` is
 *   what closes a route. This also keeps the researcher endpoints working: they
 *   send `Authorization: Bearer $RESEARCH_TOKEN` on the same header, which
 *   matches no user, so `req.user` stays null and their own check runs.
 */

/** Opaque, 256 bits of randomness. Shown once, at login, and never stored. */
export const newToken = () => randomBytes(32).toString('base64url')

/** The primary key the token is stored under. */
export const tokenKey = (token) => createHash('sha256').update(token).digest('hex')

export function bearerToken(req) {
  const header = req.get('authorization') ?? ''
  return header.startsWith('Bearer ') ? header.slice(7).trim() || null : null
}

export const tokenExpiry = (from = Date.now()) =>
  new Date(from + config.authTokenTtlDays * 24 * 60 * 60 * 1000).toISOString()

/**
 * Signs a user in. The plain token is returned to the caller and immediately
 * forgotten here — only its hash is written down, so there is no second copy
 * anywhere to leak.
 */
export async function issueToken(store, user) {
  const token = newToken()
  const at = new Date().toISOString()

  const record = await store.authTokens.insert({
    key: tokenKey(token),
    userId: user.id,
    createdAt: at,
    lastUsedAt: at,
    expiresAt: tokenExpiry(),
  })

  return { token, expiresAt: record.expiresAt }
}

/** How stale `lastUsedAt` may get before it is worth a write. */
const TOUCH_AFTER_MS = 60 * 60 * 1000

async function resolve(store, req) {
  const token = bearerToken(req)
  if (!token) return

  const key = tokenKey(token)
  const record = await store.authTokens.find(key)

  // An unrecognised token is not an error here — it may be the research token,
  // or a session that was revoked. requireAuth reports it if the route needs one.
  if (!record) {
    req.authError = 'Not a valid session token'
    return
  }

  if (Date.parse(record.expiresAt) <= Date.now()) {
    // Self-cleaning: an expired token is removed the next time it is presented,
    // which is why there is no sweeper job.
    await store.authTokens.remove(key)
    req.authError = 'Session has expired — sign in again'
    return
  }

  const user = await store.users.findById(record.userId)
  if (!user) {
    await store.authTokens.remove(key)
    req.authError = 'Not a valid session token'
    return
  }
  if (!user.active) {
    req.authError = 'This account has been deactivated'
    return
  }

  req.user = user
  req.authToken = record

  const lastUsed = Date.parse(record.lastUsedAt ?? record.createdAt)
  if (!(lastUsed > Date.now() - TOUCH_AFTER_MS)) {
    await store.authTokens.touch(key, new Date().toISOString())
  }
}

/** Attaches `req.user` when a valid token is present. Never refuses. */
export function optionalAuth(store) {
  return (req, res, next) => {
    resolve(store, req).then(() => next(), next)
  }
}

/** Closes a route. 401 carries the reason when there is a more specific one. */
export function requireAuth(req, res, next) {
  if (req.user) {
    next()
    return
  }
  next(new ApiError(401, req.authError ?? 'Sign in to use this endpoint'))
}

/** Closes a route to particular roles. Assumes requireAuth ran first. */
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      next(new ApiError(401, req.authError ?? 'Sign in to use this endpoint'))
      return
    }
    if (!roles.includes(req.user.role)) {
      next(new ApiError(403, `This endpoint is for: ${roles.join(', ')}`))
      return
    }
    next()
  }
}
