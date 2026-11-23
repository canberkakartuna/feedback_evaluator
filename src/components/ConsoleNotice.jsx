import { useT } from '../lib/i18n'

/**
 * The result of an action on an admin console page, pinned just under the
 * navbar where it is seen wherever the page is scrolled to.
 *
 * It used to sit in the page flow above the first card, so pressing Delete on a
 * row far down a long table put the answer — "deleted", or the reason it was
 * refused — off the top of the screen: the press looked like it did nothing.
 * Fixed rather than in flow also means it does not push the table down under
 * the pointer as it appears. It stays until dismissed or replaced, so a refusal
 * can be read at leisure.
 *
 * `notice` is `{ tone: 'good' | 'bad', text }`, as the pages already keep it.
 */
export default function ConsoleNotice({ notice, onDismiss }) {
  const t = useT()
  if (!notice) return null

  return (
    <div
      className="cs-note cs-notice-float"
      data-tone={notice.tone}
      role={notice.tone === 'bad' ? 'alert' : 'status'}
    >
      <span>{notice.text}</span>
      <button type="button" className="cs-notice-close" onClick={onDismiss} aria-label={t('common.dismiss')}>
        ×
      </button>
    </div>
  )
}
