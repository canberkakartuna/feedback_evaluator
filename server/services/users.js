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
import { isDuplicateEmail } from '../store/errors.js'
import { cleanStudentNumber, isUsername } from '../../shared/student-number.js'

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

/**
 * `signInKey` is the key of the login token the agreement was given under. It
 * is what limits withdrawal to that same sign-in (3 Nov 2026 doc): once the
 * student signs out and back in, the key no longer matches and their consent
 * stands. It never leaves the server — see publicUser.
 */
export function recordedConsent(signInKey = null) {
  return { given: true, at: now(), version: config.consentVersion, signInKey }
}

/**
 * May the request holding this login token still withdraw this user's consent?
 *
 * A consent recorded with `signInKey` must match that token exactly. One
 * recorded before the key existed has none, and falls back to time: a token
 * issued before the agreement was given is the sign-in it was given in, and a
 * token issued after it is a later sign-in, which may not withdraw.
 */
export function canWithdrawConsent(user, authToken) {
  if (!authToken?.key || !hasCurrentConsent(user)) return false
  if (user.consent.signInKey) return user.consent.signInKey === authToken.key
  const issued = Date.parse(authToken.createdAt ?? '')
  const agreed = Date.parse(user.consent.at ?? '')
  return Number.isFinite(issued) && Number.isFinite(agreed) && issued <= agreed
}

/**
 * The hash never leaves the server, on any path.
 *
 * `consented` is derived rather than stored: the client needs one boolean to
 * decide whether to show the notice, and deciding it here keeps the version
 * comparison on the side that owns the version.
 */
export function publicUser(user, { authToken = null } = {}) {
  if (!user) return null
  const { passwordHash: _passwordHash, ...rest } = user
  let consent = user.consent
  if (consent && typeof consent === 'object') {
    const { signInKey: _signInKey, ...shown } = consent
    consent = shown
  }
  return {
    ...rest,
    consent,
    // Only true for the sign-in the agreement was given under; callers that do
    // not pass the request's token key get false, which is the safe answer.
    canWithdrawConsent: canWithdrawConsent(user, authToken),
    // A class-list student's address is a placeholder (see classListEmail), not
    // something to show anybody as theirs.
    email: user.studentNumber ? null : user.email,
    consented: hasCurrentConsent(user),
  }
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

/**
 * The address a class-list student is stored under.
 *
 * They have no email, but `users.email` is the one unique index in the schema
 * and every user needs a value in it — a missing one would collide on `null`
 * the second time. Deriving it from the number turns that index into the
 * guarantee that **a number is on one class list at a time**, with no second
 * index to create on a live database. `.invalid` is reserved and can never
 * receive mail, and `publicUser` never shows it.
 */
export const classListEmail = (studentNumber) =>
  `${String(studentNumber).toLowerCase()}@class-list.invalid`

/**
 * A student who signs in with their number alone — see
 * shared/student-number.js. No password at all: `passwordHash` is null, which
 * `verifyPassword` reads as "never matches", so the email-and-password door
 * stays shut for them rather than open with a blank.
 */
export function newClassListStudent({ studentNumber, teacherId }) {
  const at = now()

  return {
    id: id('usr'),
    role: 'student',
    name: studentNumber,
    email: classListEmail(studentNumber),
    studentNumber,
    passwordHash: null,
    teacherId,
    managerId: null,
    active: true,
    createdAt: at,
    updatedAt: at,
    lastLoginAt: null,
  }
}

/**
 * Puts student numbers on a teacher's class list. `POST /api/users/class-list`
 * and `npm run seed:class-list` both come through here, so a number gets the same
 * treatment whichever way it was added. Who may call it, and for which teacher,
 * is the caller's job; this only does the writing.
 *
 * Answers `{ added, already, taken, invalid }` (see the route for what each one
 * means). A removed number on this teacher's list is put back and counted as
 * added.
 */
export async function addToClassList(store, { studentNumbers, teacherId, byUserId }) {
  const result = { added: [], already: [], taken: [], invalid: [] }
  const seen = new Set()

  for (const entry of studentNumbers) {
    const studentNumber = cleanStudentNumber(entry)
    if (!studentNumber || !isUsername(studentNumber)) {
      result.invalid.push(String(entry).slice(0, 40))
      continue
    }
    if (seen.has(studentNumber)) continue
    seen.add(studentNumber)

    const existing = await store.users.findByEmail(classListEmail(studentNumber))

    if (!existing) {
      try {
        await store.users.create(newClassListStudent({ studentNumber, teacherId }))
        result.added.push(studentNumber)
      } catch (error) {
        // Two teachers pasting the same number at once: the loser is told
        // it is taken, which by then it is.
        if (!isDuplicateEmail(error)) throw error
        result.taken.push(studentNumber)
      }
    } else if (existing.teacherId !== teacherId || existing.role !== 'student') {
      result.taken.push(studentNumber)
    } else if (!existing.active) {
      await store.users.update(existing.id, { active: true, updatedAt: now() })
      result.added.push(studentNumber)
    } else {
      result.already.push(studentNumber)
    }
  }

  if (result.added.length) {
    await store.events.insertMany([
      {
        id: id('evt'),
        sessionId: null,
        userId: byUserId,
        type: 'class_list_added',
        at: now(),
        payload: { teacherId, count: result.added.length, by: byUserId },
      },
    ])
  }

  return result
}

/** Clears the pointer fields a role does not use, so no stale edge survives a role change. */
export function clearUnusedParents(role) {
  const keep = parentField(role)
  return Object.fromEntries(PARENT_FIELDS.filter((field) => field !== keep).map((f) => [f, null]))
}
