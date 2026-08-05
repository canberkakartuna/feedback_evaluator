import {
  PARENT_FIELDS,
  canManageRole,
  isRole,
  parentField,
  parentRole,
} from '../../shared/roles.js'
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, hashPassword } from '../lib/password.js'
import { config } from '../config.js'
import { badRequest, forbidden, id, notFound, now } from '../lib/http.js'

/**
 * Who can see and touch whom.
 *
 * The rules live here, in one place, rather than at the top of each handler,
 * because "a teacher may only read their own students" is the kind of rule that
 * is wrong the moment it exists in two versions. routes/users.js and
 * routes/sessions.js both go through `scopeOf` / `assertCanRead` /
 * `assertCanManage`.
 *
 * Scope is derived by walking the parent pointers described in shared/roles.js:
 *
 *   admin    everyone
 *   manager  self + teachers whose managerId is them + those teachers' students
 *   teacher  self + students whose teacherId is them
 *   student  self
 */

/**
 * Consent, recorded against the account rather than only against the session.
 *
 * A student with an account is asked the research question **once**: they read
 * the notice, agree, and it is remembered — where an anonymous student is asked
 * every visit, because there is nothing to remember it against. Both still
 * produce a consent record on every session, so the per-session audit trail is
 * unchanged; this is what stops a returning student re-reading the same page
 * every lesson.
 *
 * The version is checked rather than the flag alone. `CONSENT_VERSION` is bumped
 * when the wording changes, and an agreement to last term's wording is not an
 * agreement to this term's — so a bump asks everybody again, which is the whole
 * reason the field exists.
 */
export const hasCurrentConsent = (user) =>
  Boolean(user?.consent?.given && user.consent.version === config.consentVersion)

export function recordedConsent() {
  return { given: true, at: now(), version: config.consentVersion }
}

/**
 * The hash never leaves the server, on any path.
 *
 * `consented` is derived rather than stored: the client needs one boolean to
 * decide whether to show the notice, and deciding it here keeps the version
 * comparison on the side that owns the version.
 */
export function publicUser(user) {
  if (!user) return null
  const { passwordHash: _passwordHash, ...rest } = user
  return { ...rest, consented: hasCurrentConsent(user) }
}

/**
 * `{ all: true }` for an admin, `{ ids: Set }` for everyone else.
 *
 * The admin case is a flag rather than a set of every id in the system: it is
 * the one scope that has no reason to be enumerated, and enumerating it would
 * put an unbounded read in front of every request.
 */
export async function scopeOf(store, actor) {
  if (actor.role === 'admin') return { all: true, teacherIds: null }

  if (actor.role === 'manager') {
    const teachers = await store.users.list({ role: 'teacher', managerId: actor.id })
    const teacherIds = teachers.map((teacher) => teacher.id)

    const students = teacherIds.length
      ? await store.users.list({ role: 'student', teacherId: teacherIds })
      : []

    return {
      all: false,
      teacherIds,
      ids: new Set([actor.id, ...teacherIds, ...students.map((student) => student.id)]),
    }
  }

  if (actor.role === 'teacher') {
    const students = await store.users.list({ role: 'student', teacherId: actor.id })
    return {
      all: false,
      teacherIds: [actor.id],
      ids: new Set([actor.id, ...students.map((student) => student.id)]),
    }
  }

  return { all: false, teacherIds: [], ids: new Set([actor.id]) }
}

export const inScope = (scope, userId) => scope.all || scope.ids.has(userId)

/**
 * Reading someone. Out of scope is reported as 404 rather than 403: whether a
 * given id exists is itself information a teacher has no business getting from
 * another teacher's roster.
 */
export async function loadInScope(store, actor, userId) {
  const scope = await scopeOf(store, actor)
  const user = await store.users.findById(userId)
  if (!user || !inScope(scope, user.id)) throw notFound('No such user')
  return { user, scope }
}

/**
 * Acting on someone. Reachable and outranked are both required — a manager can
 * read their own record but not administer themselves, and a teacher can see a
 * peer's student through neither test.
 */
export function assertCanManage(actor, target) {
  if (!canManageRole(actor.role, target.role)) {
    throw forbidden(`A ${actor.role} cannot administer a ${target.role}`)
  }
}

