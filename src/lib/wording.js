import { PROMPT_LANGS } from '../../shared/activity.js'

/**
 * The two language boxes for a question being opened.
 *
 * Per-language wording goes where it was written. A single-language `prompt`
 * from before the boxes existed is placed too, so it is not lost on the next
 * save — into the one box still blank if exactly one is, and otherwise into
 * the language the teacher is reading in, which is the best guess at the
 * language they wrote it in. A `prompt` that just repeats one of the
 * per-language versions (how seeded questions are stored) is left alone.
 */
export const initialWording = (question, lang) =>
  initialByLang(question?.promptByLang, question?.prompt, lang)

/** The same, for an activity's name: `titleByLang` beside the one `title`. */
export const initialNames = (activity, lang) =>
  initialByLang(activity?.titleByLang, activity?.title, lang)

export function initialByLang(byLang, single, lang) {
  const wording = { en: byLang?.en ?? '', tr: byLang?.tr ?? '' }

  const legacy = single?.trim()
  if (!legacy || PROMPT_LANGS.some((code) => wording[code].trim() === legacy)) return wording

  const blank = PROMPT_LANGS.filter((code) => !wording[code].trim())
  const slot = blank.length === 1 ? blank[0] : blank.length ? lang : null
  if (slot) wording[slot] = single
  return wording
}
