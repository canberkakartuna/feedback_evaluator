/**
 * The ready-made tutor prompts a teacher can start an activity's tutor
 * guidance from (`activity.tutorPrompt`) — see TutorGuidance in
 * src/routes/teacher/.
 *
 * Keys, not words: the label and the text both live in src/lib/strings.js
 * under `tutorGuide.*`, so the inserted text follows the interface language
 * like everything else the teacher reads.
 */
export const TUTOR_PRESETS = [
  { id: 'socratic', label: 'tutorGuide.socraticLabel', text: 'tutorGuide.socraticText' },
  { id: 'steps', label: 'tutorGuide.stepsLabel', text: 'tutorGuide.stepsText' },
  { id: 'errors', label: 'tutorGuide.errorsLabel', text: 'tutorGuide.errorsText' },
  { id: 'concise', label: 'tutorGuide.conciseLabel', text: 'tutorGuide.conciseText' },
]

/**
 * What the field holds after a template is picked.
 *
 * An empty field takes the template as it is. A field the teacher has already
 * written in keeps every word of it, and the template goes on the end after a
 * blank line — picking a template must never silently replace their text.
 * Picking the same template twice adds nothing. `null` when the result would
 * not fit in `max`, so the caller can say so rather than cut either text.
 *
 * @returns {{ text: string, appended: boolean } | null}
 */
export function withPreset(current, preset, max) {
  const mine = (current ?? '').trimEnd()
  const adding = (preset ?? '').trim()

  if (!adding) return { text: current ?? '', appended: false }
  if (!mine.trim()) return adding.length > max ? null : { text: adding, appended: false }
  if (mine.includes(adding)) return { text: current, appended: false }

  const text = `${mine}\n\n${adding}`
  return text.length > max ? null : { text, appended: true }
}
