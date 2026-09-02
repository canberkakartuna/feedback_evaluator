import {
  LIMITS,
  QUESTION_KINDS,
  TOPIC_IDS,
  blankTutor,
  isActivityStatus,
  isQuestionKind,
  isTopic,
} from '../../shared/activity.js'
import { badRequest, forbidden, id, notFound, now, shortCode } from '../lib/http.js'
import { scopeOf } from './users.js'

/**
 * Authoring rules for activities and the questions in them.
 *
 * Every rule lives here rather than in routes/activities.js for the same reason
 * the user rules live in services/users.js: "a teacher may only edit their own
 * activity" is exactly the kind of rule that goes wrong the moment there are two
 * copies of it.
 *
 * Ownership is a single pointer — `activity.ownerId`, the teacher who made it —
 * and reach is derived from the user hierarchy rather than stored again:
 *
 *   admin    every activity
 *   manager  their own, plus those of every teacher on their roster
 *   teacher  their own
 *   student  none through this path; a student reaches a *published* activity
 *            through GET /api/activities/available, which is a different door
 */

/* --------------------------------------------------------------------- scope */

/** Roles that may create an activity at all. A student never authors. */
export const canAuthor = (role) => role === 'teacher' || role === 'manager' || role === 'admin'

export function assertCanAuthor(actor) {
  if (!canAuthor(actor.role)) {
    throw forbidden(`A ${actor.role} cannot create activities`)
  }
}

/**
 * `{ all: true }` for an admin, `{ ownerIds: [...] }` for everyone else.
 *
 * A manager's reach is computed from their teacher roster, so moving a teacher
 * between managers moves that teacher's activities with them without anything
 * being rewritten.
 */
export async function activityScope(store, actor) {
  if (actor.role === 'admin') return { all: true, ownerIds: null }

  const scope = await scopeOf(store, actor)

  if (actor.role === 'manager') {
    return { all: false, ownerIds: [actor.id, ...(scope.teacherIds ?? [])] }
  }

  if (actor.role === 'teacher') return { all: false, ownerIds: [actor.id] }

  return { all: false, ownerIds: [] }
}

export const activityInScope = (scope, activity) =>
  scope.all || scope.ownerIds.includes(activity.ownerId)

/**
 * Out of reach reads as 404, matching loadInScope in services/users.js: whether
 * a given activity id exists is not something one teacher should learn from
 * another teacher's list.
 */
export async function loadActivityInScope(store, actor, activityId) {
  const [activity, scope] = await Promise.all([
    store.activities.findById(activityId),
    activityScope(store, actor),
  ])

  if (!activity || !activityInScope(scope, activity)) throw notFound('No such activity')
  return { activity, scope }
}

/* ---------------------------------------------------------------- validation */

const trimmed = (value, max) => String(value).trim().slice(0, max)

function optionalString(body, field, max) {
  const value = body?.[field]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'string') throw badRequest(`"${field}" must be a string`)
  return trimmed(value, max)
}

/**
 * A stimulus is the table or figure printed above a question. Only tables are
 * supported so far; the kind is checked rather than assumed so that adding a
 * chart later cannot silently store a shape nothing renders.
 */
function parseStimulus(value) {
  if (value === undefined) return undefined
  if (value === null) return null

  if (typeof value !== 'object' || Array.isArray(value)) {
    throw badRequest('"stimulus" must be an object or null')
  }
  if (value.kind !== 'table') throw badRequest('"stimulus.kind" must be "table"')

  const columns = value.columns
  const rows = value.rows

  if (!Array.isArray(columns) || !columns.length) {
    throw badRequest('"stimulus.columns" must be a non-empty array')
  }
  if (!Array.isArray(rows)) throw badRequest('"stimulus.rows" must be an array')

  for (const row of rows) {
    if (!Array.isArray(row) || row.length !== columns.length) {
      throw badRequest(`Every stimulus row must have ${columns.length} cells`)
    }
  }

  return {
    kind: 'table',
    caption: trimmed(value.caption ?? '', 300),
    columns: columns.map((column) => trimmed(column ?? '', 200)),
    rows: rows.map((row) => row.map((cell) => trimmed(cell ?? '', 200))),
  }
}

/**
 * The mark scheme. Absent and `[]` both mean "not marked" — see hasRubric in
 * shared/activity.js — so neither is an error.
 *
 * `keywords` is what the placeholder marker matches on, and it is the one field
 * here that must never reach a student: services/course.js strips it, and this
 * function is the only thing that decides it exists.
 */
