import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

/**
 * Password hashing on node:crypto's scrypt — no dependency, and memory-hard,
 * which is the property that matters against offline cracking of a stolen
 * database.
 *
 * The stored string carries its own parameters:
 *
 *   scrypt$16384$8$1$<salt base64url>$<key base64url>
 *
 * so raising the cost later only affects passwords set after the change.
 * Existing hashes keep verifying against the parameters they were made with,
 * and a rehash-on-login can upgrade them without anyone being locked out.
 */

const scryptAsync = promisify(scrypt)

/**
 * N=16384 costs about 16 MB and ~60 ms here. maxmem is set explicitly because
 * Node's 32 MB default sits close enough to 128·N·r that a future bump to N
 * would start throwing rather than just getting slower.
 */
const PARAMS = { N: 16384, r: 8, p: 1 }
const MAX_MEM = 64 * 1024 * 1024
const KEY_BYTES = 32
const SALT_BYTES = 16

// Re-exported rather than redeclared: the admin form reads the same two
// numbers from shared/password.js, and they drifted once already.
export { MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH } from '../../shared/password.js'

/** Unicode-normalised, so the same typed password matches on any keyboard. */
const normalise = (password) => String(password).normalize('NFKC')

const derive = (password, salt, { N, r, p }) =>
  scryptAsync(normalise(password), salt, KEY_BYTES, { N, r, p, maxmem: MAX_MEM })

export async function hashPassword(password) {
  const salt = randomBytes(SALT_BYTES)
  const key = await derive(password, salt, PARAMS)
  const { N, r, p } = PARAMS
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64url')}$${key.toString('base64url')}`
}

/**
 * False for a wrong password and false for a hash this cannot parse — a
 * malformed record must not throw its way into a 500, and must never be
 * mistaken for a match.
 */
export async function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false

  const [scheme, N, r, p, salt, key] = stored.split('$')
  if (scheme !== 'scrypt' || !salt || !key) return false

  const params = { N: Number(N), r: Number(r), p: Number(p) }
  if (!Number.isInteger(params.N) || !Number.isInteger(params.r) || !Number.isInteger(params.p)) {
    return false
  }

  try {
    const expected = Buffer.from(key, 'base64url')
    const actual = await derive(password, Buffer.from(salt, 'base64url'), params)
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  } catch {
    return false
  }
}

/**
 * Something for a failed login to compare against when the email matches no
 * user at all, so "no such account" and "wrong password" take the same time and
 * the endpoint cannot be used to enumerate who has an account.
 */
let decoy = null
export async function burnPassword(password) {
  decoy ??= await hashPassword(randomBytes(16).toString('hex'))
  await verifyPassword(password, decoy)
}
