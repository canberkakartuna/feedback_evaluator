/**
 * Finding the LaTeX inside a teacher's text.
 *
 * Prompts and answers are content — typed by a teacher, stored verbatim — and
 * some of that content is mathematics. Rather than a separate "math field" or
 * a mode switch, the ordinary delimiters work anywhere in the text and the
 * rest stays prose:
 *
 *   $...$    and \( ... \)   inline
 *   $$...$$  and \[ ... \]   display (on its own line, centred)
 *
 * This file only *splits*; rendering is MathText.jsx's job, and the split is
 * shared so the form's preview and the student's page cannot disagree about
 * what counts as math.
 *
 * A single `$` is a currency sign more often than a formula, so `$...$` only
 * matches when the inside starts and ends on non-whitespace ("$5" or "5 $"
 * never opens a formula) and stays on one line. The backslash forms have no
 * such ambiguity and match across lines.
 */

const MATH = new RegExp(
  [
    String.raw`\$\$([\s\S]+?)\$\$`, //  $$ ... $$
    String.raw`\\\[([\s\S]+?)\\\]`, //  \[ ... \]
    String.raw`\\\(([\s\S]+?)\\\)`, //  \( ... \)
    String.raw`\$((?!\s)(?:[^$\n]*[^\s$])?)\$`, //  $ ... $, one line, no padding
  ].join('|'),
  'g',
)

/** Whether rendering would change anything — what gates the form's preview. */
export function hasMath(text) {
  if (!text) return false
  MATH.lastIndex = 0
  return MATH.test(text)
}

/**
 * `[{ kind: 'text', value }, { kind: 'math', value, display }, ...]`, in
 * order, covering every character of the input exactly once.
 */
export function splitMath(text) {
  if (!text) return []

  const segments = []
  let last = 0

  MATH.lastIndex = 0
  for (let match = MATH.exec(text); match; match = MATH.exec(text)) {
    if (match.index > last) {
      segments.push({ kind: 'text', value: text.slice(last, match.index) })
    }

    const [display, bracket, inline, dollar] = [match[1], match[2], match[3], match[4]]
    const value = display ?? bracket ?? inline ?? dollar

    if (value?.trim()) {
      segments.push({
        kind: 'math',
        value,
        display: display !== undefined || bracket !== undefined,
      })
    } else {
      // "$$" or "$ $" — empty math is almost certainly punctuation, not a
      // formula. Keep the characters as the teacher typed them.
      segments.push({ kind: 'text', value: match[0] })
    }

    last = match.index + match[0].length
  }

  if (last < text.length) segments.push({ kind: 'text', value: text.slice(last) })

  return segments
}
