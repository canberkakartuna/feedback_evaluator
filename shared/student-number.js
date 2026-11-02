/**
 * Signing in with a student number — the way most students get in.
 *
 * A teacher pastes their class list (the student numbers of the class) into
 * the console; a student types their number on the entry screen and is in, with
 * no name, email or password. The number is the whole identity, and it is only
 * accepted if it is on a teacher's class list — so the site is not open to
 * anyone who finds it, which is what keeps the model bill to the class.
 *
 * Because it is an account, everything an account buys comes with it: the
 * consent notice is asked **once**, and coming back with the same number opens
 * the same work again (routes/sessions.js resumes the session rather than
 * starting a fresh one).
 *
 * A number is not a secret, and that is accepted: anyone who knows a classmate's
 * number can open their work. The study is anonymous — the number names nobody
 * outside the school's own records — and the alternative was handing a class of
 * children passwords to lose.
 *
 * In shared/ because the console's paste box and the API have to agree on what
 * a number looks like; services/users.js is the copy that holds.
 */

export const STUDENT_NUMBER_MAX = 32

/** Up to this many numbers in one paste. A class, or a year group, not a school. */
export const CLASS_LIST_MAX = 500

const SHAPE = /^[A-Z0-9][A-Z0-9-]*$/

/**
 * Upper-cased with every space removed, so "2023 0145" and "20230145" are one
 * student. `null` for anything that is not a plausible number — letters, digits
 * and hyphens only.
 */
export function cleanStudentNumber(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const cleaned = String(value).replace(/\s+/g, '').toUpperCase()
  if (!cleaned || cleaned.length > STUDENT_NUMBER_MAX || !SHAPE.test(cleaned)) return null
  return cleaned
}

/** A pasted column, a comma list, or both — split on anything that is not part of a number. */
export function splitStudentNumbers(text) {
  return String(text ?? '')
    .split(/[\s,;]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
}
