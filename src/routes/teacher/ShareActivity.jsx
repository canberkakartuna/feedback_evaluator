import { useEffect, useState } from 'react'
import { useT } from '../../lib/i18n'

/**
 * How a class gets in: the code to read out, and the link to hand over.
 *
 * Both point at the same place, because they are the same fact told to two kinds
 * of room — a code for a projector and a class saying it back, a link for a chat
 * message, a QR code or a worksheet. The link is built from `window.location` so
 * it is correct on localhost, on a preview deployment and in production without
 * anything being configured.
 *
 * It is shown for a draft too, greyed by a line of explanation rather than
 * hidden. A teacher setting work wants to paste the link into next lesson's plan
 * before they publish, and a control that appears only after an unrelated action
 * is a control nobody finds.
 */
export default function ShareActivity({ activity, published }) {
  const t = useT()
  const [copied, setCopied] = useState(null)

  // The "Copied" label is a two-second acknowledgement, not a state worth
  // keeping: clearing it on unmount stops a stray timer from setting state on a
  // component that has gone.
  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(null), 2000)
    return () => clearTimeout(timer)
  }, [copied])

  if (!activity.code) return null

  const link = `${window.location.origin}/join/${activity.code}`

  /**
   * `navigator.clipboard` needs a secure context and permission, and neither is
   * guaranteed — an http:// staging box has the first missing. The code and the
   * link are both on screen and selectable, so a refusal costs nothing but the
   * convenience, and it must not throw an unhandled rejection.
   */
  const copy = async (what, text) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(what)
    } catch {
      setCopied(null)
    }
  }

  return (
    <section className="cs-card" style={{ marginTop: 'var(--s-4)' }}>
      <p className="eyebrow">{t('editor.shareHead')}</p>

      <div className="cs-row" style={{ marginTop: 'var(--s-3)' }}>
        <div className="cs-field">
          <span className="cs-label">{t('editor.shareCode')}</span>
          <p
            className="mono"
            style={{ fontSize: 'var(--t-28)', letterSpacing: '0.08em', margin: 0 }}
          >
            {activity.code}
          </p>
          <div className="cs-actions" style={{ marginTop: 'var(--s-2)' }}>
            <button
              type="button"
              className="cs-btn cs-btn-sm"
              onClick={() => copy('code', activity.code)}
            >
              {copied === 'code' ? t('editor.copied') : t('editor.copyCode')}
            </button>
          </div>
        </div>

        <div className="cs-field">
          <span className="cs-label">{t('editor.shareLink')}</span>
          <p className="mono cs-hint" style={{ margin: 0, overflowWrap: 'anywhere' }}>
            {link}
          </p>
          <div className="cs-actions" style={{ marginTop: 'var(--s-2)' }}>
            <button type="button" className="cs-btn cs-btn-sm" onClick={() => copy('link', link)}>
              {copied === 'link' ? t('editor.copied') : t('editor.copyLink')}
            </button>
            <a className="cs-btn cs-btn-sm" href={link} target="_blank" rel="noreferrer">
              {t('editor.openLink')}
            </a>
          </div>
        </div>
      </div>

      <p className="cs-hint" style={{ marginTop: 'var(--s-3)', marginBottom: 0 }}>
        {published ? t('editor.shareHint') : t('editor.shareDraft')}
      </p>
    </section>
  )
}
