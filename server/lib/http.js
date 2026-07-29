import { randomUUID } from 'node:crypto'

/** An error the client is allowed to see. Anything else becomes a 500. */
export class ApiError extends Error {
  constructor(status, message, details) {
    super(message)
    this.status = status
    this.details = details
  }
}

export const badRequest = (message, details) => new ApiError(400, message, details)
export const notFound = (message) => new ApiError(404, message)
export const forbidden = (message) => new ApiError(403, message)
export const unavailable = (message) => new ApiError(503, message)

/** Lets route handlers stay flat: throw, and this forwards to the handler. */
export const route = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next)

export function id(prefix) {
  return `${prefix}_${randomUUID().replaceAll('-', '').slice(0, 20)}`
}

/** Short, unambiguous code for attaching a phone to a session (doc item 3). */
export function shortCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no I, O, 0, 1
  let out = ''
  for (let i = 0; i < 6; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)]
  }
  return out
}

export const now = () => new Date().toISOString()

/** Reads a field that must be a non-empty string. */
export function requireString(body, field, { max = 5000 } = {}) {
  const value = body?.[field]
  if (typeof value !== 'string' || !value.trim()) {
    throw badRequest(`"${field}" must be a non-empty string`)
  }
  if (value.length > max) throw badRequest(`"${field}" must be at most ${max} characters`)
  return value
}

export function requireOneOf(body, field, allowed) {
  const value = body?.[field]
  if (!allowed.includes(value)) {
    throw badRequest(`"${field}" must be one of: ${allowed.join(', ')}`)
  }
  return value
}
