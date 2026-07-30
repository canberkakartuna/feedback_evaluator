import { MongoClient } from 'mongodb'

/**
 * MongoDB-backed store.
 *
 * Method for method the same as store/memory.js — every method async, every
 * collection keyed the same way — so nothing in routes/ or services/ can tell
 * which one it is holding. store/index.js picks between them.
 *
 * Three conventions worth knowing:
 *
 * - **`_id` is the document's own id** wherever the document already has a
 *   natural unique key: `sessions.id`, `messages.id`, `${sessionId}:${questionId}`
 *   for an answer. Uniqueness is then the primary key's job, so an upsert cannot
 *   race and no secondary index is needed to look one up. `id` is still stored
 *   as an ordinary field and every read projects `_id` away, so callers get
 *   exactly the documents memory.js hands back.
 * - **Connecting is lazy.** createMongoStore() returns synchronously, so
 *   createApp() stays synchronous and one instance holds one pool; the first
 *   operation awaits the handshake. A failed handshake is not cached — a DNS
 *   blip at boot would otherwise poison a serverless instance for its whole
 *   life.
 * - **`messages.seq` is allocated here**, from a per-session counter document,
 *   because a module-level counter hands out the same numbers on every
 *   instance. memory.js keeps a counter per session for the same reason.
 */

/** Many short-lived instances, so each one keeps a small pool. */
const CLIENT_OPTIONS = {
  maxPoolSize: 10,
  minPoolSize: 0,
  serverSelectionTimeoutMS: 10_000,
}

const DEFAULT_DB = 'feedback_evaluator'

/**
 * Atlas's copy-paste connection string carries no database name, and the driver
 * quietly falls back to `test` when one is missing — a silent wrong answer.
 * Be explicit: MONGODB_DB wins, then a name in the URI path, then this default.
 */
