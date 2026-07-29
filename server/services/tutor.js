import { fallbackReplies } from '../../shared/course.js'
import { hasContent, uploadedFiles } from '../../shared/answer.js'
import { wordCount } from '../../shared/marking.js'
import { badRequest } from '../lib/http.js'

/**
 * Where the tutor's replies come from.
 *
 * Canned for now, but the shape is the one a model call needs to fill: given a
 * question, the answer so far, the thread, and the active system prompt, return
 * one reply. Swap the body of `reply` for the API call and nothing else moves.
 *
 * Hint escalation lives here on purpose. The server counts hints and holds the
 * text, so a student cannot read hint three out of the page before asking for
 * hint one.
 */

export const ACTIONS = ['hint', 'concept', 'example', 'review']

const ASKS = {
  hint: (used) => (used === 0 ? 'Give me a hint.' : 'Another hint, please.'),
  concept: () => 'Explain the concept behind this.',
  example: () => 'Show me a worked example.',
  review: () => 'Check my reasoning.',
}

export function studentAsk(action, hintsUsed) {
  if (!ACTIONS.includes(action)) throw badRequest(`Unknown action "${action}"`)
  return ASKS[action](hintsUsed)
}

/**
 * @returns {{ text: string, label?: string, hintsUsed: number, source: string }}
 */
export function reply({ question, answer, action, text, promptVersion }) {
  const hintsUsed = answer?.hintsUsed ?? 0
  const state = answerShape(answer)
  const base = { hintsUsed, source: 'scripted', promptVersion }

  if (!action) {
    const words = wordCount(text ?? '')
    return {
      ...base,
      text: fallbackReplies[words % fallbackReplies.length],
    }
  }

  if (action === 'hint') {
    if (hintsUsed >= question.tutor.hints.length) {
      return {
        ...base,
        text: `That was the last hint for ${question.code}. Write what you have and press Check my answer — I will mark it against the rubric and name what is missing.`,
      }
    }
    return {
      ...base,
      label: `Hint ${hintsUsed + 1} of ${question.tutor.hints.length}`,
      text: question.tutor.hints[hintsUsed],
      hintsUsed: hintsUsed + 1,
    }
  }

  if (action === 'concept') {
    return { ...base, label: 'The concept', text: question.tutor.concept }
  }

  if (action === 'example') {
    return { ...base, label: 'Worked example', text: question.tutor.example }
  }

  // review
  if (state.mode === 'write' && wordCount(state.draft) >= 4) {
    return { ...base, label: 'Watch for this', text: question.tutor.misconception }
  }

  if (hasContent(state)) {
    return {
      ...base,
      text: 'I cannot read a drawing or a photo yet, so I cannot check that working directly. Talk me through your reasoning here and I will tell you where it goes wrong.',
    }
  }

  return {
    ...base,
    text: 'There is nothing to check yet. Put something in your answer and I will read it back to you.',
  }
}

/** The shape shared/answer.js expects, whatever the stored answer looks like. */
export function answerShape(answer) {
  return {
    mode: answer?.mode ?? 'write',
    draft: answer?.draft ?? '',
    strokes: answer?.strokes ?? [],
    attachments: answer?.attachments ?? [],
  }
}

export { uploadedFiles }
