import { removeBytes } from '../routes/uploads.js'

/**
 * Everything one session left behind, removed: answers, tutor thread, events,
 * own questions, the session itself, and the bytes of every file it uploaded.
 *
 * Used by `DELETE /api/sessions/:id`. Withdrawing consent from the profile
 * (`POST /api/auth/consent/withdraw`) no longer calls this: withdrawing from
 * the study keeps the work (design doc: "withdraw", not "withdraw and delete").
 */
export async function removeSessionData(store, session) {
  const removedUploads = await store.uploads.removeBySession(session.id)
  await Promise.all([
    store.answers.removeBySession(session.id),
    store.messages.removeBySession(session.id),
    store.events.removeBySession(session.id),
    store.ownQuestions.removeBySession(session.id),
    store.sessions.remove(session.id),
  ])

  // Files too, or "delete" is a lie. Goes through the storage backend so it
  // reaches Spaces as well as disk — see removeBytes in routes/uploads.js.
  await Promise.all(removedUploads.map(removeBytes))

  return { files: removedUploads.length }
}
