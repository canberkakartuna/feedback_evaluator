import { PROMPT_LANGS } from '../../shared/activity.js'
import { config } from '../config.js'
import { generate as openaiGenerate } from '../lib/openai.js'
import { ApiError, badRequest, unavailable } from '../lib/http.js'

/**
 * Translating a teacher's own text between the two interface languages — a
 * question's wording or an activity's name — so writing an activity in both
 * does not mean writing it twice.
 *
 * **A draft, never a decision.** The result goes back into the authoring
 * form, where the teacher reads it and saves it themselves; nothing here
 * writes to an activity. That is the whole safety story: a mistranslated
 * question is caught by the person who knows what it was meant to say, before
 * a student ever sees it.
 *
 * Same model and key as the tutor (lib/openai.js). With no key there is no
 * scripted stand-in worth offering — a "translation" that is the source text
 * again would be worse than an honest 503 — so the route says so and the
 * form tells the teacher to type it instead.
 */

const NAMES = { en: 'English', tr: 'Turkish' }

export const TRANSLATE_MAX = 5000

export function translationInstruction(from, to) {
  return [
    `You translate classroom material written by a teacher from ${NAMES[from]} to ${NAMES[to]}.`,
    'The readers are secondary-school students; keep the register and difficulty of the original.',
    'Leave every LaTeX expression ($…$, $$…$$, \\(…\\), \\[…\\]), number, unit, variable name, URL and line break exactly as written. Translate only the words around them.',
    `Use the conventions of ${NAMES[to]} mathematics teaching for terms and decimal separators in prose, but never inside LaTeX.`,
    'Reply with the translation alone: no quotation marks, no notes, no explanation. If the text is a short title, reply with a short title.',
  ].join('\n')
}

export async function translate({ text, from, to }, { generate = openaiGenerate } = {}) {
  if (typeof text !== 'string' || !text.trim()) throw badRequest('"text" must be a non-empty string')
  if (text.length > TRANSLATE_MAX) throw badRequest(`"text" must be at most ${TRANSLATE_MAX} characters`)
  if (!PROMPT_LANGS.includes(from) || !PROMPT_LANGS.includes(to)) {
    throw badRequest(`"from" and "to" must each be one of: ${PROMPT_LANGS.join(', ')}`)
  }
  if (from === to) throw badRequest('"from" and "to" must be different languages')

  if (!config.openai.configured && generate === openaiGenerate) {
    throw unavailable('AI translation is not set up on this server (OPENAI_API_KEY is unset)')
  }

  try {
    const result = await generate({
      system: translationInstruction(from, to),
      turns: [{ role: 'user', text: text.trim() }],
      // A teacher is waiting on a button, not a student on a chat — and a long
      // question can take a while to reason over.
      timeoutMs: 45000,
    })
    return { text: result.text, model: result.model ?? null }
  } catch (error) {
    if (error instanceof ApiError) throw error
    console.warn('[translate] model failed:', error?.message)
    throw unavailable('The AI translation did not come back — try again, or type it yourself')
  }
}
