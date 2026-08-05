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
 * `fallbackReplies` stands in for the model call in services/tutor.js. When
 * that becomes a real request against the active system prompt, these stay as
 * the answer to "the call failed and the student is still waiting".
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
 * as written. They are English until the model call replaces them.
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
 */
export function withFallbacks(tutor) {
  const script = tutor ?? {}
  return {
    hints: script.hints?.length ? script.hints : ownTutor.hints,
    concept: script.concept?.trim() || ownTutor.concept,
    example: script.example?.trim() || ownTutor.example,
    misconception: script.misconception?.trim() || ownTutor.misconception,
  }
}

export const fallbackReplies = [
  'Good — say more about the second half of that. Which part are you least sure of?',
  'That is the right instinct, but the step in between is missing. What links those two ideas?',
  'Close. One term in there is doing the wrong job — read it back and tell me which one you would swap.',
  'Yes. Now write it as one sentence in your answer box and I will read the phrasing.',
  'Let us test that. If it were true, what would you expect the result to look like instead?',
]
