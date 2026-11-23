/**
 * What a button on the tutor's maths row puts into the student's message.
 *
 * Pure so it can be unit-tested without a DOM: given the draft, where the
 * cursor (or selection) is, and which button was pressed, it returns the new
 * draft and where the cursor should land. MathTools.jsx only applies it.
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
 * - Every blank to fill is an empty {} — "\frac{}{}", "{}^{}", the limits and
 *   body of "\int_{}^{}{}\,dx" — so moving between blanks (nextBlank below) and
 *   showing them in the preview (showBlanks) have one rule to follow.
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
  {
    id: 'integral',
    label: String.raw`\int`,
    template: String.raw`\int_{${SLOT}}^{${SLOT}}{${SELECTION}}\,dx`,
  },
  { id: 'sum', label: String.raw`\sum`, template: String.raw`\sum_{${SLOT}}^{${SLOT}}{${SELECTION}}` },
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
 * delimiters — in the raw text, and the length of its delimiter. splitMath
 * covers every character once and a formula's value starts right after its
 * opening delimiter, so the raw offsets can be recovered from the segments.
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
    ranges.push([start, start + segment.value.length, open])
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
  // Outside one, an empty base is a blank of its own: {}^{}.
  const empty = snippet.takesBase ? (inMath ? '' : `{${SLOT}}`) : SLOT
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

/** The formula [start, end] sits in, as [from, to, delimiter length], or undefined. */
const formulaAt = (text, start, end) =>
  mathRanges(text).find(([from, to]) => start >= from && end <= to)

/** Positions of the empty, unescaped {} pairs in text[from, to). */
function blanks(text, from, to) {
  const found = []
  for (let at = text.indexOf('{}', from); at !== -1 && at + 1 < to; at = text.indexOf('{}', at + 1)) {
    if (text[at - 1] !== '\\') found.push(at)
  }
  return found
}

/**
 * Where Tab (or the "next blank" button) takes the cursor.
 *
 * Inside a formula: into the next empty {} after the cursor, and once there is
 * none left, out past the formula's closing delimiter so the student carries
 * on writing. Outside a formula: null, so Tab does what it always does and
 * focus is never trapped. A cursor already in an empty {} moves on to the next
 * one.
 *
 * @returns {{ selectionStart: number, selectionEnd: number } | null}
 */
export function nextBlank(text, selectionStart, selectionEnd = selectionStart) {
  const draft = text ?? ''
  const formula = formulaAt(draft, selectionStart, selectionEnd)
  if (!formula) return null
  const [, to, open] = formula
  const [blank] = blanks(draft, selectionEnd, to)
  const caret = blank === undefined ? to + open : blank + 1
  return { selectionStart: caret, selectionEnd: caret }
}

/**
 * Shift+Tab: back into the previous empty {} in the same formula, or null —
 * nothing to go back to, so Shift+Tab moves focus as usual.
 */
export function previousBlank(text, selectionStart, selectionEnd = selectionStart) {
  const draft = text ?? ''
  const formula = formulaAt(draft, selectionStart, selectionEnd)
  if (!formula) return null
  const [from] = formula
  // A blank ending before the cursor: not the one the cursor is already in.
  const earlier = blanks(draft, from, selectionStart).filter((at) => at + 1 < selectionStart)
  if (!earlier.length) return null
  const caret = earlier[earlier.length - 1] + 1
  return { selectionStart: caret, selectionEnd: caret }
}

/**
 * The text as the *preview* shows it: every empty {} inside a formula drawn as
 * a box, so "\frac{2}{}" shows a fraction with a square to fill rather than
 * nothing under the line. Never applied to what is saved or sent.
 */
export function showBlanks(text) {
  const draft = text ?? ''
  const ranges = mathRanges(draft)
  if (!ranges.length) return draft
  let out = ''
  let at = 0
  for (const [from, to] of ranges) {
    for (const blank of blanks(draft, from, to)) {
      out += draft.slice(at, blank) + '{\\square}'
      at = blank + 2
    }
  }
  return out + draft.slice(at)
}
