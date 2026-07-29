/**
 * Placeholder for the marking API.
 *
 * Keyword matching is deliberately naive — it exists so the feedback card
 * reacts to what the student actually wrote instead of showing a canned
 * score. Replace the body of evaluateAnswer with the API call; the returned
 * shape is what QuestionPanel renders.
 */

const MIN_WORDS = 8

export function wordCount(text) {
  return text.trim().split(/\s+/).filter(Boolean).length
}

export function evaluateAnswer(question, text) {
  const words = wordCount(text)
  const haystack = text.toLowerCase()

  const criteria = question.rubric.map((criterion) => ({
    id: criterion.id,
    label: criterion.label,
    points: criterion.points,
    coach: criterion.coach,
    met: words >= MIN_WORDS && criterion.keywords.some((k) => haystack.includes(k)),
  }))

  const total = criteria.reduce((sum, c) => sum + c.points, 0)
  const earned = criteria.reduce((sum, c) => (c.met ? sum + c.points : sum), 0)
  const missed = criteria.filter((c) => !c.met)

  return {
    earned,
    total,
    words,
    criteria,
    verdict: earned === total ? 'mastered' : 'revise',
    summary: buildSummary(earned, total, words),
    nextStep: missed.length ? missed[0].coach : null,
  }
}

function buildSummary(earned, total, words) {
  if (words < MIN_WORDS) {
    return 'There is not enough here to mark yet. Write a couple of sentences and check again.'
  }
  if (earned === total) {
    return 'Every rubric point is covered, and the reasoning runs in the right order. Move on.'
  }
  if (earned === 0) {
    return 'The answer is on topic but none of the rubric points land yet. Work through the first one below.'
  }
  return `${earned} of ${total} rubric points land. The gap is a missing step, not a wrong idea — fix the first one below.`
}
