import { createHmac } from 'node:crypto'
import { config } from '../config.js'
import { datasetIdsOf } from '../../shared/datasets.js'

/**
 * A snippet is one student turn and the feedback that answered it — the unit
 * the doc names as what gets read, kept or dropped, and then labelled.
 *
 * Snippets are derived from the transcript rather than stored, so they stay
 * correct if a transcript grows. Only the decision about each one (keep it,
 * how it was labelled) is persisted, keyed by a stable id built from the pair.
 */

export function buildSnippets(messages) {
  const snippets = []

  for (let i = 0; i < messages.length - 1; i += 1) {
    const ask = messages[i]
    const answer = messages[i + 1]

    // Same session and question as well as the right shape. The list can span
    // both — `listAll` covers every session, `listBySession` every question —
    // and without this an ask at the end of one group would pair with the reply
    // at the start of the next.
    const isPair =
      ask.from === 'student' &&
      answer.from === 'tutor' &&
      answer.kind === 'reply' &&
      ask.sessionId === answer.sessionId &&
      ask.questionId === answer.questionId

    if (!isPair) continue

    snippets.push({
      id: `${ask.sessionId}:${ask.questionId}:${ask.seq}`,
      sessionId: ask.sessionId,
      questionId: ask.questionId,
      student: { text: ask.text, at: ask.createdAt },
      tutor: {
        text: answer.text,
        label: answer.label ?? null,
        /**
         * Who wrote it: `openai`, `scripted` (a teacher's own words) or
         * `fallback` (the model failed) — see services/tutor.js. A label on
         * generated feedback, a label on a teacher's hint and a label on a
         * generic line the model never got to write are three different
         * measurements, and without this they are one column of text. `null` on
         * anything recorded before the field existed.
         *
         * Carried in the payload but deliberately not shown in the labelling
         * screen: a teacher who can see which replies the model wrote is no
         * longer labelling them blind.
         */
        source: answer.source ?? null,
        model: answer.model ?? null,
        at: answer.createdAt,
      },
      rating: answer.rating ?? null,
      turnIndex: i,
    })
  }

  return snippets
}

/**
 * The labels a teacher applies. Each criterion gets yes / no / partly plus an
 * optional reason, which is the three-way choice the doc asks for.
 */
export const LABEL_VALUES = ['yes', 'no', 'partly']

export const DEFAULT_CRITERIA = [
  { id: 'specific', label: 'Points at something specific in the student’s work' },
  { id: 'actionable', label: 'Gives the student a next step they can take' },
  { id: 'no-answer', label: 'Stops short of handing over the answer' },
  { id: 'accurate', label: 'Is factually correct' },
  { id: 'tone', label: 'Tone suits a student who is stuck' },
]

export function attachLabels(snippets, labels) {
  return snippets.map((snippet) => ({
    ...snippet,
    included: labels.get(snippet.id)?.included ?? null,
    labels: labels.get(snippet.id)?.labels ?? {},
    note: labels.get(snippet.id)?.note ?? '',
    /**
     * A reason per criterion (criterionId -> text). `note` above is the single
     * overall reason the screen used to ask for; it stays as written for
     * snippets labelled before this existed, and is not offered for new ones.
     */
    notes: labels.get(snippet.id)?.notes ?? {},
    /**
     * Which annotator this snippet is assigned to, if any — see
     * `POST /api/research/snippets/assign`. Stored on the same label record.
     */
    assigneeId: labels.get(snippet.id)?.assigneeId ?? null,
    assignedBy: labels.get(snippet.id)?.assignedBy ?? null,
    assignedAt: labels.get(snippet.id)?.assignedAt ?? null,
    /**
     * The datasets this snippet is in (shared/datasets.js). A record from
     * before datasets existed reads as the default dataset when it was kept.
     */
    datasetIds: datasetIdsOf(labels.get(snippet.id)),
  }))
}

/**
 * What an annotator calls a snippet, in place of its id.
 *
 * A snippet id is `sessionId:questionId:seq`, and a session id is all the
 * session routes ask for — they have to be open to anonymous students — so an
 * id in an annotator's hands is the student's whole session. This is a keyed
 * hash of the id instead: it says nothing about the session, cannot be turned
 * back into it without the server's key, and is different for every annotator
 * (the annotator's id is hashed in), so one annotator's handle is nothing to
 * another. It is deterministic, which is what lets the server resolve one by
 * recomputing it over that annotator's assignments: no lookup table to store,
 * the same on both stores.
 *
 * 22 base64url characters is 132 bits of the HMAC — far past guessing, and
 * short enough to sit in a URL.
 */
export function snippetHandle(annotatorId, snippetId) {
  return createHmac('sha256', config.snippetHandleKey)
    .update(`${annotatorId}|${snippetId}`)
    .digest('base64url')
    .slice(0, 22)
}