function parseRubric(value) {
  if (value === undefined) return undefined
  if (value === null) return []
  if (!Array.isArray(value)) throw badRequest('"rubric" must be an array')
  if (value.length > LIMITS.criteria) {
    throw badRequest(`A question may have at most ${LIMITS.criteria} criteria`)
  }

  return value.map((criterion, index) => {
    if (typeof criterion !== 'object' || criterion === null) {
      throw badRequest(`Criterion ${index + 1} must be an object`)
    }

    const label = criterion.label
    if (typeof label !== 'string' || !label.trim()) {
      throw badRequest(`Criterion ${index + 1} needs a label`)
    }

    const points = criterion.points ?? 1
    if (!Number.isFinite(points) || points < 0 || points > 100) {
      throw badRequest(`Criterion ${index + 1}: "points" must be between 0 and 100`)
    }

    const keywords = criterion.keywords ?? []
    if (!Array.isArray(keywords)) {
      throw badRequest(`Criterion ${index + 1}: "keywords" must be an array`)
    }
    if (keywords.length > LIMITS.keywordsPerCriterion) {
      throw badRequest(
        `Criterion ${index + 1}: at most ${LIMITS.keywordsPerCriterion} keywords`,
      )
    }

    return {
      // Reused when the client sends one back, so stored feedback that names a
      // criterion still points at the same criterion after an edit.
      id: typeof criterion.id === 'string' && criterion.id.trim() ? criterion.id.trim() : id('crit'),
      label: trimmed(label, LIMITS.criterionLabel),
      points,
      keywords: keywords
        .filter((keyword) => typeof keyword === 'string' && keyword.trim())
        .map((keyword) => trimmed(keyword, LIMITS.keyword).toLowerCase()),
      coach: trimmed(criterion.coach ?? '', LIMITS.criterionCoach),
    }
  })
}

/** The scripted tutor. Every field optional; shared/tutor-scripts.js fills gaps. */
function parseTutor(value) {
  if (value === undefined) return undefined
  if (value === null) return blankTutor()
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw badRequest('"tutor" must be an object or null')
  }

  const hints = value.hints ?? []
  if (!Array.isArray(hints)) throw badRequest('"tutor.hints" must be an array')
  if (hints.length > LIMITS.hints) {
    throw badRequest(`At most ${LIMITS.hints} hints per question`)
  }

  return {
    opening: trimmed(value.opening ?? '', LIMITS.tutorField),
    hints: hints
      .filter((hint) => typeof hint === 'string' && hint.trim())
      .map((hint) => trimmed(hint, LIMITS.hint)),
    concept: trimmed(value.concept ?? '', LIMITS.tutorField),
    example: trimmed(value.example ?? '', LIMITS.tutorField),
    misconception: trimmed(value.misconception ?? '', LIMITS.tutorField),
  }
}

/**
 * Fields common to create and update. `forCreate` decides only whether a
 * missing prompt is an error or simply "not being changed".
 */
export function parseQuestionInput(body, { forCreate } = {}) {
  const patch = {}

  /**
   * The prompt is optional in itself — an uploaded image can be the question.
   * What is *not* optional is that the question asks something, and that is
   * checked in routes/activities.js once the image has been resolved, since
   * only there is it known whether one is attached or already stored.
   */
  const prompt = body?.prompt
  if (prompt !== undefined) {
    if (typeof prompt !== 'string') throw badRequest('"prompt" must be a string')
    if (prompt.length > LIMITS.prompt) {
      throw badRequest(`"prompt" must be at most ${LIMITS.prompt} characters`)
    }
    patch.prompt = prompt.trim()
  } else if (forCreate) {
    patch.prompt = ''
  }

  /**
   * The teacher's own answer. Optional everywhere: `null` and `''` both mean
   * "no answer written", stored as `''` so no reader meets three shapes of
   * absence. It goes to the tutor as context and never into a student payload —
   * see publicQuestion in shared/activity.js.
   */
  const answer = body?.answer
  if (answer !== undefined) {
    if (answer === null) {
      patch.answer = ''
    } else if (typeof answer !== 'string') {
      throw badRequest('"answer" must be a string')
    } else if (answer.length > LIMITS.answer) {
      throw badRequest(`"answer" must be at most ${LIMITS.answer} characters`)
    } else {
      patch.answer = answer.trim()
    }
  }

  if (body?.kind !== undefined) {
    if (!isQuestionKind(body.kind)) {
      throw badRequest(`"kind" must be one of: ${QUESTION_KINDS.join(', ')}`)
    }
    patch.kind = body.kind
  }

  const code = optionalString(body, 'code', LIMITS.code)
  if (code !== undefined) patch.code = code

  if (body?.workingExpected !== undefined) {
    if (typeof body.workingExpected !== 'boolean') {
      throw badRequest('"workingExpected" must be a boolean')
    }
    patch.workingExpected = body.workingExpected
  }

  const stimulus = parseStimulus(body?.stimulus)
  if (stimulus !== undefined) patch.stimulus = stimulus

  const rubric = parseRubric(body?.rubric)
  if (rubric !== undefined) patch.rubric = rubric

  const tutor = parseTutor(body?.tutor)
  if (tutor !== undefined) patch.tutor = tutor

  return patch
}