export function databaseName(uri, explicit) {
  if (explicit) return explicit

  try {
    const fromUri = new URL(uri).pathname.replace(/^\//, '')
    if (fromUri) return decodeURIComponent(fromUri)
  } catch {
    // Not parseable — the driver will reject the URI itself, with a better
    // message than anything this could invent.
  }

  return DEFAULT_DB
}

/**
 * Created on first connect, and idempotent, so it costs nothing to repeat.
 *
 * `sessions.code` is deliberately *not* unique. shortCode() is random, and the
 * memory store lets a repeat overwrite the older entry rather than fail; a
 * unique index here would turn a one-in-a-billion collision into a 500. Both
 * stores answer findByCode with the newest match instead.
 */
const INDEXES = {
  sessions: [{ code: 1 }, { createdAt: -1 }],
  answers: [{ sessionId: 1 }],
  messages: [{ sessionId: 1, questionId: 1, seq: 1 }, { sessionId: 1, seq: 1 }],
  events: [{ sessionId: 1, at: 1 }, { type: 1 }],
  ownQuestions: [{ sessionId: 1, createdAt: 1 }],
  uploads: [{ sessionId: 1 }],
  prompts: [{ active: 1, _id: -1 }],
}

/** Every read strips `_id`, so documents match the memory store's exactly. */
const BARE = { projection: { _id: 0 } }

const answerKey = (sessionId, questionId) => `${sessionId}:${questionId}`
const counterKey = (sessionId) => `seq:${sessionId}`

async function ensureIndexes(db) {
  await Promise.all(
    Object.entries(INDEXES).flatMap(([name, keys]) =>
      keys.map((spec) =>
        db
          .collection(name)
          .createIndex(spec)
          .catch((error) => {
            // Worth knowing about, not worth refusing to serve over: the
            // queries still work, they are just slower than they should be.
            console.warn(`[api] index on ${name} ${JSON.stringify(spec)}: ${error.message}`)
          }),
      ),
    ),
  )
}

export function createMongoStore({ uri, dbName } = {}) {
  const name = databaseName(uri, dbName)
  const client = new MongoClient(uri, CLIENT_OPTIONS)

  let connection = null

  function connect() {
    if (!connection) {
      connection = (async () => {
        await client.connect()
        const db = client.db(name)
        await ensureIndexes(db)
        console.log(`[api] mongo connected, database "${name}"`)
        return db
      })().catch((error) => {
        connection = null // Let the next call try again.
        throw error
      })
    }
    return connection
  }

  const col = async (collectionName) => (await connect()).collection(collectionName)

  return {
    kind: 'mongo',
    database: name,

    /** For GET /api/health: is the database actually reachable from here? */
    async ping() {
      try {
        await (await connect()).command({ ping: 1 })
        return { ok: true, error: null }
      } catch (error) {
        return { ok: false, error: error.message }
      }
    },

    async close() {
      connection = null
      await client.close()
    },

    sessions: {
      async create(doc) {
        await (await col('sessions')).insertOne({ _id: doc.id, ...doc })
        return doc
      },
      async findById(id) {
        return (await col('sessions')).findOne({ _id: id }, BARE)
      },
      async findByCode(code) {
        // Newest wins, matching the memory store, where a repeated code
        // overwrites the older mapping.
        return (await col('sessions')).findOne(
          { code: String(code).toUpperCase() },
          { ...BARE, sort: { createdAt: -1 } },
        )
      },
      async update(id, patch) {
        return (await col('sessions')).findOneAndUpdate(
          { _id: id },
          { $set: patch },
          { ...BARE, returnDocument: 'after' },
        )
      },
      async list({ limit = 100 } = {}) {
        return (await col('sessions'))
          .find({}, { ...BARE, sort: { createdAt: -1 }, limit })
          .toArray()
      },
      async remove(id) {
        const { deletedCount } = await (await col('sessions')).deleteOne({ _id: id })
        return deletedCount > 0
      },
    },

    answers: {
      async upsert(sessionId, questionId, patch) {
        const set = { ...patch, updatedAt: new Date().toISOString() }

        // $setOnInsert may not name a field $set already names — Mongo rejects
        // that as a conflict — so the defaults cover only what the patch omits.
        const defaults = { sessionId, questionId, hintsUsed: 0 }
        for (const key of Object.keys(set)) delete defaults[key]

        return (await col('answers')).findOneAndUpdate(
          { _id: answerKey(sessionId, questionId) },
          Object.keys(defaults).length ? { $set: set, $setOnInsert: defaults } : { $set: set },
          { ...BARE, upsert: true, returnDocument: 'after' },
        )
      },
      async find(sessionId, questionId) {
        return (await col('answers')).findOne({ _id: answerKey(sessionId, questionId) }, BARE)
      },
      async listBySession(sessionId) {
        return (await col('answers')).find({ sessionId }, BARE).toArray()
      },
      async removeBySession(sessionId) {
        await (await col('answers')).deleteMany({ sessionId })
      },
    },

    messages: {
      /**
       * Allocates `count` consecutive numbers in one round trip, so the student
       * message and the reply that answers it are always adjacent — a snippet is
       * built from that pair, and another request on the same session must not
       * be able to land between them.
       */
      async nextSeq(sessionId, count = 1) {
        const doc = await (await col('counters')).findOneAndUpdate(
          { _id: counterKey(sessionId) },
          { $inc: { value: count } },
          { upsert: true, returnDocument: 'after' },
        )
        const first = doc.value - count + 1
        return Array.from({ length: count }, (_, i) => first + i)
      },
      async insert(doc) {
        await (await col('messages')).insertOne({ _id: doc.id, ...doc })
        return doc
      },
      async findById(id) {
        return (await col('messages')).findOne({ _id: id }, BARE)
      },
      async update(id, patch) {
        return (await col('messages')).findOneAndUpdate(
          { _id: id },
          { $set: patch },
          { ...BARE, returnDocument: 'after' },
        )
      },
      async list(sessionId, questionId) {
        return (await col('messages'))
          .find({ sessionId, questionId }, { ...BARE, sort: { seq: 1 } })
          .toArray()
      },
      async listBySession(sessionId) {
        return (await col('messages')).find({ sessionId }, { ...BARE, sort: { seq: 1 } }).toArray()
      },
      async listAll() {
        // Grouped by session and question, not by raw seq: seq only orders
        // within a session, and buildSnippets reads consecutive pairs.
        return (await col('messages'))
          .find({}, { ...BARE, sort: { sessionId: 1, questionId: 1, seq: 1 } })
          .toArray()
      },
      async removeBySession(sessionId) {
        await Promise.all([
          (await col('messages')).deleteMany({ sessionId }),
          (await col('counters')).deleteOne({ _id: counterKey(sessionId) }),
        ])
      },
    },

    events: {
      async insertMany(docs) {
        if (!docs.length) return 0
        const { insertedCount } = await (
          await col('events')
        ).insertMany(docs.map((doc) => ({ _id: doc.id, ...doc })))
        return insertedCount
      },
      async listBySession(sessionId) {
        return (await col('events')).find({ sessionId }, { ...BARE, sort: { at: 1 } }).toArray()
      },
      async countBySession(sessionId) {
        return (await col('events')).countDocuments({ sessionId })
      },
      async removeBySession(sessionId) {
        await (await col('events')).deleteMany({ sessionId })
      },
    },

    ownQuestions: {
      async insert(doc) {
        await (await col('ownQuestions')).insertOne({ _id: doc.id, ...doc })
        return doc
      },
      async findById(id) {
        return (await col('ownQuestions')).findOne({ _id: id }, BARE)
      },
      async listBySession(sessionId) {
        return (await col('ownQuestions'))
          .find({ sessionId }, { ...BARE, sort: { createdAt: 1 } })
          .toArray()
      },
      async removeBySession(sessionId) {
        await (await col('ownQuestions')).deleteMany({ sessionId })
      },
    },

    uploads: {
      async insert(doc) {
        await (await col('uploads')).insertOne({ _id: doc.id, ...doc })
        return doc
      },
      async findById(id) {
        return (await col('uploads')).findOne({ _id: id }, BARE)
      },
      async listBySession(sessionId) {
        return (await col('uploads')).find({ sessionId }, BARE).toArray()
      },
      /** Returns what it deleted: the caller removes the files behind them. */
      async removeBySession(sessionId) {
        const uploads = await col('uploads')
        const removed = await uploads.find({ sessionId }, BARE).toArray()
        if (removed.length) await uploads.deleteMany({ sessionId })
        return removed
      },
    },

    prompts: {
      // No natural key, and the interesting order is the order they arrived —
      // which is what an ObjectId `_id` already sorts by.
      async insert(doc) {
        await (await col('prompts')).insertOne({ ...doc })
        return doc
      },
      async active() {
        return (await col('prompts')).findOne({ active: true }, { ...BARE, sort: { _id: -1 } })
      },
      async list() {
        return (await col('prompts')).find({}, { ...BARE, sort: { _id: 1 } }).toArray()
      },
    },

    snippetLabels: {
      async upsert(id, patch) {
        const defaults = { snippetId: id }
        for (const key of Object.keys(patch)) delete defaults[key]

        return (await col('snippetLabels')).findOneAndUpdate(
          { _id: id },
          Object.keys(defaults).length
            ? { $set: { ...patch }, $setOnInsert: defaults }
            : { $set: { ...patch } },
          { ...BARE, upsert: true, returnDocument: 'after' },
        )
      },
      async get(id) {
        return (await col('snippetLabels')).findOne({ _id: id }, BARE)
      },
      async map() {
        const docs = await (await col('snippetLabels')).find({}, BARE).toArray()
        return new Map(docs.map((doc) => [doc.snippetId, doc]))
      },
    },
  }
}
