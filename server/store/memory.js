/**
 * In-memory store, shaped like the MongoDB one in store/mongo.js.
 *
 * Every method is async and every collection is keyed the way a Mongo
 * collection is, so which one is in use is a decision in store/index.js and
 * nowhere else. Documents are cloned on the way out, so callers cannot mutate
 * stored state by accident — the same guarantee a real database gives for free.
 *
 * Fine for local work and for the smoke test. Not fine anywhere more than one
 * process serves requests: nothing here is shared, and it all goes when the
 * process does.
 *
 * Collections: users, authTokens, activities, questions, sessions, answers,
 * messages, events, ownQuestions, uploads, prompts, snippetLabels.
 */

import { DuplicateEmailError } from './errors.js'

const clone = (value) => (value == null ? value : structuredClone(value))

function collection() {
  return new Map()
}

/**
 * A filter that is absent matches everything, a string matches itself, and an
 * array matches any of its members — the same three cases store/mongo.js gets
 * for free from `$in`.
 */
const matches = (filter, value) => {
  if (filter === undefined) return true
  if (Array.isArray(filter)) return filter.includes(value)
  return filter === value
}

export function createMemoryStore() {
  const users = collection() // id -> user
  const usersByEmail = collection() // email -> id
  const authTokens = collection() // sha256(token) -> token record
  const activities = collection() // id -> activity
  const questions = collection() // id -> question
  const sessions = collection()
  const answers = collection() // `${sessionId}:${questionId}` -> answer
  const messages = collection() // id -> message
  const events = []
  const ownQuestions = collection() // id -> question
  const uploads = collection() // id -> upload metadata
  const prompts = []
  const snippetLabels = collection() // snippetId -> label
  const seqs = collection() // sessionId -> last seq handed out

  const answerKey = (sessionId, questionId) => `${sessionId}:${questionId}`

  return {
    kind: 'memory',

    users: {
      async create(doc) {
        if (usersByEmail.has(doc.email)) throw new DuplicateEmailError(doc.email)
        users.set(doc.id, doc)
        usersByEmail.set(doc.email, doc.id)
        return clone(doc)
      },
      async findById(id) {
        return clone(users.get(id) ?? null)
      },
      async findByEmail(email) {
        const id = usersByEmail.get(String(email).trim().toLowerCase())
        return id ? clone(users.get(id) ?? null) : null
      },
      async update(id, patch) {
        const current = users.get(id)
        if (!current) return null

        if (patch.email !== undefined && patch.email !== current.email) {
          const holder = usersByEmail.get(patch.email)
          if (holder && holder !== id) throw new DuplicateEmailError(patch.email)
          usersByEmail.delete(current.email)
          usersByEmail.set(patch.email, id)
        }

        const next = { ...current, ...patch }
        users.set(id, next)
        return clone(next)
      },
      /**
       * Every filter is optional and they combine, so one method covers "all
       * students", "this teacher's students", "these teachers' students" and
       * "everyone in scope". A roster reads best by name.
       */
      async list({ role, teacherId, managerId, ids, active, limit = 500 } = {}) {
        return [...users.values()]
          .filter(
            (user) =>
              matches(role, user.role) &&
              matches(teacherId, user.teacherId ?? null) &&
              matches(managerId, user.managerId ?? null) &&
              matches(ids, user.id) &&
              matches(active, user.active),
          )
          .sort((a, b) => a.name.localeCompare(b.name) || a.createdAt.localeCompare(b.createdAt))
          .slice(0, limit)
          .map(clone)
      },
      async count({ role, active } = {}) {
        let total = 0
        for (const user of users.values()) {
          if (matches(role, user.role) && matches(active, user.active)) total += 1
        }
        return total
      },
      async remove(id) {
        const current = users.get(id)
        if (!current) return false
        usersByEmail.delete(current.email)
        users.delete(id)
        return true
      },
    },

    authTokens: {
      async insert(doc) {
        authTokens.set(doc.key, doc)
        return clone(doc)
      },
      async find(key) {
        return clone(authTokens.get(key) ?? null)
      },
      async touch(key, at) {
        const current = authTokens.get(key)
        if (!current) return null
        const next = { ...current, lastUsedAt: at }
        authTokens.set(key, next)
        return clone(next)
      },
      async remove(key) {
        return authTokens.delete(key)
      },
      /** Signing out everywhere: deactivation and a password change both do it. */
      async removeByUser(userId) {
        let removed = 0
        for (const [key, value] of authTokens) {
          if (value.userId === userId) {
            authTokens.delete(key)
            removed += 1
          }
        }
        return removed
      },
    },

    activities: {
      async create(doc) {
        activities.set(doc.id, doc)
        return clone(doc)
      },
      async findById(id) {
        return clone(activities.get(id) ?? null)
      },
      /**
       * The class code, upper-cased on the way in so a student typing it in
       * lower case still lands. A blank code matches nothing rather than the
       * first activity authored before codes existed.
       */
      async findByCode(code) {
        if (!code) return null
        const wanted = String(code).trim().toUpperCase()
        for (const activity of activities.values()) {
          if (activity.code === wanted) return clone(activity)
        }
        return null
      },
      async update(id, patch) {
        const current = activities.get(id)
        if (!current) return null
        const next = { ...current, ...patch }
        activities.set(id, next)
        return clone(next)
      },
      async list({ ownerId, status, ids, limit = 200 } = {}) {
        return [...activities.values()]
          .filter(
            (activity) =>
              matches(ownerId, activity.ownerId) &&
              matches(status, activity.status) &&
              matches(ids, activity.id),
          )
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, limit)
          .map(clone)
      },
      async remove(id) {
        return activities.delete(id)
      },
    },

    /**
     * Questions belong to an activity and are ordered by `position` — a float,
     * so inserting between two neighbours is one write rather than renumbering
     * the tail. store/mongo.js says more about why.
     */
    questions: {
      async create(doc) {
        questions.set(doc.id, doc)
        return clone(doc)
      },
      async findById(id) {
        return clone(questions.get(id) ?? null)
      },
      async update(id, patch) {
        const current = questions.get(id)
        if (!current) return null
        const next = { ...current, ...patch }
        questions.set(id, next)
        return clone(next)
      },
      async list({ activityId } = {}) {
        return [...questions.values()]
          .filter((question) => matches(activityId, question.activityId))
          .sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt))
          .map(clone)
      },
      async count({ activityId } = {}) {
        let total = 0
        for (const question of questions.values()) {
          if (matches(activityId, question.activityId)) total += 1
        }
        return total
      },
      async remove(id) {
        return questions.delete(id)
      },
      async removeByActivity(activityId) {
        let removed = 0
        for (const [id, value] of questions) {
          if (value.activityId === activityId) {
            questions.delete(id)
            removed += 1
          }
        }
        return removed
      },
    },

    sessions: {
      async create(doc) {
        sessions.set(doc.id, doc)
        return clone(doc)
      },
      async findById(id) {
        return clone(sessions.get(id) ?? null)
      },
      async update(id, patch) {
        const current = sessions.get(id)
        if (!current) return null
        const next = { ...current, ...patch }
        sessions.set(id, next)
        return clone(next)
      },
      async list({ limit = 100, userId, activityId } = {}) {
        return [...sessions.values()]
          .filter(
            (session) =>
              matches(userId, session.userId ?? null) &&
              matches(activityId, session.activityId ?? null),
          )
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, limit)
          .map(clone)
      },
      async remove(id) {
        return sessions.delete(id)
      },
    },

    answers: {
      async upsert(sessionId, questionId, patch) {
        const key = answerKey(sessionId, questionId)
        const current = answers.get(key) ?? { sessionId, questionId, hintsUsed: 0 }
        const next = { ...current, ...patch, updatedAt: new Date().toISOString() }
        answers.set(key, next)
        return clone(next)
      },
      async find(sessionId, questionId) {
        return clone(answers.get(answerKey(sessionId, questionId)) ?? null)
      },
      async listBySession(sessionId) {
        return [...answers.values()].filter((a) => a.sessionId === sessionId).map(clone)
      },
      async removeBySession(sessionId) {
        for (const [key, value] of answers) {
          if (value.sessionId === sessionId) answers.delete(key)
        }
      },
    },

    messages: {
      /**
       * Counted per session, not globally, because that is what Mongo can do
       * with a counter document — see store/mongo.js. `count` numbers are
       * allocated at once so a student message and the reply that answers it
       * stay adjacent.
       */
      async nextSeq(sessionId, count = 1) {
        const first = (seqs.get(sessionId) ?? 0) + 1
        seqs.set(sessionId, first + count - 1)
        return Array.from({ length: count }, (_, i) => first + i)
      },
      async insert(doc) {
        messages.set(doc.id, doc)
        return clone(doc)
      },
      async findById(id) {
        return clone(messages.get(id) ?? null)
      },
      async update(id, patch) {
        const current = messages.get(id)
        if (!current) return null
        const next = { ...current, ...patch }
        messages.set(id, next)
        return clone(next)
      },
      async list(sessionId, questionId) {
        return [...messages.values()]
          .filter((m) => m.sessionId === sessionId && m.questionId === questionId)
          .sort((a, b) => a.seq - b.seq)
          .map(clone)
      },
      async listBySession(sessionId) {
        return [...messages.values()]
          .filter((m) => m.sessionId === sessionId)
          .sort((a, b) => a.seq - b.seq)
          .map(clone)
      },
      async listAll() {
        // Grouped by session and question, not by raw seq: seq only orders
        // within a session, and buildSnippets reads consecutive pairs.
        return [...messages.values()]
          .sort(
            (a, b) =>
              a.sessionId.localeCompare(b.sessionId) ||
              a.questionId.localeCompare(b.questionId) ||
              a.seq - b.seq,
          )
          .map(clone)
      },
      async removeBySession(sessionId) {
        for (const [id, value] of messages) {
          if (value.sessionId === sessionId) messages.delete(id)
        }
        seqs.delete(sessionId)
      },
    },

    events: {
      async insertMany(docs) {
        events.push(...docs)
        return docs.length
      },
      async listBySession(sessionId) {
        return events.filter((e) => e.sessionId === sessionId).map(clone)
      },
      async countBySession(sessionId) {
        return events.reduce((count, e) => (e.sessionId === sessionId ? count + 1 : count), 0)
      },
      async removeBySession(sessionId) {
        for (let i = events.length - 1; i >= 0; i -= 1) {
          if (events[i].sessionId === sessionId) events.splice(i, 1)
        }
      },
    },

    ownQuestions: {
      async insert(doc) {
        ownQuestions.set(doc.id, doc)
        return clone(doc)
      },
      async findById(id) {
        return clone(ownQuestions.get(id) ?? null)
      },
      async listBySession(sessionId) {
        return [...ownQuestions.values()]
          .filter((q) => q.sessionId === sessionId)
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
          .map(clone)
      },
      async removeBySession(sessionId) {
        for (const [id, value] of ownQuestions) {
          if (value.sessionId === sessionId) ownQuestions.delete(id)
        }
      },
    },

    uploads: {
      async insert(doc) {
        uploads.set(doc.id, doc)
        return clone(doc)
      },
      async findById(id) {
        return clone(uploads.get(id) ?? null)
      },
      async listBySession(sessionId) {
        return [...uploads.values()].filter((u) => u.sessionId === sessionId).map(clone)
      },
      async removeBySession(sessionId) {
        const removed = []
        for (const [id, value] of uploads) {
          if (value.sessionId === sessionId) {
            removed.push(clone(value))
            uploads.delete(id)
          }
        }
        return removed
      },
    },

    prompts: {
      async insert(doc) {
        prompts.push(doc)
        return clone(doc)
      },
      async active() {
        return clone(prompts.findLast((p) => p.active) ?? null)
      },
      async list() {
        return prompts.map(clone)
      },
    },

    snippetLabels: {
      async upsert(id, patch) {
        const next = { ...(snippetLabels.get(id) ?? { snippetId: id }), ...patch }
        snippetLabels.set(id, next)
        return clone(next)
      },
      async get(id) {
        return clone(snippetLabels.get(id) ?? null)
      },
      async map() {
        return new Map([...snippetLabels].map(([id, value]) => [id, clone(value)]))
      },
    },
  }
}