export function parseActivityInput(body, { forCreate } = {}) {
  const patch = {}

  const title = body?.title
  if (forCreate || title !== undefined) {
    if (typeof title !== 'string' || !title.trim()) {
      throw badRequest('"title" must be a non-empty string')
    }
    patch.title = trimmed(title, LIMITS.title)
  }

  const blurb = optionalString(body, 'blurb', LIMITS.blurb)
  if (blurb !== undefined) patch.blurb = blurb

  if (body?.status !== undefined) {
    if (!isActivityStatus(body.status)) throw badRequest('"status" must be "draft" or "published"')
    patch.status = body.status
  }

  /**
   * `null` clears the topic and is not an error — an activity with no topic is a
   * supported state, so "none" has to be sendable as well as reachable by never
   * having set one. Anything outside the list is refused rather than stored,
   * since a topic nothing can filter on is worse than no topic at all.
   */
  if (body?.topic !== undefined) {
    if (body.topic === null || body.topic === '') {
      patch.topic = null
    } else if (!isTopic(body.topic)) {
      throw badRequest(`"topic" must be null or one of: ${TOPIC_IDS.join(', ')}`)
    } else {
      patch.topic = body.topic
    }
  }

  return patch
}

/* ------------------------------------------------------------- class codes */

/**
 * The class code, and what it is not.
 *
 * It is **not a credential.** `GET /api/activities/code/:code` and the session
 * route both refuse a code that names a draft, so a code opens exactly what
 * publishing already opened — nothing more. What it buys is the walk from "open
 * the site, pick from a list of twenty" to "type six characters, or follow the
 * link I put on the board", which is the whole of a lesson's first two minutes.
 *
 * Six characters from the unambiguous alphabet in lib/http.js, so it can be read
 * off a projector and typed by a ten-year-old. Uniqueness is checked rather than
 * assumed: the space is about a billion, collisions are vanishingly unlikely,
 * and "vanishingly unlikely" is not the same as "cannot happen" when the failure
 * is two classes landing in one activity. Mongo also carries a unique index on
 * the field — see store/mongo.js — which is what actually holds under a race.
 */
const CODE_ATTEMPTS = 5

export async function freshClassCode(store) {
  for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1) {
    const candidate = shortCode()
    if (!(await store.activities.findByCode(candidate))) return candidate
  }

  // Five collisions in a row is not bad luck, it is a broken generator. Better
  // to say so than to hand two activities the same code.
  throw new Error('Could not allocate an unused class code')
}

/**
 * Backfills a code onto an activity authored before codes existed.
 *
 * A write on a read, which is normally worth avoiding — but the alternative is a
 * "Generate code" button on every older activity, which is a migration wearing a
 * user interface. It runs once per activity and then never again.
 */
export async function ensureClassCode(store, activity) {
  if (activity.code) return activity

  const code = await freshClassCode(store)
  return (await store.activities.update(activity.id, { code })) ?? { ...activity, code }
}

/* ----------------------------------------------------------------- documents */

export function newActivity({ title, blurb = '', topic = null, code, ownerId, status = 'draft' }) {
  const at = now()
  return {
    id: id('act'),
    code,
    title,
    blurb,
    topic,
    ownerId,
    status,
    createdAt: at,
    updatedAt: at,
  }
}

export async function createActivity(store, fields) {
  return store.activities.create(
    newActivity({ ...fields, code: fields.code ?? (await freshClassCode(store)) }),
  )
}

/** Appended to the end. See store/mongo.js on why `position` is a float. */
export function newQuestion({ activityId, position, code, ...rest }) {
  const at = now()
  return {
    id: id('qst'),
    activityId,
    code: code || null,
    kind: 'Explain',
    prompt: '',
    image: null,
    stimulus: null,
    answer: '',
    answerImage: null,
    workingExpected: false,
    rubric: [],
    tutor: blankTutor(),
    ...rest,
    position,
    createdAt: at,
    updatedAt: at,
  }
}

export const nextPosition = (questions) =>
  questions.length ? Math.max(...questions.map((question) => question.position)) + 1 : 1

/**
 * Falls back to Q1, Q2, … by ordinal when a teacher does not name a question.
 *
 * Derived at read time rather than stored, so deleting question 2 renumbers the
 * rest instead of leaving a gap that looks like missing work. A code the teacher
 * *did* type is theirs and is never touched.
 */
export const displayCode = (question, index) => question.code || `Q${index + 1}`
