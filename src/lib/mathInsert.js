/**
 * What a button on the tutor's maths row puts into the student's message.
 *
 * Pure so it can be unit-tested without a DOM: given the draft, where the
 * cursor (or selection) is, and which button was pressed, it returns the new
 * draft and where the cursor should land. TutorPanel.jsx only applies it.
 *
 * - The LaTeX goes in at the cursor. A selection becomes the part of the
 *   formula it most likely is — the base of a power or subscript, the
 *   numerator of a fraction, what sits under a root, the integrand, the
 *   summand. A symbol replaces the selection, as typing would.
 * - With no selection, a power or subscript outside a formula takes the
 *   letters or digits right before the cursor as its base, so "x" then the
 *   power button gives $x^{}$ rather than an x outside the formula. Inside a
 *   formula the base is already there, and the cursor goes to the exponent.
 * - It is wrapped in $…$ unless the cursor is already inside a formula
 *   (as splitMath in latex.js reads one), so the student never types a
 *   delimiter and the result is always something MathText renders. A
 *   selection spanning lines is wrapped in \( … \) instead, since $…$ stays
 *   on one line.
 * - The cursor lands in the first empty slot. With every slot filled (a
 *   symbol, or a root around a selection) it lands after the formula when one
 *   was opened, so the student carries on writing prose, and after the
 *   insertion when they were already inside one.
 *
 * Symbols are inserted as their Unicode characters (π, ≤, ×), which KaTeX
 * renders as the same symbols: unlike \pi they never run into the next letter
 * typed ("\pix"), and they read the same in the stored text.
 */
import { splitMath } from './latex.js'

/** The server refuses a longer tutor message — server/routes/tutor.js. */
export const MAX_MESSAGE_LENGTH = 4000

/** …and a longer written answer — server/routes/answers.js. */
export const MAX_ANSWER_LENGTH = 20000

const SELECTION = '\u0001'
const SLOT = '\u0002'

/**
 * In the order the row shows them. `label` is LaTeX for the button face;
 * `template` marks where the selection goes (SELECTION, which is an empty
 * slot when nothing is selected) and the other slots to fill (SLOT).
 */
export const MATH_SNIPPETS = [
  { id: 'power', label: 'x^{n}', template: `${SELECTION}^{${SLOT}}`, takesBase: true },
  { id: 'subscript', label: 'x_{n}', template: `${SELECTION}_{${SLOT}}`, takesBase: true },
  { id: 'fraction', label: String.raw`\dfrac{a}{b}`, template: String.raw`\frac{${SELECTION}}{${SLOT}}` },
  { id: 'sqrt', label: String.raw`\sqrt{x}`, template: String.raw`\sqrt{${SELECTION}}` },
  { id: 'integral', label: String.raw`\int`, template: String.raw`\int_{${SLOT}}^{${SLOT}}${SELECTION}\,dx` },
  { id: 'sum', label: String.raw`\sum`, template: String.raw`\sum_{${SLOT}}^{${SLOT}}${SELECTION}` },
  { id: 'pi', label: 'π', template: 'π' },
  { id: 'infinity', label: '∞', template: '∞' },
  { id: 'le', label: '≤', template: '≤' },
  { id: 'ge', label: '≥', template: '≥' },
  { id: 'ne', label: '≠', template: '≠' },
  { id: 'times', label: '×', template: '×' },
  { id: 'divide', label: '÷', template: '÷' },
]

const BY_ID = new Map(MATH_SNIPPETS.map((snippet) => [snippet.id, snippet]))

/**
 * The [start, end) range of each formula's *inside* — between its
 * delimiters — in the raw text. splitMath covers every character once and a
 * formula's value starts right after its opening delimiter, so the raw
 * offsets can be recovered from the segments.
 */
function mathRanges(text) {
  const ranges = []
  let at = 0
  for (const segment of splitMath(text)) {
    if (segment.kind === 'text') {
      at += segment.value.length
      continue
    }
    const start = text.indexOf(segment.value, at)
    const open = start - at
    ranges.push([start, start + segment.value.length])
    at = start + segment.value.length + open
  }
  return ranges
}

/** Whether [start, end] lies inside one formula, touching its delimiters counts. */
export function insideMath(text, start, end = start) {
  return mathRanges(text).some(([from, to]) => start >= from && end <= to)
}

/**
 * @returns {{ text: string, selectionStart: number, selectionEnd: number } | null}
 *   null for an unknown button or when the text would pass `maxLength`, the
 *   server's limit for that box.
 */
export function insertMath(text, selectionStart, selectionEnd, id, maxLength = MAX_MESSAGE_LENGTH) {
  const snippet = BY_ID.get(id)
  if (!snippet) return null

  const draft = text ?? ''
  let start = Math.max(0, Math.min(selectionStart ?? draft.length, draft.length))
  let end = Math.max(start, Math.min(selectionEnd ?? start, draft.length))

  // Spaces at the edges of a selection stay outside the formula: "$ x$" is not
  // one (see latex.js).
  while (start < end && /\s/.test(draft[start])) start += 1
  while (end > start && /\s/.test(draft[end - 1])) end -= 1

  const inMath = insideMath(draft, start, end)

  if (start === end && snippet.takesBase && !inMath) {
    const base = /[\p{L}\p{N}]+$/u.exec(draft.slice(0, start))
    if (base) start -= base[0].length
  }

  const selected = draft.slice(start, end)
  // Inside a formula the base of a power is whatever the student wrote before
  // the cursor, so the exponent is the slot to fill.
  const empty = inMath && snippet.takesBase ? '' : SLOT
  let body = snippet.template.includes(SELECTION)
    ? // A function, so a "$" in the selection is not read as a replacement pattern.
      snippet.template.replace(SELECTION, () => selected || empty)
    : snippet.template

  const firstSlot = body.indexOf(SLOT)
  body = body.replaceAll(SLOT, '')

  let open = ''
  let close = ''
  if (!inMath) {
    ;[open, close] = body.includes('\n') ? ['\\(', '\\)'] : ['$', '$']
    // Right against another formula's "$", the two would read as "$$" — the
    // display delimiter — so a space keeps them apart.
    if (open === '$' && draft[start - 1] === '$') open = ' $'
    if (close === '$' && draft[end] === '$') close = '$ '
  }

  const inserted = open + body + close
  const next = draft.slice(0, start) + inserted + draft.slice(end)
  if (next.length > maxLength) return null

  const caret = start + (firstSlot === -1 ? inserted.length : open.length + firstSlot)
  return { text: next, selectionStart: caret, selectionEnd: caret }
}
