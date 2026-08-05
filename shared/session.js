/**
 * What a session is labelled with.
 *
 * An anonymous session has no account behind it, so the only handle a teacher
 * had was its six-character code — which tells them nothing about whose work
 * they are reading. A **nickname** is the fix, and every property of it follows
 * from the study being anonymous:
 *
 * - **Made up, and optional.** Requiring one would push a child into typing
 *   their real name, which is the single thing the consent notice asks them not
 *   to do. No nickname simply means the code stands in, as it did before.
 * - **Short.** Long enough for "Blue Fox 12", too short to be a sentence anybody
 *   could hide a personal detail in comfortably.
 * - **Not an identity.** It is a label on one session, not a login and not a
 *   claim: two students may pick the same one, and nothing is scoped by it.
 *
 * Signed-in students do not get asked — their account already names them.
 *
 * In shared/ because the entry screen's input and the API's validation have to
 * agree on the limit; routes/sessions.js is the copy that holds.
 */

export const NICKNAME_MAX = 40

/** Trimmed, capped, and `null` rather than `''` when there is nothing to store. */
export function cleanNickname(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().slice(0, NICKNAME_MAX)
  return trimmed || null
}
