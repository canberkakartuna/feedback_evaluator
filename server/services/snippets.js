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
      tutor: { text: answer.text, label: answer.label ?? null, at: answer.createdAt },
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
  }))
}
