/**
 * Errors both stores raise, so a caller cannot tell which one it is holding
 * from the way a constraint failed.
 *
 * Email uniqueness is the one real constraint in the schema, and it is enforced
 * in the store rather than only checked in a route: a check-then-insert in a
 * handler is two round trips with a gap in the middle, and two people signing
 * up at once would both pass it. MongoDB enforces it with a unique index and
 * reports code 11000; the memory store keeps an email index and raises the same
 * error. routes/users.js turns it into a 409.
 */
export class DuplicateEmailError extends Error {
  constructor(email) {
    super(`An account already exists for ${email}`)
    this.name = 'DuplicateEmailError'
    this.code = 'DUPLICATE_EMAIL'
    this.email = email
  }
}

export const isDuplicateEmail = (error) => error?.code === 'DUPLICATE_EMAIL'

/**
 * A join code that is already taken.
 *
 * Unlike an email this is never chosen by anyone — shortCode() draws it at
 * random from 32^6, so a collision is luck rather than a mistake, and nobody
 * needs to be told about it. services/activities.js catches this and draws
 * again; only a run of failures reaches a caller.
 */
export class DuplicateCodeError extends Error {
  constructor(code) {
    super(`Activity code ${code} is already in use`)
    this.name = 'DuplicateCodeError'
    this.code = 'DUPLICATE_CODE'
    this.joinCode = code
  }
}

export const isDuplicateCode = (error) => error?.code === 'DUPLICATE_CODE'
