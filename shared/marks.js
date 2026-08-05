/**
 * Two kinds of mark share one set of shapes.
 *
 * The automatic ones come from checking a written answer. The self-marks are
 * set by the student — green when they are done, yellow when they ran out of
 * time, red when they know they got it wrong. A self-mark always wins in the
 * sidebar, because the student's own read of it is the point.
 *
 * **A mark is an id, a colour and a shape — never a word.** The words are
 * interface text and live in src/lib/strings.js under `marks.*`, two per id:
 * `marks.<id>Label` for the full name and `marks.<id>Short` for the sidebar and
 * the key. They used to be here, which meant a shared module that both the API
 * and the browser import decided what language the interface was in.
 */

export const MARKS = {
  // automatic
  new: { tone: 'var(--graphite-faint)', shape: 'empty' },
  draft: { tone: 'var(--stamp)', shape: 'half' },
  revise: { tone: 'var(--margin)', shape: 'flag' },
  mastered: { tone: 'var(--pen)', shape: 'check' },

  // set by the student
  done: { tone: 'var(--pen)', shape: 'check' },
  unfinished: { tone: 'var(--stamp)', shape: 'half' },
  wrong: { tone: 'var(--margin)', shape: 'flag' },
}

/** Kept as its own name because the key legend only lists automatic marks. */
export const STATUS = MARKS

export const SELF_MARKS = ['done', 'unfinished', 'wrong']

export const AUTO_MARKS = ['new', 'draft', 'revise', 'mastered']

/** The two string keys for a mark, so no caller builds them by hand. */
export const markLabelKey = (mark) => `marks.${mark}Label`
export const markShortKey = (mark) => `marks.${mark}Short`
