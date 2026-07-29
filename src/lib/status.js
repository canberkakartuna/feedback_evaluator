/** The sidebar's structural device: where each question stands, not its number. */
export const STATUS = {
  new: { label: 'Not started', short: 'New', tone: 'var(--graphite-faint)' },
  draft: { label: 'Drafted, not checked', short: 'Drafted', tone: 'var(--stamp)' },
  revise: { label: 'Needs revision', short: 'Revise', tone: 'var(--margin)' },
  mastered: { label: 'Mastered', short: 'Mastered', tone: 'var(--pen)' },
}

export const STATUS_ORDER = ['new', 'draft', 'revise', 'mastered']
