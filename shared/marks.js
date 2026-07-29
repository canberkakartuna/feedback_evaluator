/**
 * Two kinds of mark share one set of shapes.
 *
 * The automatic ones come from checking a written answer. The self-marks are
 * set by the student — green when they are done, yellow when they ran out of
 * time, red when they know they got it wrong. A self-mark always wins in the
 * sidebar, because the student's own read of it is the point.
 */

export const MARKS = {
  // automatic
  new: { label: 'Not started', short: 'New', tone: 'var(--graphite-faint)', shape: 'empty' },
  draft: { label: 'Drafted, not checked', short: 'Drafted', tone: 'var(--stamp)', shape: 'half' },
  revise: { label: 'Needs revision', short: 'Revise', tone: 'var(--margin)', shape: 'flag' },
  mastered: { label: 'Mastered', short: 'Mastered', tone: 'var(--pen)', shape: 'check' },

  // set by the student
  done: { label: 'Done', short: 'Done', tone: 'var(--pen)', shape: 'check' },
  unfinished: { label: 'Not finished', short: 'Unfinished', tone: 'var(--stamp)', shape: 'half' },
  wrong: { label: 'Got it wrong', short: 'Wrong', tone: 'var(--margin)', shape: 'flag' },
}

/** Kept as its own name because the key legend only lists automatic marks. */
export const STATUS = MARKS

export const SELF_MARKS = ['done', 'unfinished', 'wrong']

export const AUTO_MARKS = ['new', 'draft', 'revise', 'mastered']
