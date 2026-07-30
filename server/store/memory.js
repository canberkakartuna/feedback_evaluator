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
 * Collections: sessions, answers, messages, events, ownQuestions, uploads,
 * prompts, snippetLabels.
 */

const clone = (value) => (value == null ? value : structuredClone(value))

function collection() {
  return new Map()
}

export function createMemoryStore() {
  const sessions = collection()
  const sessionsByCode = collection()
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

    sessions: {
      async create(doc) {
        sessions.set(doc.id, doc)
        sessionsByCode.set(doc.code, doc.id)
        return clone(doc)
      },
      async findById(id) {
        return clone(sessions.get(id) ?? null)
      },
      async findByCode(code) {
        const id = sessionsByCode.get(String(code).toUpperCase())
        return id ? clone(sessions.get(id) ?? null) : null
      },
      async update(id, patch) {
        const current = sessions.get(id)
        if (!current) return null
        const next = { ...current, ...patch }
        sessions.set(id, next)
        return clone(next)
      },
      async list({ limit = 100 } = {}) {
        return [...sessions.values()]
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, limit)
          .map(clone)
      },
      async remove(id) {
        const current = sessions.get(id)
        if (!current) return false
        sessionsByCode.delete(current.code)
        sessions.delete(id)
        return true
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