/* ---------------------------------------------------------------- validation */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function requireEmail(body, field = 'email') {
  const value = body?.[field]
  if (typeof value !== 'string' || !EMAIL.test(value.trim())) {
    throw badRequest(`"${field}" must be an email address`)
  }
  // Stored lower-cased so that the unique index, findByEmail and login all
  // agree that one address is one account.
  return value.trim().toLowerCase()
}

export function requirePassword(body, field = 'password') {
  const value = body?.[field]
  if (typeof value !== 'string') throw badRequest(`"${field}" must be a string`)
  if (value.length < MIN_PASSWORD_LENGTH) {
    throw badRequest(`"${field}" must be at least ${MIN_PASSWORD_LENGTH} characters`)
  }
  if (value.length > MAX_PASSWORD_LENGTH) {
    throw badRequest(`"${field}" must be at most ${MAX_PASSWORD_LENGTH} characters`)
  }
  return value
}

export function requireName(body, field = 'name') {
  const value = body?.[field]
  if (typeof value !== 'string' || !value.trim()) {
    throw badRequest(`"${field}" must be a non-empty string`)
  }
  return value.trim().slice(0, 120)
}

export function requireRoleValue(body, field = 'role') {
  const value = body?.[field]
  if (!isRole(value)) throw badRequest(`"${field}" must be one of: admin, manager, teacher, student`)
  return value
}

/* ------------------------------------------------------------------ parentage */

/**
 * Resolves the parent a user of `role` should point at, and refuses anything
 * that would produce a roster the actor is not entitled to write into.
 *
 * Three things are being enforced at once:
 *
 * - the parent exists, is active, and holds the role the hierarchy expects
 *   (a student's `teacherId` must be a teacher, not another student);
 * - the actor can reach that parent, so a manager cannot park a student on
 *   another manager's teacher;
 * - a role with no parent slot cannot be given one.
 *
 * A teacher creating a student needs no `teacherId` in the body — themselves is
 * the only answer, so it is filled in. Admins may leave a student unassigned;
 * `null` is a legitimate state, meaning "on nobody's roster yet".
 */
export async function resolveParent(store, actor, role, requested, { scope } = {}) {
  const field = parentField(role)

  if (!field) {
    if (requested) throw badRequest(`A ${role} has no parent to assign`)
    return { field: null, value: null }
  }

  const expected = parentRole(role)

  // The common case: the actor is exactly the parent this role points at.
  if (requested === undefined && actor.role === expected) {
    return { field, value: actor.id }
  }

  if (requested === undefined || requested === null) {
    if (actor.role === 'admin') return { field, value: null }
    throw badRequest(`"${field}" is required — name the ${expected} this ${role} belongs to`)
  }

  if (typeof requested !== 'string') throw badRequest(`"${field}" must be a user id`)

  const parent = await store.users.findById(requested)
  if (!parent || parent.role !== expected) throw badRequest(`"${field}" must be the id of a ${expected}`)
  if (!parent.active) throw badRequest(`That ${expected} is deactivated`)

  const reach = scope ?? (await scopeOf(store, actor))
  if (!inScope(reach, parent.id)) throw forbidden(`That ${expected} is not on your roster`)

  return { field, value: parent.id }
}

/* ----------------------------------------------------------------- documents */

/**
 * One builder, so a user created by the bootstrap route and one created by an
 * admin are the same shape.
 *
 * Both pointer fields are always present, `null` when unused, rather than
 * absent: a document whose fields depend on its role is one every reader has to
 * remember to guard.
 */
export async function newUser({ role, name, email, password, parent }) {
  const at = now()

  return {
    id: id('usr'),
    role,
    name,
    email,
    passwordHash: await hashPassword(password),
    teacherId: null,
    managerId: null,
    ...(parent?.field ? { [parent.field]: parent.value } : {}),
    active: true,
    createdAt: at,
    updatedAt: at,
    lastLoginAt: null,
  }
}

/** Clears the pointer fields a role does not use, so no stale edge survives a role change. */
export function clearUnusedParents(role) {
  const keep = parentField(role)
  return Object.fromEntries(PARENT_FIELDS.filter((field) => field !== keep).map((f) => [f, null]))
}
