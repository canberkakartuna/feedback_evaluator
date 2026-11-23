/**
 * The student's text as the maths editor holds it, and as everything else
 * stores it.
 *
 * Stored, sent and saved, a message or an answer is what it has always been:
 * plain text with the maths in `$…$` (see latex.js), so the server, the tutor
 * prompt, MathText, the teacher's views and every export read it unchanged.
 * The editor (src/components/MathEditor.jsx) shows the same text as prose with
 * rendered, editable formulas in it. This file is the pure part of that: text
 * to segments and back, and nothing that needs a DOM.
 *
 * **Round trip.** A formula keeps the exact source and delimiters it was
 * loaded with until the student edits it, so `serialiseDraft(parseDraft(x))`
 * is `x` for any `x` — opening an old draft and leaving it alone changes
 * nothing and saves nothing.
 */
import { splitMath } from './latex.js'

/** The server refuses a longer tutor message — server/routes/tutor.js. */
export const MAX_MESSAGE_LENGTH = 4000

/** …and a longer written answer — server/routes/answers.js. */
export const MAX_ANSWER_LENGTH = 20000

/**
 * The maths row, in order. `label` is LaTeX for the button face; `insert` is
 * what the formula editor (MathLive) inserts, in its own template language:
 * `#?` an empty box to fill, `#0` the selection (a box when nothing is
 * selected), `#@` the selection or whatever was typed just before the cursor —
 * so "2" then the power button gives 2 with an empty exponent.
 */
export const MATH_BUTTONS = [
  { id: 'power', label: 'x^{n}', insert: '#@^{#?}' },
  { id: 'subscript', label: 'x_{n}', insert: '#@_{#?}' },
  { id: 'fraction', label: String.raw`\dfrac{a}{b}`, insert: String.raw`\frac{#@}{#?}` },
  { id: 'sqrt', label: String.raw`\sqrt{x}`, insert: String.raw`\sqrt{#0}` },
  { id: 'integral', label: String.raw`\int`, insert: String.raw`\int_{#?}^{#?}#0\,dx` },
  { id: 'sum', label: String.raw`\sum`, insert: String.raw`\sum_{#?}^{#?}#0` },
  { id: 'pi', label: String.raw`\pi`, insert: String.raw`\pi` },
  { id: 'infinity', label: String.raw`\infty`, insert: String.raw`\infty` },
  { id: 'le', label: String.raw`\le`, insert: String.raw`\le` },
  { id: 'ge', label: String.raw`\ge`, insert: String.raw`\ge` },
  { id: 'ne', label: String.raw`\ne`, insert: String.raw`\ne` },
  { id: 'times', label: String.raw`\times`, insert: String.raw`\times` },
  { id: 'divide', label: String.raw`\div`, insert: String.raw`\div` },
]

/** Whether a button leaves boxes to fill (the cursor stays in the formula) or not (a symbol). */
export const hasBoxes = (button) => /#[?@0]/.test(button.insert)

/**
 * `[{ kind: 'text', value }, { kind: 'math', latex, open, close }, ...]`,
 * covering every character of `text` once, with each formula's own
 * delimiters (`$`, `$$`, `\(`, `\[`) so it can be written back as it was.
 */
export function parseDraft(text) {
  const draft = text ?? ''
  const segments = []
  let at = 0
  for (const segment of splitMath(draft)) {
    if (segment.kind === 'text') {
      segments.push({ kind: 'text', value: segment.value })
      at += segment.value.length
      continue
    }
    // The value starts right after its opening delimiter, and the closing one
    // is the same length.
    const start = draft.indexOf(segment.value, at)
    const size = start - at
    const end = start + segment.value.length
    segments.push({
      kind: 'math',
      latex: segment.value,
      open: draft.slice(at, start),
      close: draft.slice(end, end + size),
    })
    at = end + size
  }
  return segments
}

/**
 * The editor's LaTeX, made fit to store between `$…$`:
 *
 * - an empty box left unfilled becomes an empty group, `\frac{1}{}` — KaTeX
 *   draws it as nothing, and the tutor model reads it as "not filled in";
 * - no line breaks and no padding, which `$…$` does not allow (latex.js);
 * - no literal `$`, which would end the formula early;
 * - MathLive's shorthand `\frac12` and `\sqrt9` written out as `\frac{1}{2}`
 *   and `\sqrt{9}`, which the tutor model reads more reliably.
 */
export function cleanLatex(latex) {
  return (latex ?? '')
    .replaceAll(/\\placeholder(?:\[[^\]]*\])?\{[^{}]*\}/g, '')
    .replaceAll(/\\([dt]?frac)([0-9A-Za-z])([0-9A-Za-z])/g, '\\$1{$2}{$3}')
    .replaceAll(/\\sqrt([0-9A-Za-z])/g, '\\sqrt{$1}')
    .replaceAll('\\$', '\\text{\\textdollar}')
    .replaceAll('$', '')
    .replaceAll(/\s*\n\s*/g, ' ')
    .trim()
}

/**
 * The text to store. Text segments go back as they are. A formula goes back
 * exactly as loaded unless `fresh` (new, or edited since), when its LaTeX is
 * cleaned, it is wrapped in `$…$` — unless it came with other delimiters — and
 * an empty one is dropped. Two formulas, or a formula and a "$", that would
 * touch get a space between them, or "$x$$y$" would read as "$$".
 */
export function serialiseDraft(segments) {
  let out = ''
  let previousFresh = false
  for (const segment of segments ?? []) {
    if (segment.kind === 'text') {
      if (previousFresh && out.endsWith('$') && segment.value.startsWith('$')) out += ' '
      out += segment.value
      previousFresh = false
      continue
    }
    if (!segment.fresh) {
      out += `${segment.open}${segment.latex}${segment.close}`
      previousFresh = false
      continue
    }
    const latex = cleanLatex(segment.latex)
    if (!latex) continue
    const open = segment.open || '$'
    const close = segment.close || '$'
    if (out.endsWith('$') && open.startsWith('$')) out += ' '
    out += `${open}${latex}${close}`
    previousFresh = true
  }
  return out
}
