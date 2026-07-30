import { config } from '../config.js'
import { createMemoryStore } from './memory.js'
import { createMongoStore } from './mongo.js'

/**
 * The only place that knows which store is in use.
 *
 * MONGODB_URI set means MongoDB; unset means in-memory. There is deliberately
 * no fallback from one to the other: a connection that quietly degraded to an
 * in-memory store would hand out sessions that vanish, which is the exact
 * failure the database is here to prevent. If the URI is set and the database
 * cannot be reached, requests fail and `GET /api/health` says why.
 *
 * Both stores expose the same async methods, collection for collection, so
 * nothing in routes/ or services/ has to change either way.
 */
export function createStore() {
  if (config.mongoUri) {
    return createMongoStore({ uri: config.mongoUri, dbName: config.mongoDb })
  }
  return createMemoryStore()
}
