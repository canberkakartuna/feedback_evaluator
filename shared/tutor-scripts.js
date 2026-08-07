/**
 * Generic tutor lines, used when a question carries no script of its own.
 *
 * Two cases reach these, and neither is a content gap to be filled in later:
 *
 * - a question the **student** typed in themselves, which by definition nobody
 *   wrote hints for;
 * - a question the **teacher** created without filling in the optional tutor
 *   fields, which shared/activity.js allows on purpose.
 *
 * Everything here is deliberately subject-neutral — it has to read sensibly
 * against a question this file has never seen. Anything specific to a topic
 * belongs on the question, authored by the teacher who set it.
 *
 * `fallbackReplies` is what the tutor says when the model cannot: no
 * `GEMINI_API_KEY`, a timeout, a rate limit, a blocked prompt. They are not
 * decoration — a student pressing send is owed a sentence, and an empty bubble
 * or a stack trace is worse than a generic nudge. Keep them answerable against
 * any question, because that is the situation they are read in.
 */

/**
 * No `opening` here, on purpose.
 *
 * The chat's first line is the one tutor field the browser renders itself, so an
 * unauthored one is interface text and belongs with the rest of it — see
 * `tp.opening` in src/lib/strings.js, which exists in both languages. Putting a
 * generic English sentence in this file meant `publicQuestion` shipped it as if
 * a teacher had written it, and nothing downstream could tell the difference or
 * translate it.
 *
 * The rest of these lines are delivered as tutor *replies*, a step at a time,
 * and follow the same rule as the marking summaries: produced server-side, shown
 * as written. **They are the unconfigured and the failed path only.** With
 * `GEMINI_API_KEY` set, a question nobody wrote a script for is answered by the
 * model instead — which is also the only way it gets answered in Turkish, since
 * these are English wherever the interface is.
 */
export const ownTutor = {
  hints: [
    'Tell me what you have tried so far. The first line that stopped making sense is usually where to start.',
    'Write down what you know and what you are looking for, then find the rule that connects the two.',
    'Try the smallest version of this problem first — smaller numbers, one variable — then scale it back up.',
  ],
  concept:
    'Tell me which topic this belongs to and I will lay out the idea behind it before we touch any numbers.',
  example:
    'Give me the exact question and I will work through a similar one line by line, then you try yours.',
  misconception:
    'Read your working back one line at a time and justify each step out loud. The first line you cannot justify is the line with the mistake in it.',
}

/**
 * Filled in per field, so a teacher who wrote hints but no worked example gets
 * their hints and a sensible stand-in for the example — not all-or-nothing.
 *
 * `authored` records which fields were real, because once a model is answering
 * that difference decides who speaks: services/tutor.js delivers a teacher's
 * own hint, concept or worked example verbatim, and asks the model only where
 * nobody wrote one. Server-side only, like the rest of this object —
 * `publicQuestion` is an allow-list and does not carry it.
 */
export function withFallbacks(tutor) {
  const script = tutor ?? {}
  return {
    hints: script.hints?.length ? script.hints : ownTutor.hints,
    concept: script.concept?.trim() || ownTutor.concept,
    example: script.example?.trim() || ownTutor.example,
    misconception: script.misconception?.trim() || ownTutor.misconception,
    authored: {
      hints: Boolean(script.hints?.length),
      concept: Boolean(script.concept?.trim()),
      example: Boolean(script.example?.trim()),
      misconception: Boolean(script.misconception?.trim()),
    },
  }
}

export const fallbackReplies = [
  'Good — say more about the second half of that. Which part are you least sure of?',
  'That is the right instinct, but the step in between is missing. What links those two ideas?',
  'Close. One term in there is doing the wrong job — read it back and tell me which one you would swap.',
  'Yes. Now write it as one sentence in your answer box and I will read the phrasing.',
  'Let us test that. If it were true, what would you expect the result to look like instead?',
]
