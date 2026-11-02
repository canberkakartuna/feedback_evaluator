/**
 * How many times a student may write to the tutor about one question.
 *
 * Ten turns, then the chat on that question closes for two hours, then ten
 * more. It caps what one student can spend on the model, and it nudges them
 * to work rather than ask for the answer line by line.
 *
 * Derived from the thread, never stored. A counter on the answer would drift
 * the first time a write half-failed, and the thread is already the record
 * the dataset is built from — so the server (routes/tutor.js, which refuses
 * the eleventh ask) and the workspace (TutorPanel, which shows what is left)
 * both read the same messages through this one function and cannot disagree.
 *
 * Counted per question within a session. A signed-in student is sent back to
 * their existing session when they reopen an activity (routes/sessions.js),
 * so starting over does not hand out a fresh ten.
 *
 * In shared/ because both sides need it; the server's copy is the one that
 * holds.
 */

export const TURN_LIMIT = 10

export const TURN_LOCK_MS = 2 * 60 * 60 * 1000

/**
 * Where a question's tutor thread stands right now.
 *
 * `messages` is that question's thread, oldest first — the tutor's replies
 * and any client-side notes are skipped, so the panel's own state can be
 * passed in as it is. A window opens on the first ask, closes on the tenth,
 * and stays closed until two hours after that tenth ask; the next ask after
 * that opens a new window.
 *
 * @returns {{ limit: number, used: number, remaining: number, lockedUntil: string | null }}
 */
export function turnState(messages, now = Date.now()) {
  let used = 0
  let lockedUntil = null

  for (const message of messages ?? []) {
    if (message.from !== 'student') continue
    const at = Date.parse(message.createdAt)

    if (lockedUntil !== null && at >= lockedUntil) {
      used = 0
      lockedUntil = null
    }

    used += 1
    if (used >= TURN_LIMIT && lockedUntil === null) lockedUntil = at + TURN_LOCK_MS
  }

  if (lockedUntil !== null && now >= lockedUntil) {
    used = 0
    lockedUntil = null
  }

  return {
    limit: TURN_LIMIT,
    used,
    remaining: Math.max(0, TURN_LIMIT - used),
    lockedUntil: lockedUntil === null ? null : new Date(lockedUntil).toISOString(),
  }
}
