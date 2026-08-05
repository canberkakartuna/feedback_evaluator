import { useState } from 'react'
import { useT } from '../lib/i18n'
import './Entry.css'

/**
 * The research consent notice, and the checkbox that records agreement to it.
 *
 * One component because there are now two doors into a session — the list on the
 * entry screen and a class code at /join — and a consent form that differs
 * between two paths into the same study is a consent form nobody can quote. Both
 * doors render this, and the server refuses a session either way without it (see
 * routes/sessions.js).
 *
 * **Staff never see this**, because staff never get this far. They are not
 * participants and cannot start a session at all: StudentLayout sends them to
 * their console, and routes/sessions.js refuses a staff account. Nobody is shown
 * a form addressed to somebody else, and nobody has a record written for them
 * that says they agreed to something they were never asked.
 *
 * The wording is a PLACEHOLDER in both languages. Replace it with the text your
 * ethics committee approves — in src/lib/strings.js, under `entry.consent` —
 * before this goes near a real student.
 */
export default function ConsentCard({ eyebrow, onAgree, onDecline }) {
  const t = useT()
  const [agreed, setAgreed] = useState(false)

  return (
    <div className="en-card">
      <p className="eyebrow">{eyebrow}</p>
      <h1 className="en-title">{t('entry.consent.title')}</h1>
      <p className="en-lede">{t('entry.consent.lede')}</p>

      <div className="en-terms">
        <h2 className="en-terms-head">{t('entry.consent.recordedHead')}</h2>
        <ul className="en-list">
          <li>{t('entry.consent.recorded1')}</li>
          <li>{t('entry.consent.recorded2')}</li>
          <li>{t('entry.consent.recorded3')}</li>
        </ul>

        <h2 className="en-terms-head">{t('entry.consent.usedHead')}</h2>
        <ul className="en-list">
          <li>{t('entry.consent.used1')}</li>
          <li>{t('entry.consent.used2')}</li>
          <li>{t('entry.consent.used3')}</li>
        </ul>

        <p className="en-warn">{t('entry.consent.warn')}</p>
      </div>

      <label className="en-agree">
        <input
          type="checkbox"
          checked={agreed}
          onChange={(event) => setAgreed(event.target.checked)}
        />
        <span>{t('entry.consent.agree')}</span>
      </label>

      <div className="en-actions">
        <button
          type="button"
          className="en-btn en-btn-primary"
          disabled={!agreed}
          onClick={onAgree}
        >
          {t('entry.consent.continue')}
        </button>
        <button type="button" className="en-btn" onClick={onDecline}>
          {t('entry.consent.decline')}
        </button>
      </div>
    </div>
  )
}
