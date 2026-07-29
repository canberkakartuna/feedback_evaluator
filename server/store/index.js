import { createMemoryStore } from './memory.js'

/**
 * The only place that knows which store is in use.
 *
 * To move onto MongoDB, add store/mongo.js exposing the same async methods as
 * memory.js and select it here — for example when MONGODB_URI is set. Nothing
 * in routes/ or services/ should need to change, because every call is already
 * awaited and every collection already matches.
 */
export function createStore() {
  return createMemoryStore()
}
